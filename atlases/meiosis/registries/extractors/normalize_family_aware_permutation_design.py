"""Meiosis-atlas normalizer extractor — maps a staging payload's raw rows
to the canonical family_aware_permutation_design_v1 column set with
type coercion, karyotype enum check, identifier drop, and a summary
block (including n_singleton_blocks for the consumer's degeneracy
diagnostic).

Mirrors normalize_tract_classifications / normalize_chromosome_meiosis_events /
normalize_local_inv_controls. Default column_map is the identity
(column names already canonical per
SPEC_family_aware_permutation_design_adapter.md §3); callers can
override via manifest.params.column_map.

Per-row behaviour:
  - focal_inversion_id, parent_id, family_id, permutation_block,
    hub_id                        → string (required identifiers drop the row when missing)
  - karyotype                     → enum {homA, het, homB}; unknown values drop the row
  - n_offspring                   → int (null on parse failure)

Summary computes n_singleton_blocks: count of permutation blocks
(distinct by permutation_block id, NOT per focal inversion) containing
exactly one parent. High N → degenerate null; consumer should widen.
"""
from __future__ import annotations

import collections
import json
import pathlib
from typing import Any, Dict, List, Optional, Set


_CANONICAL_COLS: List[str] = [
    "focal_inversion_id", "parent_id", "family_id",
    "karyotype", "permutation_block",
    "hub_id", "n_offspring",
]

_REQUIRED_IDS = ("focal_inversion_id", "parent_id", "family_id", "karyotype", "permutation_block")
_INTEGER_COLS = {"n_offspring"}
_STRING_COLS = {"focal_inversion_id", "parent_id", "family_id", "permutation_block", "hub_id"}
_ENUM_COLS = {"karyotype"}

_NULL_SENTINELS = {"", "NA", "NaN", "-", "null", "None"}
_KARYO_VALUES = ("homA", "het", "homB")


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
    if name in _INTEGER_COLS: return _coerce_int(val)
    if name in _STRING_COLS:  return _coerce_str(val)
    if name in _ENUM_COLS:    return _coerce_karyo(val)
    return val


def extract(raw_outputs: Dict[str, str], params: Dict[str, Any]) -> Dict[str, Any]:
    src = pathlib.Path(raw_outputs["source_envelope"])
    env = json.loads(src.read_text(encoding="utf-8"))
    payload = env.get("payload") or {}
    rows = payload.get("rows") or []

    user_map: Dict[str, str] = dict(params.get("column_map") or {})

    assignments: List[Dict[str, Any]] = []
    focal_invs: Set[str] = set()
    families: Set[str] = set()
    blocks: Set[str] = set()
    parents: Set[str] = set()
    karyo_counts: Dict[str, int] = {k: 0 for k in _KARYO_VALUES}

    # Track (block, parent) pairs so we can count singleton blocks afterwards
    # (a block whose set of distinct parents == 1).
    block_parents: Dict[str, Set[str]] = collections.defaultdict(set)

    for r in rows:
        if not isinstance(r, dict):
            continue
        out: Dict[str, Any] = {}
        for canon in _CANONICAL_COLS:
            src_key = next((s for s, d in user_map.items() if d == canon), canon)
            if src_key not in r:
                continue
            out[canon] = _coerce_field(canon, r[src_key])

        # Drop rows missing any of the 5 required identifiers (including
        # karyotype — unknown values coerce to None and trip this check).
        if not all(out.get(k) for k in _REQUIRED_IDS):
            continue

        focal_invs.add(out["focal_inversion_id"])
        families.add(out["family_id"])
        blocks.add(out["permutation_block"])
        parents.add(out["parent_id"])
        karyo_counts[out["karyotype"]] += 1
        block_parents[out["permutation_block"]].add(out["parent_id"])

        assignments.append(out)

    n_singleton_blocks = sum(1 for ps in block_parents.values() if len(ps) == 1)

    summary: Dict[str, Any] = {
        "n_assignments":        len(assignments),
        "n_focal_inversions":   len(focal_invs),
        "n_families":           len(families),
        "n_permutation_blocks": len(blocks),
        "n_parents":            len(parents),
        "karyotype_counts":     karyo_counts,
        "n_singleton_blocks":   n_singleton_blocks,
    }
    return {"assignments": assignments, "summary": summary}
