// atlases/meiosis/pages/hub/nco_per_candidate/_render.js
// =============================================================================
// Pure SVG renderers for the nco_per_candidate page.
//
// Two views over the recombination map around one inversion candidate:
//   View 1 — tract ideogram (green NCO ticks on the left of the rod,
//            yellow GC ticks on the right, candidate span as a
//            translucent band on the host rod)
//   View 2 — tract rate vs. relative telomere distance, smoothed per kind
//
// Takes an `nco_gc_track` envelope payload + minimal supporting context
// and returns SVG strings. Pure; smoke-test friendly.
//
// Sister of crossovers_per_candidate/_render.js — same chart vocabulary
// (rod, span band, side ticks, telomere bins). Splits by `kind` (nco vs
// gc) rather than by sex.
// =============================================================================

import {
  escHtml,
  binSmooth,
  relTelomereDist,
} from '../_per_candidate_helpers.js';

// ---------------------------------------------------------------------------
// View 1 — NCO + GC tract ideogram
// ---------------------------------------------------------------------------

/**
 * @param payload  nco_gc_track payload — { tracts: [{chrom, start_bp, end_bp, kind}],
 *                                          candidate_span: {chrom, start_bp, end_bp},
 *                                          chrom_lengths?: {<chrom>: bp} }
 */
export function renderTractIdeogramSVG(payload) {
  if (!payload || !Array.isArray(payload.tracts) || payload.tracts.length === 0) {
    return _emptySvg('No NCO / GC tracts on the loaded layer.');
  }
  const tracts = payload.tracts;
  const span = payload.candidate_span || {};
  const chromLens = (payload.chrom_lengths && typeof payload.chrom_lengths === 'object')
    ? payload.chrom_lengths : {};

  // Bin tracts by chrom; track length per chrom (max of pos / explicit).
  const byChrom = new Map();
  for (const t of tracts) {
    if (!t || !t.chrom) continue;
    let g = byChrom.get(t.chrom);
    if (!g) { g = { tracts: [], len_bp: chromLens[t.chrom] || 0 }; byChrom.set(t.chrom, g); }
    g.tracts.push(t);
    if (typeof t.end_bp === 'number' && t.end_bp > g.len_bp) g.len_bp = t.end_bp;
  }
  const hostChrom = span.chrom || null;
  const chroms = Array.from(byChrom.keys()).sort((a, b) => {
    if (a === hostChrom) return -1;
    if (b === hostChrom) return 1;
    return a.localeCompare(b);
  });

  const rowH = 56;
  const padTop = 8;
  const padLeft = 56;
  const padRight = 64;
  const width = 600;
  const innerW = width - padLeft - padRight;
  const height = padTop + chroms.length * rowH + 4;

  const rows = chroms.map((chrom, i) => {
    const g = byChrom.get(chrom);
    const cy = padTop + i * rowH + rowH / 2;
    const rodY = cy - 14;
    const rodH = 28;
    const len = g.len_bp || 1;
    // Span band on host rod.
    let band = '';
    if (chrom === hostChrom && typeof span.start_bp === 'number' && typeof span.end_bp === 'number') {
      const sx = padLeft + (span.start_bp / len) * innerW;
      const ex = padLeft + (span.end_bp   / len) * innerW;
      band = `<rect x="${sx.toFixed(2)}" y="${rodY.toFixed(2)}" ` +
             `width="${(ex - sx).toFixed(2)}" height="${rodH}" ` +
             `class="ga-ideo-span" fill="currentColor" opacity="0.22"/>`;
    }
    // Ticks: NCO left of rod, GC right of rod. Position uses midpoint of tract.
    const ticks = g.tracts.map(t => {
      const mid = (typeof t.start_bp === 'number' && typeof t.end_bp === 'number')
        ? (t.start_bp + t.end_bp) / 2
        : (typeof t.start_bp === 'number' ? t.start_bp : t.end_bp);
      if (typeof mid !== 'number') return '';
      const cx = padLeft + (mid / len) * innerW;
      const isNco = t.kind === 'nco' || t.kind === 'NCO';
      const isGc  = t.kind === 'gc'  || t.kind === 'GC';
      const dy = isNco ? -10 : (isGc ? 10 : 0);
      const cls = isNco ? 'ga-nco-tick-bg' : (isGc ? 'ga-gc-tick-bg' : 'ga-tract-tick-unclassified');
      return `<rect x="${(cx - 1.5).toFixed(2)}" y="${(cy + dy - 4).toFixed(2)}" ` +
             `width="3" height="8" class="${cls}" fill="currentColor"/>`;
    }).join('');
    return `
      <text x="${(padLeft - 8).toFixed(2)}" y="${cy + 4}" text-anchor="end" ` +
        `font-size="11" font-family="var(--mono, monospace)">${escHtml(chrom)}</text>
      <rect x="${padLeft}" y="${(rodY + rodH / 2 - 1).toFixed(2)}" ` +
        `width="${innerW.toFixed(2)}" height="2" class="ga-ideogram-rod" fill="currentColor" opacity="0.6"/>
      ${band}
      ${ticks}
      <text x="${(padLeft + innerW + 8).toFixed(2)}" y="${cy + 4}" text-anchor="start" ` +
        `font-size="10.5" fill="currentColor" opacity="0.7" font-family="var(--mono, monospace)">
        ${(len / 1e6).toFixed(1)} Mb
      </text>`;
  }).join('');

  return `<svg class="ga-ideogram-svg" xmlns="http://www.w3.org/2000/svg" ` +
         `width="${width}" height="${height}" ` +
         `viewBox="0 0 ${width} ${height}" role="img" ` +
         `aria-label="NCO and GC tract ideogram for the active candidate">` +
         rows +
         `</svg>`;
}

// ---------------------------------------------------------------------------
// View 2 — Tract rate vs. relative telomere distance, per kind
// ---------------------------------------------------------------------------

export function buildTractCurves(payload, opts = {}) {
  const nBins = opts.n_bins || 10;
  const tracts = (payload && payload.tracts) || [];
  const span = (payload && payload.candidate_span) || {};
  const chrom = span.chrom;
  if (!chrom) return { nco: null, gc: null };
  const chromLens = (payload.chrom_lengths && typeof payload.chrom_lengths === 'object')
    ? payload.chrom_lengths : {};
  let chrom_len_bp = chromLens[chrom] || 0;
  if (!chrom_len_bp) {
    for (const t of tracts) {
      if (t && t.chrom === chrom && typeof t.end_bp === 'number' && t.end_bp > chrom_len_bp) {
        chrom_len_bp = t.end_bp;
      }
    }
  }
  if (!chrom_len_bp) return { nco: null, gc: null };

  const ncoXs = []; const gcXs = [];
  for (const t of tracts) {
    if (!t || t.chrom !== chrom) continue;
    const mid = (typeof t.start_bp === 'number' && typeof t.end_bp === 'number')
      ? (t.start_bp + t.end_bp) / 2
      : (typeof t.start_bp === 'number' ? t.start_bp : t.end_bp);
    if (typeof mid !== 'number') continue;
    const x = relTelomereDist(mid, chrom_len_bp);
    if (!isFinite(x)) continue;
    if (t.kind === 'nco' || t.kind === 'NCO')      ncoXs.push(x);
    else if (t.kind === 'gc' || t.kind === 'GC')   gcXs.push(x);
  }
  return {
    nco:    binSmooth(ncoXs, ncoXs.map(() => 1), nBins),
    gc:     binSmooth(gcXs,  gcXs.map(() => 1),  nBins),
    chrom,
    chrom_len_bp,
  };
}

export function renderTractCurveSVG(payload, opts = {}) {
  const curves = buildTractCurves(payload, opts);
  if (!curves || (!curves.nco && !curves.gc)) {
    return _emptySvg('No tracts on the host chrom.');
  }
  const ncoHasData = curves.nco && curves.nco.n.some(c => c > 0);
  const gcHasData  = curves.gc  && curves.gc.n.some(c => c > 0);
  if (!ncoHasData && !gcHasData) return _emptySvg('No tracts on the host chrom.');

  const width = 600, height = 220;
  const padL = 44, padR = 18, padT = 14, padB = 38;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;

  let yMax = 0;
  for (const c of [curves.nco, curves.gc]) {
    if (!c) continue;
    for (const v of c.n) if (v > yMax) yMax = v;
  }
  if (yMax === 0) yMax = 1;
  yMax = Math.ceil(yMax * 1.1);

  const xToPx = x => padL + x * innerW;
  const yToPx = y => padT + innerH - (y / yMax) * innerH;

  function pathForCounts(counts, x_centers) {
    const pts = [];
    for (let i = 0; i < counts.length; i++) {
      pts.push(`${xToPx(x_centers[i]).toFixed(2)},${yToPx(counts[i]).toFixed(2)}`);
    }
    return pts.length ? `M${pts.join(' L')}` : '';
  }
  function curveLines(curve, lineCls, bandCls) {
    if (!curve) return '';
    const linePath = pathForCounts(curve.n, curve.x_centers);
    const upper = [];
    const lower = [];
    for (let i = 0; i < curve.n.length; i++) {
      const n = curve.n[i];
      const se = Math.sqrt(Math.max(n, 0));
      upper.push(`${xToPx(curve.x_centers[i]).toFixed(2)},${yToPx(n + 1.96 * se).toFixed(2)}`);
      lower.push(`${xToPx(curve.x_centers[i]).toFixed(2)},${yToPx(Math.max(0, n - 1.96 * se)).toFixed(2)}`);
    }
    const bandPath = upper.length
      ? `M${upper.join(' L')} L${lower.slice().reverse().join(' L')} Z`
      : '';
    return `
      <path d="${bandPath}" class="${bandCls}" fill="currentColor" opacity="0.18"/>
      <path d="${linePath}" class="${lineCls}" fill="none" stroke="currentColor" stroke-width="2"/>`;
  }

  const xAxis = `
    <line x1="${padL}" y1="${padT + innerH}" x2="${padL + innerW}" y2="${padT + innerH}" stroke="currentColor" opacity="0.5"/>
    <text x="${padL + innerW / 2}" y="${height - 10}" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.7">
      relative distance from telomere
    </text>
    <text x="${padL}" y="${height - 22}" text-anchor="middle" font-size="10" opacity="0.6">0</text>
    <text x="${padL + innerW}" y="${height - 22}" text-anchor="middle" font-size="10" opacity="0.6">1</text>`;
  const yAxis = `
    <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + innerH}" stroke="currentColor" opacity="0.5"/>
    <text x="${padL - 8}" y="${padT + innerH}" text-anchor="end" font-size="10" opacity="0.6">0</text>
    <text x="${padL - 8}" y="${padT + 8}" text-anchor="end" font-size="10" opacity="0.6">${yMax}</text>
    <text x="14" y="${padT + innerH / 2}" text-anchor="middle" font-size="11"
          transform="rotate(-90 14 ${padT + innerH / 2})" opacity="0.7"># tracts / bin</text>`;
  const ncoLayer = curveLines(curves.nco, 'ga-nco-line', 'ga-nco-band');
  const gcLayer  = curveLines(curves.gc,  'ga-gc-line',  'ga-gc-band');
  const legend = `
    <g transform="translate(${padL + 8}, ${padT + 8})">
      <rect width="10" height="10" class="ga-nco-tick-bg" fill="currentColor"/>
      <text x="14" y="9" font-size="10.5" fill="currentColor">NCO</text>
      <rect x="56" width="10" height="10" class="ga-gc-tick-bg" fill="currentColor"/>
      <text x="70" y="9" font-size="10.5" fill="currentColor">GC</text>
    </g>`;

  return `<svg class="ga-tract-curve-svg" xmlns="http://www.w3.org/2000/svg" ` +
         `width="${width}" height="${height}" ` +
         `viewBox="0 0 ${width} ${height}" role="img" ` +
         `aria-label="NCO and GC tract rate vs relative telomere distance">` +
         xAxis + yAxis + ncoLayer + gcLayer + legend +
         `</svg>`;
}

// ---------------------------------------------------------------------------
// Empty-state SVG
// ---------------------------------------------------------------------------

function _emptySvg(msg) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="40" ` +
         `viewBox="0 0 600 40" role="img" aria-label="${escHtml(msg)}">` +
         `<text x="12" y="22" font-size="11" fill="currentColor" opacity="0.6">${escHtml(msg)}</text>` +
         `</svg>`;
}
