# SPEC — coincidence_matrix IN/OUT JSON adapters

**Status**: shipped 2026-05-20. End-to-end smoke green; 7 new
assertions validate identifier drop, explicit-c preservation, c
derivation from r_a/r_b/r_ab when producer omits it, the r_a=0 guard,
negative-interference flagging at default and overridden thresholds,
and summary aggregates. **Unblocks** the
[`interchromosomal`](../specs_todo/SPEC_interchromosomal_page.md) page
— with this shipped, all four required builders are satisfied.

**Implemented in:**
- [`atlases/meiosis/registries/data/actions.registry.json`](../atlases/meiosis/registries/data/actions.registry.json) — `import_coincidence_matrix` + `normalize_coincidence_matrix` actions
- [`atlases/meiosis/registries/data/extractors.registry.json`](../atlases/meiosis/registries/data/extractors.registry.json) — 2 entries for layer_type `coincidence_matrix`
- [`atlases/meiosis/registries/runners/import_tsv.py`](../atlases/meiosis/registries/runners/import_tsv.py) — **shared** with the other four meiosis adapters
- [`atlases/meiosis/registries/runners/normalize_coincidence_matrix.py`](../atlases/meiosis/registries/runners/normalize_coincidence_matrix.py)
- [`atlases/meiosis/registries/extractors/coincidence_matrix_tsv.py`](../atlases/meiosis/registries/extractors/coincidence_matrix_tsv.py)
- [`atlases/meiosis/registries/extractors/normalize_coincidence_matrix.py`](../atlases/meiosis/registries/extractors/normalize_coincidence_matrix.py)
- 4 schemas under `atlases/meiosis/registries/schemas/{schema_in,schema_out}/`
- Smoke test extended in [`atlases/meiosis/registries/test_adapter_smoke.py`](../atlases/meiosis/registries/test_adapter_smoke.py)

This is the **fifth adapter** in the meiosis-atlas, built using
[atlas-core/docs/SPEC_atlas_adapter_cookbook.md](../../atlas-core/docs/SPEC_atlas_adapter_cookbook.md).

---

## 1. Goal

Provide the **per-(interval-pair) coefficient-of-coincidence table** —
the statistic that drives both the `interchromosomal` page's
`c_coincidence` view and the relatedness-atlas's `coincidence` Sandler
interference map.

The coefficient of coincidence per pair of non-overlapping intervals A
and B on the same chromosome is:

```
C = r_ab / (r_a * r_b)
```

where `r_a` and `r_b` are single-CO rates in intervals A and B, and
`r_ab` is the double-CO rate (CO in BOTH intervals). Interpretation:

| C value          | meaning |
|------------------|---------|
| `C ≈ 1`          | independence — no interference |
| `C < 1`          | positive interference (the normal pattern; one CO suppresses another nearby) |
| `C ≫ 1` (e.g. ≥ 3) | "negative interference" — usually an artefact (low sample size, miscalled COs, contamination); flag for review |

When stratified by karyotype at a focal inversion (the
interchromosomal use case), the page tests whether `C` on a tested
chromosome **differs** between het and non-het carriers — a
manuscript-grade signal of interchromosomal effect.

## 2. Two-action flow

```
producer TSV (one row per interval pair)
    │
    ▼ import_coincidence_matrix → staging_coincidence_matrix_v0
    │     loose payload: {columns, rows}
    │
    ▼ normalize_coincidence_matrix → coincidence_matrix_v1
       typed: {pairs[], summary}
       provenance.source_layer_ids = [<staging id>]
```

Layer type for both stages: `coincidence_matrix`. Distinguished by
`schema_version`.

The **import runner is shared** with the other four meiosis adapters
(`runners.import_tsv.import_tsv`) — same workspace-relative path
resolution, same copy-to-raw_results provenance.

## 3. Canonical columns (coincidence_matrix_v1)

Per [`schemas/schema_out/coincidence_matrix_v1.schema.json`](../atlases/meiosis/registries/schemas/schema_out/coincidence_matrix_v1.schema.json):

**Required (3 cols):**
```
chrom            — the chromosome (both intervals on it; cross-chrom pairs
                   live in a separate envelope when needed)
interval_a_id    — stable id for interval A
interval_b_id    — stable id for interval B
```

**Recommended (1 col; derived when omitted):**
```
c_coincidence   — r_ab / (r_a * r_b); the headline statistic. Extractor
                  derives this from r_a + r_b + r_ab when the producer
                  omits it; null when any input is null or r_a * r_b == 0.
```

**Always present (8 cols total — the 3 required + 4 interval coords + 1 c):**
```
interval_a_start_bp, interval_a_end_bp
interval_b_start_bp, interval_b_end_bp
```

**Optional (6 cols):**
```
r_a, r_b               — single-CO rates in intervals A and B
r_ab                   — double-CO rate (both intervals)
n_offspring            — sample size used in the rate computation (diagnostic)
karyotype_at_focal_inv — homA/het/homB enum; populated when stratified
focal_inversion_id     — the focal inversion under which this matrix is
                         stratified; null for cohort-wide (un-stratified)
                         matrices
```

Type coercion:
- `*_start_bp`, `*_end_bp`, `n_offspring` → int (null on parse failure)
- `r_a`, `r_b`, `r_ab`, `c_coincidence` → float (null on parse failure;
  negative values coerce to null since rates and C must be ≥ 0)
- `chrom`, `interval_a_id`, `interval_b_id`, `focal_inversion_id` → string (strip + null on standard sentinels)
- `karyotype_at_focal_inv` → enum {homA, het, homB}; unknown → null

Derived field:
- `c_coincidence` computed as `r_ab / (r_a * r_b)` when producer omits
  it AND all three inputs are present + valid (r_a > 0, r_b > 0).
  Otherwise null.

Required identifier check: rows missing `chrom` OR `interval_a_id`
OR `interval_b_id` are dropped silently.

## 4. Summary block

`coincidence_matrix_v1.summary` always includes:

```
n_pairs                     — total row count after coercion + identifier drop
n_chroms                    — distinct chrom values
n_focal_inversions          — distinct non-null focal_inversion_id values
n_stratified_rows           — rows with karyotype_at_focal_inv non-null
karyotype_counts            — {homA, het, homB} across stratified rows
mean_c                      — mean c_coincidence across all non-null rows
                              (sanity check; should be < 1 for normal interference)
median_c                    — median c_coincidence
n_neg_interference_flagged  — rows with c_coincidence > 3 (flagged as
                              likely artefact; consumer rendering should
                              highlight these in red)
```

Drives the interchromosomal page status badge: "Coincidence matrix:
4,210 pairs over 29 chroms; mean C = 0.42; 18 pairs flagged."

## 5. Producer expectations

The producer side is NOT in scope of this adapter — it lives in the
ngsTracts producer pipeline (or a successor builder), and ships the
per-interval-pair table. Authors are expected to:

1. Choose interval definitions (typically equal-width windows, e.g.
   1 Mb) and assign stable ids.
2. For each (chrom, interval_a, interval_b) pair on the same chrom,
   compute `r_a`, `r_b`, `r_ab` from CO calls per
   `tract_classifications_v1` (or `chromosome_meiosis_events_v1` when
   working from aggregated counts).
3. If stratifying by karyotype: emit one row per (focal_inversion,
   karyotype, chrom, interval_a, interval_b) tuple, with
   `karyotype_at_focal_inv` + `focal_inversion_id` populated.
4. The atlas adapter derives `c_coincidence` when the producer omits
   it — producers can ship a smaller table by omitting the derived
   column.

## 6. Manifest examples

Capture:
```json
{
  "action_id":  "act_import_2026_05_20_abc",
  "type":       "import_coincidence_matrix",
  "dataset_id": "226_WGS_hatchery",
  "target": {
    "path": "raw_results/coincidence/coincidence_matrix.tsv",
    "scope": "cohort:226_WGS_hatchery",
    "source": "computed_from:chromosome_meiosis_events_v1+tract_classifications_v1"
  },
  "expected_outputs": [
    { "layer_type": "coincidence_matrix",
      "schema_version": "staging_coincidence_matrix_v0",
      "stage": "staging" }
  ]
}
```

Promote:
```json
{
  "action_id":  "act_normalize_2026_05_20_def",
  "type":       "normalize_coincidence_matrix",
  "dataset_id": "226_WGS_hatchery",
  "target": {
    "source_layer_id": "coincidence_matrix_226_WGS_hatchery_abc"
  },
  "expected_outputs": [
    { "layer_type": "coincidence_matrix",
      "schema_version": "coincidence_matrix_v1",
      "stage": "normalized" }
  ]
}
```

## 7. Open work

- **No real data**: the builder hasn't run yet. The adapter is validated
  against a 5-row synthetic fixture in
  [`test_adapter_smoke.py`](../atlases/meiosis/registries/test_adapter_smoke.py)
  covering: full data with explicit c, missing c with r_a/r_b/r_ab so c
  must be derived, missing c with r_a == 0 so c stays null, a flagged
  high-C row (artefact), and a dropped row missing chrom.
- **Consumer not wired**: the `interchromosomal` page is now
  **unblocked** — all four builders are shipped. Wiring is the next
  SPEC.
- **Stratification mode**: this adapter supports both un-stratified
  (cohort-wide matrix for the relatedness `coincidence` page) and
  karyotype-stratified (per-focal-inversion matrix for the
  interchromosomal page) modes via the optional
  `karyotype_at_focal_inv` + `focal_inversion_id` columns. Producer
  picks which to emit; same envelope shape either way.
