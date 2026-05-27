# meiosis-atlas

Browser UI for meiotic-event evidence — consumer of ngsTracts outputs
(crossover / gene-conversion classifications produced from ngsPedigree
Stage 3 departure intervals) — plus the server-side biomod modules that
back the three manuscript chain analyses (NCO enrichment, intra-
chromosomal CO suppression, and the interchromosomal HEADLINE test).

Sibling repo to `relatedness-atlas`, `diversity-atlas`, `genome-atlas`,
`inversion-atlas`. Follows the same `atlases/<atlas_id>/` layout consumed
by the atlas-core assemble pipeline.

## Status

6 hub pages wired. 4 chain modules promoted from browser JS to server-
side biomods (zero `stale: promotion_from_browser_js` rows). Catalogue
forwarding payload auto-generated; ~565 assertions across 12 smoke
suites, 0 failures. See [`SPECS.md`](SPECS.md) for the per-feature
ledger.

## Repo layout

```
meiosis-atlas/
├── LICENSE
├── README.md
├── SPECS.md
├── Makefile                       # make catalogue / smoke / ship / catalogue-push
├── package.json
├── specs_done/                    # shipped SPECs
├── specs_todo/                    # design backlog
└── atlases/
    └── meiosis/
        ├── manifest.json
        ├── css/pages/             # per-page stylesheets
        ├── data/                  # atlas-owned data dirs (per-candidate JSON, …)
        ├── pages/hub/             # 6 hub pages + smoke tests
        ├── registries/
        │   ├── data/              # actions / extractors / layers / pages / files / slots
        │   ├── schemas/           # JSON-Schema for action input + output envelopes
        │   ├── runners/           # adapter runners + chain compute (Fisher / Welch / perm / BH)
        │   ├── extractors/        # post-runner envelope normalizers
        │   ├── catalogue_outbound/        # auto-generated forwarding payload (5 JSONL + tarball)
        │   ├── catalogue_outbound_config.json   # declarative overlay for the generator
        │   ├── generate_catalogue_outbound.py   # derives the 5 JSONL from atlas state + overlay
        │   ├── test_*.py                  # python smoke suites
        │   └── dispatcher.py              # atlas-core dispatch entry
        └── shared/
            ├── api_client.js              # listLayers, getLayer, runAction, dispatchMeiosisChain
            └── test_api_client_dispatch.js
```

## Hub pages

| page                          | role                                                  | server-compute opt-in |
|-------------------------------|-------------------------------------------------------|------------------------|
| `nco`                         | NCO/MOSAIC tract views + cohort & per-candidate Fisher | ✅ `in_vs_out` + `per_candidate` |
| `crossovers`                  | CO/DCO counts + karyo-stratified Welch                | ✅ `karyo_strat`               |
| `interchromosomal` *HEADLINE* | Focal-inv karyotype → meiosis on OTHER chromosomes    | ✅ whole page                  |
| `crossovers_per_candidate`    | Per-inv-candidate CO ideogram + telomere bias + PRDM9 | — (no chain bloc yet)          |
| `nco_per_candidate`           | Per-inv-candidate NCO/GC tract ideogram               | — (no chain bloc yet)          |
| `workflows`                   | Live inventory of the catalogue forwarding payload    | n/a (read-only view)           |

## Chain modules — all `biomod_status: ready`

| chain                                 | dispatch action                                    | math primitive |
|---------------------------------------|----------------------------------------------------|----------------|
| `nco_inside_vs_outside_inversion`     | `compute_nco_inside_vs_outside_inversion`          | Fisher exact 2×2 (hand-rolled, no scipy) |
| `nco_per_candidate_enrichment` (v2)   | `compute_nco_per_candidate_enrichment`             | Fisher per candidate + BH/Bonferroni     |
| `intrachromosomal_co_karyotype_effect`| `compute_intrachromosomal_co_karyotype_effect`     | Welch's t with t-CDF via incomplete beta |
| `interchromosomal_inversion_effect`   | `compute_interchromosomal_inversion_effect`        | Welch + family-aware permutation (mulberry32) + BH/Bonferroni |

All four modules are dispatchable via `POST /api/actions` and reachable
from their respective hub pages with an opt-in "Run on server" checkbox.
Each falls back transparently to the existing browser compute on
dispatch failure (where applicable).

## Catalogue forwarding loop

The atlas emits a forwarding payload to atlas-core's master Workflow
Catalogue (page 4). Five JSONL files live in
[`atlases/meiosis/registries/catalogue_outbound/`](atlases/meiosis/registries/catalogue_outbound/):

| file                       | rows |
|----------------------------|------|
| `module_registry.jsonl`    | 13   |
| `analysis_registry.jsonl`  | 12   |
| `analysis_modes.jsonl`     | 12   |
| `layer_registry.jsonl`     | 12   |
| `pages_registry.jsonl`     | 6    |

All five files are **auto-generated** by
[`generate_catalogue_outbound.py`](atlases/meiosis/registries/generate_catalogue_outbound.py)
from `actions.registry.json` + the declarative overlay
[`catalogue_outbound_config.json`](atlases/meiosis/registries/catalogue_outbound_config.json)
+ `manifest.json` + `pages.registry.json`.

Three hard constraints validated at generation time (and re-checked
by atlas-core's smoke test):

1. every `analysis_modes.analysis_type` ∈ `analysis_registry.analysis_id`
2. every `analysis_modes.produces` is single-valued AND ∈ that registry row's declared `produces`
3. every `analysis_modes.module_name` ∈ `module_registry.module_name`

The payload also ships as a tarball
(`meiosis_catalogue_outbound.tar.gz`) for one-shot drop into
`atlas-core/toolkit_registries/meiosis/01_registry/`.

## Workflow targets

```sh
make catalogue       # regenerate catalogue_outbound/ (JSONL + tarball)
make smoke           # run every smoke suite (Python + Node, auto-discovered)
make ship            # catalogue + smoke in one go (canonical CI-ready workflow)
make tarball         # rebuild the tarball without regenerating JSONL
make catalogue-push  # untar payload into a sibling atlas-core checkout
                     # (override location: ATLAS_CORE_REPO=path/to/atlas-core)
make clean           # remove generated artefacts
make help            # full list
```

`make smoke` auto-discovers test files via `find -name 'test_*.{py,js}'`
under `atlases/` — new test suites land without Makefile edits.

## Adding a new bloc

- **Atomic adapter** — add a `normalize_<X>` action in
  `data/actions.registry.json` (with its `import_<X>` partner), then a
  matching `<X>` entry under `atomic_module_overlay` in
  `catalogue_outbound_config.json`. Re-run `make ship`.
- **CHAIN workflow** — append an entry to `chains[]` in
  `catalogue_outbound_config.json`, write the math + runner + extractor
  + two schemas using the existing chain promotions as a template
  (see [`SPEC_nco_enrichment_chain_module.md`](specs_done/SPEC_nco_enrichment_chain_module.md)),
  register the action + extractor. Re-run `make ship`.
- **Per-candidate track** — append an entry to `per_candidate_tracks[]`
  in `catalogue_outbound_config.json`.

## Paired analysis repo

[`ngsTracts`](https://github.com/Isoris/ngsTracts) — classifier for
parent–offspring haplotype departures (NCO / CO / DCO / MOSAIC_* /
AMBIG / LOW_CONFIDENCE). The meiosis-atlas is the consumer / browser UI;
ngsTracts is the producer.

## Cohort

226-sample hatchery *Clarias gariepinus*, ref `fClaHyb_Gar_LG`. No
cross-species rows.
