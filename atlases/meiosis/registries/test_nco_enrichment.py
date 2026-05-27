"""Smoke test for the promoted NCO enrichment chain.

Covers:
  - fisher_exact_2x2: correctness against scipy reference values
    (hard-coded to avoid the scipy dependency in CI), edge cases,
    degenerate marginals.
  - crosstab_mosaic_short_inside_inv: NCO-like filter, partial-inv drop,
    cell assignment, summary counts.
  - compute_nco_enrichment: end-to-end, payload shape matches
    schemas/schema_out/nco_enrichment_result_v1.schema.json required keys.
  - Round-trip through the runner: ATLAS_PROJECT_ROOT setup, layers
    index, source envelope on disk, runner emits payload, extractor
    re-loads it, dispatcher-style validation of required keys.

Run from the meiosis-atlas root:
    python3 atlases/meiosis/registries/test_nco_enrichment.py
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

from runners.meiosis_nco_enrichment import (
    fisher_exact_2x2,
    crosstab_mosaic_short_inside_inv,
    compute_nco_enrichment,
)

_failed = 0
_passed = 0


def _approx(a, b, tol=1e-6):
    if a is None or b is None:
        return a is None and b is None
    if isinstance(a, float) and math.isnan(a):
        return isinstance(b, float) and math.isnan(b)
    return abs(a - b) <= tol


def ok(cond, msg):
    global _failed, _passed
    if cond:
        _passed += 1; print(f"  ok: {msg}")
    else:
        _failed += 1; print(f"  FAIL: {msg}")


# -------------------------------------------------------------------
# fisher_exact_2x2 — reference values from scipy.stats.fisher_exact
# (precomputed; no scipy dep in CI). scipy v1.11.3.
# -------------------------------------------------------------------
print("fisher_exact_2x2")

r = fisher_exact_2x2(8, 2, 1, 5)
# scipy.stats.fisher_exact([[8,2],[1,5]], alternative='two-sided').pvalue
# ≈ 0.03497
ok(_approx(r["p_two_sided"], 0.034965034965, tol=1e-9),
   f"two-sided p ≈ 0.0350 (got {r['p_two_sided']:.6f})")
# alternative='greater'
# ≈ 0.02447552447552
ok(_approx(r["p_one_sided_greater"], 0.024475524475524476, tol=1e-9),
   f"one-sided greater p ≈ 0.0245 (got {r['p_one_sided_greater']:.6f})")
ok(_approx(r["odds_ratio"], 20.0, tol=1e-9),
   f"odds ratio = (8·5)/(2·1) = 20.0 (got {r['odds_ratio']})")

# Independence: 5/5/5/5 → p ≈ 1.0
r2 = fisher_exact_2x2(5, 5, 5, 5)
ok(_approx(r2["p_two_sided"], 1.0, tol=1e-9), "balanced table → two-sided p = 1.0")
ok(_approx(r2["odds_ratio"], 1.0, tol=1e-9),  "balanced table → OR = 1.0")

# Strong depletion: 0 in target × inside, 10 in other × inside.
# scipy fisher_exact([[0,10],[10,0]], 'two-sided') = ~1e-6 range
r3 = fisher_exact_2x2(0, 10, 10, 0)
ok(r3["p_two_sided"] < 0.001, "[[0,10],[10,0]] is highly significant two-sided")
ok(r3["odds_ratio"] == 0.0,   "[[0,10],[10,0]] OR = 0.0")

# Strong enrichment: 10 in target × inside, 0 in other × inside.
r4 = fisher_exact_2x2(10, 0, 0, 10)
ok(r4["p_two_sided"] < 0.001, "[[10,0],[0,10]] is highly significant two-sided")
ok(math.isinf(r4["odds_ratio"]), "[[10,0],[0,10]] OR = +Inf")

# Degenerate: empty column → NaN
r5 = fisher_exact_2x2(0, 0, 5, 5)
ok(math.isnan(r5["p_two_sided"]), "empty top row → p two_sided = NaN")
ok(math.isnan(r5["odds_ratio"]),  "empty top row → OR = NaN")

# -------------------------------------------------------------------
# crosstab_mosaic_short_inside_inv
# -------------------------------------------------------------------
print("crosstab_mosaic_short_inside_inv")

# Synthetic fixture: enriched MOSAIC_SHORT × yes (the headline pattern).
TRACTS = [
    # MOSAIC_SHORT inside (cell a)
    {"class": "MOSAIC_SHORT", "inside_inversion": "yes"},
    {"class": "MOSAIC_SHORT", "inside_inversion": "yes"},
    {"class": "MOSAIC_SHORT", "inside_inversion": "yes"},
    {"class": "MOSAIC_SHORT", "inside_inversion": "yes"},
    {"class": "MOSAIC_SHORT", "inside_inversion": "yes"},
    # MOSAIC_SHORT outside (cell b)
    {"class": "MOSAIC_SHORT", "inside_inversion": "no"},
    # NCO inside (cell c)
    {"class": "NCO", "inside_inversion": "yes"},
    # NCO outside (cell d)
    {"class": "NCO", "inside_inversion": "no"},
    {"class": "NCO", "inside_inversion": "no"},
    {"class": "NCO", "inside_inversion": "no"},
    {"class": "NCO", "inside_inversion": "no"},
    # CO — should be excluded (not NCO-like)
    {"class": "CO", "inside_inversion": "yes"},
    # MOSAIC_SHORT partial — should be excluded ('partial' not in {yes,no})
    {"class": "MOSAIC_SHORT", "inside_inversion": "partial"},
    # AMBIG — excluded
    {"class": "AMBIG", "inside_inversion": "yes"},
]

xt = crosstab_mosaic_short_inside_inv(TRACTS)
ok(xt["n_in_target"]  == 5, "a (MOSAIC_SHORT × inside) = 5")
ok(xt["n_out_target"] == 1, "b (MOSAIC_SHORT × outside) = 1")
ok(xt["n_in_other"]   == 1, "c (NCO × inside) = 1")
ok(xt["n_out_other"]  == 4, "d (NCO × outside) = 4")
ok(xt["n_total"]      == 14, "n_total counts all input tracts")
ok(xt["n_excluded"]   == 3,  "n_excluded counts CO + partial + AMBIG")
ok(xt["target_class"] == "MOSAIC_SHORT", "target_class echoed")

# Empty / null input
ok(crosstab_mosaic_short_inside_inv([])["n_total"] == 0, "[] → n_total = 0")
ok(crosstab_mosaic_short_inside_inv(None)["n_total"] == 0, "None → n_total = 0")

# Sensitivity: target_class='NCO' swaps cells.
xt_nco = crosstab_mosaic_short_inside_inv(TRACTS, target_class="NCO")
ok(xt_nco["n_in_target"]  == 1, "target=NCO swaps: a = 1")
ok(xt_nco["n_out_target"] == 4, "target=NCO swaps: b = 4")
ok(xt_nco["n_in_other"]   == 5, "target=NCO swaps: c = 5")
ok(xt_nco["n_out_other"]  == 1, "target=NCO swaps: d = 1")
ok(xt_nco["target_class"] == "NCO", "target_class field updated")

# -------------------------------------------------------------------
# compute_nco_enrichment — end-to-end payload shape
# -------------------------------------------------------------------
print("compute_nco_enrichment")

p = compute_nco_enrichment(TRACTS)
ok(set(p.keys()) >= {"result", "summary"}, "payload has result + summary blocks")

req_result = {
    "target_class", "n_inside_target", "n_outside_target",
    "n_inside_other_nco_like", "n_outside_other_nco_like",
    "odds_ratio", "log_odds",
    "p_fisher_two_sided", "p_fisher_one_sided_greater",
}
ok(set(p["result"].keys()) >= req_result,
   "result block carries all schema-required keys")

req_summary = {
    "n_total_tracts", "n_excluded_tracts",
    "n_inside_inversion", "n_outside_inversion",
    "n_target_class_overall",
}
ok(set(p["summary"].keys()) >= req_summary,
   "summary block carries all schema-required keys")

# Numeric sanity: with this fixture (a=5,b=1,c=1,d=4), Fisher one-sided
# greater is small (enrichment).
ok(p["result"]["odds_ratio"] == 20.0, "OR matches direct calc (5·4)/(1·1)=20")
ok(p["result"]["p_fisher_one_sided_greater"] < 0.1,
   f"enrichment p_one_sided_greater < 0.1 (got {p['result']['p_fisher_one_sided_greater']:.4f}) — confirms detectable signal on the 11-tract toy fixture")

# NaN/Inf serialization — must be null-safe for JSON
p_degen = compute_nco_enrichment([])
ok(p_degen["result"]["p_fisher_two_sided"] is None,
   "empty input → p_two_sided serialized as None")
ok(p_degen["result"]["odds_ratio"] is None,
   "empty input → odds_ratio serialized as None")

# JSON round-trip — payload must serialize without raising.
try:
    json.dumps(p, allow_nan=False)
    json.dumps(p_degen, allow_nan=False)
    ok(True, "payload JSON-serializes with allow_nan=False")
except (TypeError, ValueError) as e:
    ok(False, f"payload JSON-serialization raised: {e}")

# -------------------------------------------------------------------
# Round-trip through the runner — full workspace simulation
# -------------------------------------------------------------------
print("compute_nco_enrichment runner round-trip")

from runners.compute_nco_enrichment import compute as runner_compute
from extractors.normalize_nco_enrichment_result import extract as extract_result

with tempfile.TemporaryDirectory() as tmp:
    root = pathlib.Path(tmp)
    # Stand up a minimal workspace: source envelope + layers index.
    layer_id   = "tracts_test"
    src_dir    = root / "layers" / "tract_classifications" / "ds1"
    src_dir.mkdir(parents=True)
    src_path   = src_dir / f"{layer_id}.json"
    src_rel    = src_path.relative_to(root)
    src_path.write_text(json.dumps({
        "layer_id": layer_id,
        "schema_version": "tract_classifications_v1",
        "payload": {"tracts": TRACTS, "summary": {}},
    }), encoding="utf-8")
    idx_path = root / "registry" / "layers.registry.json"
    idx_path.parent.mkdir(parents=True, exist_ok=True)
    idx_path.write_text(json.dumps({
        "layers": [{"layer_id": layer_id, "path": str(src_rel)}],
    }), encoding="utf-8")

    os.environ["ATLAS_PROJECT_ROOT"] = str(root)
    try:
        raw = runner_compute({
            "action_id": "test_act_001",
            "target":    {"source_layer_id": layer_id},
            "params":    {},
        }, client=None)
        ok("nco_enrichment_payload" in raw, "runner returns nco_enrichment_payload path")
        ok(pathlib.Path(raw["nco_enrichment_payload"]).exists(),
           "payload file exists on disk")

        payload = extract_result(raw, params={})
        ok("result" in payload and "summary" in payload,
           "extractor returns dispatcher-shaped payload")
        ok(payload["result"]["odds_ratio"] == 20.0,
           "round-trip preserves OR computed by math module")
    finally:
        os.environ.pop("ATLAS_PROJECT_ROOT", None)

# -------------------------------------------------------------------
print(f"\n{_passed} passed, {_failed} failed")
sys.exit(0 if _failed == 0 else 1)
