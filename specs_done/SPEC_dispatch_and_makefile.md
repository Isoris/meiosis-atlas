# SPEC — server-action dispatch + Makefile orchestration

**Status**: SHIPPED.

**Implemented in:**
- [`Makefile`](../Makefile) — one-shot catalogue regen + smoke + tarball + atlas-core push.
- [`atlases/meiosis/shared/api_client.js`](../atlases/meiosis/shared/api_client.js) — new `runAction(type, target, params)` + `dispatchMeiosisChain(chainName, target, params, opts)` helpers.
- [`atlases/meiosis/shared/test_api_client_dispatch.js`](../atlases/meiosis/shared/test_api_client_dispatch.js) — 22-assertion smoke.
- [`atlases/meiosis/pages/hub/nco.{html,js}`](../atlases/meiosis/pages/hub/) + [`css/pages/nco.css`](../atlases/meiosis/css/pages/nco.css) — opt-in "Run on server" checkbox on the NCO page, wires the `in_vs_out` view to the promoted chain action and renders the typed result envelope.
- Extended [`atlases/meiosis/pages/hub/test_nco_envelope.js`](../atlases/meiosis/pages/hub/test_nco_envelope.js) — `renderServerResult` smoke (+7 assertions, total now 43).

---

## 1. Makefile

Eight targets, all idempotent:

| target | what |
|---|---|
| `make help` | this list |
| `make catalogue` | regenerate `catalogue_outbound/` (JSONL + tarball) |
| `make smoke` | run every smoke suite (Python + Node) |
| `make smoke-py` / `make smoke-js` | by language |
| `make tarball` | re-bundle without regenerating |
| `make ship` | regenerate + smoke (canonical "I changed something" path) |
| `make catalogue-push` | copy tarball into a sibling atlas-core checkout (override with `ATLAS_CORE_REPO=path/...`) |
| `make clean` | remove generated artefacts |

`catalogue-push` refuses to write when the target directory is missing
(no partial copies), and uses `tar --strip-components=1` so the five
JSONL files + README land directly in
`atlas-core/toolkit_registries/meiosis/01_registry/`.

The atlas-core repo still has to commit the change locally; this side
just delivers the bytes.

## 2. `runAction()` dispatch helper

```js
import { runAction, dispatchMeiosisChain, ApiError } from '../shared/api_client.js';

// Direct dispatch
const env = await runAction(
  'compute_nco_inside_vs_outside_inversion',
  { source_layer_id: 'tracts_2026' },
  { target_class: 'MOSAIC_SHORT' },
);

// Convenience wrapper resolves chain name → action type, returns a
// shape that's safe to branch on without a try/catch in the caller.
const out = await dispatchMeiosisChain('nco', { source_layer_id: 'tracts_2026' });
if (out.ok) renderResult(out.body);
else        renderFallback(out.error);
```

Chain-name → action-type table baked in:

| chainName | action type |
|---|---|
| `nco` | `compute_nco_inside_vs_outside_inversion` |
| `intrachromosomal` | `compute_intrachromosomal_co_karyotype_effect` |
| `interchromosomal` | `compute_interchromosomal_inversion_effect` |

`mode: 'auto'` (default) swallows fetch/HTTP failures into
`{ ok: false, error }` so pages can render a soft fallback. `mode:
'strict'` re-throws — for callers that require server compute.

`ApiError` (already in this module) preserves status + body so the
dispatch helper integrates with the existing error path used by
`listLayers` / `getLayer`.

## 3. NCO page — opt-in server compute

The `in_vs_out` view (the chain bloc) now has a "Run on server" checkbox.
When toggled on and the user clicks Render:

1. Dispatch `dispatchMeiosisChain('nco', { source_layer_id: <envelope.layer_id> }, { target_class })`.
2. Render the typed `nco_enrichment_result_v1` payload via the new
   `renderServerResult` function — surfaces all four headline stats
   (odds ratio, log-odds, two-sided p, one-sided-greater p) + summary
   counts.
3. On dispatch failure, **transparently fall back** to the existing
   browser-side `renderInVsOut` and show a warn-coloured badge so the
   user knows the server path was tried.

For other views (per_dyad, length_hist, per_chrom) the checkbox is a
no-op — the chain bloc only covers the in_vs_out crosstab. Other chain
modules (intrachromosomal, interchromosomal HEADLINE) get their own
opt-in wiring in follow-up SPECs; the helper + pattern are ready.

## 4. Why this closes the loop end-to-end

Before this SPEC, the chain modules were promoted (POST-able) but no
in-atlas UI exercised them — the catalogue brain could dispatch, but
the page itself didn't. After this SPEC, the meiosis-atlas's own NCO
page can hit the same endpoint atlas-core's bloc-detail page would,
which means the page IS the catalogue brain's frontend for that bloc.
The other chains get the same treatment incrementally.

## 5. Tests

| suite | assertions |
|---|---|
| `test_api_client_dispatch.js` | 22 (envelope shape + HTTP method + ApiError preservation + chain-name resolution + auto-mode swallow + strict-mode rethrow + unknown-chain throw) |
| `test_nco_envelope.js` (extended) | 43 total (+7: `renderServerResult` happy path + degenerate + missing-block) |

Every other suite still green: `make smoke` → 11/11 OK,
~500 assertions total.
