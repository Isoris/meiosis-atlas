"""Smoke test for the HEADLINE chain promotion.

Covers:
  - mulberry32: matches JS implementation byte-for-byte (first 4 outputs
    pre-computed in browser console for seed=1).
  - karyotypes_at_focal / permutation_blocks / focal_chrom_from_controls
    / local_inv_burden_by_chrom: lookups + grouping over the v1 envelopes.
  - parent_co_rates_by_chrom: per-(parent, chrom) aggregation, derived
    rate, include_co/include_dco knobs.
  - permute_karyotypes: shuffles within block, never across (the
    family-aware guarantee).
  - perm_test: add-one smoothing, two-sided tail.
  - bh_adjust / bonf_adjust: monotone enforcement, NaN preservation.
  - run_interchromosomal_tests: end-to-end on a designed fixture with a
    significant off-focal-chrom signal; seeded so the permutation p is
    deterministic in CI.
  - Runner + extractor round-trip: 3-envelope workspace simulation
    (events, controls, design), named target keys, ordered fallback.

Run from the meiosis-atlas root:
    python3 atlases/meiosis/registries/test_interchromosomal_effect.py
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

from runners.meiosis_interchromosomal_effect import (
    mulberry32,
    karyotypes_at_focal,
    permutation_blocks,
    focal_chrom_from_controls,
    local_inv_burden_by_chrom,
    parent_co_rates_by_chrom,
    permute_karyotypes,
    perm_test,
    bh_adjust,
    bonf_adjust,
    run_interchromosomal_tests,
)

_failed = 0; _passed = 0


def _approx(a, b, tol=1e-6):
    if a is None or b is None:
        return a is None and b is None
    if isinstance(a, float) and math.isnan(a):
        return isinstance(b, float) and math.isnan(b)
    return abs(a - b) <= tol


def ok(cond, msg):
    global _failed, _passed
    if cond: _passed += 1; print(f"  ok: {msg}")
    else:    _failed += 1; print(f"  FAIL: {msg}")


# -------------------------------------------------------------------
# mulberry32 — verify against the JS implementation
# -------------------------------------------------------------------
print("mulberry32")

# Canonical mulberry32(1) test vector — first 4 outputs, cross-verified
# against multiple public implementations of the same generator. The Python
# port emits the same sequence as the JS browser path.
EXPECTED_SEED1 = [
    0.6270739405881613,
    0.002735721180215478,
    0.5274470399599522,
    0.9810509674716741,
]
rng = mulberry32(1)
for i, want in enumerate(EXPECTED_SEED1):
    got = rng()
    ok(_approx(got, want, tol=1e-12),
       f"mulberry32(1) call {i+1}: {got!r} matches reference {want!r}")

# Determinism: same seed → same sequence
r1 = mulberry32(42); r2 = mulberry32(42)
seq1 = [r1() for _ in range(10)]
seq2 = [r2() for _ in range(10)]
ok(seq1 == seq2, "same seed yields identical sequence")

# Range
r3 = mulberry32(99)
samples = [r3() for _ in range(1000)]
ok(all(0.0 <= x < 1.0 for x in samples), "all draws in [0, 1)")

# -------------------------------------------------------------------
# Lookups
# -------------------------------------------------------------------
print("lookups")

FAPD = [
    {"focal_inversion_id": "INV1", "parent_id": "P1", "karyotype": "het",  "permutation_block": "F1"},
    {"focal_inversion_id": "INV1", "parent_id": "P2", "karyotype": "homA", "permutation_block": "F1"},
    {"focal_inversion_id": "INV1", "parent_id": "P3", "karyotype": "het",  "permutation_block": "F2"},
    {"focal_inversion_id": "INV1", "parent_id": "P4", "karyotype": "homB", "permutation_block": "F2"},
    # Other focal — should be ignored
    {"focal_inversion_id": "INV2", "parent_id": "P1", "karyotype": "het",  "permutation_block": "F1"},
]
LIC = [
    {"inversion_id": "INV1", "inversion_chrom": "LG_FOCAL", "tested_chrom": "LG01", "length_bp": 1_000_000},
    {"inversion_id": "INV1", "inversion_chrom": "LG_FOCAL", "tested_chrom": "LG02", "length_bp": 500_000},
    {"inversion_id": "INV3", "inversion_chrom": "OTHER",    "tested_chrom": "LG01", "length_bp": 200_000},
]

kary = karyotypes_at_focal(FAPD, "INV1")
ok(kary == {"P1": "het", "P2": "homA", "P3": "het", "P4": "homB"},
   "karyotypes_at_focal filters by focal_inv")

blocks = permutation_blocks(FAPD, "INV1")
ok(blocks == {"P1": "F1", "P2": "F1", "P3": "F2", "P4": "F2"},
   "permutation_blocks filters by focal_inv")

ok(focal_chrom_from_controls(LIC, "INV1") == "LG_FOCAL",
   "focal_chrom_from_controls picks first matching inversion_id")
ok(focal_chrom_from_controls(LIC, "MISSING") is None,
   "focal_chrom_from_controls returns None for unknown id")

burden = local_inv_burden_by_chrom(LIC)
ok(burden["LG01"]["n_local_invs"] == 2,         "LG01 burden counts both INV1 + INV3 rows")
ok(burden["LG01"]["total_local_length_bp"] == 1_200_000, "LG01 length sum")
ok(burden["LG02"]["n_local_invs"] == 1,         "LG02 burden")

# -------------------------------------------------------------------
# parent_co_rates_by_chrom
# -------------------------------------------------------------------
print("parent_co_rates_by_chrom")

EVENTS = [
    {"parent_id": "P1", "chrom": "LG01", "n_co": 5, "n_dco": 1, "chrom_len_bp": 10_000_000},
    {"parent_id": "P1", "chrom": "LG02", "n_co": 3, "n_dco": 0, "chrom_len_bp": 5_000_000},
    {"parent_id": "P2", "chrom": "LG01", "n_co": 8, "n_dco": 2, "chrom_len_bp": 10_000_000},
    # Missing chrom_len — should be skipped
    {"parent_id": "P3", "chrom": "LG01", "n_co": 4},
]

rates_co = parent_co_rates_by_chrom(EVENTS, include_co=True, include_dco=False)
ok(_approx(rates_co["P1"]["LG01"], 0.5, tol=1e-9),  "P1/LG01 CO rate = 5/10Mb = 0.5")
ok(_approx(rates_co["P1"]["LG02"], 0.6, tol=1e-9),  "P1/LG02 CO rate = 3/5Mb = 0.6")
ok(_approx(rates_co["P2"]["LG01"], 0.8, tol=1e-9),  "P2/LG01 CO rate = 8/10Mb = 0.8")
ok("P3" not in rates_co, "P3 dropped (no chrom_len_bp)")

rates_combined = parent_co_rates_by_chrom(EVENTS, include_co=True, include_dco=True)
ok(_approx(rates_combined["P1"]["LG01"], 0.6, tol=1e-9),
   "include_dco=True: P1/LG01 (5+1)/10Mb = 0.6")

# -------------------------------------------------------------------
# permute_karyotypes — block-respect invariant
# -------------------------------------------------------------------
print("permute_karyotypes")

kary_for_perm = {"P1": "het", "P2": "homA", "P3": "het", "P4": "homB"}
blocks_for_perm = {"P1": "F1", "P2": "F1", "P3": "F2", "P4": "F2"}

# Run many shuffles; verify no label ever escapes its block.
r = mulberry32(7)
violations = 0
for _ in range(200):
    shuf = permute_karyotypes(kary_for_perm, blocks_for_perm, r)
    # F1 (P1,P2) must always carry one 'het' and one 'homA'
    f1_labels = sorted([shuf["P1"], shuf["P2"]])
    if f1_labels != ["het", "homA"]:
        violations += 1
    # F2 (P3,P4) must carry one 'het' and one 'homB'
    f2_labels = sorted([shuf["P3"], shuf["P4"]])
    if f2_labels != ["het", "homB"]:
        violations += 1
ok(violations == 0, "permute_karyotypes never leaks labels across blocks (200 trials)")

# Parents without a block id are dropped
kary_with_orphan = dict(kary_for_perm, P_orphan="het")
shuf2 = permute_karyotypes(kary_with_orphan, blocks_for_perm, mulberry32(1))
ok("P_orphan" not in shuf2, "parent with no block id dropped from shuffle")

# -------------------------------------------------------------------
# perm_test — add-one smoothing + tail
# -------------------------------------------------------------------
print("perm_test")

# Designed: observed = 5, every perm draws 1 → none ≥ |5|, so p = 1/(N+1).
res = perm_test(
    compute_t=lambda: 5.0,
    permute_and_compute_t=lambda r: 1.0,
    n_perms=99,
    rng=mulberry32(0),
)
ok(_approx(res["p_value"], 1.0 / (99 + 1), tol=1e-12),
   "no perm exceeds observed → p = 1/(N+1)")
ok(res["n_perms_with_t"] == 99, "all perms emit finite t")
ok(_approx(res["observed"], 5.0), "observed echoed")

# All perms exceed observed: p = (N+1)/(N+1) = 1.
res2 = perm_test(lambda: 0.5, lambda r: 5.0, n_perms=10, rng=mulberry32(0))
ok(_approx(res2["p_value"], 1.0, tol=1e-12),
   "all perms exceed observed → p = 1.0")

# Observed NaN → p NaN
res3 = perm_test(lambda: float("nan"), lambda r: 1.0, n_perms=10, rng=mulberry32(0))
ok(math.isnan(res3["p_value"]), "observed NaN → p NaN")

# -------------------------------------------------------------------
# bh_adjust / bonf_adjust
# -------------------------------------------------------------------
print("bh_adjust / bonf_adjust")

# Classic BH example
pvals = [0.001, 0.04, 0.05, 0.2]
bh = bh_adjust(pvals)
# rank 1: 0.001 * 4/1 = 0.004
# rank 2: 0.04  * 4/2 = 0.08, monotone-cap from above (0.0667 or 0.08, whichever min) → 0.0667... wait
# rank 3: 0.05  * 4/3 = 0.0667
# rank 4: 0.2   * 4/4 = 0.2
# After monotone enforcement from top: q4=0.2, q3=min(0.2, 0.0667)=0.0667, q2=min(0.0667, 0.08)=0.0667, q1=min(0.0667, 0.004)=0.004
ok(_approx(bh[0], 0.004,    tol=1e-9), f"BH q for 0.001 = 0.004 (got {bh[0]})")
ok(_approx(bh[1], 0.0666667, tol=1e-6), f"BH q for 0.04 monotone-capped to 0.0667 (got {bh[1]:.6f})")
ok(_approx(bh[2], 0.0666667, tol=1e-6), f"BH q for 0.05 = 0.0667 (got {bh[2]:.6f})")
ok(_approx(bh[3], 0.2,      tol=1e-9), f"BH q for 0.2 = 0.2 (got {bh[3]})")

# NaN preserved
bh_nan = bh_adjust([0.01, float("nan"), 0.02])
ok(math.isnan(bh_nan[1]),     "BH preserves NaN at original index")
ok(math.isfinite(bh_nan[0]),  "BH adjusts the finite values around the NaN")

# Bonferroni
bonf = bonf_adjust(pvals)
ok(bonf == [min(1.0, p * 4) for p in pvals],
   "Bonferroni multiplies by m_finite (= 4 here)")

# -------------------------------------------------------------------
# run_interchromosomal_tests — designed-significant fixture
# -------------------------------------------------------------------
print("run_interchromosomal_tests (orchestrator)")

# Build a fixture with 8 parents across 2 families. On LG02 (off-focal),
# the het parents have markedly higher CO rate than the homA/homB parents
# → expected sig_flag. LG_FOCAL is the focal chrom; LG01 should be a
# null-effect off-focal control.
# 4 families × 4 parents = 16 parents (more power + within-block variance).
N_FAMILIES = 4
PARENTS = []
FAPD2 = []
EVENTS2 = []
for fi in range(N_FAMILIES):
    for k in range(4):
        pid = f"P{fi}_{k}"
        PARENTS.append(pid)
        if k < 2: kary_lbl = "het"
        elif k == 2: kary_lbl = "homA"
        else:     kary_lbl = "homB"
        FAPD2.append({
            "focal_inversion_id": "INV_F", "parent_id": pid,
            "karyotype": kary_lbl, "permutation_block": f"FAM{fi}",
        })
        # LG_FOCAL: small per-parent jitter so Welch returns a finite t
        # but no systematic karyotype effect.
        EVENTS2.append({"parent_id": pid, "chrom": "LG_FOCAL",
                        "n_co": 10 + ((fi + k) % 3), "chrom_len_bp": 10_000_000})
        # LG01: null control — same jitter pattern, no karyotype signal
        EVENTS2.append({"parent_id": pid, "chrom": "LG01",
                        "n_co": 5 + ((fi * 2 + k) % 4), "chrom_len_bp": 10_000_000})
        # LG02: strong off-focal het>non_het signal. Het mean ≈ 3.05 CO/Mb;
        # non-het mean ≈ 1.05 CO/Mb. Jitter ensures non-zero within-group
        # variance so Welch's t is finite.
        if kary_lbl == "het":
            n_co = 30 + ((fi + k) % 3)   # 30, 31, 32
        else:
            n_co = 10 + ((fi + k) % 3)   # 10, 11, 12
        EVENTS2.append({"parent_id": pid, "chrom": "LG02",
                        "n_co": n_co, "chrom_len_bp": 10_000_000})

LIC2 = [
    {"inversion_id": "INV_F", "inversion_chrom": "LG_FOCAL",
     "tested_chrom": "LG_FOCAL", "length_bp": 2_000_000},
    {"inversion_id": "INV_F", "inversion_chrom": "LG_FOCAL",
     "tested_chrom": "LG02",     "length_bp": 1_000_000},
]

envs = {
    "cme":  {"payload": {"events":     EVENTS2}},
    "lic":  {"payload": {"controls":   LIC2}},
    "fapd": {"payload": {"assignments": FAPD2}},
}
out = run_interchromosomal_tests(envs, {
    "focal_inversion_id": "INV_F",
    "n_permutations":     500,
    "seed":               42,
    "p_bh_alpha":         0.05,
})

rows = out["rows"]
ok(len(rows) == 3, "3 tested chroms emitted (LG_FOCAL + LG01 + LG02)")

lg_focal = next(r for r in rows if r["tested_chrom"] == "LG_FOCAL")
ok(lg_focal["is_focal_chrom"] is True, "LG_FOCAL flagged is_focal_chrom")
ok(lg_focal["p_bh"]   is None, "focal-chrom row p_bh is null")
ok(lg_focal["p_bonf"] is None, "focal-chrom row p_bonf is null")
ok(lg_focal["sig_flag"] is False, "focal-chrom row never sig_flag")

lg01 = next(r for r in rows if r["tested_chrom"] == "LG01")
lg02 = next(r for r in rows if r["tested_chrom"] == "LG02")

ok(lg02["t_stat"] is not None and lg02["t_stat"] > 0,
   f"LG02 t_stat positive (het > non-het) (got {lg02['t_stat']})")
ok(lg02["p_value"] is not None and lg02["p_value"] < 0.05,
   f"LG02 permutation p < 0.05 (got {lg02['p_value']:.4f})")
ok(lg02["sig_flag"] is True, "LG02 BH-significant on this fixture")

# LG01 null signal: variance is 0 in both groups → t = NaN/0 → p NaN/handling.
# Either way, sig_flag must be False.
ok(lg01["sig_flag"] is False, "LG01 (null control) not sig_flag")

# Summary
ok(out["summary"]["focal_inversion_id"] == "INV_F", "summary focal id echoed")
ok(out["summary"]["focal_chrom"]        == "LG_FOCAL", "summary focal_chrom from controls")
ok(out["summary"]["n_tests"]            == 2, "summary n_tests = 2 (LG01 + LG02)")
ok(out["summary"]["n_sig_bh"]           >= 1, "summary n_sig_bh >= 1")
ok(out["summary"]["n_permutations"]     == 500, "summary echoes n_permutations")

# JSON strict-mode safe
try:
    json.dumps(out, allow_nan=False)
    ok(True, "payload JSON-serializes with allow_nan=False")
except (TypeError, ValueError) as e:
    ok(False, f"JSON-serialization raised: {e}")

# Determinism: same seed → same p_value
out2 = run_interchromosomal_tests(envs, {
    "focal_inversion_id": "INV_F", "n_permutations": 500, "seed": 42, "p_bh_alpha": 0.05,
})
lg02b = next(r for r in out2["rows"] if r["tested_chrom"] == "LG02")
ok(_approx(lg02["p_value"], lg02b["p_value"], tol=1e-12),
   "seeded run is deterministic across invocations")

# Auto-pick focal id when omitted
out_auto = run_interchromosomal_tests(envs, {"n_permutations": 50, "seed": 1})
ok(out_auto["summary"]["focal_inversion_id"] == "INV_F",
   "focal_inversion_id auto-picked from fapd when omitted")

# Empty fapd → empty rows + null focal id
out_empty = run_interchromosomal_tests({"cme": envs["cme"], "lic": envs["lic"],
                                         "fapd": {"payload": {"assignments": []}}},
                                        {"n_permutations": 10, "seed": 1})
ok(out_empty["rows"] == [] and out_empty["summary"]["focal_inversion_id"] is None,
   "empty fapd → empty rows + null focal id")

# -------------------------------------------------------------------
# Runner + extractor round-trip
# -------------------------------------------------------------------
print("runner + extractor round-trip")

from runners.compute_interchromosomal_effect import compute as runner_compute
from extractors.normalize_interchromosomal_effect_result import extract as extract_result

with tempfile.TemporaryDirectory() as tmp:
    root = pathlib.Path(tmp)
    def _write_envelope(layer_id: str, kind: str, payload: dict) -> str:
        d = root / "layers" / kind / "ds1"
        d.mkdir(parents=True, exist_ok=True)
        p = d / f"{layer_id}.json"
        p.write_text(json.dumps({
            "layer_id": layer_id,
            "schema_version": f"{kind}_v1",
            "payload": payload,
        }), encoding="utf-8")
        return str(p.relative_to(root))

    events_rel = _write_envelope("events_test",   "chromosome_meiosis_events",     {"events":      EVENTS2})
    controls_rel = _write_envelope("controls_test","local_inv_controls",            {"controls":    LIC2})
    design_rel = _write_envelope("design_test",   "family_aware_permutation_design",{"assignments": FAPD2})

    idx_path = root / "registry" / "layers.registry.json"
    idx_path.parent.mkdir(parents=True, exist_ok=True)
    idx_path.write_text(json.dumps({
        "layers": [
            {"layer_id": "events_test",   "path": events_rel},
            {"layer_id": "controls_test", "path": controls_rel},
            {"layer_id": "design_test",   "path": design_rel},
        ],
    }), encoding="utf-8")

    os.environ["ATLAS_PROJECT_ROOT"] = str(root)
    try:
        # Named-keys form
        raw = runner_compute({
            "action_id": "test_act_003",
            "target": {
                "events_layer_id":   "events_test",
                "controls_layer_id": "controls_test",
                "design_layer_id":   "design_test",
            },
            "params": {
                "focal_inversion_id": "INV_F",
                "n_permutations":     200,
                "seed":               42,
                "p_bh_alpha":         0.05,
            },
        }, client=None)
        ok("interchromosomal_effect_payload" in raw,
           "runner returns interchromosomal_effect_payload path")
        payload = extract_result(raw, params={})
        ok("rows" in payload and "summary" in payload,
           "extractor returns dispatcher-shaped payload")
        ok(any(r["tested_chrom"] == "LG02" and r["sig_flag"] for r in payload["rows"]),
           "round-trip preserves LG02 sig_flag")

        # Ordered fallback form
        raw2 = runner_compute({
            "action_id": "test_act_004",
            "target": {"source_layer_ids": ["events_test", "controls_test", "design_test"]},
            "params": {"focal_inversion_id": "INV_F", "n_permutations": 50, "seed": 1},
        }, client=None)
        payload2 = extract_result(raw2, params={})
        ok(payload2["summary"]["focal_inversion_id"] == "INV_F",
           "ordered source_layer_ids fallback works")

        # Missing required envelope raises
        try:
            runner_compute({
                "action_id": "test_act_005",
                "target": {"events_layer_id": "events_test"},  # missing design
                "params": {},
            }, client=None)
            ok(False, "missing design_layer_id should have raised")
        except KeyError:
            ok(True, "missing required envelope raises KeyError")
    finally:
        os.environ.pop("ATLAS_PROJECT_ROOT", None)

# -------------------------------------------------------------------
print(f"\n{_passed} passed, {_failed} failed")
sys.exit(0 if _failed == 0 else 1)
