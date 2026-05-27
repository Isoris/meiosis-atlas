# SPEC — `workflows` hub page

**Status**: SHIPPED.

**Implemented in:**
- [`atlases/meiosis/pages/hub/workflows.html`](../atlases/meiosis/pages/hub/workflows.html)
- [`atlases/meiosis/pages/hub/workflows.js`](../atlases/meiosis/pages/hub/workflows.js)
- [`atlases/meiosis/css/pages/workflows.css`](../atlases/meiosis/css/pages/workflows.css)
- [`atlases/meiosis/pages/hub/test_workflows.js`](../atlases/meiosis/pages/hub/test_workflows.js) — 36 assertions

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

## 4. Tests

[`test_workflows.js`](../atlases/meiosis/pages/hub/test_workflows.js)
runs under `node atlases/meiosis/pages/hub/test_workflows.js`. Covers:

- `parseJSONL` (basic / empty / blank-line tolerance)
- `inferBlocStatus` (ready / stale / contract_only / unknown branches)
- `joinPayload` (3-way join, fall-through when an id is missing)
- `validateConstraints` (clean payload + each of the four fail modes)
- `filterRows` (kind / status / combined)
- `renderBadge` + `renderTable` (markup contracts)
- `toTSV` (header + array encoding)
- `mount()` end-to-end with mocked `fetch` (skipped under bare Node when
  no DOM is available, matching the convention used by the other
  meiosis page tests)

36 assertions, 0 failures.

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
