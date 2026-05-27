# SPEC — v2 per-candidate NCO chain + Makefile auto-discovery

**Status**: SHIPPED. 4th chain bloc (the manuscript per-inversion p-value
table) plus a Makefile tightening so future test suites land without
edits.

**Implemented in:**
- [`atlases/meiosis/registries/runners/meiosis_nco_per_candidate.py`](../atlases/meiosis/registries/runners/meiosis_nco_per_candidate.py) — pure math: `crosstab_per_candidate` (chrom-restricted, interval-overlap classification, NCO-like filter) + `compute_nco_per_candidate` (Fisher per candidate via the shared `fisher_exact_2x2` + BH/Bonferroni via the shared `bh_adjust` / `bonf_adjust`). Zero new third-party deps; everything reused from prior promotions.
- [`atlases/meiosis/registries/runners/compute_nco_per_candidate.py`](../atlases/meiosis/registries/runners/compute_nco_per_candidate.py) — multi-source chain action runner. Named target keys (`tracts_layer_id`, `candidates_layer_id`) with ordered-fallback. Tolerates cross-atlas envelope shape — candidates pulled from `payload.candidates` OR `payload.inversions` (different inversion-atlas envelope versions use either).
- [`atlases/meiosis/registries/extractors/normalize_nco_per_candidate_result.py`](../atlases/meiosis/registries/extractors/normalize_nco_per_candidate_result.py) — passthrough.
- [`atlases/meiosis/registries/schemas/schema_in/compute_nco_per_candidate_v1.schema.json`](../atlases/meiosis/registries/schemas/schema_in/compute_nco_per_candidate_v1.schema.json) — action input.
- [`atlases/meiosis/registries/schemas/schema_out/nco_per_candidate_enrichment_v1.schema.json`](../atlases/meiosis/registries/schemas/schema_out/nco_per_candidate_enrichment_v1.schema.json) — output envelope.
- Registry entries: `compute_nco_per_candidate_enrichment` action + `extract_nco_per_candidate_enrichment_v1` extractor.
- [`atlases/meiosis/registries/test_nco_per_candidate.py`](../atlases/meiosis/registries/test_nco_per_candidate.py) — 40 assertions (crosstab cell assignment, boundary-overlap inclusion, chrom restriction, missing-coord drops, skipped flag, designed-significant fixture INV_SIG with OR=42 / p=0.009, BH/Bonferroni monotonicity, JSON strict-mode, runner round-trip via both named-keys and ordered target forms, cross-atlas envelope-key tolerance, missing-required raises).
- [`catalogue_outbound_config.json`](../atlases/meiosis/registries/catalogue_outbound_config.json) — new chain entry; payload now 13/12/12/12/6 rows.
- [`Makefile`](../Makefile) — `PY_TESTS` / `JS_TESTS` now glob via `find` so future test files are picked up automatically.

---

## 1. What the v2 adds vs. v1

The cohort-level v1 (`compute_nco_inside_vs_outside_inversion`) tests
whether MOSAIC_SHORT is enriched inside *any* inversion span overall.
This v2 fans out across the inversion candidate set: per candidate,
build a 2×2 crosstab of `{target_class × tract intersects candidate
span}` **restricted to NCO-like tracts on the candidate's own
chromosome**, run Fisher exact, BH/Bonferroni-adjust across the
candidate set. Emits one row per candidate with cells, odds ratio,
log-odds, two-sided p, one-sided-greater p, BH q, Bonferroni q,
sig_flag. Candidates missing `{chrom, start_bp, end_bp}` are emitted
with `skipped=true` and null statistics so the row count matches the
input candidate set exactly.

This is the manuscript per-inversion p-value table that the headline
figure needs.

## 2. Cross-atlas dependency

The candidates input comes from
[`inversion-atlas/atlases/inversion/registries/data/...`](https://example.local) →
`inversion_candidates.v1`. The runner is shape-tolerant: candidates
may live under `payload.candidates` or `payload.inversions`
(different envelope versions in the wild). Required candidate fields
are `chrom`, `start_bp`, `end_bp`, plus an id (one of `candidate_id`
/ `id` / `inversion_id`).

## 3. Dispatch contract

```json
POST /api/actions
{
  "type":   "compute_nco_per_candidate_enrichment",
  "target": {
    "tracts_layer_id":     "<tract_classifications_v1 layer_id>",
    "candidates_layer_id": "<inversion_candidates.v1 layer_id>"
  },
  "params": {
    "target_class": "MOSAIC_SHORT",
    "p_bh_alpha":   0.05
  }
}
```

Ordered fallback: `target.source_layer_ids = [tracts, candidates]`.

## 4. Catalogue payload state

| status | count | what |
|---|---|---|
| `external_producer`   | 2  | ngsTracts STEP_TRC_01 + STEP_TRC_02 |
| `experimental`        | 4  | adapter builders |
| **`ready`**           | **4** | **NCO cohort + intrachromosomal + interchromosomal HEADLINE + NCO per-candidate** |
| `contract_only`       | 3  | per-candidate track builders (upstream-blocked) |
| `stale`               | 0  | — |

`make ship` regenerates the forwarding payload and runs all suites in
one go. The Makefile's `PY_TESTS` / `JS_TESTS` now glob via `find`, so
this new `test_nco_per_candidate.py` was picked up without editing
the Makefile.

## 5. Tests — `make smoke` now 12 suites green

| suite | assertions |
|---|---|
| `test_adapter_smoke.py` | OK |
| `test_catalogue_outbound.py` | 13/12/12/12/6 |
| `test_nco_enrichment.py` | 37 |
| `test_nco_per_candidate.py` | **40 (new)** |
| `test_intrachromosomal_co.py` | 44 |
| `test_interchromosomal_effect.py` | 55 |
| `test_crossovers_envelope.js` | 49 |
| `test_crossovers_per_candidate_render.js` | 45 |
| `test_interchromosomal_envelope.js` | 44 |
| `test_nco_envelope.js` | 43 |
| `test_nco_per_candidate_render.js` | 22 |
| `test_workflows.js` | 61 |
| `test_api_client_dispatch.js` | 22 |

Approximately 550 assertions across 12 suites. Zero failures.

## 6. What's still open

- **UI wiring for the v2 chain** — the per-candidate enrichment isn't
  surfaced on any hub page yet. The natural home is
  `nco_per_candidate.html` (the per-candidate hub page), but that page
  is currently a tract-ideogram view and the v2 chain is per-candidate
  test statistics; a dedicated table view would be the v2 follow-on.
- **Per-candidate track builders** (`crossover_track`, `nco_gc_track`,
  `prdm9_motif`) — still `contract_only`, blocked on the upstream
  pedigree pipeline emitting per-candidate JSON.
- **Atlas-core side ingest** — `make catalogue-push ATLAS_CORE_REPO=...`
  works locally; landing the JSONL into the atlas-core repo is out of
  this repo.
