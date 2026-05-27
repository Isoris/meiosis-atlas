// atlases/meiosis/pages/hub/nco.js
// =============================================================================
// NCO page — gene conversion / non-crossover events.
//
// Data source: a `tract_classifications_v1` envelope produced by the
// meiosis-atlas's normalize_tract_classifications action (which promotes a
// staging_tract_classifications_v0 envelope from ngsTracts STEP_TRC_01
// output). See specs_done/SPEC_tract_classifications_adapter.md.
//
// mount() probes for the latest normalized envelope; renders a status
// badge advertising layer_id + n_tracts + class_counts. When no envelope
// exists (e.g. action pipeline not yet run on this workspace), the badge
// says so and the controls remain inert. Fail-soft on fetch errors.
//
// Render views (against envelope.payload.tracts[]):
//   per_dyad     — (parent_id, offspring_id) × tract count
//   length_hist  — 10-bucket span_bp histogram
//   per_chrom    — chrom × tract count
//   in_vs_out    — inside_inversion = yes/no, by class (the headline view)
// =============================================================================

import { resolveLatestLayer, dispatchMeiosisChain } from '../../shared/api_client.js';

// ---------------------------------------------------------------------------
// Page-local state. Reset on unmount().
// ---------------------------------------------------------------------------
const _wired = new Set();
let _envelope = null;          // tract_classifications_v1 envelope, or null
let _envelopeError = null;     // string when fetch failed (fail-soft)

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
// Filtering
// ---------------------------------------------------------------------------

// Map a `ncoClass` <select> value to a predicate over a tract row.
function _classPred(value) {
  if (value === 'NCO')          return t => t.class === 'NCO';
  if (value === 'MOSAIC_SHORT') return t => t.class === 'MOSAIC_SHORT';
  if (value === 'MOSAIC_LONG')  return t => t.class === 'MOSAIC_LONG';
  // ALL_NCO_LIKE: NCO + MOSAIC_SHORT (gene-conversion-like — excludes
  // MOSAIC_LONG which is the suspicious-long bucket).
  return t => t.class === 'NCO' || t.class === 'MOSAIC_SHORT';
}

function _scopePred(value) {
  if (value === 'inside_inv')  return t => t.inside_inversion === 'yes';
  if (value === 'outside_inv') return t => t.inside_inversion === 'no';
  return _ => true;
}

export function filterTracts(tracts, classValue, scopeValue) {
  const pc = _classPred(classValue);
  const ps = _scopePred(scopeValue);
  return tracts.filter(t => pc(t) && ps(t));
}

// ---------------------------------------------------------------------------
// View renderers — all take filtered tracts, return HTML.
// ---------------------------------------------------------------------------

export function renderPerDyad(tracts) {
  const by = new Map();
  for (const t of tracts) {
    const k = `${t.parent_id} → ${t.offspring_id}`;
    by.set(k, (by.get(k) || 0) + 1);
  }
  if (by.size === 0) return _emptyMsg('No tracts match this filter.');
  const rows = Array.from(by.entries()).sort((a, b) => b[1] - a[1]);
  return `
    <table class="nco-tbl">
      <thead><tr><th>dyad (parent → offspring)</th><th>n_tracts</th></tr></thead>
      <tbody>${rows.map(([k, n]) => `<tr><td>${esc(k)}</td><td style="text-align:right">${n}</td></tr>`).join('')}</tbody>
    </table>`;
}

export function renderLengthHist(tracts) {
  const lens = tracts.map(t => Number(t.span_bp)).filter(Number.isFinite);
  if (lens.length === 0) return _emptyMsg('No tracts match this filter.');
  const lo = Math.min(...lens), hi = Math.max(...lens);
  const nBins = 10;
  // Avoid div-by-zero when all values are identical.
  const width = (hi - lo) || 1;
  const bins = new Array(nBins).fill(0);
  for (const v of lens) {
    let i = Math.floor(((v - lo) / width) * nBins);
    if (i >= nBins) i = nBins - 1;
    if (i < 0) i = 0;
    bins[i]++;
  }
  const max = Math.max(...bins);
  return `
    <div class="nco-hist-meta">${lens.length} tract${lens.length === 1 ? '' : 's'} · ${esc(lo)}–${esc(hi)} bp</div>
    <table class="nco-tbl nco-hist">
      <thead><tr><th>bin (bp)</th><th>n</th><th>bar</th></tr></thead>
      <tbody>${bins.map((n, i) => {
        const a = Math.round(lo + (i      / nBins) * width);
        const b = Math.round(lo + ((i + 1) / nBins) * width);
        const pct = max ? Math.round((n / max) * 100) : 0;
        return `<tr><td>${esc(a)}–${esc(b)}</td><td style="text-align:right">${n}</td><td><div class="nco-bar" style="width:${pct}%"></div></td></tr>`;
      }).join('')}</tbody>
    </table>`;
}

export function renderPerChrom(tracts) {
  const by = new Map();
  for (const t of tracts) {
    const k = t.chrom || '(unknown)';
    by.set(k, (by.get(k) || 0) + 1);
  }
  if (by.size === 0) return _emptyMsg('No tracts match this filter.');
  const rows = Array.from(by.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  return `
    <table class="nco-tbl">
      <thead><tr><th>chrom</th><th>n_tracts</th></tr></thead>
      <tbody>${rows.map(([k, n]) => `<tr><td>${esc(k)}</td><td style="text-align:right">${n}</td></tr>`).join('')}</tbody>
    </table>`;
}

export function renderInVsOut(tracts) {
  // Per (class, inside_inversion) tally. The headline view: MOSAIC_SHORT
  // inside inversions is the gene-conversion-enrichment signal.
  const classes = ['NCO', 'MOSAIC_SHORT', 'MOSAIC_LONG'];
  const states  = ['yes', 'partial', 'no'];
  const tab = new Map();
  for (const c of classes) for (const s of states) tab.set(`${c}|${s}`, 0);
  for (const t of tracts) {
    const c = t.class, s = t.inside_inversion;
    if (!classes.includes(c) || !states.includes(s)) continue;
    tab.set(`${c}|${s}`, tab.get(`${c}|${s}`) + 1);
  }
  return `
    <table class="nco-tbl nco-cross">
      <thead><tr><th>class</th>${states.map(s => `<th>${esc(s)}</th>`).join('')}<th>total</th></tr></thead>
      <tbody>${classes.map(c => {
        const row = states.map(s => tab.get(`${c}|${s}`));
        const tot = row.reduce((a, b) => a + b, 0);
        return `<tr><td><strong>${esc(c)}</strong></td>${row.map((n, i) => `<td style="text-align:right${i === 0 && c === 'MOSAIC_SHORT' && n > 0 ? '; font-weight:600; color:var(--accent)' : ''}">${n}</td>`).join('')}<td style="text-align:right">${tot}</td></tr>`;
      }).join('')}</tbody>
    </table>
    <div class="nco-hint">Bold amber: MOSAIC_SHORT × yes — gene-conversion tracts inside inversions, the meiosis-atlas headline signal.</div>`;
}

function _emptyMsg(msg) {
  return `<div class="nco-empty">${esc(msg)}</div>`;
}

// ---------------------------------------------------------------------------
// Status badge — always-on summary at the top of the result slot.
// ---------------------------------------------------------------------------

export function renderStatusBadge(envelope, error) {
  if (error) {
    return `<div class="nco-badge nco-badge-warn">⚠ envelope fetch failed — ${esc(error)}. Render will run against any previously cached state.</div>`;
  }
  if (!envelope) {
    return `<div class="nco-badge nco-badge-empty">No <code>tract_classifications_v1</code> envelope in this workspace yet. Submit <code>import_tract_classifications</code> + <code>normalize_tract_classifications</code> to populate (see specs_done/SPEC_tract_classifications_adapter.md).</div>`;
  }
  const s = (envelope.payload && envelope.payload.summary) || {};
  const cc = s.class_counts || {};
  const parts = [
    `<strong>${esc(envelope.layer_id || '?')}</strong>`,
    `${s.n_tracts || 0} tracts`,
    `${s.n_dyads || 0} dyads`,
    `${s.n_chroms || 0} chroms`,
    `inside_inv: ${s.n_inside_inversion || 0}`,
    `NCO: ${cc.NCO || 0}`,
    `MOSAIC_SHORT: ${cc.MOSAIC_SHORT || 0}`,
    `MOSAIC_LONG: ${cc.MOSAIC_LONG || 0}`,
  ];
  return `<div class="nco-badge nco-badge-ok">${parts.join(' · ')}</div>`;
}

// ---------------------------------------------------------------------------
// Mount / unmount
// ---------------------------------------------------------------------------

export async function mount(root, ctx = {}) {
  // Restore the result slot to its empty state on every mount.
  const slot = root.querySelector('#ncoResultSlot');
  if (slot) slot.innerHTML = '<div class="nco-empty">Loading envelope…</div>';

  // Probe for the latest tract_classifications_v1 envelope. Fail-soft.
  _envelope = null;
  _envelopeError = null;
  try {
    _envelope = await resolveLatestLayer('tract_classifications', { stage: 'normalized' });
  } catch (e) {
    _envelopeError = (e && e.message) || String(e);
  }

  // Render the status badge immediately so the user knows whether data is
  // present without clicking Render.
  if (slot) slot.innerHTML = renderStatusBadge(_envelope, _envelopeError);

  const runBtn    = root.querySelector('#ncoRunBtn');
  const exportBtn = root.querySelector('#ncoExportBtn');
  if (runBtn)    wire(runBtn,    'click', () => onRender(root));
  if (exportBtn) wire(exportBtn, 'click', () => onExport(root));
}

export async function unmount(_root) {
  for (const off of _wired) off();
  _wired.clear();
  _envelope = null;
  _envelopeError = null;
}

// Render the server-side chain result envelope (nco_enrichment_result_v1).
// Same conceptual table as renderInVsOut, but the numbers come from the
// promoted biomod module via POST /api/actions — so Fisher exact +
// log-odds + one-sided-greater p (the manuscript headline) are available.
export function renderServerResult(payload) {
  if (!payload || !payload.result) {
    return _emptyMsg('Server result envelope missing the result block.');
  }
  const r = payload.result;
  const s = payload.summary || {};
  const fmt = (v, d = 3) => (v == null || Number.isNaN(v)) ? '—'
    : (typeof v === 'number' ? v.toExponential(d).replace(/e([+-])0+/, 'e$1') : String(v));
  return `
    <div class="nco-server-result">
      <table class="nco-tbl">
        <thead><tr>
          <th>${esc(r.target_class)}</th>
          <th>inside inversion</th>
          <th>outside inversion</th>
        </tr></thead>
        <tbody>
          <tr><td>${esc(r.target_class)}</td>
              <td style="text-align:right">${r.n_inside_target}</td>
              <td style="text-align:right">${r.n_outside_target}</td></tr>
          <tr><td>other NCO-like</td>
              <td style="text-align:right">${r.n_inside_other_nco_like}</td>
              <td style="text-align:right">${r.n_outside_other_nco_like}</td></tr>
        </tbody>
      </table>
      <div class="nco-stat-line">
        odds ratio: <b>${fmt(r.odds_ratio)}</b>
        · log-odds: <b>${fmt(r.log_odds)}</b>
        · p<sub>two-sided</sub>: <b>${fmt(r.p_fisher_two_sided)}</b>
        · p<sub>one-sided (greater)</sub>: <b>${fmt(r.p_fisher_one_sided_greater)}</b>
      </div>
      <div class="nco-stat-meta">
        n_total_tracts=${s.n_total_tracts ?? '—'} ·
        n_excluded=${s.n_excluded_tracts ?? '—'} ·
        target_class_overall=${s.n_target_class_overall ?? '—'}
      </div>
    </div>`;
}

function _renderServerBadge(root, msg, kind = 'info') {
  const b = root.querySelector('#ncoServerBadge');
  if (!b) return;
  b.hidden = false;
  b.className = `nco-server-badge nco-server-${kind}`;
  b.innerHTML = msg;
}

function _hideServerBadge(root) {
  const b = root.querySelector('#ncoServerBadge');
  if (!b) return;
  b.hidden = true;
  b.innerHTML = '';
}

async function onRender(root) {
  const slot = root.querySelector('#ncoResultSlot');
  if (!slot) return;

  // Status badge always re-renders on top, so the user can see the
  // envelope they're rendering against.
  let html = renderStatusBadge(_envelope, _envelopeError);

  if (!_envelope) {
    html += '<div class="nco-empty">Nothing to render — no envelope.</div>';
    slot.innerHTML = html;
    _hideServerBadge(root);
    return;
  }
  const tracts = (_envelope.payload && _envelope.payload.tracts) || [];
  const classV = root.querySelector('#ncoClass')?.value || 'ALL_NCO_LIKE';
  const scopeV = root.querySelector('#ncoScope')?.value || 'all';
  const viewV  = root.querySelector('#ncoView')?.value  || 'per_dyad';

  // Server compute is only meaningful for the in_vs_out view (that's the
  // chain bloc that's been promoted). For other views we silently use
  // the browser path.
  const useServer = !!root.querySelector('#ncoServerCompute')?.checked
                  && viewV === 'in_vs_out';

  if (useServer) {
    _renderServerBadge(root,
      `Dispatching <code>compute_nco_inside_vs_outside_inversion</code> on layer <code>${esc(_envelope.layer_id || '?')}</code>…`,
      'info');
    const targetClass = (classV === 'MOSAIC_SHORT' || classV === 'NCO')
      ? classV : 'MOSAIC_SHORT';   // server contract only accepts these two
    const resp = await dispatchMeiosisChain('nco',
      { source_layer_id: _envelope.layer_id },
      { target_class: targetClass });
    if (resp.ok) {
      _renderServerBadge(root,
        `● server: <code>${esc(resp.type)}</code> · target_class=<code>${esc(targetClass)}</code>`,
        'ok');
      slot.innerHTML = html + renderServerResult(resp.body && resp.body.payload || resp.body);
      return;
    }
    // Fall through to the browser path on dispatch failure (auto mode).
    _renderServerBadge(root,
      `◐ server unreachable — using browser compute. <small>${esc(resp.error || '')}</small>`,
      'warn');
  } else {
    _hideServerBadge(root);
  }

  const filtered = filterTracts(tracts, classV, scopeV);

  if      (viewV === 'per_dyad')    html += renderPerDyad(filtered);
  else if (viewV === 'length_hist') html += renderLengthHist(filtered);
  else if (viewV === 'per_chrom')   html += renderPerChrom(filtered);
  else if (viewV === 'in_vs_out')   html += renderInVsOut(filtered);
  else                              html += _emptyMsg('Unknown view.');

  slot.innerHTML = html;
}

function onExport(root) {
  // Export the currently-filtered tracts as TSV. Simple Blob download —
  // no server roundtrip.
  if (!_envelope) return;
  const tracts = (_envelope.payload && _envelope.payload.tracts) || [];
  const classV = root.querySelector('#ncoClass')?.value || 'ALL_NCO_LIKE';
  const scopeV = root.querySelector('#ncoScope')?.value || 'all';
  const filtered = filterTracts(tracts, classV, scopeV);
  if (filtered.length === 0) return;

  // Union of all keys across rows = TSV header.
  const cols = Array.from(filtered.reduce((s, t) => {
    for (const k of Object.keys(t)) s.add(k);
    return s;
  }, new Set()));
  const tsv = [cols.join('\t')].concat(
    filtered.map(t => cols.map(c => (t[c] === null || t[c] === undefined) ? '' : String(t[c])).join('\t'))
  ).join('\n');

  const blob = new Blob([tsv], { type: 'text/tab-separated-values' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = `nco_tracts_${classV}_${scopeV}.tsv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
