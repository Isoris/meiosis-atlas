// atlases/relatedness/shared/recomb_data.js
// =============================================================================
// Shared math for the four recombination pages (eligibility / resolution /
// coincidence / inversion_signature). Translates the Sandler two-step model
// onto observable quantities computed from DEMO.recomb_windows /
// DEMO.recomb_pairs.
//
//   eligibility(window)  ∝ n_NCO_pop / window_size_mb        (p map)
//   resolution(window)   = n_CO_ped / (n_NCO_pop + n_CO_ped) (x map)
//   coincidence(pair)    = r_ij / (r_i · r_j)                (C; Sandler)
//   interference(pair)   = 1 − coincidence
//
// Pages are deliberately separated from the math so the same helpers can
// later be swapped to consume a real ngsTracts / NCO-tract envelope without
// touching page code.
// =============================================================================

import { DEMO } from '../../relatedness/shared/demo_data.js';

export function windowsForChrom(chrom) {
  return DEMO.recomb_windows[chrom] || [];
}

export function pairsForChrom(chrom) {
  return DEMO.recomb_pairs[chrom] || [];
}

export function chromosomesWithRecomb() {
  return DEMO.chromosomes.filter(c => (DEMO.recomb_windows[c] || []).length > 0);
}

// Per-window observables.
export function eligibility(w) {
  // events per Mb of NCO in the population layer.
  return DEMO.recomb_window_mb > 0
    ? (w.n_NCO_pop / DEMO.recomb_window_mb)
    : NaN;
}
export function resolution(w, minTotal = 3) {
  // CO share given a precondition; gray-out when sample is too small.
  const total = w.n_NCO_pop + w.n_CO_ped;
  if (total < minTotal) return NaN;
  return w.n_CO_ped / total;
}
export function coRatePerMeiosis(w) {
  return w.n_CO_ped / (DEMO.recomb_n_meioses || 1);
}

// Pair-wise observables.
export function coincidence(pair, wins) {
  const wi = wins[pair.i], wj = wins[pair.j];
  if (!wi || !wj) return NaN;
  const r_i = coRatePerMeiosis(wi);
  const r_j = coRatePerMeiosis(wj);
  if (!Number.isFinite(r_i) || !Number.isFinite(r_j) || r_i * r_j === 0) return NaN;
  const r_ij = pair.n_DCO / (DEMO.recomb_n_meioses || 1);
  return r_ij / (r_i * r_j);
}
export function interferenceFromC(C) {
  return Number.isFinite(C) ? (1 - C) : NaN;
}

// Inversion footprint: list inversion candidates on a chromosome with their
// covered window indices. Used by every page to overlay shading.
export function inversionFootprint(chrom) {
  const wins = windowsForChrom(chrom);
  return DEMO.inversion_candidates_full
    .filter(i => i.chromosome === chrom)
    .map(inv => ({
      inv,
      window_ids: wins
        .filter(w => inv.start_mb < w.end_mb && inv.end_mb > w.start_mb)
        .map(w => w.idx),
    }));
}

// Inside-vs-flank summary for one inversion. Used by the inversion_signature
// page to assign a verdict: consistent / inconsistent / ambiguous.
export function insideFlankSummary(inv, chrom) {
  const wins = windowsForChrom(chrom);
  const inside = wins.filter(w => inv.start_mb < w.end_mb && inv.end_mb > w.start_mb);
  const flank  = wins.filter(w => !(inv.start_mb < w.end_mb && inv.end_mb > w.start_mb));
  const _mean = arr => arr.length ? arr.reduce((a,b) => a+b, 0) / arr.length : NaN;
  const nco_in   = _mean(inside.map(eligibility));
  const nco_fl   = _mean(flank.map(eligibility));
  const co_in    = _mean(inside.map(coRatePerMeiosis));
  const co_fl    = _mean(flank.map(coRatePerMeiosis));
  const nco_ratio = (Number.isFinite(nco_fl) && nco_fl > 0) ? (nco_in / nco_fl) : NaN;
  const co_ratio  = (Number.isFinite(co_fl)  && co_fl  > 0) ? (co_in  / co_fl)  : NaN;
  return {
    n_windows_inside: inside.length, n_windows_flank: flank.length,
    nco_in, nco_fl, nco_ratio,
    co_in,  co_fl,  co_ratio,
  };
}

// Verdict from the user's cross-layer rule:
//   - Pop NCO ≈ flank, ped CO ↓↓               → consistent with active inversion
//   - Pop NCO ≈ flank, ped CO ≈ flank          → reject (this gen has full CO)
//   - Pop NCO ↓ flank, ped CO ↓ flank          → ancient cold region (not a new inversion)
//   - Pop NCO ↑↑ flank, ped CO normal/elevated → check; not a clean inversion signature
export function inversionVerdict(sum) {
  const ncoOK = Number.isFinite(sum.nco_ratio) && sum.nco_ratio >= 0.80 && sum.nco_ratio <= 1.20;
  const coLow = Number.isFinite(sum.co_ratio)  && sum.co_ratio  <  0.30;
  const coOK  = Number.isFinite(sum.co_ratio)  && sum.co_ratio  >= 0.70;
  const ncoUp = Number.isFinite(sum.nco_ratio) && sum.nco_ratio >  1.20;
  const ncoLow = Number.isFinite(sum.nco_ratio) && sum.nco_ratio <  0.70;
  if (ncoOK && coLow) return { code: 'consistent',  label: 'CONSISTENT WITH INVERSION' };
  if (ncoOK && coOK)  return { code: 'rejected',    label: 'REJECT — NO CO SUPPRESSION' };
  if (ncoLow && coLow)return { code: 'cold_region', label: 'ANCIENT COLD REGION' };
  if (ncoUp)          return { code: 'ambiguous',   label: 'NCO ELEVATED — CHECK' };
  return                 { code: 'ambiguous',   label: 'AMBIGUOUS' };
}
