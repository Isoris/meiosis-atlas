// atlases/meiosis/pages/hub/nco_per_candidate/_demo.js
// =============================================================================
// Synthetic nco_gc_track payload for the page's DEMO MODE.
// Sister of crossovers_per_candidate/_demo.js. Activates via ?demo=1 or
// localStorage.atlasDemoMode=1. NOT loaded in normal sessions.
//
// Fixture shape mirrors the documented nco_gc_track_v1 layer:
//   {
//     candidate_id, candidate_span: {chrom, start_bp, end_bp},
//     chrom_lengths: {<chrom>: bp},
//     tracts: [{chrom, start_bp, end_bp, kind: 'nco'|'gc', ...}]
//   }
//
// Designed payload: host C_gar_LG28 + the same candidate at 5–8 Mb. 14
// NCO tracts + 8 GC tracts scattered such that SOME tracts ARE inside
// the candidate span (NCO is not suppressed by inversions the way CO is
// — that's the biological insight the page surfaces).
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
const SPAN_START_BP = 5_000_000;
const SPAN_END_BP   = 8_000_000;

// Each tract carries midpoint coordinates; ideogram renders rectangular
// ticks at the midpoint. NCO inside the candidate span is biologically
// expected (gene-conversion-like resolution survives inversion
// suppression of crossover).
const TRACTS = [
  // NCO outside the span
  { chrom: HOST_CHROM, start_bp:   800_000,  end_bp:  802_500,   kind: 'nco', length_bp:  2_500 },
  { chrom: HOST_CHROM, start_bp: 1_900_000,  end_bp:  1_903_000, kind: 'nco', length_bp:  3_000 },
  { chrom: HOST_CHROM, start_bp: 3_400_000,  end_bp:  3_402_500, kind: 'nco', length_bp:  2_500 },
  { chrom: HOST_CHROM, start_bp: 11_500_000, end_bp: 11_504_000, kind: 'nco', length_bp:  4_000 },
  { chrom: HOST_CHROM, start_bp: 13_200_000, end_bp: 13_203_500, kind: 'nco', length_bp:  3_500 },
  { chrom: HOST_CHROM, start_bp: 16_100_000, end_bp: 16_102_500, kind: 'nco', length_bp:  2_500 },
  { chrom: HOST_CHROM, start_bp: 17_400_000, end_bp: 17_402_500, kind: 'nco', length_bp:  2_500 },
  { chrom: HOST_CHROM, start_bp: 18_800_000, end_bp: 18_802_500, kind: 'nco', length_bp:  2_500 },
  // NCO INSIDE the span (the page's key biological insight)
  { chrom: HOST_CHROM, start_bp: 5_400_000,  end_bp: 5_403_000,  kind: 'nco', length_bp:  3_000 },
  { chrom: HOST_CHROM, start_bp: 5_800_000,  end_bp: 5_802_500,  kind: 'nco', length_bp:  2_500 },
  { chrom: HOST_CHROM, start_bp: 6_500_000,  end_bp: 6_503_000,  kind: 'nco', length_bp:  3_000 },
  { chrom: HOST_CHROM, start_bp: 7_200_000,  end_bp: 7_202_500,  kind: 'nco', length_bp:  2_500 },
  { chrom: HOST_CHROM, start_bp: 7_600_000,  end_bp: 7_603_000,  kind: 'nco', length_bp:  3_000 },
  { chrom: HOST_CHROM, start_bp: 14_300_000, end_bp: 14_305_500, kind: 'nco', length_bp:  5_500 },
  // GC tracts (longer; ~10-15 kb spans)
  { chrom: HOST_CHROM, start_bp: 1_200_000,  end_bp: 1_215_000,  kind: 'gc',  length_bp: 15_000 },
  { chrom: HOST_CHROM, start_bp: 3_000_000,  end_bp: 3_014_000,  kind: 'gc',  length_bp: 14_000 },
  { chrom: HOST_CHROM, start_bp: 6_100_000,  end_bp: 6_114_000,  kind: 'gc',  length_bp: 14_000 },
  { chrom: HOST_CHROM, start_bp: 10_800_000, end_bp: 10_813_000, kind: 'gc',  length_bp: 13_000 },
  { chrom: HOST_CHROM, start_bp: 12_400_000, end_bp: 12_416_000, kind: 'gc',  length_bp: 16_000 },
  { chrom: HOST_CHROM, start_bp: 15_500_000, end_bp: 15_513_000, kind: 'gc',  length_bp: 13_000 },
  { chrom: HOST_CHROM, start_bp: 17_900_000, end_bp: 17_914_000, kind: 'gc',  length_bp: 14_000 },
  { chrom: HOST_CHROM, start_bp: 19_100_000, end_bp: 19_113_000, kind: 'gc',  length_bp: 13_000 },
];

export const DEMO_NCO_PAYLOAD = {
  candidate_id: 'INV_DEMO_LG28',
  candidate_span: {
    chrom:    HOST_CHROM,
    start_bp: SPAN_START_BP,
    end_bp:   SPAN_END_BP,
  },
  chrom_lengths: { [HOST_CHROM]: HOST_LEN_BP },
  tracts: TRACTS,
};
