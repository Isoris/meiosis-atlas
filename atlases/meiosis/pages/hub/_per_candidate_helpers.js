// atlases/meiosis/pages/hub/_per_candidate_helpers.js
// =============================================================================
// Shared chart helpers for the two per-candidate pages
// (crossovers_per_candidate, nco_per_candidate).
//
// Pure functions; no DOM dependencies — they return SVG / HTML strings
// so the calling page can swap a mockup container's innerHTML in a single
// assignment. Tested via the per-page smoke tests.
//
// What lives here:
//   - escHtml         — minimal HTML escape
//   - binSmooth       — fixed-width binning over x ∈ [0, 1] with mean +
//                       normal-approx 95% CI per bin
//   - sequenceLogoSVG — column-letter sequence logo from a PWM matrix
//   - relTelomereDist — bp position → relative distance from nearer
//                       telomere, in [0, 1]
//   - svgWrap         — boilerplate <svg> open/close with the common
//                       width / viewBox / aria-label
// =============================================================================

export function escHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Bin numeric x-values into nBins equal-width bins over [0, 1]; return
 * { x_centers, mean, lo95, hi95, n } arrays of length nBins.
 *
 * normal-approx CI: mean ± 1.96 * sqrt(var/n). For rendering only — a
 * production page would compute a bootstrap CI; this is the v1 demo-
 * usable approximation.
 *
 * @param xs       array of x values in [0, 1] (out-of-range filtered out)
 * @param weights  array of y/weight values (parallel to xs); pass an
 *                 array of 1s for "rate" = mean(1) per bin
 * @param nBins    integer; default 10
 */
export function binSmooth(xs, weights, nBins = 10) {
  const sums   = new Array(nBins).fill(0);
  const sumSq  = new Array(nBins).fill(0);
  const counts = new Array(nBins).fill(0);
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i];
    if (!(x >= 0 && x <= 1)) continue;
    let bin = Math.floor(x * nBins);
    if (bin >= nBins) bin = nBins - 1;
    const w = weights ? weights[i] : 1;
    sums[bin]   += w;
    sumSq[bin]  += w * w;
    counts[bin] += 1;
  }
  const x_centers = new Array(nBins);
  const mean      = new Array(nBins);
  const lo95      = new Array(nBins);
  const hi95      = new Array(nBins);
  for (let b = 0; b < nBins; b++) {
    x_centers[b] = (b + 0.5) / nBins;
    const n = counts[b];
    if (n === 0) {
      mean[b] = NaN; lo95[b] = NaN; hi95[b] = NaN;
      continue;
    }
    const m = sums[b] / n;
    // sample variance with Bessel correction; fall back to 0 when n=1.
    const v = (n > 1) ? (sumSq[b] - n * m * m) / (n - 1) : 0;
    const se = (n > 0) ? Math.sqrt(v / n) : 0;
    mean[b] = m;
    lo95[b] = m - 1.96 * se;
    hi95[b] = m + 1.96 * se;
  }
  return { x_centers, mean, lo95, hi95, n: counts };
}

/**
 * Map a bp position to relative distance from the nearer telomere, in
 * [0, 1]. 0 = telomere; 1 = chromosome centre.
 */
export function relTelomereDist(pos_bp, chrom_len_bp) {
  if (!(chrom_len_bp > 0) || !(pos_bp >= 0)) return NaN;
  const mid = chrom_len_bp / 2;
  const fromNearer = Math.min(pos_bp, chrom_len_bp - pos_bp);
  if (fromNearer < 0) return 0;
  if (fromNearer > mid) return 1;
  return fromNearer / mid;
}

/**
 * Sequence-logo SVG from a PWM matrix [[a,c,g,t], ...]. Letters scaled
 * by per-position information content (bits). Returns an SVG string.
 *
 * @param pwm    N×4 array; each row sums to ~1 (probability distribution)
 * @param opts   { width=320, height=80, alphabet="ACGT" }
 */
export function sequenceLogoSVG(pwm, opts = {}) {
  if (!Array.isArray(pwm) || pwm.length === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0"></svg>`;
  }
  const width    = opts.width  || 320;
  const height   = opts.height || 80;
  const alphabet = opts.alphabet || ['A', 'C', 'G', 'T'];
  const LOG2 = Math.log(2);
  const colW = width / pwm.length;
  // Per-column information content I_i = log2(4) - H_i = 2 - Σ p log2 p.
  const bits = pwm.map(col => {
    let h = 0;
    for (const p of col) if (p > 0) h -= p * (Math.log(p) / LOG2);
    return Math.max(0, 2 - h);  // bits in [0, 2]
  });
  // Per (col, letter) height proportional to p * bits.
  const cols = pwm.map((col, i) => {
    const ranked = col.map((p, k) => ({ p, letter: alphabet[k] }))
                      .sort((a, b) => a.p - b.p);  // small first → drawn bottom-up
    return { ranked, bits: bits[i] };
  });
  const colSVG = cols.map((c, i) => {
    let y = height;
    const tspans = c.ranked.map(({ p, letter }) => {
      const h = p * c.bits / 2 * height;  // bits in [0,2] → fraction of axis
      if (h <= 0) return '';
      y -= h;
      const cx = i * colW + colW / 2;
      // Scale a single letter to fit the (colW, h) box.
      return `<text x="${cx.toFixed(2)}" y="${(y + h).toFixed(2)}" ` +
             `text-anchor="middle" font-family="var(--mono, monospace)" ` +
             `font-size="${h.toFixed(2)}" font-weight="700" ` +
             `transform="scale(1, 1)" ` +
             `style="dominant-baseline: alphabetic;">${escHtml(letter)}</text>`;
    }).join('');
    return tspans;
  }).join('');
  return `<svg class="ga-logo-svg" xmlns="http://www.w3.org/2000/svg" ` +
         `width="${width}" height="${height}" ` +
         `viewBox="0 0 ${width} ${height}" ` +
         `role="img" aria-label="PRDM9 sequence logo">` +
         colSVG +
         `</svg>`;
}

/**
 * Boilerplate SVG wrapper.
 */
export function svgWrap(innerSVG, opts = {}) {
  const width  = opts.width  || 600;
  const height = opts.height || 200;
  const cls    = opts.className ? ` class="${opts.className}"` : '';
  const aria   = opts.ariaLabel ? ` role="img" aria-label="${escHtml(opts.ariaLabel)}"` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg"${cls} ` +
         `width="${width}" height="${height}" ` +
         `viewBox="0 0 ${width} ${height}"${aria}>` +
         innerSVG +
         `</svg>`;
}
