# SPEC — meiosis-atlas `nco` page (gene-conversion view)

**Status**: shipped 2026-05-20. First page in the meiosis-atlas to consume a
real envelope. 36-assertion smoke test green; wired into the umbrella as
"meiosis-atlas nco page (envelope-aware)".

**Implemented in:**
- [`atlases/meiosis/pages/hub/nco.html`](../atlases/meiosis/pages/hub/nco.html)
- [`atlases/meiosis/pages/hub/nco.js`](../atlases/meiosis/pages/hub/nco.js)
- [`atlases/meiosis/pages/hub/test_nco_envelope.js`](../atlases/meiosis/pages/hub/test_nco_envelope.js)
- [`atlases/meiosis/css/pages/nco.css`](../atlases/meiosis/css/pages/nco.css)
- [`atlases/meiosis/shared/api_client.js`](../atlases/meiosis/shared/api_client.js) (created for this page; self-contained re-implementation of listLayers / getLayer / resolveLatestLayer, mirrors the relatedness atlas's api_client convention)
- Manifest entry: stylesheet registered in [`atlases/meiosis/manifest.json`](../atlases/meiosis/manifest.json)

Promoted from [`specs_todo/SPEC_meiosis_atlas_pages.md`](../specs_todo/SPEC_meiosis_atlas_pages.md) §2.1.

---

## 1. Goal

Render gene-conversion / non-crossover events from ngsTracts (classes NCO,
MOSAIC_SHORT, MOSAIC_LONG) in 4 views, all backed by the
`tract_classifications_v1` envelope produced by
[normalize_tract_classifications](SPEC_tract_classifications_adapter.md).

The biological headline: **MOSAIC_SHORT × inside_inversion = yes** —
50–200 kb gene-conversion tracts inside inversions that the legacy CO
classifier would have miscalled. This is the meiosis-atlas's primary
inversion-effect signal.

## 2. Behaviour

### 2.1 mount()

1. Probes for the latest envelope:
   ```js
   _envelope = await resolveLatestLayer('tract_classifications', { stage: 'normalized' });
   ```
   Wrapped in try/catch; on error sets `_envelopeError` and continues. Fail-soft per the relatedness convention.
2. Renders a status badge in `#ncoResultSlot` immediately so the user sees the envelope state without clicking Render. Three states:
   - **ok**: `<layer_id> · N tracts · K dyads · L chroms · inside_inv: X · NCO: a · MOSAIC_SHORT: b · MOSAIC_LONG: c` (green border)
   - **empty**: "No tract_classifications_v1 envelope in this workspace yet. Submit import_tract_classifications + normalize_tract_classifications to populate." (italic muted)
   - **warn**: "⚠ envelope fetch failed — &lt;message&gt;" (red border)
3. Wires Render + Export buttons. Clicking Render re-renders the status badge plus the selected view.

### 2.2 Filters

Two `<select>` filters, applied in order:

- **Class filter** (`#ncoClass`): `NCO` | `MOSAIC_SHORT` | `MOSAIC_LONG` | `ALL_NCO_LIKE` (= NCO + MOSAIC_SHORT, excludes MOSAIC_LONG)
- **Region scope** (`#ncoScope`): `all` | `inside_inv` (only `inside_inversion == 'yes'`) | `outside_inv` (only `'no'`)

Implemented as exported pure function `filterTracts(tracts, classValue, scopeValue)` so the smoke test can verify each predicate independently.

### 2.3 Views

| view id        | function           | scope                                                                |
|----------------|--------------------|----------------------------------------------------------------------|
| `per_dyad`     | `renderPerDyad`    | `(parent_id, offspring_id)` × tract count, descending                |
| `length_hist`  | `renderLengthHist` | 10-bucket `span_bp` histogram with horizontal bars                   |
| `per_chrom`    | `renderPerChrom`   | `chrom` × tract count, alphabetical                                  |
| `in_vs_out`    | `renderInVsOut`    | (class × inside_inversion) crosstab with MOSAIC_SHORT × yes highlighted in `var(--accent)` — **the headline view** |

All renderers return HTML strings. All are exported for the smoke test.

### 2.4 Export

The Export button downloads the currently-filtered tracts as a TSV via
`Blob` + `URL.createObjectURL`. Filename: `nco_tracts_<class>_<scope>.tsv`.
Columns are the union of keys across the filtered rows. No server roundtrip.

## 3. Surface

Five named exports for testing:

```js
export function filterTracts(tracts, classValue, scopeValue)
export function renderPerDyad(tracts)
export function renderLengthHist(tracts)
export function renderPerChrom(tracts)
export function renderInVsOut(tracts)
export function renderStatusBadge(envelope, error)
```

Plus the standard page lifecycle:

```js
export async function mount(root, ctx)
export async function unmount(root)
```

## 4. Theme

`atlases/meiosis/css/pages/nco.css` consumes shell tokens directly per
[atlas-core/docs/THEMING.md](../../atlas-core/docs/THEMING.md) §3.1:
`var(--ink)`, `var(--ink-dim)`, `var(--rule)`, `var(--panel-2)`,
`var(--good)`, `var(--bad)`, `var(--accent)`. Registered in the page
manifest entry via `"stylesheet": "atlases/meiosis/css/pages/nco.css"`
so the AtlasRouter loads it on mount.

The MOSAIC_SHORT × yes highlight uses inline style `color:var(--accent)`
on the cell — same hue cycles across dark / light / academic themes.

## 5. Tested paths

The 36-assertion smoke (in [`test_nco_envelope.js`](../atlases/meiosis/pages/hub/test_nco_envelope.js)) covers:

- `filterTracts` — 4 class predicates × 3 scope predicates = 12 combinations spot-checked
- `renderPerDyad` — dyad rendering + count tallies + empty-state
- `renderLengthHist` — meta line, min/max, bar element present
- `renderPerChrom` — per-chrom row presence
- `renderInVsOut` — every class row + headline-hint text + MOSAIC_SHORT × yes highlight class
- `renderStatusBadge` — 3 states (ok / empty / warn) + every field

Untested: `mount()` integration with mocked fetch. The pure-renderer test covers the data path; the fetch wiring is identical to relatedness's already-tested pattern.

## 6. Open work

- **Sister `crossovers` page** still scaffolded. Same shape — would consume a `chromosome_meiosis_events_v1` envelope (adapter pair to build per `SPEC_meiosis_atlas_pages.md` §2.2). Promotion follows the same 4 criteria.
- **Per-class headline ratio** not yet computed. The product (MOSAIC_SHORT_inside / total_inside) is the manuscript-grade number. Add to `renderInVsOut` once real data lands.
- **Multi-envelope selector** — today, `resolveLatestLayer` returns the most-recent envelope of its type. When multiple cohorts coexist (e.g. 226-sample + a future macrocephalus run), the page needs a dropdown to pick. Out of scope for round 1.
