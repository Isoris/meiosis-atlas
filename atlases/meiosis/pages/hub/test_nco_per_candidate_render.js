// Smoke tests for nco_per_candidate renderers.
//
// Tests pure functions only (no DOM mount):
//   - nco_per_candidate/_render: renderTractIdeogramSVG, buildTractCurves,
//     renderTractCurveSVG
// Uses the bundled DEMO_NCO_PAYLOAD as the input fixture.
//
// Run from the meiosis-atlas root:
//   node atlases/meiosis/pages/hub/test_nco_per_candidate_render.js

import {
  renderTractIdeogramSVG,
  buildTractCurves,
  renderTractCurveSVG,
} from './nco_per_candidate/_render.js';
import { DEMO_NCO_PAYLOAD } from './nco_per_candidate/_demo.js';

let _failed = 0;
let _passed = 0;

function ok(msg) { _passed++; console.log(`  ok: ${msg}`); }
function fail(msg, extra) {
  console.error(`FAIL: ${msg}`);
  if (extra !== undefined) console.error(`  ${extra}`);
  _failed++;
}
function eq(a, b, msg) {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    fail(msg, `expected: ${JSON.stringify(b)}\n  got:      ${JSON.stringify(a)}`);
    return;
  }
  ok(msg);
}
function contains(html, marker, msg) {
  if (typeof html !== 'string' || !html.includes(marker)) {
    fail(msg, `marker not found: ${marker}\n  got: ${html.slice(0, 200)}…`);
    return;
  }
  ok(msg);
}
function lacks(html, marker, msg) {
  if (typeof html === 'string' && html.includes(marker)) {
    fail(msg, `unexpected marker: ${marker}\n  got: ${html.slice(0, 200)}…`);
    return;
  }
  ok(msg);
}

// ====== renderTractIdeogramSVG =========================================

console.log('renderTractIdeogramSVG (against DEMO_NCO_PAYLOAD):');
{
  const svg = renderTractIdeogramSVG(DEMO_NCO_PAYLOAD);
  contains(svg, 'C_gar_LG28',           'host chrom labelled');
  contains(svg, 'class="ga-ideo-span"', 'candidate span band drawn on host');
  contains(svg, 'ga-nco-tick-bg',       'NCO ticks rendered');
  contains(svg, 'ga-gc-tick-bg',        'GC tracks rendered with gc class');
  contains(svg, 'ga-ideogram-rod',      'chrom rod rendered');
  contains(svg, '19.7 Mb',              'host chrom length labelled');
  // 14 NCO + 8 GC = 22 ticks; rough check that we have plenty of <rect>s.
  const nRects = (svg.match(/<rect/g) || []).length;
  if (nRects >= 22) ok(`>= 22 <rect> elements rendered (got ${nRects})`);
  else              fail(`expected >= 22 <rect> elements; got ${nRects}`);
}
{
  const svg = renderTractIdeogramSVG({ tracts: [], candidate_span: { chrom: 'X' } });
  contains(svg, 'No NCO / GC tracts',   'empty tracts → empty-state message');
  lacks(svg,    'ga-nco-tick-bg',       'empty tracts → no NCO ticks');
}

// ====== buildTractCurves ==============================================

console.log('\nbuildTractCurves (against DEMO_NCO_PAYLOAD):');
{
  const c = buildTractCurves(DEMO_NCO_PAYLOAD, { n_bins: 5 });
  if (!c.nco || !c.gc) {
    fail('expected nco + gc curves to be defined');
  } else {
    ok('nco + gc curves both defined');
    // 14 NCO tracts on host chrom; sum of bin counts === 14.
    const ncoSum = c.nco.n.reduce((a, b) => a + b, 0);
    eq(ncoSum, 14, '14 NCO tracts binned');
    const gcSum = c.gc.n.reduce((a, b) => a + b, 0);
    eq(gcSum, 8, '8 GC tracts binned');
  }
}

// ====== renderTractCurveSVG ============================================

console.log('\nrenderTractCurveSVG (against DEMO_NCO_PAYLOAD):');
{
  const svg = renderTractCurveSVG(DEMO_NCO_PAYLOAD, { n_bins: 5 });
  contains(svg, '<svg',                          'returns an SVG');
  contains(svg, 'ga-nco-line',                   'NCO curve line drawn');
  contains(svg, 'ga-gc-line',                    'GC curve line drawn');
  contains(svg, 'ga-nco-band',                   'NCO CI band drawn');
  contains(svg, 'ga-gc-band',                    'GC CI band drawn');
  contains(svg, 'relative distance from telomere','x-axis labelled');
  contains(svg, '# tracts / bin',                'y-axis labelled');
  contains(svg, '>NCO<',                          'legend has NCO entry');
  contains(svg, '>GC<',                           'legend has GC entry');
}
{
  const svg = renderTractCurveSVG({ tracts: [], candidate_span: {} });
  contains(svg, 'No tracts',                      'no tracts → empty-state message');
}

// ====== summary ========================================================

console.log();
if (_failed > 0) {
  console.error(`FAILED: ${_failed} of ${_passed + _failed} assertions failed`);
  process.exit(1);
}
console.log(`ALL OK (${_passed} assertions)`);
