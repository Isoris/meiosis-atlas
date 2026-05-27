# SPEC — meiosis-atlas workflow catalogue forwarding

**Status**: forwarding payload drafted; awaiting atlas-core ingestion +
server-side promotion of three chain-level test modules.

**Drafted in:**
[`atlases/meiosis/registries/catalogue_outbound/`](../atlases/meiosis/registries/catalogue_outbound/)
(4 JSONL files + README).

**Sibling SPEC**: the popstats / unified-ancestry equivalent in
`atlas-core/toolkit_registries/relatedness/01_registry/`. Same shape;
this SPEC is the meiosis analogue.

---

## 1. What this is

A canonical, machine-readable inventory of every meiosis workflow this
atlas exposes — drafted for forwarding to **atlas-core's Catalogue
(page 4)** so that meiosis bricks become a discoverable, dispatchable
part of the master workflow catalogue brain.

Registration shape (mirrors popstats):

- **One bloc per single analysis** (NOT fanned out by scope — scope is a
  runtime parameter, not a registry row).
- **One bloc per CHAIN workflow** — the manuscript-path targets that
  compose atomic stats into a stat-pluss-test result.

## 2. The blocs

### 2.1 Atomic stats (8 rows)

| analysis_id                          | produces                            | module backing it                            |
|--------------------------------------|-------------------------------------|----------------------------------------------|
| `tract_classifications`              | `tract_classifications_v1`          | `ngstracts_classifier`                       |
| `chromosome_meiosis_events`          | `chromosome_meiosis_events_v1`      | `chromosome_meiosis_events_builder`          |
| `coincidence_matrix`                 | `coincidence_matrix_v1`             | `coincidence_matrix_builder`                 |
| `local_inv_controls`                 | `local_inv_controls_v1`             | `local_inv_controls_builder`                 |
| `family_aware_permutation_design`    | `family_aware_permutation_design_v1`| `family_aware_permutation_design_builder`    |
| `crossover_track`                    | `crossover_track`                   | `per_candidate_co_track_builder`             |
| `nco_gc_track`                       | `nco_gc_track`                      | `per_candidate_nco_gc_track_builder`         |
| `prdm9_motif` *(optional)*           | `prdm9_motif`                       | `prdm9_motif_finder`                         |

### 2.2 CHAIN workflows (3 rows)

| analysis_id                              | produces                       | role |
|------------------------------------------|--------------------------------|------|
| `nco_inside_vs_outside_inversion`        | `nco_enrichment_result`        | Manuscript NCO headline (MOSAIC_SHORT × inside-inv). |
| `intrachromosomal_co_karyotype_effect`   | `intrachromosomal_co_effect`   | CO_rate(het) vs CO_rate(non-het) per (focal × tested chrom). |
| `interchromosomal_inversion_effect`      | `inversion_meiosis_effects_v1` | **HEADLINE.** Welch + family-aware permutation + BH + Bonferroni across off-focal chroms. |

Each chain row's `module_name` points to a promoted-from-_stats.js
biomod test module (see §4).

## 3. Hard constraints (atlas-core smoke test)

The four JSONL files in `catalogue_outbound/` have been smoke-tested
against:

- every `analysis_modes.analysis_type` ∈ `analysis_registry.analysis_id`
- every `analysis_modes.produces` is single-valued AND ∈ that registry
  row's declared `produces`
- every `analysis_modes.module_name` ∈ `module_registry.module_name`

Result: 12 modules / 11 analyses / 11 modes / 11 layers → 0 errors.

## 4. Open work — chain-module promotion

Per session decision (see commit message), chain-level statistics
currently live in browser JS:

- `meiosis_interchromosomal_effect_test` (Welch + perm + BH) → today
  inlined in
  [`atlases/meiosis/pages/hub/interchromosomal/_stats.js`](../atlases/meiosis/pages/hub/interchromosomal/_stats.js)
- `meiosis_intrachromosomal_co_test` (CO_rate(het) vs CO_rate(non-het))
  → today inlined in `crossovers.js`
- `meiosis_nco_enrichment_test` (Fisher on MOSAIC_SHORT × in/out) →
  today inlined in `nco.js`

Each is registered in `module_registry.jsonl` with appropriate
`biomod_status` / `stale_reason` so the catalogue brain sees the
**contract**; before the catalogue can **dispatch** the chain it needs
the test wrapped as a server-side biomod module. That promotion is the
follow-on SPEC.

## 5. Auto-forwarding plan ("bricks all automated")

Two pieces are needed to make new meiosis blocs auto-forward to
atlas-core without a manual paste step:

1. **Generator — SHIPPED.**
   [`atlases/meiosis/registries/generate_catalogue_outbound.py`](../atlases/meiosis/registries/generate_catalogue_outbound.py)
   reads `data/actions.registry.json` and applies the declarative
   overlay
   [`atlases/meiosis/registries/catalogue_outbound_config.json`](../atlases/meiosis/registries/catalogue_outbound_config.json)
   for chain + per-candidate-track blocs. New `normalize_<X>` actions
   appear as new atomic blocs without code edits — only the overlay
   gains a matching `<X>` entry. Validates against atlas-core's three
   hard constraints at generation time. Smoke test:
   [`test_catalogue_outbound.py`](../atlases/meiosis/registries/test_catalogue_outbound.py)
   re-runs the generator + re-validates the JSONL + checks the tarball
   exists. Both currently pass at 12 modules / 11 analyses / 11 modes
   / 11 layers, 0 constraint violations.
2. **Forwarder** — atlas-core-side. Either a SessionStart hook that
   pulls `catalogue_outbound/*.jsonl` (or the tarball) from this repo's
   pushed branch into `atlas-core/toolkit_registries/meiosis/01_registry/`,
   or a Makefile target. Ownership of the catalogue stays in atlas-core;
   this repo only emits the proposal. Deferred until atlas-core confirms
   the meiosis ingest path (parallel to
   `toolkit_registries/relatedness/01_registry/`).

## 6. Cohort

226-sample hatchery *Clarias gariepinus*, ref `fClaHyb_Gar_LG`. No
cross-species rows. Same as the popstats forwarding.
