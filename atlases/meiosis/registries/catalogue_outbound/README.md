# catalogue_outbound — meiosis-atlas → atlas-core Workflow Catalogue

Forwarding payload for atlas-core's Catalogue (page 4). Mirrors the
popstats / unified-ancestry registration shape (one bloc per single stat
or per CHAIN; scope is a runtime parameter, NOT a registry row).

**Drop target (atlas-core):**
`atlas-core/toolkit_registries/meiosis/01_registry/`

## Files

| file | rows | what it carries |
|---|---|---|
| `module_registry.jsonl` | 12 | one row per biomod module backing the blocs (all `atlas: "meiosis_atlas"`) |
| `analysis_registry.jsonl` | 11 | 8 atomic stats + 3 CHAIN analyses (single declared `produces` each) |
| `analysis_modes.jsonl` | 11 | one row per bloc; `mode: "default"` (no scope fan-out) |
| `layer_registry.jsonl` | 11 | output layer ids referenced by `produces` (all `source_kind: "analysis_result"`, `status: "experimental"`) |

## Hard constraints (atlas-core smoke test)

- every `analysis_modes.analysis_type` ∈ `analysis_registry.analysis_id`
- every `analysis_modes.produces` is single-valued AND ∈ that registry row's declared `produces`
- every `analysis_modes.module_name` ∈ `module_registry.module_name`

## Cohort

226-sample hatchery *Clarias gariepinus*, ref `fClaHyb_Gar_LG`. No
cross-species rows.

## CHAIN blocs (the workflows, not the primitives)

1. **`nco_inside_vs_outside_inversion`** — chains `tract_classifications_v1`
   → `inversion_candidates.v1` → in/out crosstab → Fisher. Manuscript NCO
   headline (MOSAIC_SHORT × inside-inv).
2. **`intrachromosomal_co_karyotype_effect`** — chains karyo-stratified
   `chromosome_meiosis_events_v1` → CO_rate(het) vs CO_rate(non-het)
   per (focal × tested chrom). Manuscript intrachromosomal-effect
   signal (cells <0.7 flag).
3. **`interchromosomal_inversion_effect`** — HEADLINE. Chains
   `coincidence_matrix_v1` + `local_inv_controls_v1` +
   `family_aware_permutation_design_v1` → Welch's t (het vs non-het) +
   family-aware permutation null + BH + Bonferroni across off-focal
   chrom tests.

## Known caveat: chain module promotion

`meiosis_interchromosomal_effect_test` is currently inlined in
`atlases/meiosis/pages/hub/interchromosomal/_stats.js` (browser JS). The
catalogue row is marked `stale: "promotion_from_browser_js"` until the
Welch / permutation / BH / Bonferroni pipeline is wrapped behind a real
server-side biomod module. Until then the catalogue lookup resolves the
module_name but cannot dispatch compute to it. Same caveat applies to
`meiosis_nco_enrichment_test` and `meiosis_intrachromosomal_co_test`
(both are conceptually simple but not yet server-side modules).

## Auto-forwarding plan

Once `atlas-core/toolkit_registries/meiosis/01_registry/` exists, a
SessionStart hook (or a Makefile target on the atlas-core side) can
copy these four files in. We don't push directly from this repo —
ownership of the catalogue lives in atlas-core.
