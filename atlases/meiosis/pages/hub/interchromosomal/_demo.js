// atlases/meiosis/pages/hub/interchromosomal/_demo.js
// =============================================================================
// Synthetic envelopes for the interchromosomal page's DEMO MODE.
//
// Demo mode is OFF by default. Activate via either:
//   - URL query string:  ?demo=1
//   - localStorage:      localStorage.setItem('atlasDemoMode', '1')
//
// When activated, mount() loads these envelopes instead of probing the
// workspace layers index. Result: the page renders a full result table
// with one row designed to be statistically significant under the
// default permutation null + seed.
//
// The synthetic data does NOT enter normal sessions — only when the
// user explicitly opts in. The same envelopes are imported by the smoke
// test as a fixture.
// =============================================================================

// Detect demo mode from URL query, localStorage, or the explicit `demo`
// key in the page-mount ctx (lets parents force-enable for previews).
export function isDemoMode(ctx) {
  if (ctx && ctx.demo === true) return true;
  if (typeof window !== 'undefined') {
    try {
      const usp = new URLSearchParams(window.location.search);
      if (usp.get('demo') === '1') return true;
    } catch (_) { /* SSR / no window — ignore */ }
    try {
      if (window.localStorage && window.localStorage.getItem('atlasDemoMode') === '1') return true;
    } catch (_) { /* private mode */ }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Synthetic envelopes.
//
// Layout:
//   focal inversion INV_A on chrom LG01 (5 carrier het parents, 5 non-het).
//   Tested chroms: LG01 (the focal — should NOT enter alpha control),
//                  LG07 (the SIGNIFICANT effect — het carriers have
//                        elevated CO rate on LG07),
//                  LG12 (null — no effect).
//   Each parent has 4 offspring (n_co counts per parent shown).
//
// Designed so welchT(LG07, het vs non-het) has |t| ≈ 3-4 → permutation
// p < 0.01 with 10k perms.
// ---------------------------------------------------------------------------

const HET_PARENTS    = ['P_HET_1', 'P_HET_2', 'P_HET_3', 'P_HET_4', 'P_HET_5'];
const NONHET_PARENTS = ['P_HOM_1', 'P_HOM_2', 'P_HOM_3', 'P_HOM_4', 'P_HOM_5'];

const PARENT_TO_FAMILY = {
  P_HET_1: 'F1', P_HOM_1: 'F1',
  P_HET_2: 'F2', P_HOM_2: 'F2',
  P_HET_3: 'F3', P_HOM_3: 'F3',
  P_HET_4: 'F4', P_HOM_4: 'F4',
  P_HET_5: 'F5', P_HOM_5: 'F5',
};

// CO counts per (parent, chrom) on a fixed chrom_len_bp = 50_000_000.
// LG01: het ~6/50Mb, nonhet ~6/50Mb (no effect on focal chrom)
// LG07: het ~9/50Mb, nonhet ~4/50Mb (THE significant effect)
// LG12: het ~5/50Mb, nonhet ~5/50Mb (null)
const CHROM_LEN_BP = 50_000_000;
const RATES = {
  LG01: { P_HET_1: 6, P_HET_2: 7, P_HET_3: 5, P_HET_4: 6, P_HET_5: 7,
          P_HOM_1: 6, P_HOM_2: 5, P_HOM_3: 7, P_HOM_4: 6, P_HOM_5: 5 },
  LG07: { P_HET_1: 9, P_HET_2: 10, P_HET_3: 8, P_HET_4: 9, P_HET_5: 11,
          P_HOM_1: 4, P_HOM_2: 5, P_HOM_3: 3, P_HOM_4: 4, P_HOM_5: 5 },
  LG12: { P_HET_1: 5, P_HET_2: 6, P_HET_3: 4, P_HET_4: 5, P_HET_5: 5,
          P_HOM_1: 5, P_HOM_2: 4, P_HOM_3: 6, P_HOM_4: 5, P_HOM_5: 4 },
};

function _buildCmeEvents() {
  const out = [];
  const chroms = Object.keys(RATES);
  for (const chrom of chroms) {
    for (const [parent, n_co] of Object.entries(RATES[chrom])) {
      // Pair with a single offspring per parent for the smoke; production data
      // would carry one row per offspring, but the rate aggregation sums
      // across them — equivalent end result for the test.
      out.push({
        parent_id:    parent,
        offspring_id: `${parent}_off`,
        chrom:        `C_gar_${chrom}`,
        chrom_len_bp: CHROM_LEN_BP,
        n_co:         n_co,
        n_dco:        0,
        n_nco:        20,
        co_per_mb:    n_co / CHROM_LEN_BP * 1e6,
        dco_per_mb:   0,
      });
    }
  }
  return out;
}

function _buildFapdAssignments() {
  const out = [];
  // INV_A on chrom LG01 (focal)
  for (const p of HET_PARENTS) {
    out.push({
      focal_inversion_id: 'INV_A',
      parent_id:          p,
      family_id:          PARENT_TO_FAMILY[p],
      karyotype:          'het',
      permutation_block:  PARENT_TO_FAMILY[p],
      n_offspring:        4,
    });
  }
  for (const p of NONHET_PARENTS) {
    out.push({
      focal_inversion_id: 'INV_A',
      parent_id:          p,
      family_id:          PARENT_TO_FAMILY[p],
      karyotype:          'homA',
      permutation_block:  PARENT_TO_FAMILY[p],
      n_offspring:        4,
    });
  }
  return out;
}

function _buildLicControls() {
  // Focal INV_A is on LG01; the local_inv_controls includes a row with
  // inversion_chrom=LG01 + inversion_id=INV_A so the page can derive
  // focal_chrom. Plus one minor local inv on LG12 (low burden) just so
  // the burden map has > 1 chrom entry.
  return [
    {
      tested_chrom:    'C_gar_LG01',
      inversion_id:    'INV_A',
      inversion_chrom: 'C_gar_LG01',
      start_bp:        12_000_000,
      end_bp:          14_000_000,
      length_bp:       2_000_001,
      frequency:       0.5,
      n_het_carriers:  5,
    },
    {
      tested_chrom:    'C_gar_LG12',
      inversion_id:    'INV_minor',
      inversion_chrom: 'C_gar_LG12',
      start_bp:        20_000_000,
      end_bp:          21_000_000,
      length_bp:       1_000_001,
      frequency:       0.08,
      n_het_carriers:  1,
    },
  ];
}

function _buildCoincidencePairs() {
  // Not used by v1 stats engine; included so the envelope-probe path is
  // satisfied. Keep tiny.
  return [
    {
      chrom:         'C_gar_LG07',
      interval_a_id: 'LG07_W1',
      interval_b_id: 'LG07_W2',
      c_coincidence: 0.4,
      neg_interference_flagged: false,
    },
  ];
}

// Keys MUST match the short-form used by runInterchromosomalTests'
// destructuring and by interchromosomal.js mount(): cme / lic / fapd / cm.
export const DEMO_ENVELOPES = {
  cme: {
    layer_id: 'demo_cme_v1',
    layer_type: 'chromosome_meiosis_events',
    schema_version: 'chromosome_meiosis_events_v1',
    stage: 'normalized',
    payload: {
      events:  _buildCmeEvents(),
      summary: {
        n_rows:               30,
        n_dyads:              10,
        n_chroms:             3,
        sum_n_co:             156,
        sum_n_dco:            0,
        sum_n_nco:            600,
        karyotype_strat_rows: 0,
      },
    },
  },
  lic: {
    layer_id: 'demo_lic_v1',
    layer_type: 'local_inv_controls',
    schema_version: 'local_inv_controls_v1',
    stage: 'normalized',
    payload: {
      controls: _buildLicControls(),
      summary: {
        n_controls:             2,
        n_chroms:               2,
        n_inversions:           2,
        n_chroms_with_controls: 2,
        mean_inv_per_chrom:     1.0,
      },
    },
  },
  fapd: {
    layer_id: 'demo_fapd_v1',
    layer_type: 'family_aware_permutation_design',
    schema_version: 'family_aware_permutation_design_v1',
    stage: 'normalized',
    payload: {
      assignments: _buildFapdAssignments(),
      summary: {
        n_assignments:        10,
        n_focal_inversions:   1,
        n_families:           5,
        n_permutation_blocks: 5,
        n_parents:            10,
        karyotype_counts:     { homA: 5, het: 5, homB: 0 },
        n_singleton_blocks:   0,
      },
    },
  },
  cm: {
    layer_id: 'demo_cm_v1',
    layer_type: 'coincidence_matrix',
    schema_version: 'coincidence_matrix_v1',
    stage: 'normalized',
    payload: {
      pairs: _buildCoincidencePairs(),
      summary: {
        n_pairs:                    1,
        n_chroms:                   1,
        n_focal_inversions:         0,
        n_stratified_rows:          0,
        karyotype_counts:           { homA: 0, het: 0, homB: 0 },
        mean_c:                     0.4,
        median_c:                   0.4,
        n_neg_interference_flagged: 0,
        neg_interference_threshold: 3.0,
      },
    },
  },
};
