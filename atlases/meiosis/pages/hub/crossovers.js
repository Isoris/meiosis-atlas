// atlases/meiosis/pages/hub/crossovers.js
// =============================================================================
// Crossovers page — non-NCO meiosis events (CO + DCO).
//
// Data source: a `chromosome_meiosis_events_v1` envelope produced by the
// meiosis-atlas's normalize_chromosome_meiosis_events action (which promotes a
// staging_chromosome_meiosis_events_v0 envelope from a per-(chrom × dyad)
// event-count TSV). See specs_done/SPEC_crossovers_page.md.
//
// mount() probes for the latest normalized envelope; renders a status
// badge advertising layer_id + n_rows + n_dyads + n_chroms + sum_n_co/dco.
// When no envelope exists (e.g. action pipeline not yet run on this
// workspace), the badge says so and the controls remain inert. Fail-soft
// on fetch errors.
//
// Render views (against envelope.payload.events[]):
//   count        — (dyad × chrom) matrix of raw counts; class filter applies
//   rate_per_mb  — same matrix, but values are co_per_mb / dco_per_mb
//   position     — STUB: needs traversal_breakpoints envelope (STEP_TRC_02)
//   karyo_strat  — CO_rate(het) vs CO_rate(non-het) per chromosome (the
//                  intrachromosomal-effect view; manuscript-grade)
// =============================================================================

import { resolveLatestLayer } from '../../shared/api_client.js';

// ---------------------------------------------------------------------------
// Page-local state. Reset on unmount().
// ---------------------------------------------------------------------------
const _wired = new Set();
let _envelope = null;        // chromosome_meiosis_events_v1 envelope, or null
let _envelopeError = null;   // string when fetch failed (fail-soft)

function wire(el, evt, fn) {
  if (!el) return;
  el.addEventListener(evt, fn);
  _wired.add(() => el.removeEventListener(evt, fn));
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// Filtering — class + chrom
// ---------------------------------------------------------------------------

// Returns predicate. `class` here is event-class scope, not row attribute:
// the row carries n_co + n_dco + n_nco simultaneously; the filter picks
// which counters the renderer reads. We return a {co, dco} pair of booleans.
export function classPred(value) {
  if (value === 'CO')  return { co: true,  dco: false };
  if (value === 'DCO') return { co: false, dco: true  };
  return { co: true, dco: true };  // ALL_CO_LIKE (default)
}

export function chromPred(value) {
  if (!value || value === 'all') return _ => true;
  return e => e.chrom === value;
}

export function filterEvents(events, chromValue) {
  return events.filter(chromPred(chromValue));
}

export function chromList(events) {
  return Array.from(new Set(events.map(e => e.chrom).filter(Boolean))).sort();
}

// ---------------------------------------------------------------------------
// View renderers — pure; take filtered events + class scope, return HTML.
// ---------------------------------------------------------------------------

export function renderPerDyadChrom(events, classScope) {
  if (events.length === 0) return _emptyMsg('No events match this filter.');
  const { co, dco } = classScope;
  const chroms = Array.from(new Set(events.map(e => e.chrom))).sort();
  const dyads  = Array.from(new Set(events.map(e => `${e.parent_id}\x00${e.offspring_id}`))).sort();

  const cell = new Map();  // key = `${dyad}|${chrom}` → number
  for (const e of events) {
    const k = `${e.parent_id}\x00${e.offspring_id}|${e.chrom}`;
    let n = 0;
    if (co  && typeof e.n_co  === 'number') n += e.n_co;
    if (dco && typeof e.n_dco === 'number') n += e.n_dco;
    cell.set(k, n);
  }

  const head = `<tr><th>dyad (parent → offspring)</th>${chroms.map(c => `<th>${esc(c)}</th>`).join('')}</tr>`;
  const body = dyads.map(d => {
    const [p, o] = d.split('\x00');
    const cells = chroms.map(c => {
      const v = cell.get(`${d}|${c}`);
      return `<td style="text-align:right">${v == null ? '' : v}</td>`;
    }).join('');
    return `<tr><td>${esc(p)} → ${esc(o)}</td>${cells}</tr>`;
  }).join('');

  return `<table class="co-tbl"><thead>${head}</thead><tbody>${body}</tbody></table>`;
}

export function renderRatePerMb(events, classScope) {
  if (events.length === 0) return _emptyMsg('No events match this filter.');
  const { co, dco } = classScope;
  const chroms = Array.from(new Set(events.map(e => e.chrom))).sort();
  const dyads  = Array.from(new Set(events.map(e => `${e.parent_id}\x00${e.offspring_id}`))).sort();

  // For ALL_CO_LIKE we sum co_per_mb + dco_per_mb (both rates are per Mb of chrom).
  const cell = new Map();
  for (const e of events) {
    const k = `${e.parent_id}\x00${e.offspring_id}|${e.chrom}`;
    let r = 0;
    if (co  && typeof e.co_per_mb  === 'number') r += e.co_per_mb;
    if (dco && typeof e.dco_per_mb === 'number') r += e.dco_per_mb;
    cell.set(k, r);
  }

  const head = `<tr><th>dyad (parent → offspring)</th>${chroms.map(c => `<th>${esc(c)}</th>`).join('')}</tr>`;
  const body = dyads.map(d => {
    const [p, o] = d.split('\x00');
    const cells = chroms.map(c => {
      const v = cell.get(`${d}|${c}`);
      return `<td style="text-align:right">${v == null ? '' : v.toFixed(3)}</td>`;
    }).join('');
    return `<tr><td>${esc(p)} → ${esc(o)}</td>${cells}</tr>`;
  }).join('');

  return `
    <div class="co-hint">Events per Mb of chromosome (n_x / chrom_len_bp × 1e6). Sums CO + DCO when "all CO-like" is selected.</div>
    <table class="co-tbl"><thead>${head}</thead><tbody>${body}</tbody></table>`;
}

export function renderBreakpointTrack(_events, _classScope) {
  // STUB: refined breakpoint positions live in a separate
  // traversal_breakpoints envelope (STEP_TRC_02). When that adapter ships,
  // this renderer fetches it and draws per-chromosome ticks at
  // refined_breakpoint_bp positions; falls back to mean_co_position_bp
  // when refined data is absent.
  return _emptyMsg('Breakpoint-position view requires the traversal_breakpoints envelope (ngsTracts STEP_TRC_02). Not yet wired — see SPEC_crossovers_page.md §7.');
}

/**
 * Karyotype-stratified rate view — the page's manuscript-grade output.
 *
 * For each chromosome, computes CO_rate(het) / CO_rate(non-het) where
 * non-het = homA ∪ homB. Cells significantly < 1.0 are coloured
 * var(--bad) (local CO suppression by the heterozygous inversion — the
 * canonical biological signal).
 *
 * Requires rows with `karyotype_at_focal_inv` populated (the
 * intrachromosomal slice of the karyotype stratification). When the
 * envelope's summary.karyotype_strat_rows is 0, returns an empty-state
 * message pointing at the missing producer.
 */
export function renderKaryotypeRate(events, classScope) {
  const stratRows = events.filter(e => e.karyotype_at_focal_inv);
  if (stratRows.length === 0) {
    return _emptyMsg('No karyotype_at_focal_inv data on the loaded envelope. Producer must emit karyotype-stratified rows; see SPEC_crossovers_page.md §3.1.');
  }
  const { co, dco } = classScope;
  const chroms = Array.from(new Set(stratRows.map(e => e.chrom))).sort();

  // Group rates by (chrom, het|non-het).
  const acc = new Map();  // key = `${chrom}|${bucket}` → {sum, n}
  for (const e of stratRows) {
    const bucket = e.karyotype_at_focal_inv === 'het' ? 'het' : 'nonhet';
    const k = `${e.chrom}|${bucket}`;
    let r = 0;
    if (co  && typeof e.co_per_mb  === 'number') r += e.co_per_mb;
    if (dco && typeof e.dco_per_mb === 'number') r += e.dco_per_mb;
    const entry = acc.get(k) || { sum: 0, n: 0 };
    entry.sum += r;
    entry.n   += 1;
    acc.set(k, entry);
  }

  const head = `<tr><th>chrom</th><th>mean CO/Mb (het)</th><th>mean CO/Mb (non-het)</th><th>ratio het / non-het</th></tr>`;
  const body = chroms.map(c => {
    const het    = acc.get(`${c}|het`);
    const nonHet = acc.get(`${c}|nonhet`);
    const mh = het    && het.n    ? het.sum    / het.n    : null;
    const mn = nonHet && nonHet.n ? nonHet.sum / nonHet.n : null;
    const ratio = (mh != null && mn && mn > 0) ? mh / mn : null;
    const lowCell = (ratio != null && ratio < 0.7) ? ' class="co-cell-low"' : '';
    const fmt = v => v == null ? '—' : v.toFixed(3);
    return `<tr>
      <td>${esc(c)}</td>
      <td style="text-align:right">${fmt(mh)}</td>
      <td style="text-align:right">${fmt(mn)}</td>
      <td style="text-align:right"${lowCell}>${fmt(ratio)}</td>
    </tr>`;
  }).join('');

  return `
    <div class="co-hint">Bold red: ratio &lt; 0.7 — local CO suppression by the heterozygous inversion (the canonical biological signal). Companion to <code>interchromosomal</code> page (tests the SAME hypothesis on other chromosomes).</div>
    <table class="co-tbl"><thead>${head}</thead><tbody>${body}</tbody></table>`;
}

function _emptyMsg(msg) {
  return `<div class="co-empty">${esc(msg)}</div>`;
}

// ---------------------------------------------------------------------------
// Status badge — always-on summary at the top of the result slot.
// ---------------------------------------------------------------------------

export function renderStatusBadge(envelope, error) {
  if (error) {
    return `<div class="co-badge co-badge-warn">⚠ envelope fetch failed — ${esc(error)}. Render will run against any previously cached state.</div>`;
  }
  if (!envelope) {
    return `<div class="co-badge co-badge-empty">No <code>chromosome_meiosis_events_v1</code> envelope in this workspace yet. Submit <code>import_chromosome_meiosis_events</code> + <code>normalize_chromosome_meiosis_events</code> to populate (see specs_done/SPEC_crossovers_page.md).</div>`;
  }
  const s = (envelope.payload && envelope.payload.summary) || {};
  const parts = [
    `<strong>${esc(envelope.layer_id || '?')}</strong>`,
    `${s.n_rows || 0} rows`,
    `${s.n_dyads || 0} dyads`,
    `${s.n_chroms || 0} chroms`,
    `ΣCO: ${s.sum_n_co || 0}`,
    `ΣDCO: ${s.sum_n_dco || 0}`,
    `ΣNCO: ${s.sum_n_nco || 0}`,
    `karyo-strat rows: ${s.karyotype_strat_rows || 0}`,
  ];
  return `<div class="co-badge co-badge-ok">${parts.join(' · ')}</div>`;
}

// ---------------------------------------------------------------------------
// Chromosome dropdown — populate from envelope on mount.
// ---------------------------------------------------------------------------

function populateChromSelect(root, events) {
  const sel = root.querySelector('#coChrom');
  if (!sel) return;
  const chroms = chromList(events);
  // Preserve the leading 'all chromosomes' option.
  const existing = Array.from(sel.options).filter(o => o.value !== 'all');
  for (const o of existing) sel.removeChild(o);
  for (const c of chroms) {
    const o = document.createElement('option');
    o.value = c;
    o.textContent = c;
    sel.appendChild(o);
  }
}

// ---------------------------------------------------------------------------
// Mount / unmount
// ---------------------------------------------------------------------------

export async function mount(root, ctx = {}) {
  const slot = root.querySelector('#coResultSlot');
  if (slot) slot.innerHTML = '<div class="co-empty">Loading envelope…</div>';

  // Probe for the latest chromosome_meiosis_events_v1 envelope. Fail-soft.
  _envelope = null;
  _envelopeError = null;
  try {
    _envelope = await resolveLatestLayer('chromosome_meiosis_events', { stage: 'normalized' });
  } catch (e) {
    _envelopeError = (e && e.message) || String(e);
  }

  if (slot) slot.innerHTML = renderStatusBadge(_envelope, _envelopeError);

  // Populate per-chromosome dropdown from envelope.
  const events = (_envelope && _envelope.payload && _envelope.payload.events) || [];
  populateChromSelect(root, events);

  const runBtn    = root.querySelector('#coRunBtn');
  const exportBtn = root.querySelector('#coExportBtn');
  if (runBtn)    wire(runBtn,    'click', () => onRender(root));
  if (exportBtn) wire(exportBtn, 'click', () => onExport(root));
}

export async function unmount(_root) {
  for (const off of _wired) off();
  _wired.clear();
  _envelope = null;
  _envelopeError = null;
}

function onRender(root) {
  const slot = root.querySelector('#coResultSlot');
  if (!slot) return;

  let html = renderStatusBadge(_envelope, _envelopeError);

  if (!_envelope) {
    html += '<div class="co-empty">Nothing to render — no envelope.</div>';
    slot.innerHTML = html;
    return;
  }
  const events = (_envelope.payload && _envelope.payload.events) || [];
  const classV   = root.querySelector('#coClass')?.value   || 'ALL_CO_LIKE';
  const displayV = root.querySelector('#coDisplay')?.value || 'count';
  const chromV   = root.querySelector('#coChrom')?.value   || 'all';

  const filtered = filterEvents(events, chromV);
  const scope    = classPred(classV);

  if      (displayV === 'count')       html += renderPerDyadChrom(filtered, scope);
  else if (displayV === 'rate_per_mb') html += renderRatePerMb(filtered, scope);
  else if (displayV === 'position')    html += renderBreakpointTrack(filtered, scope);
  else if (displayV === 'karyo_strat') html += renderKaryotypeRate(filtered, scope);
  else                                 html += _emptyMsg('Unknown view.');

  slot.innerHTML = html;
}

function onExport(root) {
  // Export the currently-filtered events as TSV.
  if (!_envelope) return;
  const events = (_envelope.payload && _envelope.payload.events) || [];
  const chromV = root.querySelector('#coChrom')?.value || 'all';
  const filtered = filterEvents(events, chromV);
  if (filtered.length === 0) return;

  const cols = Array.from(filtered.reduce((s, e) => {
    for (const k of Object.keys(e)) s.add(k);
    return s;
  }, new Set()));
  const tsv = [cols.join('\t')].concat(
    filtered.map(e => cols.map(c => (e[c] == null) ? '' : String(e[c])).join('\t'))
  ).join('\n');

  const blob = new Blob([tsv], { type: 'text/tab-separated-values' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = `crossovers_${chromV}.tsv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
