# SPEC — local_inv_controls IN/OUT JSON adapters

**Status**: shipped 2026-05-20. End-to-end smoke green; 6 new
assertions validate identifier drop, length_bp derivation, frequency
∈ [0,1] clamp-to-null, unknown-ascertainment coercion, and summary
counts. Not consumed by a page yet — wires into the still-blocked
[`interchromosomal`](../specs_todo/SPEC_interchromosomal_page.md) page
as one of its four required builders (per
[SPEC_interchromosomal_page.md §6](../specs_todo/SPEC_interchromosomal_page.md) build
order step 1).

**Implemented in:**
- [`atlases/meiosis/registries/data/actions.registry.json`](../atlases/meiosis/registries/data/actions.registry.json) — `import_local_inv_controls` + `normalize_local_inv_controls` actions
- [`atlases/meiosis/registries/data/extractors.registry.json`](../atlases/meiosis/registries/data/extractors.registry.json) — 2 entries for layer_type `local_inv_controls`
- [`atlases/meiosis/registries/runners/import_tsv.py`](../atlases/meiosis/registries/runners/import_tsv.py) — **shared** with the other two meiosis adapters
- [`atlases/meiosis/registries/runners/normalize_local_inv_controls.py`](../atlases/meiosis/registries/runners/normalize_local_inv_controls.py)
- [`atlases/meiosis/registries/extractors/local_inv_controls_tsv.py`](../atlases/meiosis/registries/extractors/local_inv_controls_tsv.py)
- [`atlases/meiosis/registries/extractors/normalize_local_inv_controls.py`](../atlases/meiosis/registries/extractors/normalize_local_inv_controls.py)
- 4 schemas under `atlases/meiosis/registries/schemas/{schema_in,schema_out}/`
- Smoke test extended in [`atlases/meiosis/registries/test_adapter_smoke.py`](../atlases/meiosis/registries/test_adapter_smoke.py)

This is the **third adapter** in the meiosis-atlas, built using
[atlas-core/docs/SPEC_atlas_adapter_cookbook.md](../../atlas-core/docs/SPEC_atlas_adapter_cookbook.md).

---

## 1. Goal

Provide a per-(tested chromosome × local inversion) covariate envelope
that the `interchromosomal` page uses to **adjust away** confounding by
local inversions on the tested chromosome. Without this control, a
significant interchromosomal effect on chrom Y might actually be driven
by an unmodelled inversion on Y itself rather than by the focal inversion
on chrom X.

Producer (per SPEC_interchromosomal_page.md §6): filter
`inversion_candidates.v1` by chromosome × frequency, emit the long-format
table consumed here.

## 2. Two-action flow

```
producer TSV (one row per (tested_chrom × local_inv))
    │
    ▼ import_local_inv_controls → staging_local_inv_controls_v0
    │     loose payload: {columns, rows}
    │
    ▼ normalize_local_inv_controls → local_inv_controls_v1
       typed: {controls[], summary}
       provenance.source_layer_ids = [<staging id>]
```

Layer type for both stages: `local_inv_controls`. Distinguished by
`schema_version`.

The **import runner is shared** with the other two meiosis adapters
(`runners.import_tsv.import_tsv`) — same workspace-relative path
resolution, same copy-to-raw_results provenance.

## 3. Canonical columns (local_inv_controls_v1)

Per [`schemas/schema_out/local_inv_controls_v1.schema.json`](../atlases/meiosis/registries/schemas/schema_out/local_inv_controls_v1.schema.json):

**Required (3 cols):**
```
tested_chrom, inversion_id, start_bp
```

**Always present (8 cols total):**
```
tested_chrom    — chromosome treated as "tested" in the interchromosomal regression
inversion_id    — local inversion's stable id (matches inversion_candidates.v1)
inversion_chrom — chromosome the inversion sits on (== tested_chrom for true local
                  controls; producer can include cross-chrom rows for completeness
                  but they are ignored by the consumer)
start_bp        — local inversion start (1-based inclusive)
end_bp          — local inversion end (1-based inclusive)
length_bp       — end - start + 1 (derived when omitted)
frequency       — cohort allele frequency, in [0, 1]
n_het_carriers  — count of parents heterozygous for this local inv (the canonical
                  covariate — drives the regression adjustment)
```

**Optional (3 cols):**
```
n_carriers      — count of parents with at least one alt allele (het + homB)
ascertainment   — 'high_confidence' | 'low_confidence' | 'tentative' (filter hint)
freq_min_filter — threshold applied at build time (provenance — e.g. 0.05)
```

Type coercion:
- `start_bp`, `end_bp`, `length_bp`, `n_het_carriers`, `n_carriers` → int (null on parse failure)
- `frequency`, `freq_min_filter` → float in [0, 1] (out-of-range → null with a warning)
- string cols → stripped string; standard null sentinels (`''`, `NA`, `NaN`, `-`, `null`, `None`) → null
- `length_bp` is **derived** as `end_bp - start_bp + 1` when the producer omits it

Required identifier check: rows missing `tested_chrom` OR `inversion_id` OR `start_bp`
are dropped silently — producer's filter step should have caught them.

## 4. Summary block

`local_inv_controls_v1.summary` always includes:

```
n_controls              — total row count after coercion
n_chroms                — distinct tested_chrom values
n_inversions            — distinct inversion_id values
n_chroms_with_controls  — chroms with ≥ 1 local control (= n_chroms minus any
                          tested_chrom that came in but had every row dropped)
mean_inv_per_chrom      — n_controls / n_chroms (null when n_chroms == 0)
```

Drives the interchromosomal page's status badge: "23 of 29 tested
chromosomes have local-inversion controls; 6 chroms will be tested
unadjusted."

## 5. Producer expectations

The producer side is NOT in scope of this adapter — it lives in the
`catfish-inversion-analysis` repo (or equivalent), and ships a TSV of
the filtered inversion_candidates per chromosome. Authors are expected
to:

1. Read `inversion_candidates.v1` from the inversion-atlas envelope index.
2. Apply a frequency filter (default `freq_min_filter = 0.05` — i.e. drop
   rare variants that are unlikely to confound).
3. Apply an ascertainment filter (drop `low_confidence` and `tentative`
   when the consumer is running interchromosomal at default settings).
4. Emit one row per surviving (chrom, inversion) pair with the columns
   listed in §3.

The atlas adapter is stage-agnostic past §3's schema check; producer
versioning happens at the producer.

## 6. Manifest examples

Capture:
```json
{
  "action_id":  "act_import_2026_05_20_abc",
  "type":       "import_local_inv_controls",
  "dataset_id": "226_WGS_hatchery",
  "target": {
    "path": "raw_results/inversions_filtered/local_inv_controls.tsv",
    "scope": "cohort:226_WGS_hatchery",
    "source": "filtered_from:inversion_candidates_v1"
  },
  "expected_outputs": [
    { "layer_type": "local_inv_controls",
      "schema_version": "staging_local_inv_controls_v0",
      "stage": "staging" }
  ]
}
```

Promote:
```json
{
  "action_id":  "act_normalize_2026_05_20_def",
  "type":       "normalize_local_inv_controls",
  "dataset_id": "226_WGS_hatchery",
  "target": {
    "source_layer_id": "local_inv_controls_226_WGS_hatchery_abc"
  },
  "expected_outputs": [
    { "layer_type": "local_inv_controls",
      "schema_version": "local_inv_controls_v1",
      "stage": "normalized" }
  ]
}
```

## 7. Open work

- **No real data**: the filter pipeline that emits this TSV hasn't run
  yet on the 226-sample cohort. The adapter is validated against a
  4-row synthetic fixture in
  [`test_adapter_smoke.py`](../atlases/meiosis/registries/test_adapter_smoke.py)
  covering: missing tested_chrom (drop), missing length_bp (derive),
  out-of-range frequency (clamp to null), and one row with full data.
- **Consumer not wired**: the `interchromosomal` page remains blocked on
  the OTHER two missing builders (`coincidence_matrix.v1` and
  `family_aware_permutation_design.v1`). When all three ship, the page
  consumes them simultaneously per SPEC_interchromosomal_page.md §6.
- **Cross-atlas read for inversion_candidates**: producer reads from the
  inversion-atlas, not from here. If the inversion-atlas's
  candidate-promotion changes meaning of `frequency` (e.g. switches from
  allele frequency to genotype frequency), the producer's filter needs
  updating but the atlas adapter is unaffected — it consumes whatever
  number ships.
