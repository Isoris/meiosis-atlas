// atlases/meiosis/pages/hub/crossovers_per_candidate/_render.js
// =============================================================================
// Pure SVG renderers for the crossovers_per_candidate page.
//
// Three views (per the HTML scaffold's three .ga-card sections):
//   View 1 — sex-specific CO ideogram (host chrom + any flank chroms)
//   View 2 — CO rate vs. relative telomere distance, smoothed per sex
//   View 3 — PRDM9 sequence logo (optional; only when prdm9_motif.pwm exists)
//
// Each renderer takes a `crossover_track` envelope payload + minimum
// supporting context and returns an SVG string the caller injects into
// the matching .ga-card body container (replacing the static mockup).
//
// Pure: no DOM, no fetch. Smoke-test friendly.
// =============================================================================

import {
  escHtml,
  binSmooth,
  relTelomereDist,
  sequenceLogoSVG,
} from '../_per_candidate_helpers.js';

// ---------------------------------------------------------------------------
// View 1 — sex-specific CO ideogram (per chrom in the candidate's scope)
// ---------------------------------------------------------------------------

/**
 * @param payload    crossover_track payload — { events: [{chrom, pos_bp, sex}],
 *                                                candidate_span: {chrom, start_bp, end_bp},
 *                                                chrom_lengths?: {<chrom>: bp}, ... }
 * @returns SVG string. Returns an empty <svg> when payload has no events.
 */
export function renderIdeogramSVG(payload) {
  if (!payload || !Array.isArray(payload.events) || payload.events.length === 0) {
    return _emptySvg('No CO events on the loaded layer.');
  }
  const events = payload.events;
  const span = payload.candidate_span || {};
  // Group events by chrom; collect chrom lengths.
  const byChrom = new Map();
  const chromLens = (payload.chrom_lengths && typeof payload.chrom_lengths === 'object')
    ? payload.chrom_lengths : {};
  for (const e of events) {
    if (!e || !e.chrom || typeof e.pos_bp !== 'number') continue;
    let g = byChrom.get(e.chrom);
    if (!g) { g = { events: [], len_bp: chromLens[e.chrom] || 0 }; byChrom.set(e.chrom, g); }
    g.events.push(e);
    // Best-effort length: max(pos_bp) when explicit length missing.
    if (!g.len_bp) g.len_bp = Math.max(g.len_bp, e.pos_bp);
  }
  // Sort chroms: host first, then others by name.
  const hostChrom = span.chrom || null;
  const chroms = Array.from(byChrom.keys()).sort((a, b) => {
    if (a === hostChrom) return -1;
    if (b === hostChrom) return 1;
    return a.localeCompare(b);
  });

  // Layout: one row per chrom; each row 38px tall.
  const rowH = 56;
  const padTop = 8;
  const padLeft = 56;   // chrom label column
  const padRight = 64;  // length label column
  const width = 600;
  const innerW = width - padLeft - padRight;
  const height = padTop + chroms.length * rowH + 4;

  const rows = chroms.map((chrom, i) => {
    const g = byChrom.get(chrom);
    const cy = padTop + i * rowH + rowH / 2;
    const rodY = cy - 14;
    const rodH = 28;
    const len = g.len_bp || 1;
    // Span band — only on the host chrom.
    let band = '';
    if (chrom === hostChrom && typeof span.start_bp === 'number' && typeof span.end_bp === 'number') {
      const sx = padLeft + (span.start_bp / len) * innerW;
      const ex = padLeft + (span.end_bp   / len) * innerW;
      band = `<rect x="${sx.toFixed(2)}" y="${rodY.toFixed(2)}" ` +
             `width="${(ex - sx).toFixed(2)}" height="${rodH}" ` +
             `class="ga-ideo-span" fill="currentColor" opacity="0.22"/>`;
    }
    // Dots: female on left side of rod, male on right.
    const dots = g.events.map(e => {
      const cx = padLeft + (e.pos_bp / len) * innerW;
      const isF = e.sex === 'F' || e.sex === 'female';
      const isM = e.sex === 'M' || e.sex === 'male';
      const dy = isF ? -10 : (isM ? 10 : 0);
      const cls = isF ? 'ga-co-female-bg' : (isM ? 'ga-co-male-bg' : 'ga-co-unsexed-bg');
      return `<circle cx="${cx.toFixed(2)}" cy="${(cy + dy).toFixed(2)}" r="3" class="${cls}"/>`;
    }).join('');
    return `
      <text x="${(padLeft - 8).toFixed(2)}" y="${cy + 4}" text-anchor="end" ` +
        `font-size="11" font-family="var(--mono, monospace)">${escHtml(chrom)}</text>
      <rect x="${padLeft}" y="${(rodY + rodH / 2 - 1).toFixed(2)}" ` +
        `width="${innerW.toFixed(2)}" height="2" class="ga-ideogram-rod" fill="currentColor" opacity="0.6"/>
      ${band}
      ${dots}
      <text x="${(padLeft + innerW + 8).toFixed(2)}" y="${cy + 4}" text-anchor="start" ` +
        `font-size="10.5" fill="currentColor" opacity="0.7" font-family="var(--mono, monospace)">
        ${(len / 1e6).toFixed(1)} Mb
      </text>`;
  }).join('');

  return `<svg class="ga-ideogram-svg" xmlns="http://www.w3.org/2000/svg" ` +
         `width="${width}" height="${height}" ` +
         `viewBox="0 0 ${width} ${height}" role="img" ` +
         `aria-label="Sex-specific crossover ideogram for the active candidate">` +
         rows +
         `</svg>`;
}

// ---------------------------------------------------------------------------
// View 2 — CO rate vs. relative telomere distance, smoothed per sex
// ---------------------------------------------------------------------------

/**
 * Build per-bin {x, mean, lo95, hi95, n} per sex on the host chrom.
 * Sees only events on candidate_span.chrom; cross-chrom flank events
 * are excluded (the curve is per-chrom by design).
 */
export function buildTelomereCurves(payload, opts = {}) {
  const nBins = opts.n_bins || 10;
  const events = (payload && payload.events) || [];
  const span = (payload && payload.candidate_span) || {};
  const chrom = span.chrom;
  if (!chrom) return { female: null, male: null };
  // chrom length: prefer payload.chrom_lengths, fall back to max event pos.
  const chromLens = (payload.chrom_lengths && typeof payload.chrom_lengths === 'object')
    ? payload.chrom_lengths : {};
  let chrom_len_bp = chromLens[chrom] || 0;
  if (!chrom_len_bp) {
    for (const e of events) {
      if (e && e.chrom === chrom && typeof e.pos_bp === 'number') {
        if (e.pos_bp > chrom_len_bp) chrom_len_bp = e.pos_bp;
      }
    }
  }
  if (!chrom_len_bp) return { female: null, male: null };

  const f = []; const m = [];
  for (const e of events) {
    if (!e || e.chrom !== chrom) continue;
    const x = relTelomereDist(e.pos_bp, chrom_len_bp);
    if (!isFinite(x)) continue;
    if (e.sex === 'F' || e.sex === 'female')      f.push(x);
    else if (e.sex === 'M' || e.sex === 'male')   m.push(x);
  }
  // Weight = 1 per event → mean per bin = event count fraction; OK for v1
  // "shape of distribution" visualisation. Per-bin rate is preserved via n.
  return {
    female: binSmooth(f, f.map(() => 1), nBins),
    male:   binSmooth(m, m.map(() => 1), nBins),
    chrom,
    chrom_len_bp,
  };
}

/**
 * @returns SVG of the per-sex curve. Empty <svg> if both sexes are empty.
 */
export function renderTelomereCurveSVG(payload, opts = {}) {
  const curves = buildTelomereCurves(payload, opts);
  if (!curves || (!curves.female && !curves.male)) {
    return _emptySvg('No CO events on the host chrom.');
  }
  const fHasData = curves.female && curves.female.n.some(c => c > 0);
  const mHasData = curves.male   && curves.male.n.some(c => c > 0);
  if (!fHasData && !mHasData) return _emptySvg('No CO events on the host chrom.');

  // Layout.
  const width = 600, height = 220;
  const padL = 44, padR = 18, padT = 14, padB = 38;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;

  // y-axis range: max of any bin count across sexes; min = 0.
  let yMax = 0;
  for (const c of [curves.female, curves.male]) {
    if (!c) continue;
    for (const v of c.n) if (v > yMax) yMax = v;
  }
  if (yMax === 0) yMax = 1;
  yMax = Math.ceil(yMax * 1.1);

  const xToPx = x => padL + x * innerW;
  const yToPx = y => padT + innerH - (y / yMax) * innerH;

  function pathForCounts(counts, x_centers) {
    // counts is per-bin event count (since weights = 1, mean is fraction of N
    // in bin which is not what we want — use counts directly).
    const pts = [];
    for (let i = 0; i < counts.length; i++) {
      pts.push(`${xToPx(x_centers[i]).toFixed(2)},${yToPx(counts[i]).toFixed(2)}`);
    }
    return pts.length ? `M${pts.join(' L')}` : '';
  }
  function curveLines(curve, lineCls, bandCls) {
    if (!curve) return '';
    const linePath = pathForCounts(curve.n, curve.x_centers);
    // Build a band by ±sqrt(n) (Poisson approx for count bins) — keeps the
    // demo render visually meaningful without dragging in a CI library.
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
          transform="rotate(-90 14 ${padT + innerH / 2})" opacity="0.7"># COs / bin</text>`;
  const fLayer = curveLines(curves.female, 'ga-co-female-line', 'ga-co-female-band');
  const mLayer = curveLines(curves.male,   'ga-co-male-line',   'ga-co-male-band');
  // Legend.
  const legend = `
    <g transform="translate(${padL + 8}, ${padT + 8})">
      <rect width="10" height="10" class="ga-co-female-bg" fill="currentColor"/>
      <text x="14" y="9" font-size="10.5" fill="currentColor">females</text>
      <rect x="74" width="10" height="10" class="ga-co-male-bg" fill="currentColor"/>
      <text x="88" y="9" font-size="10.5" fill="currentColor">males</text>
    </g>`;

  return `<svg class="ga-co-curve-svg" xmlns="http://www.w3.org/2000/svg" ` +
         `width="${width}" height="${height}" ` +
         `viewBox="0 0 ${width} ${height}" role="img" ` +
         `aria-label="Crossover rate vs relative telomere distance">` +
         xAxis + yAxis + fLayer + mLayer + legend +
         `</svg>`;
}

// ---------------------------------------------------------------------------
// View 3 — PRDM9 sequence logo (optional)
// ---------------------------------------------------------------------------

export function renderPrdm9LogoSVG(payload) {
  const pwm = payload && payload.prdm9_motif && Array.isArray(payload.prdm9_motif.pwm)
    ? payload.prdm9_motif.pwm : null;
  if (!pwm || pwm.length === 0) return '';  // caller hides the card
  return sequenceLogoSVG(pwm, { width: 320, height: 80 });
}

// ---------------------------------------------------------------------------
// Empty-state SVG (used by the renderers when payload has no events)
// ---------------------------------------------------------------------------

function _emptySvg(msg) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="40" ` +
         `viewBox="0 0 600 40" role="img" aria-label="${escHtml(msg)}">` +
         `<text x="12" y="22" font-size="11" fill="currentColor" opacity="0.6">${escHtml(msg)}</text>` +
         `</svg>`;
}
