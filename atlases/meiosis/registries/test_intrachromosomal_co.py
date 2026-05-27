"""Smoke test for the promoted intrachromosomal CO karyotype chain.

Covers:
  - t_cdf / t_two_sided_p: agreement with scipy.stats.t reference values
    (hard-coded; no scipy dep in CI).
  - welch_t: agreement with scipy.stats.ttest_ind(equal_var=False)
    reference values on a 4-sample-per-group fixture.
  - split_by_karyotype: skips rows missing karyotype / co_per_mb, groups
    homA + homB into 'non_het'.
  - compute_intrachromosomal_co: payload shape matches the schema,
    flag threshold honoured, insufficient-dyads handling, JSON
    round-trip safe.
  - Runner + extractor round-trip in a temp workspace.

Run from the meiosis-atlas root:
    python3 atlases/meiosis/registries/test_intrachromosomal_co.py
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

from runners.meiosis_intrachromosomal_co import (
    t_cdf,
    t_two_sided_p,
    welch_t,
    split_by_karyotype,
    compute_intrachromosomal_co,
)

_failed = 0; _passed = 0


def _approx(a, b, tol=1e-4):
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
# t_cdf / t_two_sided_p — scipy.stats.t reference values
# -------------------------------------------------------------------
print("t_cdf / t_two_sided_p")

# scipy.stats.t.cdf(2.0, df=10) ≈ 0.96331 (verified: t.sf(2,10)≈0.03669)
ok(_approx(t_cdf(2.0, 10), 0.9633060855926411, tol=1e-6),
   f"t_cdf(2.0, 10) ≈ 0.96331 (got {t_cdf(2.0, 10):.6f})")
ok(_approx(t_cdf(-2.0, 10), 1 - 0.9633060855926411, tol=1e-6),
   f"t_cdf(-2.0, 10) ≈ 0.03669 (got {t_cdf(-2.0, 10):.6f})")
ok(_approx(t_cdf(0.0, 10), 0.5, tol=1e-9),
   "t_cdf(0, df) == 0.5")
# scipy.stats.t.cdf(5.0, df=5) ≈ 0.99795
ok(_approx(t_cdf(5.0, 5), 0.9979476420099738, tol=1e-6),
   f"t_cdf(5.0, 5) ≈ 0.99795 (got {t_cdf(5.0, 5):.6f})")
# Two-sided/CDF consistency: 2*(1-CDF(|t|)) should equal the two-sided p.
# This is the strongest internal check — passes only if both functions
# agree, regardless of any reference-value transcription error.
ok(_approx(t_two_sided_p(2.0, 10), 2 * (1 - t_cdf(2.0, 10)), tol=1e-12),
   "two_sided_p == 2*(1-CDF(|t|)) identity")

# Two-sided
# 2 * (1 - t_cdf(|2.0|, 10))
ok(_approx(t_two_sided_p(2.0, 10), 0.07338, tol=1e-4),
   f"t_two_sided_p(2.0, 10) ≈ 0.07338 (got {t_two_sided_p(2.0, 10):.5f})")
ok(_approx(t_two_sided_p(-2.0, 10), 0.07338, tol=1e-4),
   "two-sided is symmetric in sign of t")

# -------------------------------------------------------------------
# welch_t — scipy.stats.ttest_ind(equal_var=False) reference
# -------------------------------------------------------------------
print("welch_t")

# Hand-verified by direct computation:
#   xs = [1.2, 1.5, 1.8, 1.4]  → mean 1.475, var 0.06245833 (n-1 denom)
#   ys = [2.5, 2.7, 2.9, 2.6]  → mean 2.675, var 0.02916667
#   se^2 = vx/nx + vy/ny = 0.0156146 + 0.0072917 = 0.0229062
#   t = (mx - my) / sqrt(se^2) ≈ -7.927
#   Welch-Satterthwaite df ≈ 5.299
#   Two-sided p via t-CDF ≈ 3.92e-4
xs = [1.2, 1.5, 1.8, 1.4]
ys = [2.5, 2.7, 2.9, 2.6]
res = welch_t(xs, ys)
ok(_approx(res["welch_t"], -7.92706, tol=1e-3),
   f"welch_t statistic ≈ -7.927 (got {res['welch_t']:.4f})")
ok(_approx(res["welch_df"], 5.29931, tol=1e-3),
   f"Welch df ≈ 5.299 (got {res['welch_df']:.4f})")
ok(res["p_two_sided"] is not None and 1e-4 < res["p_two_sided"] < 1e-3,
   f"welch_t p ∈ (1e-4, 1e-3) for t≈-7.9, df≈5.3 (got {res['p_two_sided']:.3e})")

# Identical samples → p = 1.0
res_eq = welch_t([1.0, 2.0, 3.0], [1.0, 2.0, 3.0])
ok(_approx(res_eq["welch_t"], 0.0, tol=1e-12),
   "identical means → t = 0")
ok(_approx(res_eq["p_two_sided"], 1.0, tol=1e-12),
   "identical means → p = 1.0")

# Degenerate: n<2 in one group → NaN
res_deg = welch_t([1.0], [1.0, 2.0, 3.0])
ok(math.isnan(res_deg["welch_t"]),     "n_x=1 → NaN t")
ok(math.isnan(res_deg["p_two_sided"]), "n_x=1 → NaN p")

# Empty inputs
ok(math.isnan(welch_t([], [])["welch_t"]), "empty inputs → NaN")

# -------------------------------------------------------------------
# split_by_karyotype
# -------------------------------------------------------------------
print("split_by_karyotype")

EVENTS = [
    # LG01: 4 het, 4 non-het (good for Welch)
    {"chrom": "LG01", "karyotype_at_focal_inv": "het",  "co_per_mb": 0.40},
    {"chrom": "LG01", "karyotype_at_focal_inv": "het",  "co_per_mb": 0.45},
    {"chrom": "LG01", "karyotype_at_focal_inv": "het",  "co_per_mb": 0.50},
    {"chrom": "LG01", "karyotype_at_focal_inv": "het",  "co_per_mb": 0.42},
    {"chrom": "LG01", "karyotype_at_focal_inv": "homA", "co_per_mb": 0.80},
    {"chrom": "LG01", "karyotype_at_focal_inv": "homA", "co_per_mb": 0.85},
    {"chrom": "LG01", "karyotype_at_focal_inv": "homB", "co_per_mb": 0.78},
    {"chrom": "LG01", "karyotype_at_focal_inv": "homB", "co_per_mb": 0.82},
    # LG02: only 1 het — should be excluded for Welch but appear in summary
    {"chrom": "LG02", "karyotype_at_focal_inv": "het",  "co_per_mb": 0.50},
    {"chrom": "LG02", "karyotype_at_focal_inv": "homA", "co_per_mb": 0.55},
    {"chrom": "LG02", "karyotype_at_focal_inv": "homA", "co_per_mb": 0.60},
    # Row with no karyotype → skipped
    {"chrom": "LG03", "co_per_mb": 0.5},
    # Row with karyotype but no co_per_mb / n_co → skipped (no derivable rate)
    {"chrom": "LG03", "karyotype_at_focal_inv": "het"},
    # Row deriving co_per_mb from n_co + chrom_len_bp
    {"chrom": "LG04", "karyotype_at_focal_inv": "het",  "n_co": 5,  "chrom_len_bp": 10_000_000},  # 0.5
    {"chrom": "LG04", "karyotype_at_focal_inv": "het",  "n_co": 6,  "chrom_len_bp": 10_000_000},  # 0.6
    {"chrom": "LG04", "karyotype_at_focal_inv": "homA", "n_co": 9,  "chrom_len_bp": 10_000_000},  # 0.9
    {"chrom": "LG04", "karyotype_at_focal_inv": "homA", "n_co": 10, "chrom_len_bp": 10_000_000},  # 1.0
]

grouped = split_by_karyotype(EVENTS)
ok(set(grouped.keys()) == {"LG01", "LG02", "LG04"},
   "LG03 (no derivable rate / no karyotype) is dropped from grouping")
ok(len(grouped["LG01"]["het"])     == 4, "LG01 het = 4 dyads")
ok(len(grouped["LG01"]["non_het"]) == 4, "LG01 non_het = 4 dyads (homA+homB combined)")
ok(len(grouped["LG02"]["het"])     == 1, "LG02 het = 1 (insufficient for Welch)")
ok(len(grouped["LG04"]["het"])     == 2, "LG04 het derived from n_co + chrom_len_bp")
ok(_approx(grouped["LG04"]["het"][0], 0.5,  tol=1e-9), "derived rate 5 CO / 10 Mb = 0.5")
ok(_approx(grouped["LG04"]["non_het"][1], 1.0, tol=1e-9), "derived rate 10 CO / 10 Mb = 1.0")

# -------------------------------------------------------------------
# compute_intrachromosomal_co — payload shape + flag logic
# -------------------------------------------------------------------
print("compute_intrachromosomal_co")

p = compute_intrachromosomal_co(EVENTS)
ok(set(p.keys()) >= {"per_chrom", "summary"}, "payload has per_chrom + summary")
ok(len(p["per_chrom"]) == 3, "one row per chrom that grouped (3)")

# LG01: het mean ~ 0.4425, non_het mean ~ 0.8125 → ratio ~ 0.545 → flagged
row_lg01 = next(r for r in p["per_chrom"] if r["chrom"] == "LG01")
ok(_approx(row_lg01["mean_co_per_mb_het"],     0.4425, tol=1e-3),
   "LG01 mean_het ≈ 0.4425")
ok(_approx(row_lg01["mean_co_per_mb_non_het"], 0.8125, tol=1e-3),
   "LG01 mean_non_het ≈ 0.8125")
ok(_approx(row_lg01["rate_ratio_het_over_non_het"], 0.5446, tol=1e-3),
   "LG01 rate_ratio ≈ 0.545")
ok(row_lg01["flag_below_threshold"] is True,
   "LG01 ratio < 0.7 → flagged")
ok(row_lg01["welch_t"] is not None and row_lg01["welch_t"] < 0,
   "LG01 welch_t negative (het < non-het)")
ok(row_lg01["p_two_sided"] is not None and row_lg01["p_two_sided"] < 0.001,
   f"LG01 p < 0.001 (got {row_lg01['p_two_sided']:.2e})")

# LG02: insufficient dyads
row_lg02 = next(r for r in p["per_chrom"] if r["chrom"] == "LG02")
ok(row_lg02["welch_t"] is None and row_lg02["p_two_sided"] is None,
   "LG02 stats nulled (insufficient_dyads)")
ok(row_lg02.get("excluded_reason") == "insufficient_dyads",
   "LG02 excluded_reason set")
ok(row_lg02["flag_below_threshold"] is False,
   "LG02 not flagged when stats absent")

# summary
ok(p["summary"]["n_chroms_total"]    == 3, "summary n_chroms_total = 3")
ok(p["summary"]["n_chroms_tested"]   == 2, "summary n_chroms_tested = 2 (LG01 + LG04)")
ok(p["summary"]["n_chroms_excluded"] == 1, "summary n_chroms_excluded = 1 (LG02)")
ok(p["summary"]["n_chroms_flagged"]  >= 1, "summary n_chroms_flagged >= 1 (LG01)")
ok(_approx(p["summary"]["flag_threshold"], 0.7, tol=1e-9),
   "summary flag_threshold echoed")

# Non-default threshold disables LG01 flag at 0.4
p_loose = compute_intrachromosomal_co(EVENTS, flag_threshold=0.4)
row_lg01_loose = next(r for r in p_loose["per_chrom"] if r["chrom"] == "LG01")
ok(row_lg01_loose["flag_below_threshold"] is False,
   "LG01 ratio 0.545 not < 0.4 → not flagged at loose threshold")

# JSON strict-mode safe
try:
    json.dumps(p, allow_nan=False)
    json.dumps(p_loose, allow_nan=False)
    ok(True, "payload JSON-serializes with allow_nan=False")
except (TypeError, ValueError) as e:
    ok(False, f"JSON-serialization raised: {e}")

# -------------------------------------------------------------------
# Runner + extractor round-trip
# -------------------------------------------------------------------
print("runner + extractor round-trip")

from runners.compute_intrachromosomal_co import compute as runner_compute
from extractors.normalize_intrachromosomal_co_result import extract as extract_result

with tempfile.TemporaryDirectory() as tmp:
    root = pathlib.Path(tmp)
    layer_id = "events_test"
    src_dir = root / "layers" / "chromosome_meiosis_events" / "ds1"
    src_dir.mkdir(parents=True)
    src_path = src_dir / f"{layer_id}.json"
    src_path.write_text(json.dumps({
        "layer_id": layer_id,
        "schema_version": "chromosome_meiosis_events_v1",
        "payload": {"events": EVENTS, "summary": {}},
    }), encoding="utf-8")
    idx_path = root / "registry" / "layers.registry.json"
    idx_path.parent.mkdir(parents=True, exist_ok=True)
    idx_path.write_text(json.dumps({
        "layers": [{"layer_id": layer_id, "path": str(src_path.relative_to(root))}],
    }), encoding="utf-8")

    os.environ["ATLAS_PROJECT_ROOT"] = str(root)
    try:
        raw = runner_compute({
            "action_id": "test_act_002",
            "target":    {"source_layer_id": layer_id},
            "params":    {"flag_threshold": 0.7},
        }, client=None)
        ok("intrachromosomal_co_payload" in raw,
           "runner returns intrachromosomal_co_payload path")
        ok(pathlib.Path(raw["intrachromosomal_co_payload"]).exists(),
           "payload file exists on disk")

        payload = extract_result(raw, params={})
        ok("per_chrom" in payload and "summary" in payload,
           "extractor returns dispatcher-shaped payload")
        ok(any(r["chrom"] == "LG01" and r["flag_below_threshold"]
               for r in payload["per_chrom"]),
           "round-trip preserves LG01 flag")
    finally:
        os.environ.pop("ATLAS_PROJECT_ROOT", None)

# -------------------------------------------------------------------
print(f"\n{_passed} passed, {_failed} failed")
sys.exit(0 if _failed == 0 else 1)
