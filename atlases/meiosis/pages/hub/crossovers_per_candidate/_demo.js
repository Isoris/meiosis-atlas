// atlases/meiosis/pages/hub/crossovers_per_candidate/_demo.js
// =============================================================================
// Synthetic crossover_track payload for the page's DEMO MODE.
//
// Activates via ?demo=1 or localStorage.atlasDemoMode=1 (same convention as
// interchromosomal/_demo.js). NOT loaded in normal sessions; smoke tests
// import the payload directly as a fixture.
//
// Fixture shape mirrors the documented crossover_track_v1 layer:
//   {
//     candidate_id, candidate_span: {chrom, start_bp, end_bp},
//     chrom_lengths: {<chrom>: bp},
//     events: [{chrom, pos_bp, sex, ...}],
//     prdm9_motif?: { pwm: [[a,c,g,t], ...] }
//   }
//
// Designed payload: host chrom C_gar_LG28 (~20 Mb); the candidate is a
// hetero-inversion at 5–8 Mb. 24 CO events scattered across the chrom,
// 12 ♀ + 12 ♂ — with NONE inside the candidate span (the "CO suppressed
// in the inversion" signal). Plus a 4-row toy PRDM9 PWM for View 3.
// =============================================================================

export function isDemoMode(ctx) {
  if (ctx && ctx.demo === true) return true;
  if (typeof window !== 'undefined') {
    try {
      const usp = new URLSearchParams(window.location.search);
      if (usp.get('demo') === '1') return true;
    } catch (_) { /* SSR / no window */ }
    try {
      if (window.localStorage && window.localStorage.getItem('atlasDemoMode') === '1') return true;
    } catch (_) { /* private mode */ }
  }
  return false;
}

const HOST_CHROM = 'C_gar_LG28';
const HOST_LEN_BP = 19_700_000;
const FLANK_CHROM = 'C_gar_LG02';
const FLANK_LEN_BP = 25_000_000;
const SPAN_START_BP = 5_000_000;
const SPAN_END_BP   = 8_000_000;

// Hand-laid positions so the ideogram shows visible telomere clustering +
// CO suppression in the candidate band. Outside-band positions chosen on
// both arms so the telomere curve has clear telomere-biased peaks.
const EVENTS = [
  // ♀ events — telomere-biased outside the span
  { chrom: HOST_CHROM, pos_bp:    900_000, sex: 'F' },
  { chrom: HOST_CHROM, pos_bp:  2_400_000, sex: 'F' },
  { chrom: HOST_CHROM, pos_bp:  3_600_000, sex: 'F' },
  { chrom: HOST_CHROM, pos_bp:  4_400_000, sex: 'F' },
  { chrom: HOST_CHROM, pos_bp: 10_200_000, sex: 'F' },
  { chrom: HOST_CHROM, pos_bp: 14_100_000, sex: 'F' },
  { chrom: HOST_CHROM, pos_bp: 16_400_000, sex: 'F' },
  { chrom: HOST_CHROM, pos_bp: 17_200_000, sex: 'F' },
  { chrom: HOST_CHROM, pos_bp: 18_100_000, sex: 'F' },
  { chrom: HOST_CHROM, pos_bp: 18_900_000, sex: 'F' },
  { chrom: HOST_CHROM, pos_bp:  1_100_000, sex: 'F' },
  { chrom: HOST_CHROM, pos_bp: 16_900_000, sex: 'F' },
  // ♂ events — milder telomere bias
  { chrom: HOST_CHROM, pos_bp:  2_700_000, sex: 'M' },
  { chrom: HOST_CHROM, pos_bp:  4_700_000, sex: 'M' },
  { chrom: HOST_CHROM, pos_bp:  9_400_000, sex: 'M' },
  { chrom: HOST_CHROM, pos_bp: 11_200_000, sex: 'M' },
  { chrom: HOST_CHROM, pos_bp: 12_500_000, sex: 'M' },
  { chrom: HOST_CHROM, pos_bp: 13_300_000, sex: 'M' },
  { chrom: HOST_CHROM, pos_bp: 15_800_000, sex: 'M' },
  { chrom: HOST_CHROM, pos_bp: 17_600_000, sex: 'M' },
  { chrom: HOST_CHROM, pos_bp: 18_200_000, sex: 'M' },
  { chrom: HOST_CHROM, pos_bp:    600_000, sex: 'M' },
  { chrom: HOST_CHROM, pos_bp: 16_300_000, sex: 'M' },
  { chrom: HOST_CHROM, pos_bp: 19_500_000, sex: 'M' },
  // 2 cross-chrom flank events (just so the ideogram shows a second row)
  { chrom: FLANK_CHROM, pos_bp:  3_200_000, sex: 'F' },
  { chrom: FLANK_CHROM, pos_bp: 22_500_000, sex: 'M' },
];

// Toy PRDM9 PWM — 8 columns of (A, C, G, T) probabilities. Strong CCG/CCT
// preference around the centre to give the logo card visible peaks.
const PRDM9_PWM = [
  [0.10, 0.60, 0.20, 0.10],
  [0.05, 0.80, 0.10, 0.05],
  [0.05, 0.85, 0.05, 0.05],
  [0.20, 0.10, 0.10, 0.60],
  [0.25, 0.40, 0.10, 0.25],
  [0.10, 0.70, 0.15, 0.05],
  [0.30, 0.20, 0.30, 0.20],
  [0.10, 0.55, 0.20, 0.15],
];

export const DEMO_CROSSOVER_PAYLOAD = {
  candidate_id: 'INV_DEMO_LG28',
  candidate_span: {
    chrom:    HOST_CHROM,
    start_bp: SPAN_START_BP,
    end_bp:   SPAN_END_BP,
  },
  chrom_lengths: {
    [HOST_CHROM]:  HOST_LEN_BP,
    [FLANK_CHROM]: FLANK_LEN_BP,
  },
  events: EVENTS,
  prdm9_motif: { pwm: PRDM9_PWM },
};
