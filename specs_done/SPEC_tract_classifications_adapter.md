# SPEC — tract_classifications IN/OUT JSON adapters

**Status**: shipped 2026-05-20. Contract-only (no real data yet — see §7 Open
work below). End-to-end smoke green; jsonschema validation against the
strict v1 schema passes on a 3-row synthetic fixture.

**Implemented in:**
- [`atlases/meiosis/registries/dispatcher.py`](../atlases/meiosis/registries/dispatcher.py) (atlas-agnostic; mirrors relatedness)
- [`atlases/meiosis/registries/runners/import_tsv.py`](../atlases/meiosis/registries/runners/import_tsv.py)
- [`atlases/meiosis/registries/runners/normalize_tract_classifications.py`](../atlases/meiosis/registries/runners/normalize_tract_classifications.py)
- [`atlases/meiosis/registries/extractors/tract_classifications_tsv.py`](../atlases/meiosis/registries/extractors/tract_classifications_tsv.py)
- [`atlases/meiosis/registries/extractors/normalize_tract_classifications.py`](../atlases/meiosis/registries/extractors/normalize_tract_classifications.py)
- 4 schemas under `atlases/meiosis/registries/schemas/{schema_in,schema_out}/`
- 2 registry tables: `data/actions.registry.json`, `data/extractors.registry.json`
- Smoke test: [`atlases/meiosis/registries/test_adapter_smoke.py`](../atlases/meiosis/registries/test_adapter_smoke.py)

Wired into umbrella at [`atlas-core/scripts/_run_all_tests.sh`](../../atlas-core/scripts/_run_all_tests.sh) — runs as "meiosis-atlas adapter (staging + normalize)".

---

## 1. Goal

Bridge ngsTracts STEP_TRC_01 output (`tract_classifications.tsv`) into the
atlas action-pipeline envelope contract, so any meiosis-atlas page can
read a typed `tract_classifications_v1` envelope via `GET /api/layers/{id}`.

Mirrors the relatedness-atlas's `import_relatedness_tsv` + `normalize_relatedness`
pair (the canonical staging→normalized example from
`atlas-core/toolkit_registries/PIPELINE_FLOW.md`).

## 2. Two-action flow

```
ngsTracts/out/tract_classifications.tsv
    │
    ▼ POST /api/actions { type: "import_tract_classifications", ... }
    │   → runners.import_tsv.import_tsv
    │   → extractors.tract_classifications_tsv.extract
    │   → staging_tract_classifications_v0 envelope (loose: {columns, rows})
    │
    ▼ POST /api/actions { type: "normalize_tract_classifications",
    │                     target.source_layer_id: <staging envelope id> }
    │   → runners.normalize_tract_classifications.normalize
    │   → extractors.normalize_tract_classifications.extract
    │   → tract_classifications_v1 envelope (typed: {tracts[], summary})
    │
    ▼ envelope.provenance.source_layer_ids = [<staging envelope id>]
       (lineage preserved per PIPELINE_FLOW.md §Reversibility)
```

Layer type: `tract_classifications` (single name, two schema_versions).
Backs registered meiosis_atlas product `gene_conversion_tracts.v1`.

## 3. Canonical columns (tract_classifications_v1)

Per [`ngsTracts/docs/METHODOLOGY.md` §5.1](../../ngsTracts/docs/METHODOLOGY.md), 22
columns total:

**Always present (19 cols):**
```
interval_id, parent_id, offspring_id, chrom, start, end, span_bp,
class, confidence,
flanking_left_state, flanking_right_state, departure_state,
n_sites, n_discordant, inside_inversion, distance_to_nearest_inv_bp,
prior_log_ratio_co_nco, manual_review_flag, notes
```

**STEP_TRC_02 only (3 cols):**
```
refined_breakpoint_bp, refined_ci_left, refined_ci_right
```

Strict schema constraints:
- `interval_id` matches `^DEP_[0-9]{6,}$` (per ngsPedigree Stage 3 contract)
- `class` ∈ `{NCO, CO, DCO, MOSAIC_SHORT, MOSAIC_LONG, AMBIG, LOW_CONFIDENCE}`
- `confidence` ∈ `{high, medium, low}`
- `flanking_*_state` ∈ `{hapA, hapB, boundary}`
- `departure_state` ∈ `{hapA, hapB, neither}`
- `inside_inversion` ∈ `{yes, partial, no}`
- `n_sites >= 3` (Stage 3 filters lower)
- `start >= 1`, `end >= 1`, `span_bp >= 1` (1-based inclusive)

## 4. Type coercion rules

In [`extractors/normalize_tract_classifications.py`](../atlases/meiosis/registries/extractors/normalize_tract_classifications.py):

| canonical column        | type   | null sentinels                          |
|-------------------------|--------|-----------------------------------------|
| start, end, span_bp, n_sites, n_discordant | int    | `''`, `NA`, `NaN`, `null`, `None`       |
| distance_to_nearest_inv_bp                  | int    | adds `'-'` (per SCHEMA.md when no atlas) |
| refined_breakpoint_bp, refined_ci_left/right| int    | empty string when STEP_TRC_01-only       |
| prior_log_ratio_co_nco                       | float  | as above + `'NaN'`                       |
| manual_review_flag                           | bool   | accepts `0/1`, `true/false`, `yes/no`    |
| interval_id, parent_id, offspring_id, chrom, class, confidence, flanking_*, departure_state, inside_inversion, notes | string | as above (but **not** `'-'` — that's a legitimate "no notes" marker) |

Coercion is null-tolerant: any unparseable value becomes `None` rather than
raising — production data is messy, refuse-to-classify is preferable to
refuse-to-load.

## 5. Summary block

`tract_classifications_v1.summary` always includes:
- `n_tracts` — total row count
- `n_dyads` — distinct `(parent_id, offspring_id)` pairs
- `n_chroms` — distinct `chrom` values
- `class_counts` — per-class tract count, all 7 enum values present (zero when missing)
- `n_inside_inversion` — tracts with `inside_inversion == 'yes'`

Drives the [`nco` page](../atlases/meiosis/pages/hub/nco.html) headline counters
and the inside-vs-outside-inversion enrichment view per §3.2 of ngsTracts
METHODOLOGY.

## 6. Why mirror relatedness verbatim

The dispatcher logic is atlas-agnostic; copying relatedness's
[`dispatcher.py`](../../relatedness-atlas/atlases/relatedness/registries/dispatcher.py)
keeps the action-pipeline contract uniform across atlases. The runners
diverge only on the `raw_results/<atlas>/` directory prefix. The extractors
diverge on the column map (relatedness: a/b/theta/KING/R; meiosis: 22-col
ngsTracts shape).

Following this pattern means each new atlas adapter is a deterministic
7-file scaffold + 2-file customisation (extractors). The cost of adding
the next adapter pair (e.g. `import_chromosome_meiosis_events` once the
builder lands) is ~1 hour of typing.

## 7. Open work

- **No real data**: ngsTracts STEP_TRC_01 hasn't run on the 226-sample
  hatchery cohort yet. The adapter is validated against a 3-row synthetic
  fixture in [`test_adapter_smoke.py`](../atlases/meiosis/registries/test_adapter_smoke.py).
  When real data arrives, expect schema-validation failures on edge cases
  the fixture doesn't cover (very long tracts, unusual flank states, etc.) —
  the strict v1 schema will surface them clearly.
- **No page consumer**: the [`nco` page](../atlases/meiosis/pages/hub/nco.html)
  declares a `Render` button that says "Stub — needs ngsTracts loader". When a
  `tract_classifications_v1` envelope exists, that button should call
  `resolveLatestLayer('tract_classifications', { stage: 'normalized' })` and
  render the per-class tract count table. See `SPEC_meiosis_atlas_pages.md` for
  the page contract.
- **STEP_TRC_02 path not separately tested**: the smoke fixture exercises
  refined_* cols populated AND empty. A real STEP_TRC_02 run hasn't validated.
  Same envelope shape — no second action needed.

## 8. Manifest example

```json
{
  "action_id":  "act_import_2026_05_20_abc",
  "type":       "import_tract_classifications",
  "dataset_id": "226_WGS_hatchery",
  "target": {
    "path": "raw_results/ngsTracts/out/tract_classifications.tsv",
    "step": "STEP_TRC_01",
    "scope": "cohort:226_WGS_hatchery"
  },
  "expected_outputs": [
    { "layer_type": "tract_classifications",
      "schema_version": "staging_tract_classifications_v0",
      "stage": "staging" }
  ]
}
```

Then promote:
```json
{
  "action_id":  "act_normalize_2026_05_20_def",
  "type":       "normalize_tract_classifications",
  "dataset_id": "226_WGS_hatchery",
  "target": {
    "source_layer_id": "tract_classifications_226_WGS_hatchery_abc"
  },
  "expected_outputs": [
    { "layer_type": "tract_classifications",
      "schema_version": "tract_classifications_v1",
      "stage": "normalized" }
  ]
}
```
