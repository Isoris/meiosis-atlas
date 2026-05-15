# meiosis-atlas

Browser UI for meiotic-event evidence — consumer of ngsTracts outputs
(crossover / gene-conversion classifications produced from ngsPedigree
Stage 3 departure intervals).

Sibling repo to `relatedness-atlas`, `diversity-atlas`, `genome-atlas`,
`inversion-atlas`. Follows the same `atlases/<atlas_id>/` layout consumed
by the atlas-core assemble pipeline.

## Status

Scaffold only. Pages will be migrated from the relatedness-atlas hub.

## Repo layout

```
meiosis-atlas/
├── LICENSE
├── README.md
├── package.json
└── atlases/
    └── meiosis/
        ├── manifest.json
        ├── css/
        │   └── pages/
        ├── data/
        ├── pages/
        │   └── hub/
        ├── registries/
        │   └── data/
        ├── server/
        └── shared/
            └── loaders/
```

## Paired analysis repo

`C:/Users/quent/Desktop/ngsTracts` — classifier for parent–offspring
haplotype departures (NCO / CO / DCO / MOSAIC_* / AMBIG). Producer side.
