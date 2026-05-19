"""Meiosis-atlas normalizer extractor — maps a staging payload's raw rows
to the canonical tract_classifications_v1 column set with type coercion,
class counts, and a summary block.

Mirrors relatedness's normalize_relatedness extractor. Default column_map
is the identity for ngsTracts STEP_TRC_01 output (column names already
match METHODOLOGY.md §5.1); callers can override via
manifest.params.column_map for producers that use different names.
"""
from __future__ import annotations

import json
import pathlib
from typing import Any, Dict, List, Optional, Set


# Identity column map by default — ngsTracts METHODOLOGY §5.1 already uses
# the canonical names. Override per-action via params.column_map if a
# producer renames anything.
_CANONICAL_COLS: List[str] = [
    "interval_id", "parent_id", "offspring_id", "chrom",
    "start", "end", "span_bp",
    "class", "confidence",
    "flanking_left_state", "flanking_right_state", "departure_state",
    "n_sites", "n_discordant", "inside_inversion",
    "distance_to_nearest_inv_bp", "prior_log_ratio_co_nco",
    "refined_breakpoint_bp", "refined_ci_left", "refined_ci_right",
    "manual_review_flag", "notes",
]

_INTEGER_COLS = {
    "start", "end", "span_bp", "n_sites", "n_discordant",
    "distance_to_nearest_inv_bp",
    "refined_breakpoint_bp", "refined_ci_left", "refined_ci_right",
}
_FLOAT_COLS = {"prior_log_ratio_co_nco"}
_STRING_COLS = {
    "interval_id", "parent_id", "offspring_id", "chrom",
    "class", "confidence",
    "flanking_left_state", "flanking_right_state", "departure_state",
    "inside_inversion", "notes",
}
_BOOL_COLS = {"manual_review_flag"}

# Sentinel for "missing int" in ngsTracts output (SCHEMA.md §
# distance_to_nearest_inv_bp uses '-' when no inversions on chrom).
_NULL_SENTINELS = {"", "NA", "NaN", "-", "null", "None"}

_CLASS_VALUES = ("NCO", "CO", "DCO", "MOSAIC_SHORT", "MOSAIC_LONG", "AMBIG", "LOW_CONFIDENCE")


def _coerce_int(v: Any) -> Optional[int]:
    if v is None: return None
    if isinstance(v, bool): return int(v)  # avoid bool→int False positives below
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


def _coerce_bool(v: Any) -> Optional[bool]:
    if v is None: return None
    if isinstance(v, bool): return v
    if isinstance(v, (int, float)):
        return bool(v) if v in (0, 1) else None
    s = str(v).strip().lower()
    if s in _NULL_SENTINELS: return None
    if s in ("1", "true", "t", "yes", "y"):  return True
    if s in ("0", "false", "f", "no", "n"):  return False
    return None


def _coerce_str(v: Any) -> Optional[str]:
    if v is None: return None
    s = str(v).strip()
    if s in _NULL_SENTINELS and s != "-":
        # distance_to_nearest_inv_bp sentinel '-' is handled per-column;
        # for true string cols (notes etc.) treat '-' as a normal value.
        return None
    return s


def _coerce_field(name: str, val: Any) -> Any:
    if name in _INTEGER_COLS:
        return _coerce_int(val)
    if name in _FLOAT_COLS:
        return _coerce_float(val)
    if name in _BOOL_COLS:
        return _coerce_bool(val)
    if name in _STRING_COLS:
        return _coerce_str(val)
    # Pass-through for any column not in the canonical set.
    return val


def extract(raw_outputs: Dict[str, str], params: Dict[str, Any]) -> Dict[str, Any]:
    src = pathlib.Path(raw_outputs["source_envelope"])
    env = json.loads(src.read_text(encoding="utf-8"))
    payload = env.get("payload") or {}
    rows = payload.get("rows") or []

    user_map: Dict[str, str] = dict(params.get("column_map") or {})

    tracts: List[Dict[str, Any]] = []
    class_counts: Dict[str, int] = {c: 0 for c in _CLASS_VALUES}
    dyads: Set[str] = set()
    chroms: Set[str] = set()
    n_inside_inv = 0

    for r in rows:
        if not isinstance(r, dict):
            continue
        out: Dict[str, Any] = {}
        for canon in _CANONICAL_COLS:
            # Source key: user override → identity (canon itself).
            src_key = next((s for s, d in user_map.items() if d == canon), canon)
            if src_key not in r:
                continue
            out[canon] = _coerce_field(canon, r[src_key])

        # Drop rows missing the row-identifying interval_id.
        if not out.get("interval_id"):
            continue

        # Bookkeeping for summary.
        cls = out.get("class")
        if cls in class_counts:
            class_counts[cls] += 1
        p, o = out.get("parent_id"), out.get("offspring_id")
        if p and o:
            dyads.add(f"{p}\x00{o}")
        if out.get("chrom"):
            chroms.add(out["chrom"])
        if out.get("inside_inversion") == "yes":
            n_inside_inv += 1

        tracts.append(out)

    summary: Dict[str, Any] = {
        "n_tracts":           len(tracts),
        "n_dyads":            len(dyads),
        "n_chroms":           len(chroms),
        "class_counts":       class_counts,
        "n_inside_inversion": n_inside_inv,
    }
    return {"tracts": tracts, "summary": summary}
