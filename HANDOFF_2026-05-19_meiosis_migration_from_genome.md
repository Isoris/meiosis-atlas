# HANDOFF — Meiosis migration from Genome Atlas

**Date:** 2026-05-19
**Direction:** `genome-atlas` → `meiosis-atlas` (page11 + page12 + 3 layers)
**Status:** Done. atlas-workspace re-assembled.

---

## What moved

Two per-inversion-candidate pages were living in the wrong atlas. They describe
**meiosis events keyed by inversion candidate**, not genome assembly / annotation
features — but they shipped under `genome-atlas/atlases/genome/pages/annotation/`
because the genome atlas was scaffolded first.

| Asset | From | To |
|---|---|---|
| Crossovers page (HTML) | `genome-atlas/atlases/genome/pages/annotation/page11.html` | `meiosis-atlas/atlases/meiosis/pages/hub/crossovers_per_candidate.html` |
| Crossovers page (JS) | `genome-atlas/.../page11.js` | `meiosis-atlas/.../crossovers_per_candidate.js` |
| Crossovers page-state stub | `genome-atlas/.../page11/_state.js` | `meiosis-atlas/.../crossovers_per_candidate/_state.js` |
| NCO/GC page (HTML) | `genome-atlas/.../annotation/page12.html` | `meiosis-atlas/.../hub/nco_per_candidate.html` |
| NCO/GC page (JS) | `genome-atlas/.../page12.js` | `meiosis-atlas/.../nco_per_candidate.js` |
| NCO/GC page-state stub | `genome-atlas/.../page12/_state.js` | `meiosis-atlas/.../nco_per_candidate/_state.js` |
| `crossover_track` layer | `genome-atlas/.../layers.registry.json` | `meiosis-atlas/.../layers.registry.json` |
| `prdm9_motif` layer | `genome-atlas/.../layers.registry.json` | `meiosis-atlas/.../layers.registry.json` |
| `nco_gc_track` layer | `genome-atlas/.../layers.registry.json` | `meiosis-atlas/.../layers.registry.json` |

### Page rename rationale

Genome `page11` → meiosis `crossovers_per_candidate` and `page12` →
`nco_per_candidate` (rather than re-using the legacy numeric names) because:

1. The meiosis atlas has cohort-level scaffold pages already named `crossovers`
   and `nco` (under `pages/hub/`). The migrated pages are the per-candidate
   lens on the same data; the `_per_candidate` suffix makes the relationship
   explicit and avoids a name collision.
2. Per the kickoff handoff convention, names are page-renumbered late in the
   migration; the rename is consistent with that — semantic names first, page
   numbers later if needed.

### Layer-path simplification

Genome stored the layers under `data/annotation/<...>` (because they were on the
`annotation` stage). Meiosis stores them under `data/<...>` directly — there's
no need for the `annotation/` ancestor in a fresh data layout. Affected:

- `data/annotation/crossovers/<candidate_id>.json` → `data/crossovers/<candidate_id>.json`
- `data/annotation/nco_gc/<candidate_id>.json` → `data/nco_gc/<candidate_id>.json`

The CO/NCO pedigree pipelines (per ngsTracts STEP_TRC_01 / STEP_TRC_02) emit
into the meiosis-atlas-owned data tree.

---

## Cross-atlas reads that still happen

The Genome Atlas's **page3** (chromosome overview) renders a **CO-density
sub-track** by reading `crossover_track`. After the migration `crossover_track`
is owned by meiosis-atlas. page3 keeps the sub-track — it just reads the layer
cross-atlas from the meiosis registry rather than locally. The page3 docs
(both `manifest.json` tooltip and `pages.registry.json` `_doc`) have been
updated to point at the meiosis-atlas page (`crossovers_per_candidate`) as
the click-pivot target instead of the old `page11`.

---

## CSS — the `.ga-*` namespace stays where it is

The migrated pages use class names like `.ga-card`, `.ga-ideogram-row`, `.ga-co-female`,
etc. — the entire `genome.css` is namespaced under `.ga-*`. Rather than copy
the stylesheet or rename classes, the migrated pages declare:

```json
"stylesheet": "atlases/genome/css/genome.css"
```

on each page entry in `meiosis/atlases/meiosis/manifest.json`. The atlas-core
router loads per-page stylesheets at mount time (see [atlas_router.js](https://example.local/atlas-core/core/atlas_router.js)).

**Trade-off acknowledged:** cross-atlas CSS dependency. If `genome-atlas` is
ever pruned from `atlas-core/build/atlas.config`, these meiosis pages will
render unstyled. The alternative (copying genome.css into meiosis or renaming
to `.mei-*`) was rejected as too much churn for a scaffold-stage migration.

---

## Cleanup on the genome side

| File | What changed |
|---|---|
| `genome/atlases/genome/manifest.json` | `pages[]` array trimmed (page11/page12 dropped). New top-level `_pages_migration_note_2026_05_19` documents the move. page3 tooltip updated to point at meiosis-atlas. |
| `genome/atlases/genome/registries/data/pages.registry.json` | page11/page12 entries dropped, replaced by `_migration_note_2026_05_19`. page3's `_doc` updated. `_round1_status` count updated from "All ten" → "Ten pages (post-migration)". |
| `genome/atlases/genome/registries/data/layers.registry.json` | `crossover_track`, `prdm9_motif`, `nco_gc_track` entries dropped, replaced by `_migration_note_2026_05_19`. `_round1_status` count updated from "eleven" → "Eight layers (post-migration)". |
| `genome/atlases/genome/pages/assembly/page3.html` | Three live cross-references to "page11" rewritten to point at `meiosis-atlas/crossovers_per_candidate` (and one mention of "page12" → `meiosis-atlas/nco_per_candidate`). |
| `genome/atlases/genome/pages/annotation/page11.{html,js}` + `page11/_state.js` | **DELETED**. |
| `genome/atlases/genome/pages/annotation/page12.{html,js}` + `page12/_state.js` | **DELETED**. |

The genome `.css` file still contains rules under `.ga-co-female`,
`.ga-co-male`, `.ga-ideo-tick`, etc. — these are not deleted because the
migrated meiosis pages reference them via the cross-atlas stylesheet declared
on each page entry. The two comment markers in `genome.css` (`page11 — crossovers`
at line 319, `page12 NCO / GC band+line variants — analogous to female/male on page11`
at line 454) are stale but harmless and not worth churning for.

---

## atlas-core changes

None to atlas-core directly. The migration is contained within the two atlas
repos (`genome-atlas`, `meiosis-atlas`). atlas-core was last touched two turns
ago (forgiving-loader + auto_index_empty-noise-downgrade) which is unrelated.

`atlas-core/build/atlas.config` already lists `atlas_meiosis = ../../meiosis-atlas`
so `assemble.sh` picks up the new pages automatically. atlas-workspace was
re-assembled at the end of this migration.

---

## Verification

1. `atlas-workspace/atlases/meiosis/pages/hub/{crossovers,nco}_per_candidate.{html,js}` exist (yes).
2. `atlas-workspace/atlases/meiosis/pages/hub/{crossovers,nco}_per_candidate/_state.js` exist (yes).
3. `atlas-workspace/atlases/genome/pages/annotation/page11*` and `page12*` are gone (yes).
4. Meiosis manifest declares 5 pages: nco, crossovers, interchromosomal, crossovers_per_candidate, nco_per_candidate (yes).
5. Meiosis layers registry declares 3 layers: crossover_track, prdm9_motif, nco_gc_track (yes).
6. Genome layers registry no longer declares those 3 layers (yes).

To validate end-to-end:

```sh
cd /mnt/c/Users/quent/Desktop/atlas-workspace
bash start.sh
# http://localhost:8000/#/meiosis/crossovers_per_candidate
# http://localhost:8000/#/meiosis/nco_per_candidate
```

Both pages should render their static spec/scaffold content (no data wiring yet
— that's phase C+ work, blocked on the ngsTracts pipeline producing real CO/NCO
output).

---

## Open items for next round

- **Rename `_per_candidate` pages?** The current names are descriptive but
  long. If the cohort-level meiosis pages don't end up needing distinct
  names, the per-candidate ones could become just `crossovers` and `nco`
  while the cohort scaffolds rename to `crossovers_cohort` / `nco_cohort`.
  Defer until both views actually have data wiring.
- **Copy / rename the `.ga-*` CSS into meiosis-owned `mei-*`** if cross-atlas
  stylesheet coupling proves a problem. Not urgent; the coupling is minor.
- **Genome `genome.css` comments at lines 319 + 454** ("page11", "page12") are
  stale. Mass-replace `page11` → `crossovers_per_candidate` and `page12` →
  `nco_per_candidate` in CSS comments when the next genome migration touches
  the file.
- **`data/crossovers/` and `data/nco_gc/` dirs** under `meiosis-atlas/atlases/meiosis/`
  don't exist yet (they're declared paths waiting for pipeline output). When
  ngsTracts STEP_TRC_01 / STEP_TRC_02 produces real per-candidate JSONs, drop
  them in or wire a `master_config.roots.crossover_track_dir` entry pointing
  at the pipeline output dir + flip the layers to `auto_index: true`.
