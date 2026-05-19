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

## Backlog — `specs_todo/`

| SPEC | what it covers | status |
|------|----------------|--------|
| [SPEC_meiosis_atlas_pages.md](specs_todo/SPEC_meiosis_atlas_pages.md) | The 5 hub pages (nco, crossovers, interchromosomal, crossovers_per_candidate, nco_per_candidate) and the 3 missing builders (coincidence_matrix.v1, local_inv_controls.v1, family_aware_permutation_design.v1) backing the interchromosomal page | scaffolded; data loaders + compute paths pending real-data pipeline |

## Cross-atlas dependencies

The meiosis_atlas is registered in `atlas-core/toolkit_registries/relatedness/01_registry/atlases.jsonl` with `depends_on_atlases: [relatedness_atlas, inversion_atlas]`. Per that registry, primary products are: `chromosome_meiosis_events.v1`, `gene_conversion_tracts.v1`, `coincidence_matrix.v1`, `local_inv_controls.v1`, `family_aware_permutation_design.v1`, `inversion_meiosis_effects.v1`.

## Paired analysis repo

[`ngsTracts`](https://github.com/Isoris/ngsTracts) — classifier for parent–offspring haplotype departures (NCO / CO / DCO / MOSAIC_* / AMBIG / LOW_CONFIDENCE). The meiosis-atlas is the consumer / browser UI; ngsTracts is the producer.
