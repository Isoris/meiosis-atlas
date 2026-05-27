"""Smoke test for the v2 per-candidate NCO chain.

Covers:
  - crosstab_per_candidate: chrom restriction, NCO-like filter, missing
    coord drops, skipped flag for candidates missing chrom/start_bp/end_bp.
  - compute_nco_per_candidate: per-candidate Fisher + BH/Bonferroni across
    the candidate set, sig_flag, summary counts, NaN/Inf JSON-strict
    serialization, designed-significant fixture, BH monotone preservation.
  - Cross-atlas envelope shape tolerance: candidates pulled from either
    payload.candidates or payload.inversions key (different envelopes
    might use either).
  - Runner + extractor round-trip in a temp workspace with named and
    ordered target forms; missing required envelope raises.

Run from the meiosis-atlas root:
    python3 atlases/meiosis/registries/test_nco_per_candidate.py
"""
from __future__ import annotations

import json
import math
import os
import pathlib
import sys
import tempfile

HERE = pathlib.Path(__file__).parent
sys.path.insert(0, str(HERE))

from runners.meiosis_nco_per_candidate import (
    crosstab_per_candidate,
    compute_nco_per_candidate,
)

_failed = 0; _passed = 0


def _approx(a, b, tol=1e-6):
    if a is None or b is None:
        return a is None and b is None
    return abs(a - b) <= tol


def ok(cond, msg):
    global _failed, _passed
    if cond: _passed += 1; print(f"  ok: {msg}")
    else:    _failed += 1; print(f"  FAIL: {msg}")


# -------------------------------------------------------------------
# crosstab_per_candidate
# -------------------------------------------------------------------
print("crosstab_per_candidate")

CAND = {"candidate_id": "INV01", "chrom": "LG07",
        "start_bp": 10_000_000, "end_bp": 12_000_000}

TRACTS = [
    # LG07 inside INV01 — MOSAIC_SHORT
    {"class": "MOSAIC_SHORT", "chrom": "LG07", "start": 10_500_000, "end": 10_700_000},
    {"class": "MOSAIC_SHORT", "chrom": "LG07", "start": 11_000_000, "end": 11_100_000},
    # LG07 outside INV01 — MOSAIC_SHORT
    {"class": "MOSAIC_SHORT", "chrom": "LG07", "start":  5_000_000, "end":  5_100_000},
    # LG07 inside INV01 — NCO
    {"class": "NCO",          "chrom": "LG07", "start": 11_900_000, "end": 11_950_000},
    # LG07 outside INV01 — NCO (3 of them)
    {"class": "NCO",          "chrom": "LG07", "start":  1_000_000, "end":  1_100_000},
    {"class": "NCO",          "chrom": "LG07", "start":  2_000_000, "end":  2_100_000},
    {"class": "NCO",          "chrom": "LG07", "start":  3_000_000, "end":  3_100_000},
    # Boundary-overlapping tract — should still count as inside (overlaps by 1bp)
    {"class": "MOSAIC_SHORT", "chrom": "LG07", "start":  9_000_000, "end": 10_000_000},
    # CO — should be excluded (not NCO-like)
    {"class": "CO",           "chrom": "LG07", "start": 10_400_000, "end": 10_400_500},
    # Other chrom — should not count
    {"class": "MOSAIC_SHORT", "chrom": "LG12", "start": 11_000_000, "end": 11_100_000},
    # Missing coords — excluded
    {"class": "NCO",          "chrom": "LG07", "start": None, "end": None},
]

xt = crosstab_per_candidate(TRACTS, CAND)
ok(xt["n_in_target"]  == 3, f"a=3 MOSAIC_SHORT inside (incl. boundary overlap), got {xt['n_in_target']}")
ok(xt["n_out_target"] == 1, "b=1 MOSAIC_SHORT outside on chrom")
ok(xt["n_in_other"]   == 1, "c=1 NCO inside")
ok(xt["n_out_other"]  == 3, "d=3 NCO outside on chrom")
ok(xt["n_total_on_chrom"] == 10, "total on chrom = 10 (all LG07 tracts; LG12 excluded)")
ok(xt["n_excluded"]   == 2, "excluded = 2 (CO + missing-coords)")
ok(xt["skipped"]      is False, "candidate has full span → not skipped")
ok(xt["target_class"] == "MOSAIC_SHORT", "target_class echoed")

# Candidate missing fields → skipped
xt_bad = crosstab_per_candidate(TRACTS, {"candidate_id": "INV02"})
ok(xt_bad["skipped"] is True, "candidate without chrom/start_bp/end_bp → skipped")

# Empty tracts
xt_empty = crosstab_per_candidate([], CAND)
ok(xt_empty["n_in_target"] == 0 and xt_empty["n_total_on_chrom"] == 0,
   "empty tract list → zeros")

# target_class=NCO swap
xt_nco = crosstab_per_candidate(TRACTS, CAND, target_class="NCO")
ok(xt_nco["n_in_target"]  == 1, "target=NCO: a = 1 (NCO inside)")
ok(xt_nco["n_in_other"]   == 3, "target=NCO: c = 3 MOSAIC_SHORT inside")
ok(xt_nco["target_class"] == "NCO", "target_class swapped")

# -------------------------------------------------------------------
# compute_nco_per_candidate — designed fixture with one sig candidate
# -------------------------------------------------------------------
print("compute_nco_per_candidate")

# Two candidates: INV_SIG has strong MOSAIC_SHORT enrichment inside, INV_NULL has none.
CANDS_FIX = [
    {"candidate_id": "INV_SIG",  "chrom": "LG01",
     "start_bp": 5_000_000, "end_bp": 7_000_000},
    {"candidate_id": "INV_NULL", "chrom": "LG02",
     "start_bp": 5_000_000, "end_bp": 7_000_000},
    {"candidate_id": "INV_BAD"},  # missing coords → skipped
]

TRACTS_FIX = []
# INV_SIG: 6 MOSAIC_SHORT inside + 1 MOSAIC_SHORT outside + 1 NCO inside + 7 NCO outside
for i in range(6):
    TRACTS_FIX.append({"class": "MOSAIC_SHORT", "chrom": "LG01",
                       "start": 5_500_000 + i * 10_000, "end": 5_510_000 + i * 10_000})
TRACTS_FIX.append({"class": "MOSAIC_SHORT", "chrom": "LG01", "start":  1_000_000, "end":  1_010_000})
TRACTS_FIX.append({"class": "NCO",          "chrom": "LG01", "start":  6_500_000, "end":  6_510_000})
for i in range(7):
    TRACTS_FIX.append({"class": "NCO", "chrom": "LG01",
                       "start": 1_000_000 + i * 100_000, "end": 1_010_000 + i * 100_000})

# INV_NULL: balanced 3 MOSAIC_SHORT inside, 3 MOSAIC_SHORT outside, 3 NCO inside, 3 NCO outside
for i in range(3):
    TRACTS_FIX.append({"class": "MOSAIC_SHORT", "chrom": "LG02",
                       "start": 5_500_000 + i * 10_000, "end": 5_510_000 + i * 10_000})
    TRACTS_FIX.append({"class": "MOSAIC_SHORT", "chrom": "LG02",
                       "start": 2_000_000 + i * 10_000, "end": 2_010_000 + i * 10_000})
    TRACTS_FIX.append({"class": "NCO", "chrom": "LG02",
                       "start": 6_000_000 + i * 10_000, "end": 6_010_000 + i * 10_000})
    TRACTS_FIX.append({"class": "NCO", "chrom": "LG02",
                       "start": 2_500_000 + i * 10_000, "end": 2_510_000 + i * 10_000})

out = compute_nco_per_candidate(TRACTS_FIX, CANDS_FIX)
ok(set(out.keys()) >= {"per_candidate", "summary"}, "payload has both blocks")
ok(len(out["per_candidate"]) == 3, "one row per candidate (3)")

sig_row = next(r for r in out["per_candidate"] if r["candidate_id"] == "INV_SIG")
null_row = next(r for r in out["per_candidate"] if r["candidate_id"] == "INV_NULL")
bad_row  = next(r for r in out["per_candidate"] if r["candidate_id"] == "INV_BAD")

ok(sig_row["skipped"] is False,   "INV_SIG processed")
ok(sig_row["n_in_target"] == 6,    "INV_SIG a=6 MOSAIC_SHORT inside")
ok(sig_row["n_out_target"] == 1,   "INV_SIG b=1")
ok(sig_row["odds_ratio"] is not None and sig_row["odds_ratio"] > 1,
   f"INV_SIG OR > 1 (got {sig_row['odds_ratio']})")
ok(sig_row["p_fisher_one_sided_greater"] is not None
   and sig_row["p_fisher_one_sided_greater"] < 0.1,
   f"INV_SIG enrichment p < 0.1 (got {sig_row['p_fisher_one_sided_greater']:.4f})")
ok(sig_row["p_bh"]   is not None, "INV_SIG p_bh populated")
ok(sig_row["p_bonf"] is not None, "INV_SIG p_bonf populated")

ok(null_row["skipped"] is False,   "INV_NULL processed")
ok(null_row["sig_flag"] is False,  "INV_NULL not flagged")

ok(bad_row["skipped"] is True,     "INV_BAD skipped")
ok(bad_row["p_fisher_two_sided"] is None, "skipped row → null stats")
ok(bad_row["sig_flag"] is False,   "skipped row → sig_flag false")

# BH monotone: bonf >= bh for the same row.
for r in (sig_row, null_row):
    if r["p_bh"] is not None and r["p_bonf"] is not None:
        ok(r["p_bonf"] >= r["p_bh"] - 1e-12,
           f"{r['candidate_id']}: p_bonf >= p_bh (got bonf={r['p_bonf']:.4f}, bh={r['p_bh']:.4f})")

# Summary
ok(out["summary"]["n_candidates_total"]   == 3, "summary n_candidates_total = 3")
ok(out["summary"]["n_candidates_tested"]  == 2, "summary n_candidates_tested = 2")
ok(out["summary"]["n_candidates_skipped"] == 1, "summary n_candidates_skipped = 1")
ok(out["summary"]["target_class"] == "MOSAIC_SHORT", "summary target_class echoed")

# JSON strict-mode safe
try:
    json.dumps(out, allow_nan=False)
    ok(True, "payload JSON-serializes with allow_nan=False")
except (TypeError, ValueError) as e:
    ok(False, f"JSON-serialization raised: {e}")

# -------------------------------------------------------------------
# Runner + extractor round-trip
# -------------------------------------------------------------------
print("runner + extractor round-trip")

from runners.compute_nco_per_candidate import compute as runner_compute
from extractors.normalize_nco_per_candidate_result import extract as extract_result

with tempfile.TemporaryDirectory() as tmp:
    root = pathlib.Path(tmp)

    def _write_env(layer_id, kind, payload):
        d = root / "layers" / kind / "ds1"
        d.mkdir(parents=True, exist_ok=True)
        p = d / f"{layer_id}.json"
        p.write_text(json.dumps({"layer_id": layer_id, "payload": payload}),
                     encoding="utf-8")
        return str(p.relative_to(root))

    tracts_rel = _write_env("tracts_v2",  "tract_classifications",
                            {"tracts": TRACTS_FIX})
    cands_rel  = _write_env("cands_v2",   "inversion_candidates",
                            {"candidates": CANDS_FIX})

    idx_path = root / "registry" / "layers.registry.json"
    idx_path.parent.mkdir(parents=True, exist_ok=True)
    idx_path.write_text(json.dumps({
        "layers": [
            {"layer_id": "tracts_v2", "path": tracts_rel},
            {"layer_id": "cands_v2",  "path": cands_rel},
        ],
    }), encoding="utf-8")

    os.environ["ATLAS_PROJECT_ROOT"] = str(root)
    try:
        # Named-keys form
        raw = runner_compute({
            "action_id": "test_act_006",
            "target":    {"tracts_layer_id": "tracts_v2",
                          "candidates_layer_id": "cands_v2"},
            "params":    {"target_class": "MOSAIC_SHORT", "p_bh_alpha": 0.05},
        }, client=None)
        ok("nco_per_candidate_payload" in raw,
           "runner returns nco_per_candidate_payload path")
        payload = extract_result(raw, params={})
        ok("per_candidate" in payload and "summary" in payload,
           "extractor returns dispatcher-shaped payload")
        ok(any(r["candidate_id"] == "INV_SIG" and not r["skipped"]
               for r in payload["per_candidate"]),
           "round-trip preserves INV_SIG row")

        # Ordered fallback
        raw2 = runner_compute({
            "action_id": "test_act_007",
            "target":    {"source_layer_ids": ["tracts_v2", "cands_v2"]},
            "params":    {},
        }, client=None)
        payload2 = extract_result(raw2, params={})
        ok(payload2["summary"]["n_candidates_total"] == 3,
           "ordered source_layer_ids fallback works")

        # Cross-atlas envelope-key tolerance: candidates under `inversions` key
        cands_alt_rel = _write_env("cands_alt", "inversion_candidates",
                                   {"inversions": CANDS_FIX})
        idx_path.write_text(json.dumps({
            "layers": [
                {"layer_id": "tracts_v2", "path": tracts_rel},
                {"layer_id": "cands_v2",  "path": cands_rel},
                {"layer_id": "cands_alt", "path": cands_alt_rel},
            ],
        }), encoding="utf-8")
        raw3 = runner_compute({
            "action_id": "test_act_008",
            "target":    {"tracts_layer_id": "tracts_v2",
                          "candidates_layer_id": "cands_alt"},
            "params":    {},
        }, client=None)
        payload3 = extract_result(raw3, params={})
        ok(payload3["summary"]["n_candidates_total"] == 3,
           "payload.inversions key fallback works")

        # Missing required envelope raises
        try:
            runner_compute({
                "action_id": "test_act_009",
                "target":    {"tracts_layer_id": "tracts_v2"},  # missing candidates
                "params":    {},
            }, client=None)
            ok(False, "missing candidates_layer_id should have raised")
        except KeyError:
            ok(True, "missing required envelope raises KeyError")
    finally:
        os.environ.pop("ATLAS_PROJECT_ROOT", None)

# -------------------------------------------------------------------
print(f"\n{_passed} passed, {_failed} failed")
sys.exit(0 if _failed == 0 else 1)
