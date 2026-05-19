# SPEC — chromosome_meiosis_events IN/OUT JSON adapters

**Status**: shipped 2026-05-20. End-to-end smoke green; jsonschema
validation against the strict v1 schema passes on a 3-row synthetic
fixture covering all coercion paths.

**Implemented in:**
- [`registries/data/actions.registry.json`](../atlases/meiosis/registries/data/actions.registry.json) — `import_chromosome_meiosis_events` + `normalize_chromosome_meiosis_events` actions
- [`registries/data/extractors.registry.json`](../atlases/meiosis/registries/data/extractors.registry.json) — 2 entries for layer_type `chromosome_meiosis_events`
- [`registries/runners/import_tsv.py`](../atlases/meiosis/registries/runners/import_tsv.py) — **shared** with the tract_classifications adapter (same TSV-capture flow)
- [`registries/runners/normalize_chromosome_meiosis_events.py`](../atlases/meiosis/registries/runners/normalize_chromosome_meiosis_events.py)
- [`registries/extractors/chromosome_meiosis_events_tsv.py`](../atlases/meiosis/registries/extractors/chromosome_meiosis_events_tsv.py)
- [`registries/extractors/normalize_chromosome_meiosis_events.py`](../atlases/meiosis/registries/extractors/normalize_chromosome_meiosis_events.py)
- 4 schemas under `registries/schemas/{schema_in,schema_out}/`
- Smoke test extended in [`registries/test_adapter_smoke.py`](../atlases/meiosis/registries/test_adapter_smoke.py)

This is the **second adapter** in the meiosis-atlas, built using
[atlas-core/docs/SPEC_atlas_adapter_cookbook.md](../../atlas-core/docs/SPEC_atlas_adapter_cookbook.md).

---

## 1. Goal

Bridge a per-(chromosome × dyad) event-count TSV (typically produced by
an aggregation script over ngsTracts `tract_classifications.tsv` +
ngsPedigree Stage 3's `dyad_event_rates.tsv`) into the atlas envelope
contract. Backs the registered meiosis_atlas product
`chromosome_meiosis_events.v1` and unblocks the
[`crossovers` page](../specs_todo/SPEC_crossovers_page.md) §3.1.

## 2. Two-action flow

```
producer TSV (per (parent × offspring × chrom) row)
    │
    ▼ import_chromosome_meiosis_events → staging_chromosome_meiosis_events_v0
    │     loose payload: {columns, rows}
    │
    ▼ normalize_chromosome_meiosis_events → chromosome_meiosis_events_v1
       typed: {events[], summary}
       provenance.source_layer_ids = [<staging id>]
```

Layer type for both stages: `chromosome_meiosis_events`. Distinguished
by `schema_version`.

The **import runner is shared** with the tract_classifications adapter
(`runners.import_tsv.import_tsv`) — same workspace-relative path resolution,
same copy-to-raw_results provenance, same return shape. The dispatcher
distinguishes the two actions by their `schema_in` validation, then the
extractors registry routes the right typed extractor per
`layer_type + schema_version`.

## 3. Canonical columns (chromosome_meiosis_events_v1)

Per [`schemas/schema_out/chromosome_meiosis_events_v1.schema.json`](../atlases/meiosis/registries/schemas/schema_out/chromosome_meiosis_events_v1.schema.json):

**Required (3 cols):**
```
parent_id, offspring_id, chrom
```

**Optional (8 cols):**
```
chrom_len_bp                  — int  (needed for rate views)
n_co, n_dco, n_nco            — int  (≥0; null = no data; 0 = data says zero)
co_per_mb, dco_per_mb         — float (derived if absent; see §4)
mean_co_position_bp           — int
median_co_position_bp         — int
karyotype_at_focal_inv        — enum {homA, het, homB} | null  (drives the karyo_strat view)
```

Total: 12 columns. The optional-everywhere-but-IDs shape lets a producer
emit a minimal {parent, offspring, chrom, n_co} TSV and let the
normalizer derive co_per_mb from chrom_len_bp.

## 4. Type coercion + rate derivation

Per [`extractors/normalize_chromosome_meiosis_events.py`](../atlases/meiosis/registries/extractors/normalize_chromosome_meiosis_events.py):

- **Integer cols** — null on any of `''`, `NA`, `NaN`, `-`, `null`, `None`, or parse failure
- **Float cols** — same null sentinels
- **String cols** — same (but the literal `'-'` survives for `notes`-style fields; not applicable here)
- **Karyotype enum** — string ∈ {`homA`, `het`, `homB`}; `'-'` → null; any other string → null

**Rate derivation** — when `co_per_mb` is null but `n_co` and
`chrom_len_bp` are both present:

```py
co_per_mb = n_co / chrom_len_bp * 1e6
```

Same for `dco_per_mb`. Producers can pre-compute the rates OR rely on
the normalizer to derive them — the page consumer gets a uniform shape
either way.

Tested directly in the smoke (row 2: producer omitted `co_per_mb`;
normalizer derived `n_co=1 / chrom_len_bp=30000000 * 1e6 = 0.0333...`).

## 5. Summary block

`chromosome_meiosis_events_v1.summary`:

- `n_rows` — total (chrom × dyad) rows
- `n_dyads` — distinct `(parent_id, offspring_id)` pairs
- `n_chroms` — distinct `chrom` values
- `sum_n_co`, `sum_n_dco`, `sum_n_nco` — totals (skipping null)
- `karyotype_strat_rows` — count of rows with non-null `karyotype_at_focal_inv`
  (tells the page whether the karyo_strat view is available)

The smoke covers all 7 summary fields against a fixture with 3 rows
where 2 are karyotype-stratified.

## 6. Cookbook reuse

This adapter was the first "second pair" — i.e. a new adapter built on
top of an atlas that already had one. Notable reuses:

- **Dispatcher** — verbatim (atlas-agnostic; unchanged from the
  tract_classifications shipment)
- **Import runner** — verbatim (the action discriminator + extractor
  routing handles the second pair without any runner change)
- **Smoke test** — extended in-place rather than as a new file
  (the umbrella runs one suite per adapter atlas, not one per pair)

Net new code for this adapter: 4 schemas + 2 extractors + 1 normalize
runner + the smoke-test extension. ~250 lines total. Confirms the
cookbook's ~150-line estimate is right when re-using shared infrastructure.

## 7. Manifest examples

```json
{
  "action_id":  "act_import_2026_05_20_xyz",
  "type":       "import_chromosome_meiosis_events",
  "dataset_id": "226_WGS_hatchery",
  "target": {
    "path": "raw_results/aggregator/per_chrom_meiosis_events.tsv",
    "scope": "cohort:226_WGS_hatchery",
    "source": "ngsTracts/aggregator_v1"
  },
  "expected_outputs": [
    { "layer_type": "chromosome_meiosis_events",
      "schema_version": "staging_chromosome_meiosis_events_v0",
      "stage": "staging" }
  ]
}
```

Then promote:

```json
{
  "action_id":  "act_normalize_2026_05_20_uvw",
  "type":       "normalize_chromosome_meiosis_events",
  "dataset_id": "226_WGS_hatchery",
  "target": {
    "source_layer_id": "chromosome_meiosis_events_226_WGS_hatchery_xyz"
  },
  "expected_outputs": [
    { "layer_type": "chromosome_meiosis_events",
      "schema_version": "chromosome_meiosis_events_v1",
      "stage": "normalized" }
  ]
}
```

## 8. What this unblocks

- [`crossovers` page](../specs_todo/SPEC_crossovers_page.md) — `mount()` can now call `resolveLatestLayer('chromosome_meiosis_events', { stage: 'normalized' })` and render real per-dyad × per-chrom event tables.
- The karyo_strat view (intrachromosomal-effect headline) is wired the moment a producer emits rows with `karyotype_at_focal_inv` populated.
- 3 of 4 missing builders blocking the [`interchromosomal` page](../specs_todo/SPEC_interchromosomal_page.md) are still pending (`coincidence_matrix`, `local_inv_controls`, `family_aware_permutation_design`); this adapter unblocks the prerequisite product that feeds them.

## 9. Open work

- **No real data yet** — same caveat as the tract_classifications adapter. The aggregation script that produces this TSV doesn't exist; the smoke fixture is the only test data.
- **`crossovers` page wiring** — see [SPEC_crossovers_page.md §3.2](../specs_todo/SPEC_crossovers_page.md). Mirror the `nco` page pattern (SPEC_nco_page.md).
