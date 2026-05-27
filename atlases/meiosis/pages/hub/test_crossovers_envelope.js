// Smoke tests for the Crossovers page's envelope-aware renderers.
//
// Mirrors test_nco_envelope.js. Exercises filterEvents + chromList + classPred
// + four view renderers + renderStatusBadge against a 4-row synthetic fixture
// in the chromosome_meiosis_events_v1 shape (post-normalize).
//
// Run from the meiosis-atlas root:
//   node atlases/meiosis/pages/hub/test_crossovers_envelope.js

import {
  classPred,
  chromPred,
  filterEvents,
  chromList,
  renderPerDyadChrom,
  renderRatePerMb,
  renderBreakpointTrack,
  renderKaryotypeRate,
  renderStatusBadge,
  renderServerKaryoStrat,
} from './crossovers.js';

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

// ----- fixture: 4 rows spanning every code path ------------------------
const EVENTS = [
  // dyad A→B, chr01, het carrier (drives karyo_strat numerator)
  { parent_id: 'A', offspring_id: 'B', chrom: 'LG01', chrom_len_bp: 50_000_000,
    n_co: 3, n_dco: 0, n_nco: 12, co_per_mb: 0.06, dco_per_mb: 0,
    karyotype_at_focal_inv: 'het' },
  // dyad A→B, chr01, ALSO het — averaged with the above
  { parent_id: 'C', offspring_id: 'D', chrom: 'LG01', chrom_len_bp: 50_000_000,
    n_co: 2, n_dco: 0, n_nco: 14, co_per_mb: 0.04, dco_per_mb: 0,
    karyotype_at_focal_inv: 'het' },
  // dyad E→F, chr01, homA (non-het — drives karyo_strat denominator with much
  // higher rate so the ratio is < 0.7, triggering the co-cell-low highlight).
  { parent_id: 'E', offspring_id: 'F', chrom: 'LG01', chrom_len_bp: 50_000_000,
    n_co: 9, n_dco: 0, n_nco: 8, co_per_mb: 0.18, dco_per_mb: 0,
    karyotype_at_focal_inv: 'homA' },
  // dyad A→B, chr28, no karyotype (does NOT appear in karyo_strat view)
  { parent_id: 'A', offspring_id: 'B', chrom: 'LG28', chrom_len_bp: 30_000_000,
    n_co: 1, n_dco: 1, n_nco: 8, co_per_mb: 0.033, dco_per_mb: 0.033,
    karyotype_at_focal_inv: null },
];

// ====== filter / list / pred ============================================

console.log('classPred:');
{
  eq(classPred('CO'),          { co: true,  dco: false }, 'CO scope reads n_co only');
  eq(classPred('DCO'),         { co: false, dco: true  }, 'DCO scope reads n_dco only');
  eq(classPred('ALL_CO_LIKE'), { co: true,  dco: true  }, 'ALL_CO_LIKE reads both');
  eq(classPred('xyz'),         { co: true,  dco: true  }, 'unknown → ALL_CO_LIKE fallback');
}

console.log('\nchromPred + filterEvents:');
{
  eq(filterEvents(EVENTS, 'all').length, 4, 'chrom=all → 4 rows');
  eq(filterEvents(EVENTS, 'LG01').length, 3, 'chrom=LG01 → 3 rows');
  eq(filterEvents(EVENTS, 'LG28').length, 1, 'chrom=LG28 → 1 row');
  eq(filterEvents(EVENTS, '').length, 4, 'empty chrom value → all');
}

console.log('\nchromList:');
{
  eq(chromList(EVENTS), ['LG01', 'LG28'], 'sorted distinct chroms');
  eq(chromList([]), [], 'empty input → empty list');
}

// ====== renderPerDyadChrom =============================================

console.log('\nrenderPerDyadChrom:');
{
  const html = renderPerDyadChrom(EVENTS, classPred('ALL_CO_LIKE'));
  contains(html, 'A → B', 'dyad A→B row');
  contains(html, 'C → D', 'dyad C→D row');
  contains(html, 'E → F', 'dyad E→F row');
  contains(html, 'LG01',  'LG01 column');
  contains(html, 'LG28',  'LG28 column');
  // A→B LG28: n_co + n_dco = 1 + 1 = 2
  contains(html, '>2<',   'A→B LG28 cell = n_co + n_dco = 2');
}
{
  const html = renderPerDyadChrom([], classPred('ALL_CO_LIKE'));
  contains(html, 'No events match', 'empty input → empty message');
  lacks(html,    '<table',          'empty input → no table');
}

// ====== renderRatePerMb ================================================

console.log('\nrenderRatePerMb:');
{
  const html = renderRatePerMb(EVENTS, classPred('CO'));
  contains(html, 'co-hint', 'rate view has descriptive hint');
  contains(html, 'per Mb',  'hint mentions per Mb');
  // E→F LG01 should show co_per_mb = 0.18 → '0.180'
  contains(html, '0.180', 'rate value formatted to 3 decimals');
}

// ====== renderBreakpointTrack ==========================================

console.log('\nrenderBreakpointTrack:');
{
  const html = renderBreakpointTrack(EVENTS, classPred('CO'));
  contains(html, 'traversal_breakpoints', 'stub points at the missing envelope');
  contains(html, 'STEP_TRC_02',           'stub names the producer step');
}

// ====== renderKaryotypeRate ============================================

console.log('\nrenderKaryotypeRate:');
{
  // EVENTS has 3 LG01 rows with karyotype: het (0.06), het (0.04), homA (0.18).
  // mean_het = 0.05; mean_nonhet = 0.18; ratio = 0.278 (< 0.7 → highlighted).
  const html = renderKaryotypeRate(EVENTS, classPred('CO'));
  contains(html, 'LG01',          'LG01 row rendered');
  contains(html, 'mean CO/Mb',    'columns labelled');
  contains(html, 'co-cell-low',   'low-ratio cell highlighted (suppression signal)');
  contains(html, 'canonical biological signal', 'biological-significance hint present');
}
{
  // No karyotype data on any row → empty-state message.
  const noKaryo = [{ parent_id: 'A', offspring_id: 'B', chrom: 'LG01', chrom_len_bp: 1e7, n_co: 1, co_per_mb: 0.1, karyotype_at_focal_inv: null }];
  const html = renderKaryotypeRate(noKaryo, classPred('CO'));
  contains(html, 'No karyotype_at_focal_inv data', 'empty-state when no karyo rows');
  lacks(html,    'co-cell-low',                    'no highlight in empty state');
}

// ====== renderStatusBadge ==============================================

console.log('\nrenderStatusBadge:');
{
  contains(renderStatusBadge(null, null), 'No <code>chromosome_meiosis_events_v1</code>', 'null envelope → empty-state badge');
  contains(renderStatusBadge(null, null), 'co-badge-empty',                                'empty-state class');
}
{
  contains(renderStatusBadge(null, 'HTTP 503'), '⚠ envelope fetch failed', 'fetch error → warn badge');
  contains(renderStatusBadge(null, 'HTTP 503'), 'HTTP 503',                'error text included');
  contains(renderStatusBadge(null, 'HTTP 503'), 'co-badge-warn',           'warn class');
}
{
  const env = {
    layer_id: 'chromosome_meiosis_events_226_xyz',
    payload: { summary: { n_rows: 4, n_dyads: 3, n_chroms: 2,
      sum_n_co: 15, sum_n_dco: 1, sum_n_nco: 42, karyotype_strat_rows: 3 } },
  };
  const html = renderStatusBadge(env, null);
  contains(html, 'chromosome_meiosis_events_226_xyz', 'layer_id shown');
  contains(html, '4 rows',                            'n_rows shown');
  contains(html, '3 dyads',                           'n_dyads shown');
  contains(html, 'ΣCO: 15',                           'sum_n_co shown');
  contains(html, 'ΣDCO: 1',                           'sum_n_dco shown');
  contains(html, 'karyo-strat rows: 3',               'karyotype_strat_rows shown');
  contains(html, 'co-badge-ok',                       'ok class applied');
}

// ====== renderServerKaryoStrat (intrachromosomal_co_effect_v1 envelope) ====

console.log('\nrenderServerKaryoStrat:');
{
  const PAYLOAD = {
    per_chrom: [
      { chrom: 'LG02',
        n_dyads_het: 8, n_dyads_non_het: 12,
        mean_co_per_mb_het: 0.42, mean_co_per_mb_non_het: 0.81,
        rate_ratio_het_over_non_het: 0.518,
        welch_t: -3.41, welch_df: 14.2, p_two_sided: 0.0042,
        flag_below_threshold: true },
      { chrom: 'LG05',
        n_dyads_het: 6, n_dyads_non_het: 10,
        mean_co_per_mb_het: 0.55, mean_co_per_mb_non_het: 0.60,
        rate_ratio_het_over_non_het: 0.917,
        welch_t: -0.71, welch_df: 12.0, p_two_sided: 0.49,
        flag_below_threshold: false },
      { chrom: 'LG06',
        n_dyads_het: 1, n_dyads_non_het: 12,
        mean_co_per_mb_het: 0.55, mean_co_per_mb_non_het: 0.62,
        rate_ratio_het_over_non_het: null,
        welch_t: null, welch_df: null, p_two_sided: null,
        flag_below_threshold: false,
        excluded_reason: 'insufficient_dyads' },
    ],
    summary: {
      n_chroms_total: 3, n_chroms_tested: 2,
      n_chroms_excluded: 1, n_chroms_flagged: 1,
      flag_threshold: 0.7,
    },
  };
  const html = renderServerKaryoStrat(PAYLOAD);
  contains(html, 'LG02',                  'flagged chrom row rendered');
  contains(html, 'color:var(--bad)',      'flagged ratio cell coloured red');
  contains(html, 'LG05',                  'unflagged chrom row rendered');
  contains(html, 'insufficient_dyads',    'excluded reason rendered for low-power chrom');
  contains(html, 'n_chroms_flagged=1',    'summary flagged count rendered');
  contains(html, 'n_chroms_tested=2',     'summary tested count rendered');

  // Missing per_chrom block → empty-state message
  contains(renderServerKaryoStrat({}),     'Server result envelope',
                                           'missing per_chrom block → empty message');
  contains(renderServerKaryoStrat(null),   'Server result envelope',
                                           'null payload → empty message');
}

// ====== summary ========================================================

console.log();
if (_failed > 0) {
  console.error(`FAILED: ${_failed} of ${_passed + _failed} assertions failed`);
  process.exit(1);
}
console.log(`ALL OK (${_passed} assertions)`);
