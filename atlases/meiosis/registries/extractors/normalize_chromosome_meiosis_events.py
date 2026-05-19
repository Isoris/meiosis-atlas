"""Meiosis-atlas normalizer extractor — maps a staging payload's raw rows
to the canonical chromosome_meiosis_events_v1 column set with type
coercion, derived rate fields, and a summary block.

Mirrors normalize_tract_classifications. Default column_map is the
identity (column names already canonical per SPEC_crossovers_page.md
§3.1); callers can override via manifest.params.column_map for
producers that use different names.

Per-row behaviour:
  - parent_id, offspring_id, chrom               → string (required for inclusion)
  - chrom_len_bp, n_co, n_dco, n_nco,
    mean_co_position_bp, median_co_position_bp   → int (null on parse failure)
  - co_per_mb, dco_per_mb                        → float (null on parse failure)
  - karyotype_at_focal_inv                       → string ∈ {homA, het, homB} or null

When co_per_mb / dco_per_mb are missing AND n_co / chrom_len_bp are
present, the rate is derived as n_x / chrom_len_bp * 1e6. This keeps
the renderer single-shape regardless of which fields the producer
emits.
"""
from __future__ import annotations

import json
import pathlib
from typing import Any, Dict, List, Optional, Set


_CANONICAL_COLS: List[str] = [
    "parent_id", "offspring_id", "chrom", "chrom_len_bp",
    "n_co", "n_dco", "n_nco",
    "co_per_mb", "dco_per_mb",
    "mean_co_position_bp", "median_co_position_bp",
    "karyotype_at_focal_inv",
]

_INTEGER_COLS = {
    "chrom_len_bp", "n_co", "n_dco", "n_nco",
    "mean_co_position_bp", "median_co_position_bp",
}
_FLOAT_COLS = {"co_per_mb", "dco_per_mb"}
_STRING_COLS = {"parent_id", "offspring_id", "chrom"}
_ENUM_COLS = {"karyotype_at_focal_inv"}

_NULL_SENTINELS = {"", "NA", "NaN", "-", "null", "None"}
_KARYO_VALUES = ("homA", "het", "homB")


def _coerce_int(v: Any) -> Optional[int]:
    if v is None: return None
    if isinstance(v, bool): return int(v)
    if isinstance(v, int):  return v
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


def _coerce_str(v: Any) -> Optional[str]:
    if v is None: return None
    s = str(v).strip()
    if s in _NULL_SENTINELS and s != "-":
        return None
    return s


def _coerce_karyo(v: Any) -> Optional[str]:
    s = _coerce_str(v)
    if s is None or s == "-":
        return None
    return s if s in _KARYO_VALUES else None


def _coerce_field(name: str, val: Any) -> Any:
    if name in _INTEGER_COLS: return _coerce_int(val)
    if name in _FLOAT_COLS:   return _coerce_float(val)
    if name in _STRING_COLS:  return _coerce_str(val)
    if name in _ENUM_COLS:    return _coerce_karyo(val)
    return val


def _derive_rate_per_mb(n: Optional[int], chrom_len_bp: Optional[int]) -> Optional[float]:
    if n is None or chrom_len_bp is None or chrom_len_bp <= 0:
        return None
    return float(n) / chrom_len_bp * 1e6


def extract(raw_outputs: Dict[str, str], params: Dict[str, Any]) -> Dict[str, Any]:
    src = pathlib.Path(raw_outputs["source_envelope"])
    env = json.loads(src.read_text(encoding="utf-8"))
    payload = env.get("payload") or {}
    rows = payload.get("rows") or []

    user_map: Dict[str, str] = dict(params.get("column_map") or {})

    events: List[Dict[str, Any]] = []
    dyads: Set[str] = set()
    chroms: Set[str] = set()
    sum_co  = 0
    sum_dco = 0
    sum_nco = 0
    n_karyo_strat = 0

    for r in rows:
        if not isinstance(r, dict):
            continue
        out: Dict[str, Any] = {}
        for canon in _CANONICAL_COLS:
            src_key = next((s for s, d in user_map.items() if d == canon), canon)
            if src_key not in r:
                continue
            out[canon] = _coerce_field(canon, r[src_key])

        # Required identifiers — drop rows missing any of the three.
        if not (out.get("parent_id") and out.get("offspring_id") and out.get("chrom")):
            continue

        # Derive co_per_mb / dco_per_mb when absent.
        if out.get("co_per_mb") is None:
            out["co_per_mb"] = _derive_rate_per_mb(out.get("n_co"), out.get("chrom_len_bp"))
        if out.get("dco_per_mb") is None:
            out["dco_per_mb"] = _derive_rate_per_mb(out.get("n_dco"), out.get("chrom_len_bp"))

        # Bookkeeping for summary.
        dyads.add(f"{out['parent_id']}\x00{out['offspring_id']}")
        chroms.add(out["chrom"])
        if isinstance(out.get("n_co"),  int): sum_co  += out["n_co"]
        if isinstance(out.get("n_dco"), int): sum_dco += out["n_dco"]
        if isinstance(out.get("n_nco"), int): sum_nco += out["n_nco"]
        if out.get("karyotype_at_focal_inv") is not None:
            n_karyo_strat += 1

        events.append(out)

    summary: Dict[str, Any] = {
        "n_rows":               len(events),
        "n_dyads":              len(dyads),
        "n_chroms":             len(chroms),
        "sum_n_co":             sum_co,
        "sum_n_dco":            sum_dco,
        "sum_n_nco":            sum_nco,
        "karyotype_strat_rows": n_karyo_strat,
    }
    return {"events": events, "summary": summary}
