"""Adapter smoke test for the meiosis atlas.

Exercises the staging + normalize extractors end-to-end against a
synthetic 3-row fixture. Skips the dispatcher + runner layer (those
need a real workspace with a registry/layers.registry.json); the
fixture drives the extractors directly.

Run from this directory:
    python3 test_adapter_smoke.py

Verifies:
  - staging extractor parses 3 rows with 22 columns
  - normalize extractor produces tract_classifications_v1-shaped payload
  - distance_to_nearest_inv_bp = '-' is coerced to null
  - manual_review_flag = 0/1 string is coerced to bool
  - class_counts tallies each enum value
  - inside_inversion = 'yes' is counted in summary.n_inside_inversion
"""
from __future__ import annotations

import json
import pathlib
import sys
import tempfile

HERE = pathlib.Path(__file__).parent
sys.path.insert(0, str(HERE))

HEADER = [
    "interval_id", "parent_id", "offspring_id", "chrom",
    "start", "end", "span_bp",
    "class", "confidence",
    "flanking_left_state", "flanking_right_state", "departure_state",
    "n_sites", "n_discordant", "inside_inversion",
    "distance_to_nearest_inv_bp", "prior_log_ratio_co_nco",
    "refined_breakpoint_bp", "refined_ci_left", "refined_ci_right",
    "manual_review_flag", "notes",
]

ROWS = [
    # NCO: outside inversion, has distance value, no STEP_TRC_02 refinement
    ["DEP_000001", "sampA", "sampB", "C_gar_LG01", "100",      "5000",    "4901",
     "NCO", "high", "hapA", "hapA", "hapB", "42", "7", "no", "125000", "0.4",
     "", "", "", "0", "-"],
    # CO: outside inversion, '-' sentinel for distance, STEP_TRC_02 refined
    ["DEP_000002", "sampA", "sampB", "C_gar_LG01", "2000000", "3000000", "1000001",
     "CO", "high", "hapA", "hapB", "hapB", "58", "30", "no", "-", "2.1",
     "2500000", "2499800", "2500200", "0", "refined by STEP_TRC_02"],
    # DCO: inside inversion, manual_review_flag=1, no refinement
    ["DEP_000003", "sampA", "sampB", "C_gar_LG28", "1000", "50000", "49001",
     "DCO", "medium", "hapA", "hapA", "hapB", "40", "22", "yes", "0", "-1.8",
     "", "", "", "1", "-"],
]


def main() -> int:
    # Stage 1: TSV → staging payload.
    from extractors.tract_classifications_tsv import extract as stage_extract

    with tempfile.NamedTemporaryFile("w", suffix=".tsv", delete=False) as fh:
        fh.write("\t".join(HEADER) + "\n")
        for r in ROWS:
            fh.write("\t".join(r) + "\n")
        tsv_path = fh.name

    raw_outputs = {
        "tsv_path":   tsv_path,
        "source_rel": "fixture.tsv",
        "step":       "STEP_TRC_02",
        "scope":      "smoke",
    }
    staging = stage_extract(raw_outputs, {})
    assert staging["n_rows"] == 3, f"staging n_rows = {staging['n_rows']}"
    assert len(staging["columns"]) == 22, f"columns = {len(staging['columns'])}"
    assert staging["step"] == "STEP_TRC_02"
    print(f"  ok: staging — 3 rows, 22 columns, step=STEP_TRC_02")

    # Stage 2: staging envelope JSON → normalized payload.
    envelope = {"layer_id": "test_env", "payload": staging}
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as fh:
        json.dump(envelope, fh)
        env_path = fh.name

    from extractors.normalize_tract_classifications import extract as norm_extract
    norm = norm_extract({"source_envelope": env_path}, {})

    s = norm["summary"]
    assert s["n_tracts"] == 3, f"n_tracts = {s['n_tracts']}"
    assert s["n_dyads"]  == 1, f"n_dyads = {s['n_dyads']}"
    assert s["n_chroms"] == 2, f"n_chroms = {s['n_chroms']}"
    assert s["class_counts"]["NCO"] == 1
    assert s["class_counts"]["CO"]  == 1
    assert s["class_counts"]["DCO"] == 1
    assert s["class_counts"]["MOSAIC_SHORT"] == 0
    assert s["n_inside_inversion"] == 1
    print(f"  ok: summary — n_tracts=3, class_counts {{NCO:1, CO:1, DCO:1}}, n_inside_inversion=1")

    # Type-coercion spot checks.
    t1 = next(t for t in norm["tracts"] if t["interval_id"] == "DEP_000001")
    assert t1["start"]                      == 100
    assert t1["end"]                        == 5000
    assert t1["distance_to_nearest_inv_bp"] == 125000
    assert t1["manual_review_flag"]         is False
    assert t1["refined_breakpoint_bp"]      is None
    print(f"  ok: row1 — int/bool coercion, refined_* null when STEP_TRC_01-only")

    t2 = next(t for t in norm["tracts"] if t["interval_id"] == "DEP_000002")
    assert t2["distance_to_nearest_inv_bp"] is None, \
        f"'-' should coerce to null; got {t2['distance_to_nearest_inv_bp']!r}"
    assert t2["refined_breakpoint_bp"] == 2500000
    assert t2["refined_ci_left"]      == 2499800
    assert t2["refined_ci_right"]     == 2500200
    print(f"  ok: row2 — '-' sentinel → null; refined_* populated")

    t3 = next(t for t in norm["tracts"] if t["interval_id"] == "DEP_000003")
    assert t3["inside_inversion"]   == "yes"
    assert t3["manual_review_flag"] is True
    assert isinstance(t3["prior_log_ratio_co_nco"], float)
    assert abs(t3["prior_log_ratio_co_nco"] - (-1.8)) < 1e-9
    print(f"  ok: row3 — inside_inversion='yes', manual_review_flag=True, float coercion")

    # Schema validation (if jsonschema available).
    try:
        import jsonschema
        schema_path = HERE / "schemas" / "schema_out" / "tract_classifications_v1.schema.json"
        schema = json.loads(schema_path.read_text(encoding="utf-8"))
        jsonschema.validate(norm, schema)
        print(f"  ok: jsonschema — normalized payload validates against tract_classifications_v1")
    except ImportError:
        print(f"  skip: jsonschema not installed — relying on dispatcher's shallow-required check")

    # ======================================================================
    # chromosome_meiosis_events adapter pair (SPEC_crossovers_page §3.1)
    # ======================================================================
    print()
    print("chromosome_meiosis_events adapter:")

    CME_HEADER = [
        "parent_id", "offspring_id", "chrom", "chrom_len_bp",
        "n_co", "n_dco", "n_nco",
        "co_per_mb", "dco_per_mb",
        "mean_co_position_bp", "median_co_position_bp",
        "karyotype_at_focal_inv",
    ]
    CME_ROWS = [
        # Row 1: full data, het at focal — drives the karyo_strat view
        ["sampA", "sampB", "C_gar_LG01", "50000000",
         "3", "0", "12",
         "0.06", "0",
         "25000000", "24000000",
         "het"],
        # Row 2: producer omitted co_per_mb — extractor must derive it
        ["sampA", "sampB", "C_gar_LG28", "30000000",
         "1", "1", "8",
         "", "",
         "15000000", "15000000",
         "homA"],
        # Row 3: '-' sentinel for karyotype (no focal-inv stratification on this row)
        ["sampC", "sampD", "C_gar_LG02", "40000000",
         "2", "0", "10",
         "0.05", "0",
         "20000000", "20000000",
         "-"],
    ]

    from extractors.chromosome_meiosis_events_tsv import extract as cme_stage_extract

    with tempfile.NamedTemporaryFile("w", suffix=".tsv", delete=False) as fh:
        fh.write("\t".join(CME_HEADER) + "\n")
        for r in CME_ROWS:
            fh.write("\t".join(r) + "\n")
        cme_tsv_path = fh.name

    cme_raw_outputs = {
        "tsv_path":   cme_tsv_path,
        "source_rel": "fixture.tsv",
        "scope":      "smoke",
    }
    cme_staging = cme_stage_extract(cme_raw_outputs, {})
    assert cme_staging["n_rows"] == 3, f"cme staging n_rows = {cme_staging['n_rows']}"
    assert len(cme_staging["columns"]) == 12, f"cme columns = {len(cme_staging['columns'])}"
    print(f"  ok: staging — 3 rows, 12 columns")

    cme_envelope = {"layer_id": "test_cme_env", "payload": cme_staging}
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as fh:
        json.dump(cme_envelope, fh)
        cme_env_path = fh.name

    from extractors.normalize_chromosome_meiosis_events import extract as cme_norm_extract
    cme_norm = cme_norm_extract({"source_envelope": cme_env_path}, {})

    s2 = cme_norm["summary"]
    assert s2["n_rows"]    == 3, f"n_rows = {s2['n_rows']}"
    assert s2["n_dyads"]   == 2, f"n_dyads = {s2['n_dyads']}"
    assert s2["n_chroms"]  == 3, f"n_chroms = {s2['n_chroms']}"
    assert s2["sum_n_co"]  == 6, f"sum_n_co = {s2['sum_n_co']}"
    assert s2["sum_n_dco"] == 1, f"sum_n_dco = {s2['sum_n_dco']}"
    assert s2["sum_n_nco"] == 30, f"sum_n_nco = {s2['sum_n_nco']}"
    assert s2["karyotype_strat_rows"] == 2, f"karyotype_strat_rows = {s2['karyotype_strat_rows']}"
    print(f"  ok: summary — n_rows=3, sums {{co:6, dco:1, nco:30}}, karyo_strat_rows=2")

    # Row-level checks.
    ev1 = next(e for e in cme_norm["events"] if e["chrom"] == "C_gar_LG01")
    assert ev1["chrom_len_bp"] == 50_000_000
    assert ev1["n_co"] == 3
    assert isinstance(ev1["co_per_mb"], float) and abs(ev1["co_per_mb"] - 0.06) < 1e-9
    assert ev1["karyotype_at_focal_inv"] == "het"
    print(f"  ok: row1 — int/float coercion + karyotype='het' preserved")

    ev2 = next(e for e in cme_norm["events"] if e["chrom"] == "C_gar_LG28")
    # Producer omitted co_per_mb -> extractor derived 1 / 30_000_000 * 1e6.
    assert isinstance(ev2["co_per_mb"], float), \
        f"co_per_mb should be derived; got {ev2['co_per_mb']!r}"
    assert abs(ev2["co_per_mb"] - (1 / 30_000_000 * 1e6)) < 1e-9
    assert ev2["karyotype_at_focal_inv"] == "homA"
    print(f"  ok: row2 — co_per_mb derived from n_co / chrom_len_bp when producer omitted it")

    ev3 = next(e for e in cme_norm["events"] if e["chrom"] == "C_gar_LG02")
    assert ev3["karyotype_at_focal_inv"] is None, \
        f"'-' should coerce to null; got {ev3['karyotype_at_focal_inv']!r}"
    print(f"  ok: row3 — karyotype '-' sentinel -> null")

    # Schema validation (if jsonschema available).
    try:
        import jsonschema
        cme_schema_path = HERE / "schemas" / "schema_out" / "chromosome_meiosis_events_v1.schema.json"
        cme_schema = json.loads(cme_schema_path.read_text(encoding="utf-8"))
        jsonschema.validate(cme_norm, cme_schema)
        print(f"  ok: jsonschema — normalized payload validates against chromosome_meiosis_events_v1")
    except ImportError:
        pass  # already announced above

    # ======================================================================
    # local_inv_controls adapter pair (SPEC_local_inv_controls_adapter.md)
    # ======================================================================
    print()
    print("local_inv_controls adapter:")

    LIC_HEADER = [
        "tested_chrom", "inversion_id", "inversion_chrom",
        "start_bp", "end_bp", "length_bp",
        "frequency", "n_het_carriers", "n_carriers",
        "ascertainment", "freq_min_filter",
    ]
    LIC_ROWS = [
        # Row 1: full data with length_bp present
        ["C_gar_LG01", "INV_LG01_01", "C_gar_LG01",
         "12000000", "12500000", "500001",
         "0.18", "41", "73",
         "high_confidence", "0.05"],
        # Row 2: length_bp omitted -> extractor derives 13_000_001 - 11_000_001 + 1
        ["C_gar_LG01", "INV_LG01_02", "C_gar_LG01",
         "11000001", "13000001", "",
         "0.07", "12", "20",
         "low_confidence", "0.05"],
        # Row 3: frequency out of range (1.5) -> coerces to null;
        # ascertainment 'maybe' (unknown enum value) -> null
        ["C_gar_LG28", "INV_LG28_01", "C_gar_LG28",
         "5000000", "9000000", "4000001",
         "1.5", "55", "111",
         "maybe", "0.05"],
        # Row 4: missing tested_chrom -> ENTIRE ROW DROPPED
        ["",            "INV_LGXX_01", "C_gar_LGXX",
         "100",         "200",         "101",
         "0.10",        "5",           "8",
         "high_confidence", "0.05"],
    ]

    from extractors.local_inv_controls_tsv import extract as lic_stage_extract

    with tempfile.NamedTemporaryFile("w", suffix=".tsv", delete=False) as fh:
        fh.write("\t".join(LIC_HEADER) + "\n")
        for r in LIC_ROWS:
            fh.write("\t".join(r) + "\n")
        lic_tsv_path = fh.name

    lic_raw_outputs = {
        "tsv_path":   lic_tsv_path,
        "source_rel": "fixture.tsv",
        "scope":      "smoke",
    }
    lic_staging = lic_stage_extract(lic_raw_outputs, {})
    # staging captures everything verbatim INCLUDING the dropped-by-normalize row
    assert lic_staging["n_rows"] == 4, f"lic staging n_rows = {lic_staging['n_rows']}"
    assert len(lic_staging["columns"]) == 11, f"lic columns = {len(lic_staging['columns'])}"
    print(f"  ok: staging — 4 rows, 11 columns (verbatim incl. the invalid row)")

    lic_envelope = {"layer_id": "test_lic_env", "payload": lic_staging}
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as fh:
        json.dump(lic_envelope, fh)
        lic_env_path = fh.name

    from extractors.normalize_local_inv_controls import extract as lic_norm_extract
    lic_norm = lic_norm_extract({"source_envelope": lic_env_path}, {})

    s3 = lic_norm["summary"]
    # Row 4 dropped (missing tested_chrom) -> 3 controls
    assert s3["n_controls"]             == 3, f"n_controls = {s3['n_controls']}"
    assert s3["n_chroms"]               == 2, f"n_chroms = {s3['n_chroms']}"
    assert s3["n_inversions"]           == 3, f"n_inversions = {s3['n_inversions']}"
    assert s3["n_chroms_with_controls"] == 2, f"n_chroms_with_controls = {s3['n_chroms_with_controls']}"
    assert abs(s3["mean_inv_per_chrom"] - 1.5) < 1e-9, f"mean_inv_per_chrom = {s3['mean_inv_per_chrom']}"
    print(f"  ok: summary — n_controls=3 (row4 dropped), 2 chroms × 3 inversions, mean 1.5/chrom")

    # Row-level checks.
    c1 = next(c for c in lic_norm["controls"] if c["inversion_id"] == "INV_LG01_01")
    assert c1["length_bp"] == 500_001
    assert c1["frequency"] == 0.18
    assert c1["n_het_carriers"] == 41
    assert c1["ascertainment"] == "high_confidence"
    print(f"  ok: row1 — int + float + enum coercion preserved")

    c2 = next(c for c in lic_norm["controls"] if c["inversion_id"] == "INV_LG01_02")
    # length_bp derived from end - start + 1 = 13_000_001 - 11_000_001 + 1 = 2_000_001
    assert c2["length_bp"] == 2_000_001, \
        f"length_bp should be derived; got {c2['length_bp']!r}"
    print(f"  ok: row2 — length_bp derived from end_bp - start_bp + 1 when producer omitted it")

    c3 = next(c for c in lic_norm["controls"] if c["inversion_id"] == "INV_LG28_01")
    # frequency 1.5 is out-of-range [0, 1] -> null
    assert c3["frequency"] is None, \
        f"out-of-range frequency should coerce to null; got {c3['frequency']!r}"
    # ascertainment 'maybe' is not in the enum -> null
    assert c3["ascertainment"] is None, \
        f"unknown ascertainment should coerce to null; got {c3['ascertainment']!r}"
    print(f"  ok: row3 — out-of-range frequency -> null; unknown ascertainment -> null")

    # Row 4 should be absent entirely.
    assert all(c["inversion_id"] != "INV_LGXX_01" for c in lic_norm["controls"]), \
        "row missing tested_chrom should have been dropped"
    print(f"  ok: row4 — missing tested_chrom -> row dropped entirely")

    # Schema validation (if jsonschema available).
    try:
        import jsonschema
        lic_schema_path = HERE / "schemas" / "schema_out" / "local_inv_controls_v1.schema.json"
        lic_schema = json.loads(lic_schema_path.read_text(encoding="utf-8"))
        jsonschema.validate(lic_norm, lic_schema)
        print(f"  ok: jsonschema — normalized payload validates against local_inv_controls_v1")
    except ImportError:
        pass

    # ======================================================================
    # family_aware_permutation_design adapter pair
    # (SPEC_family_aware_permutation_design_adapter.md)
    # ======================================================================
    print()
    print("family_aware_permutation_design adapter:")

    FAPD_HEADER = [
        "focal_inversion_id", "parent_id", "family_id",
        "karyotype", "permutation_block",
        "hub_id", "n_offspring",
    ]
    FAPD_ROWS = [
        # Row 1: full data — focal INV_A, family F1, het carrier
        ["INV_A", "P1", "F1", "het",  "F1", "hub_001", "4"],
        # Row 2: same family, same focal — homA carrier; pair with row 1 makes
        # F1 a non-singleton block (2 distinct parents)
        ["INV_A", "P2", "F1", "homA", "F1", "hub_001", "3"],
        # Row 3: different family for SAME focal — singleton block (only P3 in F2)
        ["INV_A", "P3", "F2", "homB", "F2", "hub_002", "5"],
        # Row 4: missing focal_inversion_id -> DROPPED
        ["",      "P4", "F1", "het",  "F1", "hub_001", "2"],
        # Row 5: unknown karyotype enum -> DROPPED
        ["INV_A", "P5", "F1", "wat",  "F1", "hub_001", "1"],
    ]

    from extractors.family_aware_permutation_design_tsv import extract as fapd_stage_extract

    with tempfile.NamedTemporaryFile("w", suffix=".tsv", delete=False) as fh:
        fh.write("\t".join(FAPD_HEADER) + "\n")
        for r in FAPD_ROWS:
            fh.write("\t".join(r) + "\n")
        fapd_tsv_path = fh.name

    fapd_raw_outputs = {
        "tsv_path":   fapd_tsv_path,
        "source_rel": "fixture.tsv",
        "scope":      "smoke",
    }
    fapd_staging = fapd_stage_extract(fapd_raw_outputs, {})
    assert fapd_staging["n_rows"] == 5, f"fapd staging n_rows = {fapd_staging['n_rows']}"
    assert len(fapd_staging["columns"]) == 7, f"fapd columns = {len(fapd_staging['columns'])}"
    print(f"  ok: staging — 5 rows, 7 columns (verbatim incl. invalid rows)")

    fapd_envelope = {"layer_id": "test_fapd_env", "payload": fapd_staging}
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as fh:
        json.dump(fapd_envelope, fh)
        fapd_env_path = fh.name

    from extractors.normalize_family_aware_permutation_design import extract as fapd_norm_extract
    fapd_norm = fapd_norm_extract({"source_envelope": fapd_env_path}, {})

    s4 = fapd_norm["summary"]
    # Rows 4 + 5 dropped -> 3 assignments
    assert s4["n_assignments"]      == 3, f"n_assignments = {s4['n_assignments']}"
    assert s4["n_focal_inversions"] == 1, f"n_focal_inversions = {s4['n_focal_inversions']}"
    assert s4["n_families"]         == 2, f"n_families = {s4['n_families']}"
    assert s4["n_permutation_blocks"] == 2, f"n_permutation_blocks = {s4['n_permutation_blocks']}"
    assert s4["n_parents"]          == 3, f"n_parents = {s4['n_parents']}"
    # F2 has only P3 -> 1 singleton; F1 has P1 + P2 -> not singleton
    assert s4["n_singleton_blocks"] == 1, f"n_singleton_blocks = {s4['n_singleton_blocks']}"
    assert s4["karyotype_counts"]   == {"homA": 1, "het": 1, "homB": 1}, \
        f"karyotype_counts = {s4['karyotype_counts']}"
    print(f"  ok: summary — 3 assignments, 2 families, 1 singleton block, karyo counts {{homA:1,het:1,homB:1}}")

    # Row-level checks.
    a1 = next(a for a in fapd_norm["assignments"] if a["parent_id"] == "P1")
    assert a1["karyotype"] == "het"
    assert a1["family_id"] == "F1"
    assert a1["permutation_block"] == "F1"
    assert a1["hub_id"] == "hub_001"
    assert a1["n_offspring"] == 4
    print(f"  ok: row1 — string + enum + int coercion preserved")

    # Verify the dropped rows are absent.
    assert all(a["parent_id"] != "P4" for a in fapd_norm["assignments"]), \
        "row missing focal_inversion_id should have been dropped"
    print(f"  ok: row4 — missing focal_inversion_id -> dropped")
    assert all(a["parent_id"] != "P5" for a in fapd_norm["assignments"]), \
        "row with unknown karyotype 'wat' should have been dropped"
    print(f"  ok: row5 — unknown karyotype 'wat' -> dropped")

    # Singleton-block diagnostic: F2 should contain only P3.
    f2_parents = {a["parent_id"] for a in fapd_norm["assignments"] if a["permutation_block"] == "F2"}
    assert f2_parents == {"P3"}, f"F2 should contain only P3; got {f2_parents}"
    print(f"  ok: singleton diagnostic — F2 block contains only P3 (n_singleton_blocks counted it)")

    # Schema validation (if jsonschema available).
    try:
        import jsonschema
        fapd_schema_path = HERE / "schemas" / "schema_out" / "family_aware_permutation_design_v1.schema.json"
        fapd_schema = json.loads(fapd_schema_path.read_text(encoding="utf-8"))
        jsonschema.validate(fapd_norm, fapd_schema)
        print(f"  ok: jsonschema — normalized payload validates against family_aware_permutation_design_v1")
    except ImportError:
        pass

    # ======================================================================
    # coincidence_matrix adapter pair (SPEC_coincidence_matrix_adapter.md)
    # ======================================================================
    print()
    print("coincidence_matrix adapter:")

    CM_HEADER = [
        "chrom", "interval_a_id", "interval_b_id",
        "interval_a_start_bp", "interval_a_end_bp",
        "interval_b_start_bp", "interval_b_end_bp",
        "r_a", "r_b", "r_ab", "c_coincidence",
        "n_offspring",
        "karyotype_at_focal_inv", "focal_inversion_id",
    ]
    CM_ROWS = [
        # Row 1: full data with explicit c (0.5 -> positive interference)
        ["C_gar_LG01", "IA_001", "IA_002",
         "1000000", "2000000", "3000000", "4000000",
         "0.20", "0.20", "0.02", "0.50",
         "100", "het", "INV_A"],
        # Row 2: c omitted, producer ships r_a/r_b/r_ab -> extractor derives
        # c = 0.10 / (0.30 * 0.30) = 1.1111... (just over 1, no flag)
        ["C_gar_LG01", "IA_002", "IA_003",
         "3000000", "4000000", "5000000", "6000000",
         "0.30", "0.30", "0.10", "",
         "100", "het", "INV_A"],
        # Row 3: c missing, r_a == 0 -> c stays null
        ["C_gar_LG02", "IB_001", "IB_002",
         "1000000", "2000000", "3000000", "4000000",
         "0.0", "0.10", "0.0", "",
         "50", "homA", "INV_A"],
        # Row 4: high c (5.0 -> ARTEFACT, flagged)
        ["C_gar_LG02", "IB_002", "IB_003",
         "3000000", "4000000", "5000000", "6000000",
         "0.10", "0.10", "0.05", "5.0",
         "50", "homA", "INV_A"],
        # Row 5: missing chrom -> DROPPED
        ["",            "IX_001", "IX_002",
         "1000000", "2000000", "3000000", "4000000",
         "0.10", "0.10", "0.01", "1.0",
         "50", "het", "INV_A"],
    ]

    from extractors.coincidence_matrix_tsv import extract as cm_stage_extract

    with tempfile.NamedTemporaryFile("w", suffix=".tsv", delete=False) as fh:
        fh.write("\t".join(CM_HEADER) + "\n")
        for r in CM_ROWS:
            fh.write("\t".join(r) + "\n")
        cm_tsv_path = fh.name

    cm_raw_outputs = {
        "tsv_path":   cm_tsv_path,
        "source_rel": "fixture.tsv",
        "scope":      "smoke",
    }
    cm_staging = cm_stage_extract(cm_raw_outputs, {})
    assert cm_staging["n_rows"] == 5, f"cm staging n_rows = {cm_staging['n_rows']}"
    assert len(cm_staging["columns"]) == 14, f"cm columns = {len(cm_staging['columns'])}"
    print(f"  ok: staging — 5 rows, 14 columns (verbatim incl. invalid row)")

    cm_envelope = {"layer_id": "test_cm_env", "payload": cm_staging}
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as fh:
        json.dump(cm_envelope, fh)
        cm_env_path = fh.name

    from extractors.normalize_coincidence_matrix import extract as cm_norm_extract
    cm_norm = cm_norm_extract({"source_envelope": cm_env_path}, {})

    s5 = cm_norm["summary"]
    # Row 5 dropped (missing chrom) -> 4 pairs
    assert s5["n_pairs"]                    == 4, f"n_pairs = {s5['n_pairs']}"
    assert s5["n_chroms"]                   == 2, f"n_chroms = {s5['n_chroms']}"
    assert s5["n_focal_inversions"]         == 1, f"n_focal_inversions = {s5['n_focal_inversions']}"
    assert s5["n_stratified_rows"]          == 4, f"n_stratified_rows = {s5['n_stratified_rows']}"
    assert s5["karyotype_counts"]           == {"homA": 2, "het": 2, "homB": 0}, \
        f"karyotype_counts = {s5['karyotype_counts']}"
    # Row 4 has c=5.0 (> 3.0 default threshold) -> 1 flagged
    assert s5["n_neg_interference_flagged"] == 1, \
        f"n_neg_interference_flagged = {s5['n_neg_interference_flagged']}"
    assert s5["neg_interference_threshold"] == 3.0, \
        f"neg_interference_threshold echoed: {s5['neg_interference_threshold']}"
    print(f"  ok: summary — 4 pairs (row5 dropped), 2 chroms, karyo {{homA:2, het:2}}, 1 flagged")

    # Row-level checks.
    p1 = next(p for p in cm_norm["pairs"] if p["interval_a_id"] == "IA_001")
    assert p1["c_coincidence"] == 0.5, f"row1 c should be 0.5; got {p1['c_coincidence']!r}"
    assert p1["neg_interference_flagged"] is False, \
        f"row1 c=0.5 should NOT be flagged; got {p1['neg_interference_flagged']!r}"
    print(f"  ok: row1 — explicit c=0.5 preserved; not flagged")

    p2 = next(p for p in cm_norm["pairs"] if p["interval_a_id"] == "IA_002")
    # 0.10 / (0.30 * 0.30) = 1.111...
    assert p2["c_coincidence"] is not None and abs(p2["c_coincidence"] - (0.10 / (0.30 * 0.30))) < 1e-9, \
        f"row2 c should be derived; got {p2['c_coincidence']!r}"
    assert p2["neg_interference_flagged"] is False, \
        f"row2 c~1.11 should NOT be flagged; got {p2['neg_interference_flagged']!r}"
    print(f"  ok: row2 — c derived from r_a/r_b/r_ab when producer omitted it; not flagged")

    p3 = next(p for p in cm_norm["pairs"] if p["interval_a_id"] == "IB_001")
    assert p3["c_coincidence"] is None, \
        f"row3 r_a=0 should leave c null; got {p3['c_coincidence']!r}"
    assert p3["neg_interference_flagged"] is None, \
        f"row3 null c should leave flag null; got {p3['neg_interference_flagged']!r}"
    print(f"  ok: row3 — r_a=0 -> c stays null; flag null")

    p4 = next(p for p in cm_norm["pairs"] if p["interval_a_id"] == "IB_002")
    assert p4["c_coincidence"] == 5.0, f"row4 c should be 5.0; got {p4['c_coincidence']!r}"
    assert p4["neg_interference_flagged"] is True, \
        f"row4 c=5.0 should be flagged; got {p4['neg_interference_flagged']!r}"
    print(f"  ok: row4 — high c=5.0 flagged as artefact-likely")

    # Row 5 should be absent entirely.
    assert all(p["interval_a_id"] != "IX_001" for p in cm_norm["pairs"]), \
        "row missing chrom should have been dropped"
    print(f"  ok: row5 — missing chrom -> dropped")

    # Override threshold via params -> different flag count.
    cm_norm_low_thr = cm_norm_extract(
        {"source_envelope": cm_env_path},
        {"neg_interference_threshold": 1.05},  # row2 c~1.11 will now be flagged too
    )
    assert cm_norm_low_thr["summary"]["n_neg_interference_flagged"] == 2, \
        f"low threshold should flag rows 2 and 4; got {cm_norm_low_thr['summary']['n_neg_interference_flagged']}"
    assert cm_norm_low_thr["summary"]["neg_interference_threshold"] == 1.05, \
        f"params threshold echoed: {cm_norm_low_thr['summary']['neg_interference_threshold']}"
    print(f"  ok: params.neg_interference_threshold=1.05 -> 2 flagged (rows 2 + 4)")

    # Schema validation (if jsonschema available).
    try:
        import jsonschema
        cm_schema_path = HERE / "schemas" / "schema_out" / "coincidence_matrix_v1.schema.json"
        cm_schema = json.loads(cm_schema_path.read_text(encoding="utf-8"))
        jsonschema.validate(cm_norm, cm_schema)
        print(f"  ok: jsonschema — normalized payload validates against coincidence_matrix_v1")
    except ImportError:
        pass

    print("\nALL OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
