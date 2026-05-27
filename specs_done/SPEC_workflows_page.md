# SPEC — `workflows` hub page

**Status**: SHIPPED.

**Implemented in:**
- [`atlases/meiosis/pages/hub/workflows.html`](../atlases/meiosis/pages/hub/workflows.html)
- [`atlases/meiosis/pages/hub/workflows.js`](../atlases/meiosis/pages/hub/workflows.js)
- [`atlases/meiosis/css/pages/workflows.css`](../atlases/meiosis/css/pages/workflows.css)
- [`atlases/meiosis/pages/hub/test_workflows.js`](../atlases/meiosis/pages/hub/test_workflows.js) — 61 assertions

**Wired in:**
[`atlases/meiosis/manifest.json`](../atlases/meiosis/manifest.json) +
[`atlases/meiosis/registries/data/pages.registry.json`](../atlases/meiosis/registries/data/pages.registry.json).

---

## 1. What it is

The user-facing companion to
[`SPEC_meiosis_workflow_catalogue.md`](../specs_todo/SPEC_meiosis_workflow_catalogue.md).
Visualises the catalogue forwarding payload (`catalogue_outbound/*.jsonl`)
inside the meiosis-atlas itself, so the same artefact that ships to
atlas-core's Catalogue (page 4) is browsable in this atlas's hub.

Cross-joins the four JSONL files: each row in `analysis_modes.jsonl`
becomes a table row showing its referenced `analysis_id`, backing
`module_name`, produced `layer_id`, `required_dimensions`, and an
inferred **bloc-status badge** (`ready` / `stale` / `contract_only`).

## 2. Behaviour

- `mount()` fetches the four JSONL files in parallel from
  `/atlases/meiosis/registries/catalogue_outbound/` (static repo files
  served by atlas-core's static-file route — no `/api` dependency).
  Fail-soft: on 404 / parse error the badge flips to warn and the result
  slot hints at re-running `generate_catalogue_outbound.py`.
- Computes the three atlas-core hard constraints in-page and surfaces
  the PASS/FAIL state in the badge banner. Violations log to console.
- Two `<select>` filters: by kind (`adapter` / `chain` / `track_builder`
  / `motif_finder`) and by bloc-status (`ready` / `stale` /
  `contract_only`). No scope fan-out (per the registration shape:
  scope is a runtime parameter, not a registry row).
- TSV export of the currently-visible rows.

## 3. Status inference

Per row, from the joined module entry:

| condition                                                        | bloc_status      |
|------------------------------------------------------------------|------------------|
| `biomod_status == 'contract_only'` OR `installed == 'false'`     | `contract_only`  |
| `stale` flag set (e.g. `promotion_from_browser_js`)              | `stale`          |
| otherwise                                                        | `ready`          |

The CSS surfaces each status with a tinted row + chip; `stale` rows
also render the `stale_reason` inline.

## 3a. Row click → details panel + deep-link

Clicking any row (or pressing Enter on a focused row) opens a slide-in
panel on the right that cross-joins the four registries for that
`analysis_id`: analysis_registry entry, analysis_modes entry (with all
policies), module_registry entry (version / biomod_status / parent /
derivatives / n_samples / last_run_*), and layer_registry entry
(entity_type / description / status).

The panel state is reflected in the URL hash as
`#workflows/<analysis_id>` (URL-encoded), so each bloc is a shareable
deep-link. Mount-time hash parsing opens the panel automatically when
the page is loaded with such a link. Esc closes the panel and restores
the base `#workflows` hash.

## 3b. Pages sub-block

Below the main bloc table, a collapsed `<details>` block surfaces the
`pages_registry.jsonl` rows (one per hub page) with `page_id`, `stage`,
`requires_layers`, `missing_layers` (cross-atlas dependencies in red),
and declared `_products`. Empty when atlas-core ships without the
optional `pages_registry.jsonl` (`_fetchJSONLOptional` swallows 404).

## 4. Tests

[`test_workflows.js`](../atlases/meiosis/pages/hub/test_workflows.js)
runs under `node atlases/meiosis/pages/hub/test_workflows.js`. Covers:

- `parseJSONL` (basic / empty / blank-line tolerance)
- `inferBlocStatus` (ready / stale / contract_only / unknown branches)
- `joinPayload` (3-way join, fall-through when an id is missing)
- `validateConstraints` (clean payload + each of the four fail modes)
- `filterRows` (kind / status / combined)
- `renderBadge` + `renderTable` + `renderPagesTable` (markup contracts)
- `toTSV` (header + array encoding)
- `buildDetail` + `renderDetail` (4-section panel, fall-through to empty)
- `parseDeepLink` (prefix match, URL decoding, null branches)
- `mount()` end-to-end with mocked `fetch` (skipped under bare Node when
  no DOM is available, matching the convention used by the other
  meiosis page tests)

61 assertions, 0 failures.

## 5. Why this closes the loop

> "our bricks start to be all automated" — the catalogue_outbound
> generator made the payload a derived artefact, and this page makes
> the artefact visible to the user inside the atlas. Adding a new
> meiosis bloc is now: edit `actions.registry.json` (atomic) or
> `catalogue_outbound_config.json` (chain / track), re-run the
> generator, refresh the workflows page.

The atlas-core-side forwarder (SessionStart hook / Makefile target)
remains the only missing piece for end-to-end automation; that's
deferred to atlas-core per `SPEC_meiosis_workflow_catalogue.md` §5.2.
