# SPEC — meiosis-atlas `crossovers` page (CO + DCO cohort view)

**Status**: shipped 2026-05-20. mount() probes the latest
`chromosome_meiosis_events_v1` envelope and is fail-soft. Three of the
four views render real data (`count`, `rate_per_mb`, `karyo_strat`);
the `position` view remains a stub pointing at the missing
`traversal_breakpoints` envelope (STEP_TRC_02) per §7. The
karyo_strat view colour-tags CO_rate(het) / CO_rate(non-het) cells
below 0.7 in `var(--bad)` — the manuscript-grade output per §5.

**Implemented in:**
- [`atlases/meiosis/pages/hub/crossovers.html`](../atlases/meiosis/pages/hub/crossovers.html) — stub message updated to "Loading envelope…"
- [`atlases/meiosis/pages/hub/crossovers.js`](../atlases/meiosis/pages/hub/crossovers.js) — full mount/render/export wiring; mirrors `nco.js`
- [`atlases/meiosis/css/pages/crossovers.css`](../atlases/meiosis/css/pages/crossovers.css) — `#crossovers`-scoped badge / table / `co-cell-low` highlight
- [`atlases/meiosis/manifest.json`](../atlases/meiosis/manifest.json) — added `stylesheet` field for the page entry
- [`atlases/meiosis/pages/hub/test_crossovers_envelope.js`](../atlases/meiosis/pages/hub/test_crossovers_envelope.js) — JS smoke (~30 assertions across filterEvents / chromList / classPred / 4 renderers / status badge), mirrors `test_nco_envelope.js`
- Adapter pair: shipped via the already-done [SPEC_chromosome_meiosis_events_adapter.md](SPEC_chromosome_meiosis_events_adapter.md) (§3.1)

**Sister page**: [`nco`](SPEC_nco_page.md) — shipped first.
This SPEC mirrors that pattern.

---

## 1. Goal

Render meiotic events that are NOT NCO — single crossovers (CO) and
double crossovers (DCO, 50–200 kb return-to-flank) — per dyad and per
chromosome.

This is the cohort-level CO view. The per-candidate variant (sex-specific
ideogram + telomere distance curve + optional PRDM9 logo) is
[`crossovers_per_candidate`](SPEC_crossovers_per_candidate_page.md).

## 2. Data sources

Two envelopes (neither built yet):

| envelope | producer | status |
|----------|----------|--------|
| `tract_classifications_v1` (filtered to `class ∈ {CO, DCO}`) | ngsTracts STEP_TRC_01 ([adapter shipped](../specs_done/SPEC_tract_classifications_adapter.md)) | adapter ready, no real data |
| `chromosome_meiosis_events_v1` | TBD — needs a new adapter pair | **not built** |

Plus optional:
- `traversal_breakpoints` envelope from ngsTracts STEP_TRC_02 (refined CO breakpoints)
- intrachromosomal slice of `inversion_meiosis_effects.v1` (karyotype-stratified rate; product registered, builder pending)

## 3. Action items before promotion

### 3.1 Adapter pair for `chromosome_meiosis_events` — **SHIPPED 2026-05-20**

Shipped — see [specs_done/SPEC_chromosome_meiosis_events_adapter.md](../specs_done/SPEC_chromosome_meiosis_events_adapter.md). The IN/OUT pair is wired; envelopes can be produced as soon as a real producer emits the TSV.

Canonical columns (per [products.jsonl entry](../../atlas-core/toolkit_registries/relatedness/01_registry/products.jsonl)):
```
parent_id, offspring_id, chrom, chrom_len_bp,
n_co, n_dco, n_nco,
co_per_mb, dco_per_mb,
mean_co_position_bp, median_co_position_bp,
karyotype_at_focal_inv  (optional, when karyotype-stratified)
```

Grain: `chromosome × dyad`. Per the registry: 14/29 chromosomes covered today, "rebuilder needed."

### 3.2 Wire `crossovers.js` to the envelope

Mirror the [`nco` page](../specs_done/SPEC_nco_page.md) precisely:

```js
import { resolveLatestLayer } from '../../shared/api_client.js';

export async function mount(root) {
  // 1. Probe envelope (fail-soft)
  let envelope = null, error = null;
  try {
    envelope = await resolveLatestLayer('chromosome_meiosis_events', { stage: 'normalized' });
  } catch (e) { error = (e && e.message) || String(e); }

  // 2. Status badge in result slot
  // 3. Wire Render + Export buttons
}
```

Status badge field set:
- `layer_id` · `n_rows` events · `n_dyads` · `n_chroms` · `sum(n_co)` total CO · `sum(n_dco)` total DCO

## 4. Views

Per the page HTML (`#coClass` / `#coDisplay` / `#coChrom` / `#coRefined` /
Render):

| view (display value)     | renderer                          | what it shows |
|--------------------------|-----------------------------------|---------------|
| `count`                  | `renderPerDyadChrom`              | (dyad × chrom) matrix of raw event counts; class filter applies |
| `rate_per_mb`            | `renderRatePerMb`                 | same matrix, but values are `n_co / chrom_len_bp * 1e6` (or n_dco) |
| `position`               | `renderBreakpointTrack`           | per-chromosome track of refined breakpoint positions (when `coRefined = yes`); falls back to interval midpoints otherwise |
| `karyo_strat`            | `renderKaryotypeRate`             | **intrachromosomal effect view**: CO rate stratified by focal-inversion karyotype (homA / het / homB), to test whether het-inversion suppresses local CO. Requires `inversion_meiosis_effects.v1`. |

Filters:
- `#coClass`: `CO` | `DCO` | `ALL_CO_LIKE` (default — both)
- `#coDisplay`: see view table above
- `#coChrom`: `all` (default) | per-chromosome dropdown populated from envelope
- `#coRefined`: `yes` (default — use STEP_TRC_02 refined breakpoints) | `no`

## 5. Headline number

For the karyotype-stratified rate view:

```
CO_rate(het) / CO_rate(non-het)  per chromosome × focal inversion
```

Values significantly < 1.0 = local CO suppression by the inversion
(the canonical biological signal). Page should colour-tag those cells
in `var(--bad)` once the rate is computed.

This is the page's manuscript-grade output. The corresponding cell on
the [`interchromosomal`](SPEC_interchromosomal_page.md) page tests the
SAME hypothesis but on OTHER chromosomes.

## 6. Promotion criteria

Per [SPEC_meiosis_atlas_pages.md §4](SPEC_meiosis_atlas_pages.md):

- [ ] `mount()` calls `resolveLatestLayer('chromosome_meiosis_events', { stage: 'normalized' })` and is fail-soft
- [ ] At least one view renders real data — recommend starting with the `count` view (simplest)
- [ ] Smoke test in `pages/hub/test_crossovers_envelope.js` following the [`nco` test](../atlases/meiosis/pages/hub/test_nco_envelope.js) pattern
- [ ] Move this SPEC to `specs_done/`, add `Implemented in:` block, update SPECS.md index

## 7. Open work

- **Adapter pair to design** — `chromosome_meiosis_events` is the immediate blocker. See §3.1.
- **Schema for breakpoint refinement** — STEP_TRC_02 emits `traversal_breakpoints.tsv` per ngsTracts; not yet decided whether to register as its own envelope or merge into `tract_classifications_v1` extension.
- **Cross-atlas read** — the karyo_strat view needs to resolve `inversion_karyotypes.v1` from the inversion-atlas. Cross-atlas reads use the same `resolveLatestLayer` API; no special wiring.
- **Per-chromosome length** — `rate_per_mb` needs `chrom_len_bp`. ngsTracts has it in `dyad_event_rates.tsv` summary; the adapter should propagate.
