// Smoke tests for the Interchromosomal page (HEADLINE).
//
// Exercises:
//   - pure stats helpers in interchromosomal/_stats.js
//     (mulberry32, welchT, bhAdjust, bonfAdjust)
//   - runInterchromosomalTests end-to-end against the DEMO_ENVELOPES
//     fixture (proves the permutation-test pipeline produces sane output)
//   - renderStatusBadge in 4 states (demo / ok / missing / warn)
//   - renderResultTable for the sig-row / focal-row / empty paths
//
// Run from the meiosis-atlas root:
//   node atlases/meiosis/pages/hub/test_interchromosomal_envelope.js

import { renderStatusBadge, renderResultTable } from './interchromosomal.js';
import {
  mulberry32,
  welchT,
  bhAdjust,
  bonfAdjust,
  runInterchromosomalTests,
} from './interchromosomal/_stats.js';
import { DEMO_ENVELOPES } from './interchromosomal/_demo.js';

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
    fail(msg, `marker not found: ${marker}\n  got: ${html}`);
    return;
  }
  ok(msg);
}

// ====== mulberry32 ======================================================

console.log('mulberry32:');
{
  const a = mulberry32(42);
  const b = mulberry32(42);
  const seqA = [a(), a(), a()];
  const seqB = [b(), b(), b()];
  eq(seqA, seqB, 'same seed → identical sequence');
  for (const v of seqA) {
    if (!(v >= 0 && v < 1)) { fail('value not in [0,1)', `got ${v}`); break; }
  }
  ok('values in [0, 1)');
  const c = mulberry32(43);
  const seqC = [c(), c(), c()];
  if (JSON.stringify(seqA) === JSON.stringify(seqC)) {
    fail('different seed should not produce identical sequence');
  } else {
    ok('different seeds → different sequences');
  }
}

// ====== welchT ==========================================================

console.log('\nwelchT:');
{
  // Two identical samples → t ≈ 0
  const r = welchT([1, 2, 3, 4, 5], [1, 2, 3, 4, 5]);
  approx(r.t_stat, 0, 1e-9, 'identical samples → t = 0');
  approx(r.mean_diff, 0, 1e-9, 'identical samples → mean_diff = 0');
}
{
  // Distinct means → non-zero t
  const r = welchT([10, 11, 12], [1, 2, 3]);
  if (r.t_stat > 5) ok('clearly separated samples → t > 5');
  else fail('expected large positive t', `got ${r.t_stat}`);
  approx(r.mean_diff, 9, 1e-9, 'mean_diff captures direction (het − non-het)');
}
{
  // Insufficient data → null mean_diff (n < 2 in either group)
  const r = welchT([5], [1, 2, 3]);
  if (r == null || r.t_stat == null || isNaN(r.t_stat)) ok('n_het < 2 → null/NaN t');
  else fail('expected null/NaN for under-powered welchT', `got ${JSON.stringify(r)}`);
}

// ====== bhAdjust + bonfAdjust ===========================================

console.log('\nbhAdjust:');
{
  // Known reference: BH on (0.01, 0.02, 0.5) with n=3:
  //   sorted = (0.01, 0.02, 0.5); q_i = p_i * n / rank
  //   q_1 = 0.01 * 3/1 = 0.030;  q_2 = 0.02 * 3/2 = 0.030;  q_3 = 0.5 * 3/3 = 0.5
  // Monotonic from the tail: min so far ⇒ (0.030, 0.030, 0.5).
  const adj = bhAdjust([0.01, 0.02, 0.5]);
  approx(adj[0], 0.030, 1e-6, 'BH adjusted [0]');
  approx(adj[1], 0.030, 1e-6, 'BH adjusted [1]');
  approx(adj[2], 0.5,   1e-6, 'BH adjusted [2]');
}

console.log('\nbonfAdjust:');
{
  const adj = bonfAdjust([0.01, 0.02, 0.5]);
  eq(adj.map(v => +v.toFixed(6)), [0.03, 0.06, 1.0], 'Bonferroni × n, clamped at 1');
}

// ====== runInterchromosomalTests against DEMO ===========================

console.log('\nrunInterchromosomalTests (DEMO_ENVELOPES):');
{
  // DEMO_ENVELOPES is designed so that at least one tested chromosome
  // shows a statistically significant interchromosomal effect under the
  // default seed. We probe for that.
  let result;
  try {
    result = runInterchromosomalTests(DEMO_ENVELOPES, {
      focal_inversion_id: null,  // let the pipeline auto-pick from FAPD
      n_permutations:     1000,
      p_bh_alpha:         0.05,
      seed:               1,
    });
  } catch (e) {
    fail('runInterchromosomalTests threw', e && e.message);
  }
  if (result) {
    if (result.rows && result.rows.length > 0) {
      ok(`rows produced (n=${result.rows.length})`);
    } else {
      fail('expected at least one tested-chrom row');
    }
    if (result.summary && typeof result.summary.n_tests === 'number') {
      ok(`summary.n_tests = ${result.summary.n_tests}`);
    } else {
      fail('summary.n_tests missing');
    }
    // Each row has the expected shape.
    if (result.rows && result.rows[0]) {
      const r = result.rows[0];
      const required = ['tested_chrom', 'n_het', 'n_nonhet', 't_stat', 'p_value', 'p_bonf', 'p_bh', 'is_focal_chrom'];
      const missing = required.filter(k => !(k in r));
      if (missing.length === 0) ok('row carries all expected fields');
      else fail(`row missing fields: ${missing.join(', ')}`);
    }
    // The focal chrom should be flagged on at least one row.
    if (result.rows && result.rows.some(r => r.is_focal_chrom)) {
      ok('at least one row flagged as focal chrom');
    } else {
      fail('no row flagged as focal chrom');
    }
  }
}

// ====== renderStatusBadge ==============================================

console.log('\nrenderStatusBadge:');
{
  contains(renderStatusBadge(null, [], null, true),
           'DEMO MODE',
           'demo-mode → demo badge');
  contains(renderStatusBadge(null, [], null, true),
           'ic-badge-demo',
           'demo badge has demo class');
}
{
  const html = renderStatusBadge(null, [], 'chromosome_meiosis_events: HTTP 503', false);
  contains(html, '⚠ envelope fetch failed', 'fetch error → warn badge');
  contains(html, 'HTTP 503',                 'error text included');
  contains(html, 'ic-badge-warn',            'warn class');
}
{
  const html = renderStatusBadge(null, ['coincidence_matrix', 'local_inv_controls'], null, false);
  contains(html, 'missing envelope(s)',     'missing → empty-state badge');
  contains(html, 'coincidence_matrix',       'first missing layer listed');
  contains(html, 'local_inv_controls',       'second missing layer listed');
  contains(html, 'ic-badge-empty',           'empty class');
}
{
  const envelopes = {
    cme:  { layer_id: 'cme_xyz',  payload: { summary: { n_chroms: 5 } } },
    lic:  { layer_id: 'lic_xyz',  payload: { summary: { n_controls: 12 } } },
    fapd: { layer_id: 'fapd_xyz', payload: { summary: {
      n_focal_inversions: 3,
      n_parents: 50,
      n_families: 14,
      n_singleton_blocks: 2,
    } } },
    cm:   { layer_id: 'cm_xyz',   payload: { summary: {} } },
  };
  const html = renderStatusBadge(envelopes, [], null, false);
  contains(html, 'fapd_xyz',           'fapd layer_id shown');
  contains(html, '3 focal inv',         'n_focal_inversions');
  contains(html, '50 parents',          'n_parents');
  contains(html, '14 families',         'n_families');
  contains(html, '5 chroms in CME',     'n_chroms from CME');
  contains(html, '12 local controls',   'n_controls from LIC');
  contains(html, 'singleton blocks: 2', 'singleton blocks');
  contains(html, 'ic-badge-ok',         'ok class');
}

// ====== renderResultTable ==============================================

console.log('\nrenderResultTable:');
{
  contains(renderResultTable({ rows: [], summary: {} }),
           'No tests produced',
           'empty rows → empty-state message');
}
{
  // Mixed: 1 focal row + 1 significant row + 1 inert row
  const result = {
    rows: [
      { tested_chrom: 'LG01', n_het: 8, n_nonhet: 7, mean_diff: 0.01, t_stat: 0.4,
        p_value: 0.5, p_bonf: 1.0, p_bh: 0.6, is_focal_chrom: true,
        sig_flag: false, local_inv_burden: null },
      { tested_chrom: 'LG28', n_het: 8, n_nonhet: 7, mean_diff: 0.06, t_stat: 3.8,
        p_value: 0.001, p_bonf: 0.014, p_bh: 0.014, is_focal_chrom: false,
        sig_flag: true, local_inv_burden: { n_local_invs: 2, total_local_length_bp: 5_000_000 } },
      { tested_chrom: 'LG02', n_het: 8, n_nonhet: 7, mean_diff: 0.01, t_stat: 0.3,
        p_value: 0.7, p_bonf: 1.0, p_bh: 0.85, is_focal_chrom: false,
        sig_flag: false, local_inv_burden: null },
    ],
    summary: {
      focal_inversion_id: 'INV_LG01_01',
      focal_chrom: 'LG01',
      n_tests: 3,
      n_sig_bh: 1,
      p_bh_alpha: 0.05,
      n_permutations: 10000,
    },
  };
  const html = renderResultTable(result);
  contains(html, 'INV_LG01_01',     'focal_inversion_id shown in headline');
  contains(html, 'LG01',             'focal_chrom shown');
  contains(html, '3 tested chrom',   'n_tests shown');
  contains(html, '1 signal',         'n_sig_bh shown (singular)');
  contains(html, '10,000',           'n_permutations formatted with commas');
  contains(html, 'ic-focal-row',     'focal row gets ic-focal-row class');
  contains(html, 'ic-sig',           'significant row gets ic-sig class');
  contains(html, 'focal chrom',      'focal-chrom pill label');
  contains(html, 'p-BH&nbsp;sig',    'significant-row pill label');
  contains(html, '2 inv (5 Mb)',     'local_inv_burden formatted');
}

// ====== summary ========================================================

console.log();
if (_failed > 0) {
  console.error(`FAILED: ${_failed} of ${_passed + _failed} assertions failed`);
  process.exit(1);
}
console.log(`ALL OK (${_passed} assertions)`);
