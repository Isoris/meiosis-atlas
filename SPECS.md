# SPECS — meiosis-atlas master index

Cross-cutting index of every specification in this repo. Mirrors the
`inversion-atlas/SPECS.md` convention.

## Folder convention

```
specs_todo/   — design backlog (authored, not yet implemented)
specs_done/   — shipped (implementation matches the SPEC)
```

**Rule**: a SPEC never gets deleted. When code ships, move the SPEC
from `specs_todo/` to `specs_done/`, update its status line, and add an
`Implemented in:` block at the top.

## Shipped — `specs_done/`

| SPEC | what it covers | implementation |
|------|----------------|----------------|
| [SPEC_tract_classifications_adapter.md](specs_done/SPEC_tract_classifications_adapter.md) | IN + OUT JSON adapters for ngsTracts STEP_TRC_01 output (import_tract_classifications → staging_tract_classifications_v0; normalize_tract_classifications → tract_classifications_v1). Type coercion, summary block, `'-'` null sentinel. | [atlases/meiosis/registries/](atlases/meiosis/registries/) (12 files: dispatcher + 2 runners + 2 extractors + 4 schemas + 2 registries + smoke test) |
| [SPEC_chromosome_meiosis_events_adapter.md](specs_done/SPEC_chromosome_meiosis_events_adapter.md) | Second adapter pair: per-(chrom × dyad) CO/DCO/NCO event counts. Reuses the shared `import_tsv` runner from the first adapter; adds 2 schemas + 2 extractors + 1 normalize runner. Derives co_per_mb / dco_per_mb when the producer omits them. Karyotype-stratified rows (homA/het/homB) drive the intrachromosomal-effect view. **Unblocks** [SPEC_crossovers_page.md](specs_todo/SPEC_crossovers_page.md). | extends [atlases/meiosis/registries/](atlases/meiosis/registries/) — 7 new files + smoke-test extension |
| [SPEC_nco_page.md](specs_done/SPEC_nco_page.md) | `nco` hub page consuming `tract_classifications_v1` envelopes. Status badge + 4 views (per-dyad / length histogram / per-chrom / in-vs-out crosstab) + TSV export. The headline MOSAIC_SHORT × yes highlight. | [atlases/meiosis/pages/hub/nco.{html,js}](atlases/meiosis/pages/hub/) + [css/pages/nco.css](atlases/meiosis/css/pages/nco.css) + [shared/api_client.js](atlases/meiosis/shared/api_client.js) + 36-assertion smoke |
| [SPEC_crossovers_page.md](specs_done/SPEC_crossovers_page.md) | `crossovers` hub page consuming `chromosome_meiosis_events_v1`. Status badge + 4 views (count / rate_per_mb / position-stub / karyo_strat). The karyo_strat view's CO_rate(het) / CO_rate(non-het) cells < 0.7 → `var(--bad)` (manuscript-grade intrachromosomal-effect signal). | [atlases/meiosis/pages/hub/crossovers.{html,js}](atlases/meiosis/pages/hub/) + [css/pages/crossovers.css](atlases/meiosis/css/pages/crossovers.css) + ~30-assertion JS smoke |

## Backlog — `specs_todo/`

| SPEC | what it covers | status |
|------|----------------|--------|
| [SPEC_meiosis_atlas_pages.md](specs_todo/SPEC_meiosis_atlas_pages.md) | Master page-set overview: the 5 hub pages + 3 missing builders + cross-atlas dependencies | nco + crossovers shipped; interchromosomal pending |
| [SPEC_interchromosomal_page.md](specs_todo/SPEC_interchromosomal_page.md) | `interchromosomal` page (HEADLINE): does het at focal inversion alter meiosis on OTHER chromosomes? Family-aware permutation + local-inversion controls. | blocked by 3 missing builders: `coincidence_matrix.v1`, `local_inv_controls.v1`, `family_aware_permutation_design.v1`. The `chromosome_meiosis_events` adapter dependency is now satisfied. |

## Cross-atlas dependencies

The meiosis_atlas is registered in `atlas-core/toolkit_registries/relatedness/01_registry/atlases.jsonl` with `depends_on_atlases: [relatedness_atlas, inversion_atlas]`. Per that registry, primary products are: `chromosome_meiosis_events.v1`, `gene_conversion_tracts.v1`, `coincidence_matrix.v1`, `local_inv_controls.v1`, `family_aware_permutation_design.v1`, `inversion_meiosis_effects.v1`.

## Paired analysis repo

[`ngsTracts`](https://github.com/Isoris/ngsTracts) — classifier for parent–offspring haplotype departures (NCO / CO / DCO / MOSAIC_* / AMBIG / LOW_CONFIDENCE). The meiosis-atlas is the consumer / browser UI; ngsTracts is the producer.
