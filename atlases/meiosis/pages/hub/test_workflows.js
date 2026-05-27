// Smoke tests for the Workflows page.
//
// Exercises:
//   - JSONL parser (multiline + blank-line tolerance)
//   - inferBlocStatus (ready / stale / contract_only branches)
//   - joinPayload (analysis_modes × analysis_registry × module_registry × layer_registry)
//   - validateConstraints (atlas-core's 3 hard constraints; pass + each fail mode)
//   - filterRows (kind + status)
//   - renderBadge + renderTable (HTML markers)
//   - toTSV (header + tab encoding)
//   - mount() end-to-end against mocked fetch returning a synthetic payload
//
// Run from the meiosis-atlas root:
//   node atlases/meiosis/pages/hub/test_workflows.js

import {
  parseJSONL,
  inferBlocStatus,
  joinPayload,
  validateConstraints,
  filterRows,
  renderBadge,
  renderTable,
  renderPagesTable,
  toTSV,
  fetchPayload,
  mount,
  unmount,
  buildDetail,
  renderDetail,
  parseDeepLink,
} from './workflows.js';

let _failed = 0, _passed = 0;
function eq(a, b, msg) {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    console.error(`FAIL: ${msg}\n  expected: ${JSON.stringify(b)}\n  got:      ${JSON.stringify(a)}`);
    _failed++; return;
  }
  _passed++; console.log(`  ok: ${msg}`);
}
function contains(s, marker, msg) {
  if (typeof s !== 'string' || !s.includes(marker)) {
    console.error(`FAIL: ${msg}\n  marker not found: ${marker}\n  in: ${String(s).slice(0, 200)}`);
    _failed++; return;
  }
  _passed++; console.log(`  ok: ${msg}`);
}
function truthy(v, msg) {
  if (!v) { console.error(`FAIL: ${msg}`); _failed++; return; }
  _passed++; console.log(`  ok: ${msg}`);
}

// ---------------------------------------------------------------------------
// Synthetic catalogue payload — one of each bloc kind / status.
// ---------------------------------------------------------------------------
const MODULES = [
  { module_name: 'mod_ready',    biomod_status: 'experimental',  installed: 'true',  ready: 'true',  stale: '',                          stale_reason: '',         derivatives: 'lay_a_v1' },
  { module_name: 'mod_stale',    biomod_status: 'experimental',  installed: 'true',  ready: 'true',  stale: 'promotion_from_browser_js', stale_reason: 'inlined',  derivatives: 'lay_chain' },
  { module_name: 'mod_contract', biomod_status: 'contract_only', installed: 'false', ready: 'false', stale: 'missing_builder',           stale_reason: 'no producer', derivatives: 'lay_track' },
];
const ANALYSES = [
  { analysis_id: 'ana_a',     label: 'A',     kind: 'adapter',       produces: ['lay_a_v1']  },
  { analysis_id: 'ana_chain', label: 'CHAIN', kind: 'chain',         produces: ['lay_chain'] },
  { analysis_id: 'ana_track', label: 'TRACK', kind: 'track_builder', produces: ['lay_track'] },
];
const MODES = [
  { analysis_type: 'ana_a',     mode: 'default', label: 'A',     module_name: 'mod_ready',    produces: 'lay_a_v1',  required_dimensions: ['dim_a'] },
  { analysis_type: 'ana_chain', mode: 'default', label: 'CHAIN', module_name: 'mod_stale',    produces: 'lay_chain', required_dimensions: ['dim_b', 'dim_c'] },
  { analysis_type: 'ana_track', mode: 'default', label: 'TRACK', module_name: 'mod_contract', produces: 'lay_track', required_dimensions: ['candidate_id'] },
];
const LAYERS = [
  { layer_id: 'lay_a_v1',  label: 'layer A',     entity_type: 'eA' },
  { layer_id: 'lay_chain', label: 'layer chain', entity_type: 'eC' },
  { layer_id: 'lay_track', label: 'layer track', entity_type: 'eT' },
];
const PAGES = [
  { page_id: 'pg_a', stage: 'hub', label: 'A',     requires_layers: ['lay_a_v1'],  missing_layers: [], products: ['prod_a'] },
  { page_id: 'pg_b', stage: 'hub', label: 'B',     requires_layers: ['cross_atlas_layer'], missing_layers: ['cross_atlas_layer'], products: [] },
];

// ---------------------------------------------------------------------------
// parseJSONL
// ---------------------------------------------------------------------------
console.log('parseJSONL');
eq(parseJSONL('{"a":1}\n{"a":2}\n'), [{a:1},{a:2}], 'basic two rows');
eq(parseJSONL(''), [], 'empty string → empty array');
eq(parseJSONL('\n{"a":1}\n\n{"a":2}\n\n'), [{a:1},{a:2}], 'blank lines tolerated');

// ---------------------------------------------------------------------------
// inferBlocStatus
// ---------------------------------------------------------------------------
console.log('inferBlocStatus');
eq(inferBlocStatus(MODULES[0]), 'ready', 'installed + not stale → ready');
eq(inferBlocStatus(MODULES[1]), 'stale', 'installed but stale flag set → stale');
eq(inferBlocStatus(MODULES[2]), 'contract_only', 'biomod_status=contract_only → contract_only');
eq(inferBlocStatus(null),       'unknown', 'null module → unknown');
eq(inferBlocStatus({ biomod_status: 'experimental', installed: 'false', stale: '' }), 'contract_only', 'installed=false flips to contract_only');

// ---------------------------------------------------------------------------
// joinPayload
// ---------------------------------------------------------------------------
console.log('joinPayload');
const joined = joinPayload({ modules: MODULES, analyses: ANALYSES, modes: MODES, layers: LAYERS });
eq(joined.length, 3, '3 mode rows → 3 joined rows');
eq(joined[0].kind, 'adapter', 'kind pulled from analysis_registry');
eq(joined[1].bloc_status, 'stale', 'CHAIN row gets stale status from module');
eq(joined[2].bloc_status, 'contract_only', 'track row is contract-only');
eq(joined[0].layer_label, 'layer A', 'layer_label joined from layer_registry');
eq(joined[1].required_dimensions, ['dim_b', 'dim_c'], 'required_dimensions preserved');

// ---------------------------------------------------------------------------
// validateConstraints — pass + each fail mode
// ---------------------------------------------------------------------------
console.log('validateConstraints');
eq(validateConstraints({ modules: MODULES, analyses: ANALYSES, modes: MODES, layers: LAYERS }),
   [], 'clean payload → no errors');

const errs_missing_analysis = validateConstraints({
  modules: MODULES, analyses: ANALYSES, layers: LAYERS,
  modes: [...MODES, { analysis_type: 'ghost', module_name: 'mod_ready', produces: 'lay_a_v1' }],
});
truthy(errs_missing_analysis.some(e => e.includes('ghost')), 'missing analysis_id surfaces');

const errs_missing_module = validateConstraints({
  modules: MODULES, analyses: ANALYSES, layers: LAYERS,
  modes: [...MODES, { analysis_type: 'ana_a', module_name: 'phantom', produces: 'lay_a_v1' }],
});
truthy(errs_missing_module.some(e => e.includes('phantom')), 'missing module_name surfaces');

const errs_list_produces = validateConstraints({
  modules: MODULES, analyses: ANALYSES, layers: LAYERS,
  modes: [{ analysis_type: 'ana_a', module_name: 'mod_ready', produces: ['lay_a_v1'] }],
});
truthy(errs_list_produces.some(e => e.includes('single-valued')), 'list-valued produces surfaces');

const errs_wrong_layer = validateConstraints({
  modules: MODULES, analyses: ANALYSES, layers: LAYERS,
  modes: [{ analysis_type: 'ana_a', module_name: 'mod_ready', produces: 'wrong_layer' }],
});
truthy(errs_wrong_layer.some(e => e.includes('wrong_layer')), 'produces ∉ analysis.produces surfaces');

// ---------------------------------------------------------------------------
// filterRows
// ---------------------------------------------------------------------------
console.log('filterRows');
eq(filterRows(joined, { kind: 'chain', status: 'all' }).length, 1, 'kind=chain → 1 row');
eq(filterRows(joined, { kind: 'all',   status: 'ready' }).length, 1, 'status=ready → 1 row');
eq(filterRows(joined, { kind: 'all',   status: 'all' }).length, 3, 'no filter → 3 rows');
eq(filterRows(joined, { kind: 'chain', status: 'ready' }).length, 0, 'chain + ready → 0 (chain is stale)');

// ---------------------------------------------------------------------------
// renderBadge + renderTable
// ---------------------------------------------------------------------------
console.log('renderBadge + renderTable');
const badgeOK = renderBadge({ modules: MODULES, analyses: ANALYSES, modes: MODES, layers: LAYERS, pages: PAGES }, []);
contains(badgeOK, 'wf-badge-ok',  'PASS badge has wf-badge-ok class');
contains(badgeOK, '1 atomic',     'badge advertises atomic count');
contains(badgeOK, '1 chain',      'badge advertises chain count');
contains(badgeOK, '2 pages',      'badge advertises page count');

const badgeWarn = renderBadge({ modules: MODULES, analyses: ANALYSES, modes: MODES, layers: LAYERS },
                              ['some error']);
contains(badgeWarn, 'wf-badge-warn', 'failing constraints flip badge to warn');

const tbl = renderTable(joined);
contains(tbl, '<table class="wf-tbl">', 'table tag present');
contains(tbl, 'ana_chain',              'CHAIN row rendered');
contains(tbl, 'wf-status-stale',        'stale row gets status class');
contains(tbl, 'wf-status-contract_only','contract-only row gets status class');
contains(tbl, 'wf-kind-chain',          'CHAIN row gets kind chip class');

eq(renderTable([]), '<div class="wf-empty">No blocs match this filter.</div>', 'empty table → empty-state div');

// renderPagesTable
const pgHtml = renderPagesTable(PAGES);
contains(pgHtml, 'wf-pages-block',     'pages block wraps in <details>');
contains(pgHtml, 'pg_a',               'page row rendered');
contains(pgHtml, 'cross_atlas_layer',  'missing-layer note rendered for cross-atlas page');
contains(pgHtml, 'wf-miss',            'missing-layer warning class applied');
eq(renderPagesTable([]),     '', 'empty pages → empty string (block hidden)');
eq(renderPagesTable(null),   '', 'null pages → empty string');

// ---------------------------------------------------------------------------
// toTSV
// ---------------------------------------------------------------------------
console.log('toTSV');
const tsv = toTSV(joined);
contains(tsv, 'kind\tanalysis_id\tlabel\tmodule_name', 'TSV header present');
contains(tsv, 'ana_chain\tCHAIN\tmod_stale',            'CHAIN TSV row present');
contains(tsv, 'dim_b|dim_c',                            'required_dimensions joined with |');

// ---------------------------------------------------------------------------
// buildDetail + renderDetail + parseDeepLink
// ---------------------------------------------------------------------------
console.log('buildDetail + renderDetail + parseDeepLink');
const PAYLOAD = { modules: MODULES, analyses: ANALYSES, modes: MODES, layers: LAYERS };

const d = buildDetail(PAYLOAD, 'ana_chain');
truthy(d, 'buildDetail returns an object for a known id');
eq(d.ana.kind, 'chain', 'detail joins analysis row');
eq(d.mod.module_name, 'mod_stale', 'detail joins module row');
eq(d.layer.layer_id, 'lay_chain', 'detail joins layer row');

eq(buildDetail(PAYLOAD, 'ghost'), null, 'unknown id → null');
eq(buildDetail(null, 'ana_a'), null, 'null payload → null');

const html = renderDetail(d);
contains(html, '<h4>analysis_registry</h4>',           'detail has analysis section');
contains(html, '<h4>analysis_modes',                   'detail has modes section');
contains(html, '<h4>module_registry</h4>',             'detail has module section');
contains(html, '<h4>layer_registry',                   'detail has layer section');
contains(html, 'inlined',                              'stale_reason rendered');
contains(html, 'lay_chain',                            'produces layer rendered');

eq(renderDetail(null), '<div class="wf-empty">No bloc with that analysis_id.</div>', 'null detail → empty state');

eq(parseDeepLink('#workflows/ana_chain'), 'ana_chain', 'deep-link parsed');
eq(parseDeepLink('#workflows/foo%20bar'), 'foo bar',   'deep-link URL-decoded');
eq(parseDeepLink('#workflows'),           null,        'no trailing id → null');
eq(parseDeepLink('#other/x'),             null,        'wrong prefix → null');
eq(parseDeepLink(''),                     null,        'empty hash → null');

// ---------------------------------------------------------------------------
// mount() end-to-end with mocked fetch
// ---------------------------------------------------------------------------
console.log('mount() end-to-end');

function mockFetch(jsonlByName) {
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const name = String(url).split('/').pop();
    const body = jsonlByName[name];
    if (body == null) return { ok: false, status: 404, text: async () => 'not found' };
    return { ok: true, status: 200, text: async () => body };
  };
  return () => { globalThis.fetch = origFetch; };
}

function makeRoot() {
  // Minimal stand-in for the page fragment. The real fragment is injected
  // by the atlas-core router; the test provides a matching shape.
  if (typeof document === 'undefined') {
    // Node 18+ ships `globalThis.document` only with --experimental-vm-modules;
    // bail gracefully when it's missing — the pure functions above carry the
    // bulk of the assertion budget.
    return null;
  }
  const root = document.createElement('div');
  root.id = 'workflows';
  root.innerHTML = `
    <select id="wfKind"><option value="all"></option></select>
    <select id="wfStatus"><option value="all"></option></select>
    <button id="wfRunBtn"></button>
    <button id="wfExportBtn"></button>
    <div id="wfBadgeSlot"></div>
    <div id="wfResultSlot"></div>`;
  return root;
}

const root = makeRoot();
if (!root) {
  console.log('  skip: no document — mount() end-to-end skipped under bare Node');
} else {
  const restore = mockFetch({
    'module_registry.jsonl':   MODULES.map(r => JSON.stringify(r)).join('\n'),
    'analysis_registry.jsonl': ANALYSES.map(r => JSON.stringify(r)).join('\n'),
    'analysis_modes.jsonl':    MODES.map(r => JSON.stringify(r)).join('\n'),
    'layer_registry.jsonl':    LAYERS.map(r => JSON.stringify(r)).join('\n'),
  });
  await mount(root);
  contains(root.querySelector('#wfBadgeSlot').innerHTML, 'wf-badge-ok', 'mount() renders pass badge');
  contains(root.querySelector('#wfResultSlot').innerHTML, 'ana_chain',  'mount() renders CHAIN row');
  unmount();
  restore();

  // Fetch-failure path
  const restore2 = mockFetch({});  // no files → 404
  const root2 = makeRoot();
  await mount(root2);
  contains(root2.querySelector('#wfBadgeSlot').innerHTML,  'wf-badge-warn', 'mount() shows payload-error badge on fetch failure');
  contains(root2.querySelector('#wfResultSlot').innerHTML, 'generate_catalogue_outbound', 'fetch-failure result slot hints at regeneration');
  unmount();
  restore2();
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(`\n${_passed} passed, ${_failed} failed`);
process.exit(_failed === 0 ? 0 : 1);
