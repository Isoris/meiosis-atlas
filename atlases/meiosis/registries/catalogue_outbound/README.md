# catalogue_outbound — meiosis-atlas → atlas-core Workflow Catalogue

**Auto-generated artefact** — do not edit by hand. Re-run
`python atlases/meiosis/registries/generate_catalogue_outbound.py` to
refresh. Source of truth: `atlases/meiosis/registries/data/actions.registry.json`
+ `atlases/meiosis/registries/catalogue_outbound_config.json`
+ `atlases/meiosis/manifest.json`
+ `atlases/meiosis/registries/data/pages.registry.json`.

Last regenerated: **2026-05-27 04:55:41Z**

Mirrors the popstats / unified-ancestry registration shape (one bloc per
single stat or per CHAIN; scope is a runtime parameter, NOT a registry
row).

**Drop target (atlas-core):**
`atlas-core/toolkit_registries/meiosis/01_registry/`

## Files

| file | rows | what it carries |
|---|---|---|
| `module_registry.jsonl` | 12 | one row per biomod module backing the blocs (all `atlas: "meiosis_atlas"`) |
| `analysis_registry.jsonl` | 11 | atomic stats + CHAIN analyses (single declared `produces` each) |
| `analysis_modes.jsonl` | 11 | one row per bloc; `mode: "default"` (no scope fan-out) |
| `layer_registry.jsonl` | 11 | output layer ids referenced by `produces` (all `source_kind: "analysis_result"`, `status: "experimental"`) |
| `pages_registry.jsonl` | 6 | one row per hub page (page_id × stage × label × tooltip × fragment × module × stylesheet × products × requires_layers × missing_layers). Joins manifest.pages with pages.registry.json. |

## Hard constraints (atlas-core smoke test)

- every `analysis_modes.analysis_type` ∈ `analysis_registry.analysis_id`
- every `analysis_modes.produces` is single-valued AND ∈ that registry row's declared `produces`
- every `analysis_modes.module_name` ∈ `module_registry.module_name`

Validated at generation time. Re-validated by
`atlases/meiosis/registries/test_catalogue_outbound.py`.

## Cohort

226-sample hatchery *Clarias gariepinus*, ref `fClaHyb_Gar_LG`. No
cross-species rows.

## How to add a new bloc

- **New atomic adapter**: add a `normalize_<X>` action in
  `data/actions.registry.json` (with its `import_<X>` partner) and add a
  matching `<X>` entry under `atomic_module_overlay` in
  `catalogue_outbound_config.json`. Re-run the generator.
- **New CHAIN workflow**: append an entry to `chains[]` in
  `catalogue_outbound_config.json`. Re-run the generator.
- **New per-candidate track**: append an entry to
  `per_candidate_tracks[]` in `catalogue_outbound_config.json`.

## Caveat: chain module promotion

Some chain modules (e.g. `meiosis_interchromosomal_effect_test`) are
flagged `stale: "promotion_from_browser_js"` because the test pipeline
currently lives in browser JS (`interchromosomal/_stats.js`). The
catalogue brain can resolve the module_name but cannot dispatch compute
until the test is wrapped as a server-side biomod module. The
registration is the contract; the promotion is open work.
