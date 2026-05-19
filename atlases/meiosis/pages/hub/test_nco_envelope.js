// Smoke tests for the NCO page's envelope-aware renderers.
//
// Exercises mount()'s envelope-probe path with mocked fetch and tests the
// pure renderers + filters directly against a 4-tract synthetic fixture.
// Matches the convention in
// atlases/relatedness/pages/hub/test_network_data_source.js.
//
// Run from the meiosis-atlas root:
//   node atlases/meiosis/pages/hub/test_nco_envelope.js

import {
  filterTracts,
  renderPerDyad,
  renderLengthHist,
  renderPerChrom,
  renderInVsOut,
  renderStatusBadge,
} from './nco.js';

let _failed = 0;
let _passed = 0;

function eq(a, b, msg) {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    console.error(`FAIL: ${msg}\n  expected: ${JSON.stringify(b)}\n  got:      ${JSON.stringify(a)}`);
    _failed++; return;
  }
  _passed++; console.log(`  ok: ${msg}`);
}
function contains(html, marker, msg) {
  if (typeof html !== 'string' || !html.includes(marker)) {
    console.error(`FAIL: ${msg}\n  marker not found: ${marker}\n  got: ${html}`);
    _failed++; return;
  }
  _passed++; console.log(`  ok: ${msg}`);
}
function lacks(html, marker, msg) {
  if (typeof html === 'string' && html.includes(marker)) {
    console.error(`FAIL: ${msg}\n  unexpected marker: ${marker}\n  got: ${html}`);
    _failed++; return;
  }
  _passed++; console.log(`  ok: ${msg}`);
}

// ----- fixture: 4 tracts spanning every code path -----------------------
// Same logical fixture as the adapter smoke test, but in the v1-typed shape
// (post-normalize) — what the nco page would see via resolveLatestLayer().
const TRACTS = [
  // NCO, outside inversion
  { interval_id: 'DEP_000001', parent_id: 'A', offspring_id: 'B', chrom: 'LG01',
    span_bp: 5000, class: 'NCO', inside_inversion: 'no' },
  // MOSAIC_SHORT, INSIDE inversion (the headline signal)
  { interval_id: 'DEP_000002', parent_id: 'A', offspring_id: 'B', chrom: 'LG28',
    span_bp: 120000, class: 'MOSAIC_SHORT', inside_inversion: 'yes' },
  // MOSAIC_SHORT, outside inversion (rare but allowed)
  { interval_id: 'DEP_000003', parent_id: 'C', offspring_id: 'D', chrom: 'LG28',
    span_bp: 80000, class: 'MOSAIC_SHORT', inside_inversion: 'no' },
  // MOSAIC_LONG, outside inversion
  { interval_id: 'DEP_000004', parent_id: 'A', offspring_id: 'B', chrom: 'LG02',
    span_bp: 2500000, class: 'MOSAIC_LONG', inside_inversion: 'no' },
];

// ====== filterTracts ===================================================

console.log('filterTracts:');
{
  eq(filterTracts(TRACTS, 'NCO',          'all').length, 1, 'class=NCO only');
  eq(filterTracts(TRACTS, 'MOSAIC_SHORT', 'all').length, 2, 'class=MOSAIC_SHORT only');
  eq(filterTracts(TRACTS, 'MOSAIC_LONG',  'all').length, 1, 'class=MOSAIC_LONG only');
  eq(filterTracts(TRACTS, 'ALL_NCO_LIKE', 'all').length, 3, 'ALL_NCO_LIKE = NCO + MOSAIC_SHORT (excludes MOSAIC_LONG)');
}
{
  eq(filterTracts(TRACTS, 'ALL_NCO_LIKE', 'inside_inv').length,  1, 'inside_inv scope only');
  eq(filterTracts(TRACTS, 'ALL_NCO_LIKE', 'outside_inv').length, 2, 'outside_inv scope (NCO + MOSAIC_SHORT outside)');
}

// ====== renderPerDyad ==================================================

console.log('\nrenderPerDyad:');
{
  const html = renderPerDyad(TRACTS);
  contains(html, 'A → B', 'dyad A→B rendered');
  contains(html, 'C → D', 'dyad C→D rendered');
  contains(html, '<thead>', 'table has header');
  // A has 3 tracts (rows 1, 2, 4); C has 1 (row 3).
  contains(html, '>3<', 'A→B count = 3');
  contains(html, '>1<', 'C→D count = 1');
}
{
  const html = renderPerDyad([]);
  contains(html, 'No tracts match', 'empty input → empty message');
  lacks(html,    '<table',          'empty input → no table');
}

// ====== renderLengthHist ===============================================

console.log('\nrenderLengthHist:');
{
  const html = renderLengthHist(TRACTS);
  contains(html, '4 tracts',  'meta line shows 4 tracts');
  contains(html, '5000',      'min span_bp shown');
  contains(html, '2500000',   'max span_bp shown');
  contains(html, 'nco-bar',   'bar element rendered');
}

// ====== renderPerChrom =================================================

console.log('\nrenderPerChrom:');
{
  const html = renderPerChrom(TRACTS);
  contains(html, 'LG01',  'LG01 row');
  contains(html, 'LG02',  'LG02 row');
  contains(html, 'LG28',  'LG28 row');
}

// ====== renderInVsOut ==================================================

console.log('\nrenderInVsOut:');
{
  // Headline view — verifies the cross-tab tally is right.
  const html = renderInVsOut(TRACTS);
  contains(html, 'NCO',           'NCO row');
  contains(html, 'MOSAIC_SHORT',  'MOSAIC_SHORT row');
  contains(html, 'MOSAIC_LONG',   'MOSAIC_LONG row');
  contains(html, 'gene-conversion tracts inside inversions', 'headline hint text');
  // Verify the "in" cell for MOSAIC_SHORT is highlighted (color:var(--accent)).
  contains(html, 'color:var(--accent)', 'MOSAIC_SHORT × yes highlight applied');
}

// ====== renderStatusBadge ==============================================

console.log('\nrenderStatusBadge:');
{
  contains(renderStatusBadge(null, null), 'No <code>tract_classifications_v1</code> envelope', 'null envelope → empty-state badge');
  contains(renderStatusBadge(null, null), 'nco-badge-empty',                                   'empty-state class');
}
{
  contains(renderStatusBadge(null, 'HTTP 503'), '⚠ envelope fetch failed', 'fetch error → warn badge');
  contains(renderStatusBadge(null, 'HTTP 503'), 'HTTP 503',                'error text included');
  contains(renderStatusBadge(null, 'HTTP 503'), 'nco-badge-warn',          'warn class');
}
{
  const env = {
    layer_id: 'tract_classifications_226_xyz',
    payload: { summary: { n_tracts: 4, n_dyads: 2, n_chroms: 3, n_inside_inversion: 1,
      class_counts: { NCO: 1, CO: 0, DCO: 0, MOSAIC_SHORT: 2, MOSAIC_LONG: 1, AMBIG: 0, LOW_CONFIDENCE: 0 } } },
  };
  const html = renderStatusBadge(env, null);
  contains(html, 'tract_classifications_226_xyz', 'layer_id shown');
  contains(html, '4 tracts',                       'n_tracts shown');
  contains(html, '2 dyads',                        'n_dyads shown');
  contains(html, 'MOSAIC_SHORT: 2',                'MOSAIC_SHORT count shown');
  contains(html, 'inside_inv: 1',                  'inside_inversion count shown');
  contains(html, 'nco-badge-ok',                   'ok class applied');
}

// ====== summary ========================================================

console.log();
if (_failed > 0) {
  console.error(`FAILED: ${_failed} of ${_passed + _failed} assertions failed`);
  process.exit(1);
}
console.log(`ALL OK (${_passed} assertions)`);
