// atlases/relatedness/shared/recomb_track.js
// =============================================================================
// SVG track renderer used by the four recombination pages. One function:
//
//   renderTrack(svg, opts)
//
// Draws a horizontal per-window track for one chromosome with inversion
// footprints overlaid. The four pages call it with different value
// functions (eligibility, resolution, CO rate) and colour scales.
//
// A second function renderCoincidenceHeatmap(svg, opts) draws a 2D
// window × window matrix for the Coincidence page.
//
// Both functions accept either a DOM <svg> node or a selector string.
// =============================================================================

import { $ } from '../../relatedness/shared/utils.js';
import {
  windowsForChrom, pairsForChrom, inversionFootprint,
  eligibility, resolution, coRatePerMeiosis, coincidence,
} from './recomb_data.js';
import { DEMO } from '../../relatedness/shared/demo_data.js';

const NS = 'http://www.w3.org/2000/svg';
function svgEl(tag, attrs, ...children) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null) continue;
    e.setAttribute(k, v);
  }
  for (const c of children) {
    if (c == null) continue;
    e.appendChild(c);
  }
  return e;
}

// Colour ramp: smooth from cold → warm. Returns a CSS rgb() string.
function ramp(value, vmin, vmax, scheme) {
  if (!Number.isFinite(value)) return 'var(--panel-3)';
  const t = Math.max(0, Math.min(1, (value - vmin) / (vmax - vmin || 1)));
  if (scheme === 'cool') {
    // Indigo (low) → cyan → emerald (high).
    const r = Math.round(63 + (16 - 63) * t);
    const g = Math.round(63 + (185 - 63) * t);
    const b = Math.round(212 + (129 - 212) * t);
    return `rgb(${r},${g},${b})`;
  }
  if (scheme === 'warm') {
    // Slate (low) → amber → ruby (high).
    const r = Math.round(95 + (220 - 95) * t);
    const g = Math.round(95 + (50 - 95) * t);
    const b = Math.round(110 + (60 - 110) * t);
    return `rgb(${r},${g},${b})`;
  }
  // diverging — for coincidence around 1.0 (positive interference < 1 vs
  // negative interference > 1).
  if (scheme === 'diverging') {
    if (t < 0.5) {
      // <1 → cyan (positive interference)
      const k = t * 2;
      const r = Math.round(95 + (16 - 95) * k);
      const g = Math.round(110 + (185 - 110) * k);
      const b = Math.round(195 + (129 - 195) * k);
      return `rgb(${r},${g},${b})`;
    } else {
      // >1 → amber/ruby (negative interference)
      const k = (t - 0.5) * 2;
      const r = Math.round(150 + (220 - 150) * k);
      const g = Math.round(150 + (60 - 150) * k);
      const b = Math.round(110 + (60 - 110) * k);
      return `rgb(${r},${g},${b})`;
    }
  }
  return 'var(--accent)';
}

// Layout constants used by the linear-track renderer.
const TRACK = {
  W: 820, H: 90,
  marginL: 60, marginR: 24,
  marginT: 14, marginB: 26,
  inv_y: 0, inv_h: 6,            // inversion-footprint strip on top
  track_pad: 4,
};

// ─── Linear per-window track ─────────────────────────────────────────────
//
// opts:
//   chromosome    string   chromosome id
//   valueFn       (w)→number
//   vmin, vmax    number   colour ramp domain
//   scheme        'cool' | 'warm' | 'diverging'
//   label         string   y-axis label (e.g. 'NCO/Mb')
//   highlight     string|null  inversion candidate id to outline
export function renderTrack(svgRefOrSel, opts) {
  const svg = typeof svgRefOrSel === 'string' ? $(svgRefOrSel) : svgRefOrSel;
  if (!svg) return;
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  svg.setAttribute('viewBox', `0 0 ${TRACK.W} ${TRACK.H}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

  const wins = windowsForChrom(opts.chromosome);
  if (!wins.length) {
    svg.appendChild(svgEl('text', {
      x: TRACK.W / 2, y: TRACK.H / 2, 'text-anchor': 'middle',
      fill: 'var(--ink-dim)', 'font-size': 11,
    }, document.createTextNode('No recomb data for ' + opts.chromosome)));
    return;
  }
  const innerW = TRACK.W - TRACK.marginL - TRACK.marginR;
  const innerH = TRACK.H - TRACK.marginT - TRACK.marginB;
  const cellW = innerW / wins.length;

  // y-axis label.
  svg.appendChild(svgEl('text', {
    x: 4, y: TRACK.marginT + innerH / 2 + 4,
    fill: 'var(--ink-dim)', 'font-size': 10,
  }, document.createTextNode(opts.label || '')));

  // Inversion footprint strip on top.
  const footprints = inversionFootprint(opts.chromosome);
  for (const fp of footprints) {
    const xs = fp.window_ids;
    if (!xs.length) continue;
    const x0 = TRACK.marginL + Math.min(...xs) * cellW;
    const x1 = TRACK.marginL + (Math.max(...xs) + 1) * cellW;
    const cls = 'inv-' + fp.inv.status;
    const fill = fp.inv.status === 'pass' ? 'rgba(95,212,154,0.30)'
               : fp.inv.status === 'warn' ? 'rgba(232,196,76,0.30)'
               : 'rgba(224,85,92,0.30)';
    const stroke = (opts.highlight && fp.inv.candidate === opts.highlight)
      ? 'var(--accent)' : 'transparent';
    svg.appendChild(svgEl('rect', {
      x: x0, y: TRACK.marginT,
      width: Math.max(1, x1 - x0), height: innerH,
      fill, stroke, 'stroke-width': 1.5, class: 'recomb-inv ' + cls,
    }));
    svg.appendChild(svgEl('text', {
      x: (x0 + x1) / 2, y: TRACK.marginT - 2, 'text-anchor': 'middle',
      'font-size': 9, fill: 'var(--ink-dim)',
    }, document.createTextNode(fp.inv.candidate)));
  }

  // Cells.
  for (const w of wins) {
    const value = opts.valueFn(w);
    const x = TRACK.marginL + w.idx * cellW;
    const y = TRACK.marginT;
    const fill = ramp(value, opts.vmin, opts.vmax, opts.scheme);
    const cell = svgEl('rect', {
      x: x + 1, y: y + 1,
      width: Math.max(0.5, cellW - 2),
      height: innerH - 2,
      fill,
      stroke: 'var(--rule)', 'stroke-width': 0.5,
      class: 'recomb-cell',
    });
    cell.appendChild(svgEl('title', {}, document.createTextNode(
      `${opts.chromosome} ${w.start_mb}-${w.end_mb} Mb · ${opts.label || ''}=`
      + (Number.isFinite(value) ? value.toFixed(3) : 'n/a')
      + `\nNCO_pop=${w.n_NCO_pop}  CO_ped=${w.n_CO_ped}`
      + (w.inside_inversion ? `\ninside ${w.inside_inversion} (${w.inv_status})` : ''))));
    svg.appendChild(cell);
    // Numeric label inside the cell when there's room.
    if (cellW > 28 && Number.isFinite(value)) {
      svg.appendChild(svgEl('text', {
        x: x + cellW / 2, y: y + innerH / 2 + 3, 'text-anchor': 'middle',
        'font-size': 9, fill: 'var(--ink)',
      }, document.createTextNode(value.toFixed(2))));
    }
  }

  // X-axis tick labels (Mb).
  for (const w of wins) {
    if (w.idx % 2 !== 0) continue;
    const x = TRACK.marginL + w.idx * cellW + cellW / 2;
    svg.appendChild(svgEl('text', {
      x, y: TRACK.H - 8, 'text-anchor': 'middle',
      'font-size': 9, fill: 'var(--ink-dim)',
    }, document.createTextNode(w.start_mb + ' Mb')));
  }
}

// ─── Coincidence 2D heatmap ──────────────────────────────────────────────
//
// opts:
//   chromosome   string
//   highlight    string|null  inversion candidate id
//   bandMax      number       max physical distance (windows) to show; default = all
//   onCellClick  (i, j, C)→void
export function renderCoincidenceHeatmap(svgRefOrSel, opts) {
  const svg = typeof svgRefOrSel === 'string' ? $(svgRefOrSel) : svgRefOrSel;
  if (!svg) return;
  while (svg.firstChild) svg.removeChild(svg.firstChild);

  const wins = windowsForChrom(opts.chromosome);
  const pairs = pairsForChrom(opts.chromosome);
  const N = wins.length;
  const W = 520, H = 520;
  const marginL = 40, marginT = 40, marginR = 20, marginB = 36;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

  if (!N) {
    svg.appendChild(svgEl('text', {
      x: W / 2, y: H / 2, 'text-anchor': 'middle',
      fill: 'var(--ink-dim)', 'font-size': 11,
    }, document.createTextNode('No recomb data for ' + opts.chromosome)));
    return;
  }
  const innerW = W - marginL - marginR;
  const innerH = H - marginT - marginB;
  const cell = Math.min(innerW, innerH) / N;
  const bandMax = opts.bandMax || N;

  // Build a quick lookup pairs[i][j] → C.
  const pairC = {};
  for (const p of pairs) {
    const c = coincidence(p, wins);
    pairC[p.i + ',' + p.j] = c;
    pairC[p.j + ',' + p.i] = c;
  }

  // Inversion overlay: rows/cols inside an inversion get a thin border.
  const fp = inversionFootprint(opts.chromosome);
  const insideSet = new Set();
  for (const f of fp) {
    if (!opts.highlight || f.inv.candidate === opts.highlight) {
      f.window_ids.forEach(w => insideSet.add(w));
    }
  }

  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const x = marginL + j * cell;
      const y = marginT + i * cell;
      if (i === j) {
        // diagonal
        svg.appendChild(svgEl('rect', {
          x, y, width: cell, height: cell,
          fill: 'var(--panel-2)', stroke: 'var(--rule)', 'stroke-width': 0.5,
        }));
        continue;
      }
      if (Math.abs(i - j) > bandMax) continue;
      const C = pairC[i + ',' + j];
      const fill = ramp(Number.isFinite(C) ? C : 1.0, 0, 2, 'diverging');
      const rect = svgEl('rect', {
        x, y, width: cell, height: cell, fill,
        stroke: insideSet.has(i) && insideSet.has(j) ? 'var(--accent)'
              : 'var(--rule)',
        'stroke-width': insideSet.has(i) && insideSet.has(j) ? 1.2 : 0.5,
        class: 'recomb-coin-cell',
      });
      rect.style.cursor = opts.onCellClick ? 'pointer' : 'default';
      rect.appendChild(svgEl('title', {}, document.createTextNode(
        `${opts.chromosome} win ${i} × win ${j}`
        + (Number.isFinite(C) ? ` · C=${C.toFixed(3)} I=${(1-C).toFixed(3)}` : ' · n/a'))));
      if (opts.onCellClick) {
        rect.addEventListener('click', () => opts.onCellClick(i, j, C));
      }
      svg.appendChild(rect);
    }
  }

  // Axis ticks (every other window).
  for (let i = 0; i < N; i++) {
    if (i % 2 !== 0) continue;
    svg.appendChild(svgEl('text', {
      x: marginL + i * cell + cell / 2, y: H - 20, 'text-anchor': 'middle',
      'font-size': 9, fill: 'var(--ink-dim)',
    }, document.createTextNode(wins[i].start_mb + '')));
    svg.appendChild(svgEl('text', {
      x: marginL - 8, y: marginT + i * cell + cell / 2 + 3, 'text-anchor': 'end',
      'font-size': 9, fill: 'var(--ink-dim)',
    }, document.createTextNode(wins[i].start_mb + '')));
  }
  // Axis title.
  svg.appendChild(svgEl('text', {
    x: marginL + innerW / 2, y: H - 4, 'text-anchor': 'middle',
    'font-size': 10, fill: 'var(--ink-dim)',
  }, document.createTextNode('window start (Mb)')));
  svg.appendChild(svgEl('text', {
    x: 10, y: marginT + innerH / 2,
    transform: `rotate(-90 10 ${marginT + innerH / 2})`,
    'text-anchor': 'middle', 'font-size': 10, fill: 'var(--ink-dim)',
  }, document.createTextNode('window start (Mb)')));
}

// Small legend strip showing the colour ramp.
export function renderRampLegend(slot, opts) {
  const target = typeof slot === 'string' ? $(slot) : slot;
  if (!target) return;
  target.innerHTML = '';
  const W = 200, H = 14;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('width', W); svg.setAttribute('height', H);
  for (let k = 0; k < 50; k++) {
    const t = k / 49;
    const val = opts.vmin + t * (opts.vmax - opts.vmin);
    svg.appendChild(svgEl('rect', {
      x: k * (W / 50), y: 0, width: (W / 50) + 0.5, height: H,
      fill: ramp(val, opts.vmin, opts.vmax, opts.scheme),
    }));
  }
  target.appendChild(svg);
  const lbl = document.createElement('div');
  lbl.style.fontSize = '9.5px';
  lbl.style.color = 'var(--ink-dim)';
  lbl.style.display = 'flex';
  lbl.style.justifyContent = 'space-between';
  lbl.style.width = W + 'px';
  lbl.style.marginTop = '2px';
  lbl.innerHTML = `<span>${opts.vmin}</span>`
                + `<span>${opts.label || ''}</span>`
                + `<span>${opts.vmax}</span>`;
  target.appendChild(lbl);
}
