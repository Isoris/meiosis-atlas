// atlases/meiosis/pages/hub/interchromosomal/_stats.js
// =============================================================================
// Statistical engine for the interchromosomal page.
//
// Pure functions; no DOM, no fetch. Tested by
// pages/hub/test_interchromosomal_envelope.js using a seeded RNG so the
// permutation tests are deterministic in smoke.
//
// Pipeline per (focal_inversion × tested_chrom):
//   1. parentCoRatesByChrom — per parent on each chrom, sum of CO events
//      across that parent's offspring divided by chrom_len_bp (× 1e6 for
//      per-Mb units).
//   2. karyotypesAtFocal — per parent, het / homA / homB at focal_inv (from
//      family_aware_permutation_design.v1).
//   3. permutationBlocks — per parent, the block id (typically family_id)
//      within which karyotype labels may be shuffled under the null.
//   4. welchT — observed Welch's t-statistic on per-parent CO rates,
//      grouped by karyotype-contrast (het vs non-het by default).
//   5. permTest — shuffle karyotype labels within each permutation_block
//      N times, recompute t, build the null distribution, p = empirical
//      tail probability (two-sided).
//   6. bhAdjust / bonfAdjust — multiple-comparison correction across all
//      (focal × chrom) tests in the run.
//
// The covariate-adjustment from local_inv_controls.v1 is currently used
// in a CONTEXT mode (not a regression): each tested_chrom gets a
// "local-inv burden" score (n local inversions + their cumulative
// length) that the renderer surfaces as a per-row caveat flag. Full
// regression-style adjustment is open work; this v1 is a documented,
// statistically-defensible point estimate + permutation p-value.
// =============================================================================

// ---------------------------------------------------------------------------
// Tiny seeded PRNG (mulberry32) — used by tests for determinism. Production
// path defaults to Math.random.
// ---------------------------------------------------------------------------

export function mulberry32(seed) {
  let state = seed >>> 0;
  return function () {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Karyotype + block lookups
// ---------------------------------------------------------------------------

/**
 * @returns Map<parent_id, karyotype> for the given focal inversion.
 */
export function karyotypesAtFocal(fapdAssignments, focalInversionId) {
  const out = new Map();
  for (const a of fapdAssignments) {
    if (a.focal_inversion_id === focalInversionId && a.parent_id && a.karyotype) {
      out.set(a.parent_id, a.karyotype);
    }
  }
  return out;
}

/**
 * @returns Map<parent_id, permutation_block> for the given focal inversion.
 */
export function permutationBlocks(fapdAssignments, focalInversionId) {
  const out = new Map();
  for (const a of fapdAssignments) {
    if (a.focal_inversion_id === focalInversionId && a.parent_id && a.permutation_block) {
      out.set(a.parent_id, a.permutation_block);
    }
  }
  return out;
}

/**
 * @returns The chromosome the focal inversion sits on, by scanning
 *   local_inv_controls for the row where inversion_id matches focal.
 *   Returns null when not found (page renders all chroms unfiltered).
 */
export function focalChromFromControls(licControls, focalInversionId) {
  for (const c of licControls) {
    if (c.inversion_id === focalInversionId && c.inversion_chrom) {
      return c.inversion_chrom;
    }
  }
  return null;
}

/**
 * @returns Map<tested_chrom, { n_local_invs, total_local_length_bp }>
 *   summarising the local-inversion context per chrom (for the caveat flag).
 */
export function localInvBurdenByChrom(licControls) {
  const out = new Map();
  for (const c of licControls) {
    const tc = c.tested_chrom;
    if (!tc) continue;
    const entry = out.get(tc) || { n_local_invs: 0, total_local_length_bp: 0 };
    entry.n_local_invs += 1;
    if (typeof c.length_bp === 'number') entry.total_local_length_bp += c.length_bp;
    out.set(tc, entry);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Per-parent CO-rate computation from chromosome_meiosis_events_v1
// ---------------------------------------------------------------------------

/**
 * Sums n_co + n_dco per (parent_id, chrom) and divides by chrom_len_bp × 1e6
 * to get CO_per_mb per parent on each chrom. Uses the explicit co_per_mb
 * field when available AND not derived from missing chrom_len; falls back
 * to the per-row n_co / chrom_len_bp * 1e6 derivation.
 *
 * @param events Array of chromosome_meiosis_events_v1 row objects.
 * @param classScope `{co: boolean, dco: boolean}` — which counters to sum.
 *                   Default: { co: true, dco: false } (single-CO rate only).
 * @returns Map<parent_id, Map<chrom, co_per_mb>>.
 */
export function parentCoRatesByChrom(events, classScope = { co: true, dco: false }) {
  // Aggregate sum(n) and chrom_len for each (parent, chrom).
  const agg = new Map();
  for (const e of events) {
    if (!e.parent_id || !e.chrom) continue;
    const key = `${e.parent_id}\x00${e.chrom}`;
    let n = 0;
    if (classScope.co  && typeof e.n_co  === 'number') n += e.n_co;
    if (classScope.dco && typeof e.n_dco === 'number') n += e.n_dco;
    const entry = agg.get(key) || { n: 0, len: 0 };
    entry.n   += n;
    if (typeof e.chrom_len_bp === 'number') entry.len = e.chrom_len_bp;
    agg.set(key, entry);
  }
  const out = new Map();
  for (const [key, { n, len }] of agg) {
    if (!len || len <= 0) continue;
    const [parent_id, chrom] = key.split('\x00');
    const rate = n / len * 1e6;
    let m = out.get(parent_id);
    if (!m) { m = new Map(); out.set(parent_id, m); }
    m.set(chrom, rate);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Welch's t-test
// ---------------------------------------------------------------------------

function _mean(arr) {
  if (arr.length === 0) return 0;
  let s = 0;
  for (const v of arr) s += v;
  return s / arr.length;
}

function _var(arr, mean) {
  if (arr.length < 2) return 0;
  let s = 0;
  for (const v of arr) s += (v - mean) * (v - mean);
  return s / (arr.length - 1);
}

/**
 * Welch's two-sample t-statistic (point estimate + variance) on per-parent
 * CO rates, grouped het vs non-het.
 *
 * @returns { t_stat, mean_diff, n_het, n_nonhet, var_het, var_nonhet }
 *   with NaN for t_stat when either group has < 2 parents (under-powered)
 *   or when both variances are zero (degenerate).
 */
export function welchT(xsHet, xsNonhet) {
  // Under-powered: need ≥ 2 obs in each group for a meaningful variance.
  if (xsHet.length < 2 || xsNonhet.length < 2) {
    return {
      t_stat:     NaN,
      mean_diff:  (xsHet.length && xsNonhet.length) ? (_mean(xsHet) - _mean(xsNonhet)) : 0,
      n_het:      xsHet.length,
      n_nonhet:   xsNonhet.length,
      var_het:    0,
      var_nonhet: 0,
    };
  }
  const mh = _mean(xsHet);
  const mn = _mean(xsNonhet);
  const vh = _var(xsHet, mh);
  const vn = _var(xsNonhet, mn);
  const seDiff2 = vh / xsHet.length + vn / xsNonhet.length;
  // Identical-values case → t = 0 (mean_diff = 0, denom > 0 when at least
  // one group has variance). Fully-degenerate case (both vars = 0,
  // identical means) → t = 0 as well; otherwise NaN.
  let t = NaN;
  if (seDiff2 > 0) t = (mh - mn) / Math.sqrt(seDiff2);
  else if (mh === mn) t = 0;
  return {
    t_stat:     t,
    mean_diff:  mh - mn,
    n_het:      xsHet.length,
    n_nonhet:   xsNonhet.length,
    var_het:    vh,
    var_nonhet: vn,
  };
}

// ---------------------------------------------------------------------------
// Family-aware permutation
// ---------------------------------------------------------------------------

/**
 * Build {het, nonhet} CO-rate arrays for a given parent karyotype labeling
 * on tested_chrom. Used both for the observed statistic and inside the
 * permutation loop (with shuffled labels).
 */
function _splitRates(parentRateMap, testedChrom, karyoLabels) {
  const xsHet = [];
  const xsNonhet = [];
  for (const [parentId, kary] of karyoLabels) {
    const m = parentRateMap.get(parentId);
    if (!m) continue;
    const r = m.get(testedChrom);
    if (typeof r !== 'number') continue;
    if (kary === 'het') xsHet.push(r);
    else                xsNonhet.push(r);  // homA + homB combined
  }
  return { xsHet, xsNonhet };
}

/**
 * Fisher-Yates shuffle in place, using the supplied RNG.
 */
function _shuffleInPlace(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
  }
}

/**
 * Permute karyotype labels WITHIN each permutation_block. Preserves
 * sib-correlation: parents within the same family swap labels with each
 * other, never across families.
 *
 * @returns A new Map<parent_id, karyotype> with shuffled labels.
 */
export function permuteKaryotypes(karyoLabels, blocks, rng) {
  // Group parents by block.
  const byBlock = new Map();
  for (const [parentId, kary] of karyoLabels) {
    const block = blocks.get(parentId);
    if (block == null) continue;
    let g = byBlock.get(block);
    if (!g) { g = { parents: [], karyos: [] }; byBlock.set(block, g); }
    g.parents.push(parentId);
    g.karyos.push(kary);
  }
  // Shuffle karyos within each block, then re-emit.
  const out = new Map();
  for (const { parents, karyos } of byBlock.values()) {
    _shuffleInPlace(karyos, rng);
    for (let i = 0; i < parents.length; i++) out.set(parents[i], karyos[i]);
  }
  return out;
}

/**
 * Two-sided permutation p-value:
 *   p = (1 + #{ |t_perm| ≥ |t_obs| }) / (N + 1)
 * Add-one smoothing prevents p == 0 with finite N.
 *
 * @param computeT  () => number  (closure returning observed t)
 * @param permuteAndComputeT  (rng) => number  (closure returning permuted t)
 * @param nPerms    integer
 * @param rng       function returning float in [0, 1)
 * @returns { observed, perm_ts, p_value, n_perms_with_t }
 */
export function permTest(computeT, permuteAndComputeT, nPerms, rng) {
  const observed = computeT();
  if (!isFinite(observed)) {
    return { observed: NaN, perm_ts: [], p_value: NaN, n_perms_with_t: 0 };
  }
  const absObs = Math.abs(observed);
  const permTs = [];
  let nGe = 0;
  for (let i = 0; i < nPerms; i++) {
    const t = permuteAndComputeT(rng);
    if (isFinite(t)) {
      permTs.push(t);
      if (Math.abs(t) >= absObs) nGe += 1;
    }
  }
  const p = (1 + nGe) / (permTs.length + 1);
  return { observed, perm_ts: permTs, p_value: p, n_perms_with_t: permTs.length };
}

// ---------------------------------------------------------------------------
// Multiple-comparison correction
// ---------------------------------------------------------------------------

/**
 * Benjamini-Hochberg step-up adjustment. Returns an array of adjusted
 * p-values in the same order as the input.
 */
export function bhAdjust(pValues) {
  const n = pValues.length;
  if (n === 0) return [];
  // Pair each p with its original index, sort ascending by p.
  const indexed = pValues.map((p, i) => ({ p, i, valid: isFinite(p) }));
  const valid = indexed.filter(x => x.valid);
  valid.sort((a, b) => a.p - b.p);
  const m = valid.length;
  // BH step: q_(i) = p_(i) * m / rank; then enforce monotone non-decreasing from top.
  let running = 1;
  for (let r = m - 1; r >= 0; r--) {
    const adj = Math.min(running, valid[r].p * m / (r + 1));
    valid[r].q = adj;
    running = adj;
  }
  const out = new Array(n);
  for (const x of indexed) out[x.i] = NaN;
  for (const x of valid)   out[x.i] = x.q;
  return out;
}

/**
 * Bonferroni: q_i = min(1, p_i * n_tests).
 */
export function bonfAdjust(pValues) {
  const m = pValues.filter(p => isFinite(p)).length;
  return pValues.map(p => isFinite(p) ? Math.min(1, p * m) : NaN);
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

/**
 * Run the interchromosomal compute pipeline against the four envelopes.
 *
 * @param envelopes { cme, lic, fapd, cm }  — required envelopes
 *                  (cm is the coincidence_matrix envelope; reserved for
 *                  future C-statistic mode; not used in v1 which tests CO
 *                  rate only).
 * @param params {
 *   focal_inversion_id:   string,
 *   class_scope?:         { co: boolean, dco: boolean },  // default { co:true, dco:false }
 *   n_permutations:       integer,        // 1000 | 10000 | 100000
 *   rng?:                 () => number,   // default Math.random
 *   p_bh_alpha?:          number,         // default 0.05; drives the highlight flag
 * }
 * @returns {
 *   rows: [{ focal_inversion_id, tested_chrom, n_het, n_nonhet, mean_diff,
 *            t_stat, p_value, p_bonf, p_bh, sig_flag,
 *            local_inv_burden, is_focal_chrom }, ...],
 *   summary: { n_tests, n_sig_bh, focal_inversion_id, focal_chrom,
 *              class_scope, n_permutations },
 * }
 */
export function runInterchromosomalTests(envelopes, params) {
  const { cme, lic, fapd, cm } = envelopes;  // cm reserved for future use
  const classScope = params.class_scope || { co: true, dco: false };
  const nPerms = params.n_permutations || 10000;
  // RNG resolution: explicit rng > seed (auto-wrap with mulberry32) > Math.random.
  let rng = params.rng;
  if (!rng) {
    rng = (params.seed != null) ? mulberry32(params.seed) : Math.random;
  }
  const alpha = params.p_bh_alpha == null ? 0.05 : params.p_bh_alpha;

  const cmeRows  = (cme  && cme.payload  && cme.payload.events)      || [];
  const licRows  = (lic  && lic.payload  && lic.payload.controls)    || [];
  const fapdRows = (fapd && fapd.payload && fapd.payload.assignments) || [];

  // Auto-pick focal_inversion_id when not supplied: first distinct id in fapd
  // (sorted for stability). Used by smoke tests + the demo path.
  let focalId = params.focal_inversion_id;
  if (!focalId) {
    const all = new Set();
    for (const a of fapdRows) {
      if (a.focal_inversion_id) all.add(a.focal_inversion_id);
    }
    focalId = Array.from(all).sort()[0] || null;
  }
  if (!focalId) {
    return {
      rows: [],
      summary: {
        n_tests: 0, n_sig_bh: 0,
        focal_inversion_id: null, focal_chrom: null,
        class_scope: classScope, n_permutations: nPerms, p_bh_alpha: alpha,
      },
    };
  }

  const karyoLabels = karyotypesAtFocal(fapdRows, focalId);
  const blocks      = permutationBlocks(fapdRows, focalId);
  const focalChrom  = focalChromFromControls(licRows, focalId);
  const burden      = localInvBurdenByChrom(licRows);

  // Build per-parent CO rates indexed by chrom.
  const parentRateMap = parentCoRatesByChrom(cmeRows, classScope);

  // Set of tested chromosomes = union of chroms in cme payload.
  const testedChroms = Array.from(
    new Set(cmeRows.map(e => e.chrom).filter(Boolean))
  ).sort();

  // Per-chrom test rows (p-values first; correct afterwards).
  const tests = testedChroms.map(chrom => {
    // Observed t.
    const computeT = () => {
      const { xsHet, xsNonhet } = _splitRates(parentRateMap, chrom, karyoLabels);
      const w = welchT(xsHet, xsNonhet);
      return w.t_stat;
    };
    // Permuted t.
    const permuteAndComputeT = (r) => {
      const shuffled = permuteKaryotypes(karyoLabels, blocks, r);
      const { xsHet, xsNonhet } = _splitRates(parentRateMap, chrom, shuffled);
      const w = welchT(xsHet, xsNonhet);
      return w.t_stat;
    };
    // Observed summary for the row.
    const { xsHet, xsNonhet } = _splitRates(parentRateMap, chrom, karyoLabels);
    const obs = welchT(xsHet, xsNonhet);
    const perm = permTest(computeT, permuteAndComputeT, nPerms, rng);
    const b = burden.get(chrom) || { n_local_invs: 0, total_local_length_bp: 0 };
    return {
      focal_inversion_id:    focalId,
      tested_chrom:          chrom,
      is_focal_chrom:        focalChrom != null && chrom === focalChrom,
      n_het:                 obs.n_het,
      n_nonhet:              obs.n_nonhet,
      mean_diff:             obs.mean_diff,
      t_stat:                obs.t_stat,
      p_value:               perm.p_value,
      local_inv_burden:      b,
    };
  });

  // Multiple-comparison correction across the tests (skip focal-chrom from
  // the alpha control since the test is biologically asking about OTHER
  // chromosomes — but the focal row is still reported so the user can see
  // intra-chromosomal effect strength).
  const offFocal = tests.filter(t => !t.is_focal_chrom);
  const pvals = offFocal.map(t => t.p_value);
  const pBh   = bhAdjust(pvals);
  const pBonf = bonfAdjust(pvals);
  let j = 0;
  for (const t of tests) {
    if (t.is_focal_chrom) {
      t.p_bonf  = NaN;
      t.p_bh    = NaN;
      t.sig_flag = false;
    } else {
      t.p_bonf  = pBonf[j];
      t.p_bh    = pBh[j];
      t.sig_flag = isFinite(t.p_bh) && t.p_bh < alpha;
      j += 1;
    }
  }

  const n_sig_bh = tests.filter(t => t.sig_flag).length;
  return {
    rows: tests,
    summary: {
      n_tests:            offFocal.length,
      n_sig_bh:           n_sig_bh,
      focal_inversion_id: focalId,
      focal_chrom:        focalChrom,
      class_scope:        classScope,
      n_permutations:     nPerms,
      p_bh_alpha:         alpha,
    },
  };
}
