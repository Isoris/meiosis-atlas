// Smoke tests for crossovers_per_candidate renderers + helpers.
//
// Tests pure functions only (no DOM mount):
//   - _per_candidate_helpers: binSmooth, relTelomereDist, sequenceLogoSVG, escHtml
//   - crossovers_per_candidate/_render: renderIdeogramSVG, buildTelomereCurves,
//     renderTelomereCurveSVG, renderPrdm9LogoSVG
// Uses the bundled DEMO_CROSSOVER_PAYLOAD as the input fixture.
//
// Run from the meiosis-atlas root:
//   node atlases/meiosis/pages/hub/test_crossovers_per_candidate_render.js

import {
  escHtml,
  binSmooth,
  relTelomereDist,
  sequenceLogoSVG,
} from './_per_candidate_helpers.js';
import {
  renderIdeogramSVG,
  buildTelomereCurves,
  renderTelomereCurveSVG,
  renderPrdm9LogoSVG,
} from './crossovers_per_candidate/_render.js';
import { DEMO_CROSSOVER_PAYLOAD } from './crossovers_per_candidate/_demo.js';

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
function approx(a, b, tol, msg) {
  if (typeof a !== 'number' || typeof b !== 'number' || Math.abs(a - b) > tol) {
    fail(msg, `expected ${b} ± ${tol}; got ${a}`);
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

// ====== escHtml ========================================================

console.log('escHtml:');
{
  eq(escHtml('<a&"'), '&lt;a&amp;&quot;', 'escapes < & "');
  eq(escHtml(null), '', 'null → empty string');
  eq(escHtml(0), '0', 'numbers stringified');
}

// ====== relTelomereDist =================================================

console.log('\nrelTelomereDist:');
{
  // Edge of the chromosome → 0.
  approx(relTelomereDist(0,       100), 0.0, 1e-9, '0 bp → 0 (left telomere)');
  approx(relTelomereDist(100,     100), 0.0, 1e-9, 'end bp → 0 (right telomere)');
  // Centre of the chrom → 1.
  approx(relTelomereDist(50,      100), 1.0, 1e-9, 'centre → 1');
  // 25 bp into a 100 bp chrom → 0.5 of the way to centre.
  approx(relTelomereDist(25,      100), 0.5, 1e-9, 'quarter-arm → 0.5');
  // 75 bp (3/4 of the way along) — same as 25 by symmetry.
  approx(relTelomereDist(75,      100), 0.5, 1e-9, 'symmetric: 75/100 == 25/100');
}

// ====== binSmooth =======================================================

console.log('\nbinSmooth:');
{
  // Four x in [0, 1], one per quadrant; binSmooth with 4 bins → counts {1,1,1,1}.
  const r = binSmooth([0.1, 0.3, 0.6, 0.9], [1, 1, 1, 1], 4);
  eq(r.n, [1, 1, 1, 1], '4 bins evenly populated');
  eq(r.x_centers.map(x => +x.toFixed(3)), [0.125, 0.375, 0.625, 0.875], 'bin centers');
}
{
  // Empty input → all NaN means.
  const r = binSmooth([], [], 5);
  ok(r.n.every(v => v === 0) ? 'empty input → all counts 0' : (fail('empty counts wrong'),''));
  ok(r.mean.every(v => Number.isNaN(v)) ? 'empty input → all means NaN' : (fail('expected NaN means'),''));
}

// ====== sequenceLogoSVG =================================================

console.log('\nsequenceLogoSVG:');
{
  const pwm = [[0.05, 0.85, 0.05, 0.05], [0.10, 0.10, 0.10, 0.70]];
  const svg = sequenceLogoSVG(pwm, { width: 200, height: 60 });
  contains(svg, '<svg', 'returns an SVG element');
  contains(svg, 'role="img"', 'has role=img');
  // The strong base in column 1 is C → expect a <text>C</text> in there.
  contains(svg, '>C<', 'high-prob C letter appears in column 1');
  contains(svg, '>T<', 'high-prob T letter appears in column 2');
}
{
  eq(sequenceLogoSVG([]).includes('<svg'), true, 'empty pwm still returns a (tiny) <svg>');
}

// ====== renderIdeogramSVG ==============================================

console.log('\nrenderIdeogramSVG (against DEMO_CROSSOVER_PAYLOAD):');
{
  const svg = renderIdeogramSVG(DEMO_CROSSOVER_PAYLOAD);
  contains(svg, 'C_gar_LG28',          'host chrom labelled');
  contains(svg, 'C_gar_LG02',          'flank chrom labelled');
  contains(svg, 'class="ga-ideo-span"', 'candidate span band drawn on host');
  contains(svg, '<circle',              'CO events render as circles');
  contains(svg, 'ga-co-female-bg',     'female CO dots get female class');
  contains(svg, 'ga-co-male-bg',       'male CO dots get male class');
  contains(svg, 'ga-ideogram-rod',     'chrom rod rendered');
  contains(svg, '19.7 Mb',             'host chrom length labelled');
}
{
  // Empty events → empty-state SVG.
  const svg = renderIdeogramSVG({ events: [], candidate_span: { chrom: 'X' } });
  contains(svg, 'No CO events',         'empty events → empty-state message');
  lacks(svg,    '<circle',                'empty events → no event dots');
}

// ====== buildTelomereCurves ============================================

console.log('\nbuildTelomereCurves (against DEMO_CROSSOVER_PAYLOAD):');
{
  const c = buildTelomereCurves(DEMO_CROSSOVER_PAYLOAD, { n_bins: 5 });
  if (!c.female || !c.male) {
    fail('expected female + male curves to be defined');
  } else {
    ok('female + male curves both defined');
    // 12 ♀ events on host; sum of bin counts === 12.
    const fSum = c.female.n.reduce((a, b) => a + b, 0);
    eq(fSum, 12, '12 ♀ events binned across all 5 bins');
    const mSum = c.male.n.reduce((a, b) => a + b, 0);
    eq(mSum, 12, '12 ♂ events binned across all 5 bins');
  }
}

// ====== renderTelomereCurveSVG =========================================

console.log('\nrenderTelomereCurveSVG (against DEMO_CROSSOVER_PAYLOAD):');
{
  const svg = renderTelomereCurveSVG(DEMO_CROSSOVER_PAYLOAD, { n_bins: 5 });
  contains(svg, '<svg',                          'returns an SVG');
  contains(svg, 'ga-co-female-line',             'female curve line drawn');
  contains(svg, 'ga-co-male-line',               'male curve line drawn');
  contains(svg, 'ga-co-female-band',             'female CI band drawn');
  contains(svg, 'relative distance from telomere','x-axis labelled');
  contains(svg, '# COs / bin',                   'y-axis labelled');
  contains(svg, '<text x="14"',                  'rotated y-axis label rendered');
  contains(svg, 'females',                       'legend has females entry');
  contains(svg, 'males',                         'legend has males entry');
}
{
  const svg = renderTelomereCurveSVG({ events: [], candidate_span: {} });
  contains(svg, 'No CO events',                   'no events → empty-state message');
}

// ====== renderPrdm9LogoSVG =============================================

console.log('\nrenderPrdm9LogoSVG:');
{
  const svg = renderPrdm9LogoSVG(DEMO_CROSSOVER_PAYLOAD);
  contains(svg, '<svg',  'PRDM9 logo rendered when pwm present');
  contains(svg, '>C<',   'expected dominant C base in column 1');
}
{
  eq(renderPrdm9LogoSVG({}),                  '', 'no prdm9_motif → empty string (caller hides card)');
  eq(renderPrdm9LogoSVG({ prdm9_motif: {} }), '', 'no pwm field  → empty string');
  eq(renderPrdm9LogoSVG({ prdm9_motif: { pwm: [] } }), '', 'empty pwm → empty string');
}

// ====== summary ========================================================

console.log();
if (_failed > 0) {
  console.error(`FAILED: ${_failed} of ${_passed + _failed} assertions failed`);
  process.exit(1);
}
console.log(`ALL OK (${_passed} assertions)`);
