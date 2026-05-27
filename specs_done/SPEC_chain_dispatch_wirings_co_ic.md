# SPEC — crossovers + interchromosomal page server-compute wirings

**Status**: SHIPPED. Completes the per-chain UI opt-in for all three
promoted chain modules. (NCO landed in
[`SPEC_dispatch_and_makefile.md`](SPEC_dispatch_and_makefile.md).)

**Implemented in:**
- [`atlases/meiosis/pages/hub/crossovers.{html,js}`](../atlases/meiosis/pages/hub/) + [`css/pages/crossovers.css`](../atlases/meiosis/css/pages/crossovers.css) — new `renderServerKaryoStrat` + opt-in "Run on server (karyo_strat only)" checkbox.
- [`atlases/meiosis/pages/hub/interchromosomal.{html,js}`](../atlases/meiosis/pages/hub/) + [`css/pages/interchromosomal.css`](../atlases/meiosis/css/pages/interchromosomal.css) — opt-in "Run on server" checkbox on the HEADLINE page. Existing `renderResultTable` is reused (server payload matches the browser-side shape exactly, by design).
- Extended [`atlases/meiosis/pages/hub/test_crossovers_envelope.js`](../atlases/meiosis/pages/hub/test_crossovers_envelope.js) — +8 assertions covering `renderServerKaryoStrat` (flagged/unflagged/excluded rows + summary + degenerate inputs). Suite total 49 (was 41).

---

## 1. Crossovers page (`intrachromosomal` chain)

- Checkbox gated on the `karyo_strat` view (the chain bloc). Other views
  unchanged.
- Dispatches `compute_intrachromosomal_co_karyotype_effect` with
  `target.source_layer_id = <chromosome_meiosis_events_v1 layer_id>` and
  `params.flag_threshold = 0.7`.
- `renderServerKaryoStrat` renders the typed
  `intrachromosomal_co_effect_v1` payload: per-chrom Welch t + df +
  two-sided p + rate ratio (red when `flag_below_threshold`) +
  excluded-reason note for low-power chroms.
- On dispatch failure: transparent fall-through to the browser
  `renderKaryotypeRate`, warn badge surfaces the error.

## 2. Interchromosomal page (HEADLINE chain)

- Checkbox always available (the whole page IS the chain bloc).
- Dispatches `compute_interchromosomal_inversion_effect` with named
  target keys (`events_layer_id` / `controls_layer_id` /
  `design_layer_id`) read from the page's existing envelope state.
  `params` carry the focal inversion id, class scope, n_permutations,
  and BH α from the existing controls — no UI duplication.
- **Demo mode is automatically skipped** (the synthetic demo envelopes
  have no server-registered layer_ids).
- Server response shape `{rows, summary}` matches the browser
  `runInterchromosomalTests` output exactly, so the existing
  `renderResultTable` handles the result without changes. The server
  result is also stored in `_lastResult`, so TSV export Just Works.
- On dispatch failure: transparent fall-through to the browser
  permutation engine, warn badge surfaces the error.

## 3. Why this matters

Three chain modules promoted out of browser JS, three pages now hit
the same `POST /api/actions` endpoint atlas-core's master Catalogue
would call. The meiosis-atlas's hub pages are now the catalogue
brain's frontend for their respective blocs — same numbers, same
seed, same result schema.

No browser-side stats code was deleted: the inline compute is the
graceful fallback when the server is unreachable. The migration is
additive and reversible.

## 4. Tests

`make smoke` runs 11 suites green:

| suite | assertions |
|---|---|
| `test_adapter_smoke.py` | OK |
| `test_catalogue_outbound.py` | OK (12/11/11/11/6) |
| `test_nco_enrichment.py` | 37 |
| `test_intrachromosomal_co.py` | 44 |
| `test_interchromosomal_effect.py` | 55 |
| `test_crossovers_envelope.js` | **49 (was 41; +8 server-render)** |
| `test_crossovers_per_candidate_render.js` | 45 |
| `test_interchromosomal_envelope.js` | 44 |
| `test_nco_envelope.js` | 43 (server-render added in prior SPEC) |
| `test_nco_per_candidate_render.js` | 22 |
| `test_workflows.js` | 61 |
| `test_api_client_dispatch.js` | 22 |
