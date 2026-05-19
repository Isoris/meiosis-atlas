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

    print("\nALL OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
