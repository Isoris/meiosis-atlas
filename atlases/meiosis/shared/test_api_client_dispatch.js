// Smoke test for the new POST /api/actions dispatch helpers in
// shared/api_client.js. Mocks globalThis.fetch and asserts:
//   - runAction posts the correct envelope shape to /api/actions
//   - runAction throws ApiError (status + body preserved) on non-2xx
//   - dispatchMeiosisChain resolves the chain name to the right type
//   - dispatchMeiosisChain 'auto' returns {ok:false, error} on failure
//   - dispatchMeiosisChain 'strict' re-throws on failure
//   - unknown chain name throws synchronously
//
// Run from the meiosis-atlas root:
//   node atlases/meiosis/shared/test_api_client_dispatch.js

import {
  runAction,
  dispatchMeiosisChain,
  ApiError,
} from './api_client.js';

let _passed = 0, _failed = 0;
function ok(cond, msg) {
  if (cond) { _passed++; console.log(`  ok: ${msg}`); }
  else      { _failed++; console.error(`  FAIL: ${msg}`); }
}

function captureFetch(handler) {
  const orig = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return handler(url, init);
  };
  return { calls, restore: () => { globalThis.fetch = orig; } };
}

// -------------------------------------------------------------------
console.log('runAction — happy path');
{
  const f = captureFetch(async () => ({
    ok: true, status: 200,
    json: async () => ({ layer_id: 'result_42', schema_version: 'nco_enrichment_result_v1' }),
    text: async () => '',
  }));
  const out = await runAction(
    'compute_nco_inside_vs_outside_inversion',
    { source_layer_id: 'tracts_test' },
    { target_class: 'MOSAIC_SHORT' },
  );
  ok(f.calls.length === 1, 'one fetch call made');
  ok(f.calls[0].url.endsWith('/api/actions'), 'posts to /api/actions');
  ok(f.calls[0].init.method === 'POST', 'uses POST method');
  ok(f.calls[0].init.headers['Content-Type'] === 'application/json',
     'sets Content-Type: application/json');
  const body = JSON.parse(f.calls[0].init.body);
  ok(body.type === 'compute_nco_inside_vs_outside_inversion',
     'envelope.type echoed');
  ok(body.target.source_layer_id === 'tracts_test', 'envelope.target echoed');
  ok(body.params.target_class === 'MOSAIC_SHORT',   'envelope.params echoed');
  ok(out.layer_id === 'result_42', 'response body returned to caller');
  f.restore();
}

// -------------------------------------------------------------------
console.log('runAction — error path');
{
  const f = captureFetch(async () => ({
    ok: false, status: 422,
    json: async () => ({}),
    text: async () => 'schema validation failed',
  }));
  let caught = null;
  try {
    await runAction('compute_nco_inside_vs_outside_inversion', { source_layer_id: 'x' });
  } catch (e) {
    caught = e;
  }
  ok(caught instanceof ApiError, '422 raises ApiError');
  ok(caught && caught.status === 422,                  'ApiError.status preserved');
  ok(caught && /schema validation failed/.test(caught.message),
     'ApiError.message includes server body');
  f.restore();
}

// -------------------------------------------------------------------
console.log('runAction — input validation');
{
  let caught;
  try { await runAction('', { source_layer_id: 'x' }); } catch (e) { caught = e; }
  ok(caught && /type required/.test(caught.message), 'empty type rejected');

  caught = null;
  try { await runAction('compute_x', null); } catch (e) { caught = e; }
  ok(caught && /target object required/.test(caught.message), 'null target rejected');
}

// -------------------------------------------------------------------
console.log('dispatchMeiosisChain — chain name resolution + auto mode');
{
  const f = captureFetch(async () => ({
    ok: true, status: 200,
    json: async () => ({ layer_id: 'r' }),
    text: async () => '',
  }));
  const ncoOut = await dispatchMeiosisChain('nco',
    { source_layer_id: 'tracts' }, { target_class: 'MOSAIC_SHORT' });
  ok(ncoOut.ok === true, "nco chain ok");
  ok(ncoOut.type === 'compute_nco_inside_vs_outside_inversion',
     "nco resolves to compute_nco_inside_vs_outside_inversion");

  const intraOut = await dispatchMeiosisChain('intrachromosomal',
    { source_layer_id: 'events' }, { flag_threshold: 0.7 });
  ok(intraOut.type === 'compute_intrachromosomal_co_karyotype_effect',
     "intrachromosomal resolves correctly");

  const interOut = await dispatchMeiosisChain('interchromosomal',
    { events_layer_id: 'events', design_layer_id: 'design' },
    { focal_inversion_id: 'INV1' });
  ok(interOut.type === 'compute_interchromosomal_inversion_effect',
     "interchromosomal resolves correctly");

  const pcOut = await dispatchMeiosisChain('nco_per_candidate',
    { tracts_layer_id: 'tracts', candidates_layer_id: 'cands' },
    { target_class: 'MOSAIC_SHORT' });
  ok(pcOut.type === 'compute_nco_per_candidate_enrichment',
     "nco_per_candidate resolves to compute_nco_per_candidate_enrichment");

  f.restore();
}

// -------------------------------------------------------------------
console.log('dispatchMeiosisChain — auto mode swallows errors');
{
  const f = captureFetch(async () => {
    throw new TypeError('NetworkError: no server');
  });
  const out = await dispatchMeiosisChain('nco', { source_layer_id: 'x' });
  ok(out.ok === false, 'auto mode → ok:false on failure');
  ok(/NetworkError/.test(out.error), 'auto mode preserves error message');
  ok(out.type === 'compute_nco_inside_vs_outside_inversion',
     'auto mode echoes resolved type');
  f.restore();
}

// -------------------------------------------------------------------
console.log('dispatchMeiosisChain — strict mode re-throws');
{
  const f = captureFetch(async () => {
    throw new TypeError('NetworkError: no server');
  });
  let caught;
  try {
    await dispatchMeiosisChain('nco', { source_layer_id: 'x' }, {}, { mode: 'strict' });
  } catch (e) { caught = e; }
  ok(caught instanceof TypeError, 'strict mode re-throws original error');
  f.restore();
}

// -------------------------------------------------------------------
console.log('dispatchMeiosisChain — unknown chain name');
{
  let caught;
  try {
    await dispatchMeiosisChain('bogus', { source_layer_id: 'x' });
  } catch (e) { caught = e; }
  ok(caught && /unknown chain/.test(caught.message),
     'unknown chain name throws synchronously');
}

// -------------------------------------------------------------------
console.log(`\n${_passed} passed, ${_failed} failed`);
process.exit(_failed === 0 ? 0 : 1);
