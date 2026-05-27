// atlases/relatedness/shared/inversion_meiosis.js
// =============================================================================
// Focal-inversion × meiosis analysis. Implements the "interchromosomal effect"
// scan: for each focal inversion candidate, compares the coefficient of
// coincidence on every tested chromosome between carriers and matched non-
// carriers, using a family-aware permutation null.
//
// Source of truth for the result schema (one row per focal_inv × tested_chr):
//
//   focal_inv  focal_chr  tested_chr  relation        n_carriers
//   n_controls   C_carrier  C_control  delta_C  p_perm
//   carrier_share_in_hub      local_inv_controlled    status
//
// where relation ∈ {'intra', 'inter'}.
//
// IMPORTANT WARNING: when carriers concentrate in one family hub, comparing
// carriers to "everyone else" measures the family, not the inversion. The
// permutation shuffles labels within family hubs so the null preserves
// family structure / meiosis count / carrier count.
//
// Readiness ladder (per the user's design):
//   basic_ready       carriers vs non-carriers possible
//   family_ready      family / hub labels available  → permutation null
//   controlled_ready  other inversion karyotypes available → can residualise
//   interaction_ready enough N for pairwise inversion × inversion tests
//   phenotype_ready   phenotype / survival / fertility table loaded
//
// All math is deliberately small and decoupled from the page so a real
// per-dyad CO/DCO envelope (ngsPedigree Stage 3 / ngsTracts) can be swapped
// in by replacing baselineCoincidenceAndN() and carrierEffect() without
// touching the page code.
// =============================================================================

import { DEMO } from '../../relatedness/shared/demo_data.js';
import { hashStr } from '../../relatedness/shared/utils.js';
import {
  windowsForChrom, pairsForChrom, coincidence, coRatePerMeiosis,
} from './recomb_data.js';

// ─── Group construction ─────────────────────────────────────────────────

export function carriersOf(invId) {
  return DEMO.individuals.filter(ind => {
    const k = (DEMO.karyotype_matrix[ind] || {})[invId];
    return k === '0/1' || k === '1/1';
  });
}
export function controlsOf(invId) {
  return DEMO.individuals.filter(ind => {
    const k = (DEMO.karyotype_matrix[ind] || {})[invId];
    return k === '0/0';
  });
}

// Parental-meiosis groups — the proper causal unit per the user's spec
// (2026-05-15). For each focal inversion, identify which individuals
// appear as parents in any triad and split them by their *own* karyotype
// at the focal candidate. Returns parents (with at least one observed
// meiosis in DEMO.triads), plus the offspring-count weights so the
// downstream tests use parent-meiosis as the unit rather than individual
// karyotype.
export function parentalCarriersOf(invId) {
  const seen = {};   // parent_id → n_meioses (offspring count)
  for (const t of DEMO.triads || []) {
    for (const p of [t.parent_a, t.parent_b]) {
      seen[p] = (seen[p] || 0) + 1;
    }
  }
  const all = Object.keys(seen);
  const car = [], con = [];
  for (const ind of all) {
    const k = (DEMO.karyotype_matrix[ind] || {})[invId];
    if (k === '0/1' || k === '1/1') car.push(ind);
    else if (k === '0/0') con.push(ind);
  }
  return { carriers: car, controls: con, meiosis_counts: seen };
}

// Total parental meioses across a group (sum of offspring counts).
export function parentalMeioses(group, meiosis_counts) {
  return group.reduce((s, ind) => s + (meiosis_counts[ind] || 0), 0);
}

// Dosage classes — the proper causal-genetic split. Heterokaryotypes show
// the strongest local pairing effects; homozygous-alt may show a different
// (often larger) interchromosomal modifier effect; carrier-vs-control alone
// hides any genotype-response pattern.
export function dosageGroups(invId) {
  const hom_ref = [], het = [], hom_alt = [];
  for (const ind of DEMO.individuals) {
    const k = (DEMO.karyotype_matrix[ind] || {})[invId];
    if (k === '0/0') hom_ref.push(ind);
    else if (k === '0/1') het.push(ind);
    else if (k === '1/1') hom_alt.push(ind);
  }
  return { hom_ref, het, hom_alt };
}

// Inversion burden = total number of non-reference inversion karyotypes
// per individual (het + hom_alt across every candidate). The "carriers
// also carry many other inversions" confound the user warned about.
export function inversionBurden(ind) {
  let n = 0;
  for (const inv of DEMO.inversion_candidates_full) {
    const k = (DEMO.karyotype_matrix[ind] || {})[inv.candidate];
    if (k === '0/1' || k === '1/1') n++;
  }
  return n;
}

export function familyOf(ind) {
  const f = (DEMO.families || []).find(f => (f.members || []).includes(ind));
  return f ? f.family_id : null;
}
export function focalChromOf(invId) {
  const inv = (DEMO.inversion_candidates_full || []).find(i => i.candidate === invId);
  return inv ? inv.chromosome : null;
}

// Carrier share inside the family hub with the most carriers — the diagnostic
// for "carriers concentrated in one family" that the user flagged.
export function carrierHubShare(carriers) {
  if (!carriers.length) return { hub: null, share: 0 };
  const counts = {};
  for (const c of carriers) {
    const f = familyOf(c) || '(none)';
    counts[f] = (counts[f] || 0) + 1;
  }
  let best = null, bestN = 0;
  for (const [f, n] of Object.entries(counts)) {
    if (n > bestN) { best = f; bestN = n; }
  }
  return { hub: best, share: bestN / carriers.length, count: bestN };
}

// Confounder profile — quantifies the imbalance between carriers and
// controls along three axes the user flagged as essential to control:
//   family-hub spread, mean ancestry vector, mean inversion burden.
export function confounderProfile(carriers, controls) {
  const meanQ = (group) => {
    if (!group.length) return [];
    const K = (DEMO.ancestry_q[group[0]] || []).length;
    const out = new Array(K).fill(0);
    for (const ind of group) {
      const q = DEMO.ancestry_q[ind] || [];
      for (let k = 0; k < K; k++) out[k] += (q[k] || 0);
    }
    return out.map(v => v / group.length);
  };
  const meanBurden = (group) =>
    group.length ? group.reduce((s, ind) => s + inversionBurden(ind), 0) / group.length : 0;
  const meanQ_c = meanQ(carriers);
  const meanQ_n = meanQ(controls);
  // L1 ancestry distance.
  let ancestry_l1 = 0;
  const K = Math.max(meanQ_c.length, meanQ_n.length);
  for (let k = 0; k < K; k++) {
    ancestry_l1 += Math.abs((meanQ_c[k] || 0) - (meanQ_n[k] || 0));
  }
  const burden_c = meanBurden(carriers);
  const burden_n = meanBurden(controls);
  const hubShare = carrierHubShare(carriers);
  // Per-hub carrier vs control balance.
  const hubBalance = {};
  const all = [...carriers, ...controls];
  for (const ind of all) {
    const f = familyOf(ind) || '(none)';
    if (!hubBalance[f]) hubBalance[f] = { carriers: 0, controls: 0 };
    if (carriers.includes(ind)) hubBalance[f].carriers++;
    else                         hubBalance[f].controls++;
  }
  return {
    ancestry_l1, mean_q_carrier: meanQ_c, mean_q_control: meanQ_n,
    burden_carrier: burden_c, burden_control: burden_n,
    burden_delta: burden_c - burden_n,
    hub_share: hubShare,
    hub_balance: hubBalance,
  };
}

// ─── Baseline observable ─────────────────────────────────────────────────

// Mean coincidence on a tested chromosome, with the count of informative
// window-pairs ("n_meioses-pair"-ish). Currently aggregate from
// DEMO.recomb_pairs; swap to per-dyad event tables when those land.
export function baselineCoincidenceAndN(testedChr) {
  const wins = windowsForChrom(testedChr);
  const pairs = pairsForChrom(testedChr);
  let sum = 0, n_finite = 0;
  for (const p of pairs) {
    const C = coincidence(p, wins);
    if (Number.isFinite(C)) { sum += C; n_finite++; }
  }
  return { C: n_finite ? sum / n_finite : NaN, n_pairs: n_finite };
}

// ─── Carrier effect ──────────────────────────────────────────────────────

// Per-individual contribution to the carrier effect on a tested chromosome.
// In the demo this is deterministic from a hash, so permutations produce
// real variability. When per-dyad CO/DCO calls arrive, replace the body
// with the aggregate over each individual's actual meioses on testedChr.
function _indvContribution(ind, testedChr, focal_chr) {
  const s = hashStr(ind + '|' + testedChr);
  // ±0.4 noise per individual; deterministic.
  const noise = ((Math.sin(s * 0.91827) + 1) * 0.5 - 0.5) * 0.40;
  // Intra-chromosome inversion suppression — concentrated on the focal chr.
  const intra_bias = (testedChr === focal_chr) ? -0.55 : 0;
  return noise + intra_bias;
}

// Mean effect across a group of individuals.
function _groupEffect(group, testedChr, focal_chr) {
  if (!group.length) return 0;
  let sum = 0;
  for (const ind of group) sum += _indvContribution(ind, testedChr, focal_chr);
  return sum / group.length;
}

// Carriers' C, given the baseline. Synthesised deterministically from the
// carrier set; if the carrier set changes (permutation), the effect changes.
export function carrierC(carriers, testedChr, focal_chr, baseline_C) {
  return baseline_C + _groupEffect(carriers, testedChr, focal_chr);
}
export function controlC(controls, testedChr, focal_chr, baseline_C) {
  // Use a much smaller residual effect for the controls (only noise, no
  // intra-bias since controls don't carry the focal arrangement).
  let sum = 0;
  for (const ind of controls) {
    const s = hashStr(ind + '|' + testedChr);
    sum += ((Math.sin(s * 0.13971) + 1) * 0.5 - 0.5) * 0.05;
  }
  return baseline_C + (controls.length ? sum / controls.length : 0);
}

// ─── Family-aware permutation null ──────────────────────────────────────

// Shuffle carrier / non-carrier labels within each family hub, preserving
// each hub's carrier count. Returns a new carrier set the same size as
// the original.
function _permuteWithinHubs(carriers, controls) {
  const all = [...carriers, ...controls];
  // Group by family.
  const byFam = {};
  for (const ind of all) {
    const f = familyOf(ind) || '(none)';
    if (!byFam[f]) byFam[f] = { members: [], n_carrier: 0 };
    byFam[f].members.push(ind);
    if (carriers.includes(ind)) byFam[f].n_carrier++;
  }
  const out = [];
  for (const f of Object.keys(byFam)) {
    const fam = byFam[f];
    // Fisher–Yates shuffle.
    const arr = fam.members.slice();
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    out.push(...arr.slice(0, fam.n_carrier));
  }
  return out;
}

// Two-sided permutation p-value for delta_C on a single (focal, tested_chr).
export function permutationP(carriers, controls, testedChr, focal_chr,
                              baseline_C, observed_delta, n_perm = 1000) {
  if (!carriers.length || !controls.length) return NaN;
  let n_extreme = 0;
  for (let i = 0; i < n_perm; i++) {
    const perm_car = _permuteWithinHubs(carriers, controls);
    const perm_con = [...carriers, ...controls].filter(x => !perm_car.includes(x));
    const c_car = carrierC(perm_car, testedChr, focal_chr, baseline_C);
    const c_con = controlC(perm_con, testedChr, focal_chr, baseline_C);
    const delta = c_car - c_con;
    if (Math.abs(delta) >= Math.abs(observed_delta) - 1e-9) n_extreme++;
  }
  return (n_extreme + 1) / (n_perm + 1);
}

// ─── Readiness ladder ──────────────────────────────────────────────────

export function readinessLevels(focal_inv_id) {
  const carriers = carriersOf(focal_inv_id);
  const controls = controlsOf(focal_inv_id);
  const focal_chr = focalChromOf(focal_inv_id);
  // basic_ready: both groups non-empty
  const basic_ready = carriers.length > 0 && controls.length > 0;
  // family_ready: ≥ 2 families have at least one carrier
  const hubs = new Set(carriers.map(c => familyOf(c)).filter(Boolean));
  const family_ready = hubs.size >= 2;
  // controlled_ready: at least 1 other inversion candidate on a tested chrom
  const other_invs = DEMO.inversion_candidates_full
    .filter(i => i.candidate !== focal_inv_id && i.chromosome !== focal_chr).length;
  const controlled_ready = other_invs >= 1;
  // interaction_ready: at least 6 carriers and 6 controls
  const interaction_ready = carriers.length >= 6 && controls.length >= 6;
  // phenotype_ready: DEMO.phenotype present
  const phenotype_ready = !!(DEMO.phenotype && Object.keys(DEMO.phenotype).length);
  return {
    basic_ready, family_ready, controlled_ready, interaction_ready, phenotype_ready,
    n_carriers: carriers.length, n_controls: controls.length,
    n_hubs: hubs.size, n_other_invs: other_invs,
  };
}

// ─── Driver — one row per tested chromosome ─────────────────────────────

export function runFocalScan(focal_inv_id, opts = {}) {
  const scope     = opts.scope     || 'both';        // 'intra' / 'inter' / 'both'
  const n_perm    = opts.n_perm    || 1000;
  const control_local = !!opts.control_local;
  const unit      = opts.unit      || 'individual';  // 'individual' | 'parental_meiosis'
  const focal_chr = focalChromOf(focal_inv_id);
  let carriers, controls, parental;
  if (unit === 'parental_meiosis') {
    parental = parentalCarriersOf(focal_inv_id);
    carriers = parental.carriers;
    controls = parental.controls;
  } else {
    carriers = carriersOf(focal_inv_id);
    controls = controlsOf(focal_inv_id);
  }
  const hubShare = carrierHubShare(carriers);
  const tested = DEMO.chromosomes.filter(c => {
    if (scope === 'intra') return c === focal_chr;
    if (scope === 'inter') return c !== focal_chr;
    return true;
  });
  const rows = [];
  for (const tc of tested) {
    const { C: base_C, n_pairs } = baselineCoincidenceAndN(tc);
    if (!Number.isFinite(base_C)) {
      rows.push({
        focal_inv: focal_inv_id, focal_chr, tested_chr: tc,
        relation: tc === focal_chr ? 'intra' : 'inter',
        n_carriers: carriers.length, n_controls: controls.length,
        n_pairs, C_carrier: NaN, C_control: NaN,
        delta_C: NaN, p_perm: NaN, carrier_share_in_hub: hubShare.share,
        local_inv_controlled: control_local,
        status: 'no_data',
      });
      continue;
    }
    const C_c = carrierC(carriers, tc, focal_chr, base_C);
    const C_n = controlC(controls, tc, focal_chr, base_C);
    const delta = C_c - C_n;
    const p = permutationP(carriers, controls, tc, focal_chr, base_C, delta, n_perm);
    rows.push({
      focal_inv: focal_inv_id, focal_chr, tested_chr: tc,
      relation: tc === focal_chr ? 'intra' : 'inter',
      n_carriers: carriers.length, n_controls: controls.length,
      n_pairs,
      C_carrier: C_c, C_control: C_n, delta_C: delta, p_perm: p,
      carrier_share_in_hub: hubShare.share,
      local_inv_controlled: control_local,
      status: _classify(delta, p, hubShare.share),
    });
  }
  return {
    focal_inv: focal_inv_id, focal_chr,
    n_carriers: carriers.length, n_controls: controls.length,
    hub_share: hubShare,
    scope, n_perm, control_local, unit,
    n_carrier_meioses: parental ? parentalMeioses(carriers, parental.meiosis_counts) : null,
    n_control_meioses: parental ? parentalMeioses(controls, parental.meiosis_counts) : null,
    rows,
  };
}

function _classify(delta, p, hubShare) {
  if (!Number.isFinite(delta) || !Number.isFinite(p)) return 'no_data';
  if (hubShare >= 0.80)        return 'family_confounded';
  if (p < 0.01 && Math.abs(delta) >= 0.30) return 'strong_effect';
  if (p < 0.05 && Math.abs(delta) >= 0.15) return 'moderate_effect';
  if (p < 0.05)                return 'weak_effect';
  return 'no_effect';
}

export const STATUS_LABEL = {
  no_data:           'NO DATA',
  family_confounded: 'FAMILY CONFOUNDED',
  strong_effect:     'STRONG EFFECT',
  moderate_effect:   'MODERATE EFFECT',
  weak_effect:       'WEAK EFFECT',
  no_effect:         'NO EFFECT',
};

// ─── Per-family direction-consistency scan ──────────────────────────────
//
// For each family with at least one carrier and one control, compute the
// within-family delta_C on the tested chromosome. Direction-consistent
// effects across multiple families are much stronger evidence than a
// single pooled significant test.
export function perFamilyScan(focal_inv_id, tested_chr) {
  const carriers = carriersOf(focal_inv_id);
  const controls = controlsOf(focal_inv_id);
  const focal_chr = focalChromOf(focal_inv_id);
  const { C: base_C } = baselineCoincidenceAndN(tested_chr);
  if (!Number.isFinite(base_C)) return [];
  const allFams = new Set([...carriers, ...controls].map(familyOf).filter(Boolean));
  const out = [];
  for (const fam of allFams) {
    const fam_c = carriers.filter(ind => familyOf(ind) === fam);
    const fam_n = controls.filter(ind => familyOf(ind) === fam);
    if (!fam_c.length || !fam_n.length) {
      out.push({ family: fam, n_c: fam_c.length, n_n: fam_n.length,
                 C_carrier: NaN, C_control: NaN, delta_C: NaN, direction: 'no_data' });
      continue;
    }
    const C_c = carrierC(fam_c, tested_chr, focal_chr, base_C);
    const C_n = controlC(fam_n, tested_chr, focal_chr, base_C);
    const d = C_c - C_n;
    out.push({
      family: fam, n_c: fam_c.length, n_n: fam_n.length,
      C_carrier: C_c, C_control: C_n, delta_C: d,
      direction: d > 0.05 ? 'positive' : (d < -0.05 ? 'negative' : 'flat'),
    });
  }
  return out;
}

// Direction-consistency score: fraction of informative families (n_c & n_n
// both >= 1) that share the same sign as the pooled delta_C.
export function directionConsistency(perFam, pooled_delta) {
  const informative = perFam.filter(r => Number.isFinite(r.delta_C));
  if (!informative.length) return { n_informative: 0, n_concordant: 0, score: NaN };
  const sign = pooled_delta > 0 ? 1 : (pooled_delta < 0 ? -1 : 0);
  if (sign === 0) return { n_informative: informative.length, n_concordant: 0, score: 0 };
  const concordant = informative.filter(r => Math.sign(r.delta_C) === sign).length;
  return {
    n_informative: informative.length,
    n_concordant: concordant,
    score: concordant / informative.length,
  };
}

// ─── Negative-control null (random fake-label sets) ─────────────────────
//
// Generates K random "fake focal" label sets with the same number of
// carriers as the real focal inversion, sampled from the full sample
// list (not restricted within hubs — this is the negative control, not
// the family-aware permutation null). Each fake set is run through the
// same scan; the resulting null distribution of |delta_C| is what the
// observed |delta_C| should beat to be a real signal vs a method
// artefact.
export function negativeControlNull(focal_inv_id, tested_chr, n_fake = 200) {
  const focal_chr = focalChromOf(focal_inv_id);
  const carriers = carriersOf(focal_inv_id);
  const all = DEMO.individuals.slice();
  const { C: base_C } = baselineCoincidenceAndN(tested_chr);
  if (!Number.isFinite(base_C) || carriers.length < 1) {
    return { n_fake: 0, mean_abs_delta: NaN, p_outside: NaN, samples: [] };
  }
  const observed = (() => {
    const cs = carriers, ns = controlsOf(focal_inv_id);
    const C_c = carrierC(cs, tested_chr, focal_chr, base_C);
    const C_n = controlC(ns, tested_chr, focal_chr, base_C);
    return Math.abs(C_c - C_n);
  })();
  const samples = [];
  let n_ge = 0;
  for (let i = 0; i < n_fake; i++) {
    const shuffled = all.slice();
    for (let j = shuffled.length - 1; j > 0; j--) {
      const k = Math.floor(Math.random() * (j + 1));
      [shuffled[j], shuffled[k]] = [shuffled[k], shuffled[j]];
    }
    const fake_c = shuffled.slice(0, carriers.length);
    const fake_n = shuffled.slice(carriers.length);
    const C_c = carrierC(fake_c, tested_chr, focal_chr, base_C);
    const C_n = controlC(fake_n, tested_chr, focal_chr, base_C);
    const abs_d = Math.abs(C_c - C_n);
    samples.push(abs_d);
    if (abs_d >= observed - 1e-9) n_ge++;
  }
  const mean = samples.length ? samples.reduce((a,b) => a+b, 0) / samples.length : NaN;
  return {
    observed_abs_delta: observed,
    mean_abs_delta: mean,
    p_outside: (n_ge + 1) / (n_fake + 1),
    n_fake, samples,
  };
}

// ─── Causal ladder ──────────────────────────────────────────────────────
//
// Per the user's framework (2026-05-15):
//
//   Level 0: association only — at least one tested chromosome shows
//             a raw |delta_C| above an effect threshold.
//   Level 1: family-aware permutation null passed (p_perm < 0.05).
//   Level 2: confounder controls clean — ancestry L1 small, burden delta
//             small, no FAMILY CONFOUNDED row driving the result.
//   Level 3: same direction across ≥3 informative families on the
//             leading tested chromosome (direction consistency ≥ 0.66).
//   Level 4: mechanistic coherence — intra-chromosomal effect larger
//             than typical inter, OR a clean dose pattern het ↑ vs
//             hom_ref baseline.
//   Level 5: experimental — out of scope for WGS, requires controlled
//             crosses.
//
// Returns { level, reasons[] } so the page can show what would be
// needed to climb to the next level.
export function causalLadder(scan_result, opts = {}) {
  const reasons = [];
  if (!scan_result || !scan_result.rows || !scan_result.rows.length) {
    return { level: 0, reasons: ['no scan results yet'] };
  }
  const rows = scan_result.rows;
  const informative = rows.filter(r => Number.isFinite(r.delta_C));
  if (!informative.length) return { level: 0, reasons: ['no informative tested chromosomes'] };

  // Level 0
  const any_assoc = informative.some(r => Math.abs(r.delta_C) >= 0.15);
  if (!any_assoc) return { level: 0, reasons: ['no |delta_C| >= 0.15 anywhere'] };
  reasons.push('Level 0 ✓ at least one |ΔC| ≥ 0.15');

  // Level 1
  const any_sig = informative.some(r => Number.isFinite(r.p_perm) && r.p_perm < 0.05);
  if (!any_sig) return { level: 0, reasons: [...reasons, 'no p_perm < 0.05 (family-aware null)'] };
  reasons.push('Level 1 ✓ family-aware p_perm < 0.05');

  // Level 2 — confounder controls
  const conf = opts.confounders;
  const fam_confounded = informative.some(r => r.status === 'family_confounded');
  const ancestry_clean = !conf || conf.ancestry_l1 < 0.50;
  const burden_clean   = !conf || Math.abs(conf.burden_delta) < 1.5;
  if (fam_confounded || !ancestry_clean || !burden_clean) {
    return { level: 1, reasons: [...reasons,
      fam_confounded   ? 'Level 2 ✗ at least one row is FAMILY CONFOUNDED' : null,
      !ancestry_clean  ? `Level 2 ✗ ancestry L1 = ${conf.ancestry_l1.toFixed(2)} ≥ 0.50` : null,
      !burden_clean    ? `Level 2 ✗ |burden delta| = ${Math.abs(conf.burden_delta).toFixed(2)} ≥ 1.5` : null,
    ].filter(Boolean) };
  }
  reasons.push('Level 2 ✓ ancestry / burden / family-balance clean');

  // Level 3 — direction consistency on the leading row
  const leading = informative.slice().sort((a,b) => Math.abs(b.delta_C) - Math.abs(a.delta_C))[0];
  const perFam = perFamilyScan(scan_result.focal_inv, leading.tested_chr);
  const cons = directionConsistency(perFam, leading.delta_C);
  if (!(cons.n_informative >= 3 && cons.score >= 0.66)) {
    return { level: 2, reasons: [...reasons,
      `Level 3 ✗ direction consistency on ${leading.tested_chr}: ${cons.n_concordant}/${cons.n_informative} `
        + `informative families (need ≥3 informative, ≥0.66 concordance)`] };
  }
  reasons.push(`Level 3 ✓ ${cons.n_concordant}/${cons.n_informative} families concordant on ${leading.tested_chr}`);

  // Level 4 — mechanistic coherence
  // Intra effect should be larger than the inter median (when both exist),
  // or the dose pattern (het vs hom_alt) should be monotone.
  const intra = informative.filter(r => r.relation === 'intra');
  const inter = informative.filter(r => r.relation === 'inter');
  const intra_max = intra.length ? Math.max(...intra.map(r => Math.abs(r.delta_C))) : 0;
  const inter_med = inter.length ? _median(inter.map(r => Math.abs(r.delta_C))) : 0;
  const intra_dom = intra.length && inter.length && intra_max >= 1.5 * inter_med;
  if (!intra_dom) {
    return { level: 3, reasons: [...reasons,
      `Level 4 ✗ intra max |ΔC|=${intra_max.toFixed(2)} not ≥ 1.5 × inter median |ΔC|=${inter_med.toFixed(2)}`] };
  }
  reasons.push(`Level 4 ✓ intra max |ΔC| ≥ 1.5 × inter median`);

  // Level 5 is unreachable from observational data.
  return { level: 4, reasons: [...reasons,
    'Level 5 (experimental) is out of scope: controlled crosses required.'] };
}

function _median(arr) {
  if (!arr.length) return NaN;
  const s = arr.slice().sort((a,b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m-1] + s[m]) / 2;
}

export const CAUSAL_LEVEL_LABEL = {
  0: 'L0 · ASSOCIATION ONLY',
  1: 'L1 · FAMILY-AWARE NULL PASSED',
  2: 'L2 · CONFOUNDER CONTROLS CLEAN',
  3: 'L3 · DIRECTION CONSISTENT ACROSS FAMILIES',
  4: 'L4 · MECHANISTIC COHERENCE',
  5: 'L5 · EXPERIMENTAL (out of scope)',
};
