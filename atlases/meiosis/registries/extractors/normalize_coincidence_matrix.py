"""Meiosis-atlas normalizer extractor — maps a staging payload's raw rows
to the canonical coincidence_matrix_v1 column set with type coercion,
c_coincidence derivation, negative-interference flagging, mean/median
across non-null C, and a summary block.

Fifth meiosis-atlas normalize extractor; mirrors the prior four
(tract_classifications, chromosome_meiosis_events, local_inv_controls,
family_aware_permutation_design). Default column_map is the identity
per SPEC_coincidence_matrix_adapter.md §3; override via
manifest.params.column_map.

Per-row behaviour:
  - chrom, interval_a_id, interval_b_id   → string (required for inclusion)
  - focal_inversion_id                    → string (null on null sentinel)
  - *_start_bp, *_end_bp, n_offspring     → int (null on parse failure)
  - r_a, r_b, r_ab, c_coincidence         → float ≥ 0 (negative → null)
  - karyotype_at_focal_inv                → enum {homA, het, homB} else null
  - c_coincidence                         → DERIVED as r_ab / (r_a * r_b)
                                             when producer omits it AND
                                             all three inputs are present
                                             AND r_a * r_b > 0
  - neg_interference_flagged              → True when c_coincidence > threshold
                                             (default 3.0; override via
                                             params.neg_interference_threshold)
"""
from __future__ import annotations

import json
import pathlib
import statistics
from typing import Any, Dict, List, Optional, Set


_CANONICAL_COLS: List[str] = [
    "chrom", "interval_a_id", "interval_b_id",
    "interval_a_start_bp", "interval_a_end_bp",
    "interval_b_start_bp", "interval_b_end_bp",
    "r_a", "r_b", "r_ab", "c_coincidence",
    "n_offspring",
    "karyotype_at_focal_inv", "focal_inversion_id",
]

_REQUIRED_IDS = ("chrom", "interval_a_id", "interval_b_id")
_INTEGER_COLS = {
    "interval_a_start_bp", "interval_a_end_bp",
    "interval_b_start_bp", "interval_b_end_bp",
    "n_offspring",
}
_NONNEG_FLOAT_COLS = {"r_a", "r_b", "r_ab", "c_coincidence"}
_STRING_COLS = {"chrom", "interval_a_id", "interval_b_id", "focal_inversion_id"}
_ENUM_COLS = {"karyotype_at_focal_inv"}

_NULL_SENTINELS = {"", "NA", "NaN", "-", "null", "None"}
_KARYO_VALUES = ("homA", "het", "homB")

_DEFAULT_NEG_INTERFERENCE_THRESHOLD = 3.0


def _coerce_int(v: Any) -> Optional[int]:
    if v is None: return None
    if isinstance(v, bool): return int(v)
    if isinstance(v, int): return v
    if isinstance(v, float):
        if v != v:  # NaN
            return None
        return int(v)
    s = str(v).strip()
    if s in _NULL_SENTINELS:
        return None
    try:
        return int(float(s))
    except (TypeError, ValueError):
        return None


def _coerce_nonneg_float(v: Any) -> Optional[float]:
    """rates and C must be ≥ 0; negatives coerce to null."""
    if v is None: return None
    if isinstance(v, bool): return float(v)
    if isinstance(v, (int, float)):
        f = float(v)
        if f != f or f < 0.0:  # NaN or negative
            return None
        return f
    s = str(v).strip()
    if s in _NULL_SENTINELS:
        return None
    try:
        f = float(s)
    except (TypeError, ValueError):
        return None
    if f != f or f < 0.0:
        return None
    return f


def _coerce_str(v: Any) -> Optional[str]:
    if v is None: return None
    s = str(v).strip()
    if s in _NULL_SENTINELS:
        return None
    return s


def _coerce_karyo(v: Any) -> Optional[str]:
    s = _coerce_str(v)
    if s is None:
        return None
    return s if s in _KARYO_VALUES else None


def _coerce_field(name: str, val: Any) -> Any:
    if name in _INTEGER_COLS:       return _coerce_int(val)
    if name in _NONNEG_FLOAT_COLS:  return _coerce_nonneg_float(val)
    if name in _STRING_COLS:        return _coerce_str(val)
    if name in _ENUM_COLS:          return _coerce_karyo(val)
    return val


def _derive_c(r_a: Optional[float], r_b: Optional[float],
              r_ab: Optional[float]) -> Optional[float]:
    """C = r_ab / (r_a * r_b); null when inputs missing OR r_a * r_b == 0."""
    if r_a is None or r_b is None or r_ab is None:
        return None
    denom = r_a * r_b
    if denom <= 0.0:
        return None
    return r_ab / denom


def _median_nonnull(xs: List[float]) -> Optional[float]:
    vals = [x for x in xs if x is not None]
    if not vals:
        return None
    return statistics.median(vals)


def _mean_nonnull(xs: List[float]) -> Optional[float]:
    vals = [x for x in xs if x is not None]
    if not vals:
        return None
    return sum(vals) / len(vals)


def extract(raw_outputs: Dict[str, str], params: Dict[str, Any]) -> Dict[str, Any]:
    src = pathlib.Path(raw_outputs["source_envelope"])
    env = json.loads(src.read_text(encoding="utf-8"))
    payload = env.get("payload") or {}
    rows = payload.get("rows") or []

    user_map: Dict[str, str] = dict(params.get("column_map") or {})
    try:
        threshold = float(params.get("neg_interference_threshold",
                                     _DEFAULT_NEG_INTERFERENCE_THRESHOLD))
    except (TypeError, ValueError):
        threshold = _DEFAULT_NEG_INTERFERENCE_THRESHOLD
    if threshold < 1.0:
        threshold = _DEFAULT_NEG_INTERFERENCE_THRESHOLD

    pairs: List[Dict[str, Any]] = []
    chroms: Set[str] = set()
    focal_invs: Set[str] = set()
    n_stratified = 0
    karyo_counts: Dict[str, int] = {k: 0 for k in _KARYO_VALUES}
    c_values: List[Optional[float]] = []
    n_flagged = 0

    for r in rows:
        if not isinstance(r, dict):
            continue
        out: Dict[str, Any] = {}
        for canon in _CANONICAL_COLS:
            src_key = next((s for s, d in user_map.items() if d == canon), canon)
            if src_key not in r:
                continue
            out[canon] = _coerce_field(canon, r[src_key])

        # Required identifiers — drop rows missing any.
        if not all(out.get(k) for k in _REQUIRED_IDS):
            continue

        # Derive c_coincidence when producer omitted it.
        if out.get("c_coincidence") is None:
            out["c_coincidence"] = _derive_c(
                out.get("r_a"), out.get("r_b"), out.get("r_ab"),
            )

        # Flag artefact-likely rows.
        c = out.get("c_coincidence")
        if isinstance(c, (int, float)) and c > threshold:
            out["neg_interference_flagged"] = True
            n_flagged += 1
        else:
            out["neg_interference_flagged"] = False if isinstance(c, (int, float)) else None

        chroms.add(out["chrom"])
        if out.get("focal_inversion_id"):
            focal_invs.add(out["focal_inversion_id"])
        if out.get("karyotype_at_focal_inv"):
            n_stratified += 1
            karyo_counts[out["karyotype_at_focal_inv"]] += 1
        c_values.append(out.get("c_coincidence"))

        pairs.append(out)

    summary: Dict[str, Any] = {
        "n_pairs":                    len(pairs),
        "n_chroms":                   len(chroms),
        "n_focal_inversions":         len(focal_invs),
        "n_stratified_rows":          n_stratified,
        "karyotype_counts":           karyo_counts,
        "mean_c":                     _mean_nonnull(c_values),
        "median_c":                   _median_nonnull(c_values),
        "n_neg_interference_flagged": n_flagged,
        "neg_interference_threshold": threshold,
    }
    return {"pairs": pairs, "summary": summary}
