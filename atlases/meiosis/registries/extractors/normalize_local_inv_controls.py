"""Meiosis-atlas normalizer extractor — maps a staging payload's raw rows
to the canonical local_inv_controls_v1 column set with type coercion,
length_bp derivation, frequency-range clamp to null, and a summary block.

Mirrors normalize_tract_classifications + normalize_chromosome_meiosis_events.
Default column_map is the identity (column names already canonical per
SPEC_local_inv_controls_adapter.md §3); callers can override via
manifest.params.column_map for producers that use different names.

Per-row behaviour:
  - tested_chrom, inversion_id            → string (required for inclusion)
  - start_bp                              → int (required for inclusion)
  - inversion_chrom, ascertainment        → string (null on null sentinel)
  - end_bp, length_bp, n_het_carriers,
    n_carriers                            → int (null on parse failure)
  - frequency, freq_min_filter            → float in [0, 1] (out-of-range → null)
  - length_bp                             → DERIVED as end_bp - start_bp + 1
                                            when producer omits it

Ascertainment enum values: {high_confidence, low_confidence, tentative};
unknown values coerce to null.
"""
from __future__ import annotations

import json
import pathlib
from typing import Any, Dict, List, Optional, Set


_CANONICAL_COLS: List[str] = [
    "tested_chrom", "inversion_id", "inversion_chrom",
    "start_bp", "end_bp", "length_bp",
    "frequency", "n_het_carriers", "n_carriers",
    "ascertainment", "freq_min_filter",
]

_INTEGER_COLS = {"start_bp", "end_bp", "length_bp", "n_het_carriers", "n_carriers"}
_FLOAT_COLS = {"frequency", "freq_min_filter"}
_STRING_COLS = {"tested_chrom", "inversion_id", "inversion_chrom"}
_ENUM_COLS = {"ascertainment"}

_NULL_SENTINELS = {"", "NA", "NaN", "-", "null", "None"}
_ASCERTAIN_VALUES = ("high_confidence", "low_confidence", "tentative")


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


def _coerce_float(v: Any) -> Optional[float]:
    if v is None: return None
    if isinstance(v, bool): return float(v)
    if isinstance(v, (int, float)):
        f = float(v)
        return None if f != f else f
    s = str(v).strip()
    if s in _NULL_SENTINELS:
        return None
    try:
        f = float(s)
    except (TypeError, ValueError):
        return None
    return None if f != f else f


def _coerce_freq(v: Any) -> Optional[float]:
    """Frequency cols are in [0, 1]. Out-of-range coerces to null —
    producer should have caught it, but the typed schema enforces."""
    f = _coerce_float(v)
    if f is None: return None
    if f < 0.0 or f > 1.0:
        return None
    return f


def _coerce_str(v: Any) -> Optional[str]:
    if v is None: return None
    s = str(v).strip()
    if s in _NULL_SENTINELS:
        return None
    return s


def _coerce_ascertain(v: Any) -> Optional[str]:
    s = _coerce_str(v)
    if s is None: return None
    return s if s in _ASCERTAIN_VALUES else None


def _coerce_field(name: str, val: Any) -> Any:
    if name in _INTEGER_COLS: return _coerce_int(val)
    if name in _FLOAT_COLS:   return _coerce_freq(val)
    if name in _STRING_COLS:  return _coerce_str(val)
    if name in _ENUM_COLS:    return _coerce_ascertain(val)
    return val


def _derive_length_bp(start: Optional[int], end: Optional[int]) -> Optional[int]:
    if start is None or end is None:
        return None
    length = end - start + 1
    return length if length >= 1 else None


def extract(raw_outputs: Dict[str, str], params: Dict[str, Any]) -> Dict[str, Any]:
    src = pathlib.Path(raw_outputs["source_envelope"])
    env = json.loads(src.read_text(encoding="utf-8"))
    payload = env.get("payload") or {}
    rows = payload.get("rows") or []

    user_map: Dict[str, str] = dict(params.get("column_map") or {})

    controls: List[Dict[str, Any]] = []
    chroms: Set[str] = set()
    inversions: Set[str] = set()

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
        if not (out.get("tested_chrom") and out.get("inversion_id") and out.get("start_bp")):
            continue

        # Derive length_bp when absent.
        if out.get("length_bp") is None:
            out["length_bp"] = _derive_length_bp(out.get("start_bp"), out.get("end_bp"))

        chroms.add(out["tested_chrom"])
        inversions.add(out["inversion_id"])
        controls.append(out)

    # n_chroms_with_controls counts chroms that survived the row drops.
    # Today this equals n_chroms because the row-drop step keeps tested_chrom
    # only when at least one valid row exists. Kept as a distinct field for
    # forward compatibility (when producer can emit chroms with zero local
    # inversions explicitly).
    summary: Dict[str, Any] = {
        "n_controls":             len(controls),
        "n_chroms":               len(chroms),
        "n_inversions":           len(inversions),
        "n_chroms_with_controls": len(chroms),
        "mean_inv_per_chrom":     (len(controls) / len(chroms)) if chroms else None,
    }
    return {"controls": controls, "summary": summary}
