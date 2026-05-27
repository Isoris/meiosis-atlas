// atlases/meiosis/pages/hub/interchromosomal.js
// =============================================================================
// Interchromosomal page — HEADLINE of the meiosis-atlas.
//
// Tests whether a focal inversion's karyotype on chrom X alters meiosis
// (CO rate today; DCO rate + C reserved) on chromosomes OTHER than X.
//
// Reads four normalized envelopes:
//   - chromosome_meiosis_events_v1      → CO counts per dyad × chrom
//   - local_inv_controls_v1             → per-chrom local-inversion burden
//   - family_aware_permutation_design_v1 → karyotype labels + permutation blocks
//   - coincidence_matrix_v1             → C per interval pair (reserved)
//
// Pipeline (per page-mount):
//   1. Probe all four envelopes via resolveLatestLayer. Fail-soft: if ANY
//      is missing, the page renders an empty-state status badge (NO fake
//      data — see _demo.js for the opt-in demo mode).
//   2. Populate the focal-inversion dropdown from family_aware_permutation_design.
//   3. On Run: call runInterchromosomalTests against the current UI
//      selections, render the result table with per-(focal × chrom) rows.
//   4. p-BH < alpha rows are highlighted in red (the manuscript-grade
//      "interchromosomal effect detected" signal).
//
// Demo mode (?demo=1 or localStorage.atlasDemoMode=1): bypass the
// envelope probes and load synthetic envelopes from _demo.js. ONE row
// in the result table is designed to be statistically significant under
// the default seed.
// =============================================================================

import { resolveLatestLayer, dispatchMeiosisChain } from '../../shared/api_client.js';
import { runInterchromosomalTests, mulberry32 } from './interchromosomal/_stats.js';
import { isDemoMode, DEMO_ENVELOPES } from './interchromosomal/_demo.js';

// ---------------------------------------------------------------------------
// Page-local state. Reset on unmount().
// ---------------------------------------------------------------------------

const _wired = new Set();
let _envelopes = null;       // { cme, lic, fapd, cm } when fully loaded, else null
let _envelopeError = null;   // { layer_type, message } when fetch failed
let _missingLayers = [];     // array of layer types missing
let _demoActive = false;     // true when ?demo=1 supplied the envelopes
let _lastResult = null;      // last { rows, summary } for Export

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

function _fmt(v, digits = 3) {
  if (v == null || !isFinite(v)) return '—';
  return v.toFixed(digits);
}

// ---------------------------------------------------------------------------
// Envelope probe — fetches all four; returns null if any required is missing.
// ---------------------------------------------------------------------------

const REQUIRED_LAYER_TYPES = [
  ['cme',  'chromosome_meiosis_events'],
  ['lic',  'local_inv_controls'],
  ['fapd', 'family_aware_permutation_design'],
  ['cm',   'coincidence_matrix'],
];

async function _probeEnvelopes() {
  const out = {};
  const missing = [];
  let errMsg = null;
  for (const [key, layerType] of REQUIRED_LAYER_TYPES) {
    try {
      const env = await resolveLatestLayer(layerType, { stage: 'normalized' });
      if (env) out[key] = env;
      else     missing.push(layerType);
    } catch (e) {
      errMsg = `${layerType}: ${(e && e.message) || String(e)}`;
      missing.push(layerType);
    }
  }
  return { envelopes: missing.length === 0 ? out : null, missing, errMsg };
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

export function renderStatusBadge(envelopes, missing, errMsg, demoActive) {
  if (demoActive) {
    return `<div class="ic-badge ic-badge-demo">⚙ <strong>DEMO MODE</strong> — synthetic envelopes loaded from <code>_demo.js</code>. No production data. Disable via removing <code>?demo=1</code> / <code>localStorage.atlasDemoMode</code>.</div>`;
  }
  if (errMsg) {
    return `<div class="ic-badge ic-badge-warn">⚠ envelope fetch failed — ${esc(errMsg)}. Run will not start until all four envelopes resolve.</div>`;
  }
  if (!envelopes) {
    const list = missing.length
      ? missing.map(m => `<code>${esc(m)}</code>`).join(', ')
      : '(none reported)';
    return `<div class="ic-badge ic-badge-empty">No interchromosomal compute available — missing envelope(s): ${list}. Submit the corresponding import + normalize actions to populate. See specs_done/SPEC_*_adapter.md.</div>`;
  }
  // Healthy badge with summary numbers.
  const fapdS = (envelopes.fapd.payload && envelopes.fapd.payload.summary) || {};
  const cmeS  = (envelopes.cme.payload  && envelopes.cme.payload.summary)  || {};
  const licS  = (envelopes.lic.payload  && envelopes.lic.payload.summary)  || {};
  const parts = [
    `<strong>${esc(envelopes.fapd.layer_id || '?')}</strong>`,
    `${fapdS.n_focal_inversions || 0} focal inv`,
    `${fapdS.n_parents || 0} parents`,
    `${fapdS.n_families || 0} families`,
    `${cmeS.n_chroms || 0} chroms in CME`,
    `${licS.n_controls || 0} local controls`,
    `singleton blocks: ${fapdS.n_singleton_blocks || 0}`,
  ];
  return `<div class="ic-badge ic-badge-ok">${parts.join(' · ')}</div>`;
}

// ---------------------------------------------------------------------------
// Result table renderer
// ---------------------------------------------------------------------------

export function renderResultTable(result) {
  const { rows, summary } = result;
  if (!rows || rows.length === 0) {
    return `<div class="ic-empty">No tests produced — check focal inversion selection.</div>`;
  }

  const focalChrom = summary.focal_chrom || '—';
  const headline = `<div class="ic-summary">
    Focal inversion <code>${esc(summary.focal_inversion_id)}</code>
    on chrom <code>${esc(focalChrom)}</code> · ${summary.n_tests} tested chrom(s) ·
    ${summary.n_sig_bh} signal(s) at p-BH &lt; ${summary.p_bh_alpha}.
    Permutations: ${summary.n_permutations.toLocaleString()}.
  </div>`;

  const head = `
    <tr>
      <th>tested chrom</th>
      <th>n het</th>
      <th>n non-het</th>
      <th>mean diff (CO/Mb)</th>
      <th>t</th>
      <th>p (perm)</th>
      <th>p-Bonf</th>
      <th>p-BH</th>
      <th>local inv burden</th>
      <th>flag</th>
    </tr>`;
  const body = rows.map(r => {
    const rowCls = r.sig_flag ? ' class="ic-sig"' : (r.is_focal_chrom ? ' class="ic-focal-row"' : '');
    const flag = r.is_focal_chrom
      ? '<span class="ic-pill ic-pill-focal">focal chrom</span>'
      : (r.sig_flag ? '<span class="ic-pill ic-pill-sig">p-BH&nbsp;sig</span>' : '');
    const burden = r.local_inv_burden && r.local_inv_burden.n_local_invs
      ? `${r.local_inv_burden.n_local_invs} inv (${Math.round((r.local_inv_burden.total_local_length_bp || 0) / 1e6)} Mb)`
      : '—';
    return `<tr${rowCls}>
      <td><code>${esc(r.tested_chrom)}</code></td>
      <td style="text-align:right">${r.n_het}</td>
      <td style="text-align:right">${r.n_nonhet}</td>
      <td style="text-align:right">${_fmt(r.mean_diff, 4)}</td>
      <td style="text-align:right">${_fmt(r.t_stat)}</td>
      <td style="text-align:right">${_fmt(r.p_value, 4)}</td>
      <td style="text-align:right">${_fmt(r.p_bonf, 4)}</td>
      <td style="text-align:right">${_fmt(r.p_bh, 4)}</td>
      <td style="text-align:right">${burden}</td>
      <td>${flag}</td>
    </tr>`;
  }).join('');

  return headline + `<table class="ic-tbl"><thead>${head}</thead><tbody>${body}</tbody></table>`;
}

// ---------------------------------------------------------------------------
// Mount / unmount
// ---------------------------------------------------------------------------

function _populateFocalDropdown(root, fapdEnv) {
  const sel = root.querySelector('#icFocalInv');
  if (!sel) return;
  // Preserve the leading "— select —" option, then add one per focal_inv.
  const existing = Array.from(sel.options).filter(o => o.value !== '');
  for (const o of existing) sel.removeChild(o);
  const ids = new Set();
  const rows = (fapdEnv.payload && fapdEnv.payload.assignments) || [];
  for (const r of rows) if (r.focal_inversion_id) ids.add(r.focal_inversion_id);
  for (const id of Array.from(ids).sort()) {
    const o = document.createElement('option');
    o.value = id;
    o.textContent = id;
    sel.appendChild(o);
  }
}

export async function mount(root, ctx = {}) {
  const slot = root.querySelector('#icResultSlot');
  if (slot) slot.innerHTML = '<div class="ic-empty">Loading envelopes…</div>';

  _envelopes = null;
  _envelopeError = null;
  _missingLayers = [];
  _demoActive = isDemoMode(ctx);

  if (_demoActive) {
    _envelopes = DEMO_ENVELOPES;
  } else {
    const { envelopes, missing, errMsg } = await _probeEnvelopes();
    _envelopes = envelopes;
    _missingLayers = missing;
    if (errMsg) _envelopeError = errMsg;
  }

  if (slot) slot.innerHTML = renderStatusBadge(_envelopes, _missingLayers, _envelopeError, _demoActive);

  if (_envelopes) _populateFocalDropdown(root, _envelopes.fapd);

  const runBtn    = root.querySelector('#icRunBtn');
  const exportBtn = root.querySelector('#icExportBtn');
  if (runBtn)    wire(runBtn,    'click', () => onRun(root));
  if (exportBtn) wire(exportBtn, 'click', () => onExport(root));
}

export async function unmount(_root) {
  for (const off of _wired) off();
  _wired.clear();
  _envelopes = null;
  _envelopeError = null;
  _missingLayers = [];
  _demoActive = false;
  _lastResult = null;
}

function _renderServerBadge(root, msg, kind = 'info') {
  const b = root.querySelector('#icServerBadge');
  if (!b) return;
  b.hidden = false;
  b.className = `ic-server-badge ic-server-${kind}`;
  b.innerHTML = msg;
}

function _hideServerBadge(root) {
  const b = root.querySelector('#icServerBadge');
  if (!b) return;
  b.hidden = true;
  b.innerHTML = '';
}

async function onRun(root) {
  const slot = root.querySelector('#icResultSlot');
  if (!slot) return;

  let html = renderStatusBadge(_envelopes, _missingLayers, _envelopeError, _demoActive);

  if (!_envelopes) {
    html += '<div class="ic-empty">Nothing to compute — envelopes missing.</div>';
    slot.innerHTML = html;
    _hideServerBadge(root);
    return;
  }

  const focalId = root.querySelector('#icFocalInv')?.value;
  if (!focalId) {
    html += '<div class="ic-empty">Pick a focal inversion to begin.</div>';
    slot.innerHTML = html;
    _hideServerBadge(root);
    return;
  }

  const nPerms  = parseInt(root.querySelector('#icPermN')?.value || '10000', 10);
  const statSel = root.querySelector('#icStat')?.value || 'co_rate';
  const classScope = (statSel === 'dco_rate')
    ? { co: false, dco: true }
    : { co: true, dco: false };

  const useServer = !!root.querySelector('#icServerCompute')?.checked;

  // -------- server path ------------------------------------------------
  // Server compute requires real (non-demo) envelopes with registered
  // layer_ids. In demo mode the synthetic envelopes have no server-side
  // counterpart, so we silently skip the server path.
  if (useServer && !_demoActive) {
    const cmeId  = _envelopes.cme  && _envelopes.cme.layer_id;
    const licId  = _envelopes.lic  && _envelopes.lic.layer_id;
    const fapdId = _envelopes.fapd && _envelopes.fapd.layer_id;
    if (!cmeId || !fapdId) {
      _renderServerBadge(root,
        `◐ server path requires registered layer_ids on cme + fapd envelopes; falling back to browser compute.`,
        'warn');
    } else {
      _renderServerBadge(root,
        `Dispatching <code>compute_interchromosomal_inversion_effect</code> with ${nPerms.toLocaleString()} permutations…`,
        'info');
      const resp = await dispatchMeiosisChain('interchromosomal',
        { events_layer_id: cmeId,
          controls_layer_id: licId || undefined,
          design_layer_id: fapdId },
        { focal_inversion_id: focalId,
          include_co:  classScope.co,
          include_dco: classScope.dco,
          n_permutations: nPerms,
          p_bh_alpha: 0.05 });
      if (resp.ok) {
        const payload = (resp.body && resp.body.payload) || resp.body;
        if (payload && Array.isArray(payload.rows)) {
          _lastResult = payload;
          _renderServerBadge(root,
            `● server: <code>${esc(resp.type)}</code> · ${payload.summary?.n_tests ?? 0} tests · ${payload.summary?.n_sig_bh ?? 0} sig at BH</br>α=${payload.summary?.p_bh_alpha ?? '?'}`,
            'ok');
          slot.innerHTML = html + renderResultTable(payload);
          return;
        }
      }
      _renderServerBadge(root,
        `◐ server unreachable — using browser compute. <small>${esc(resp.error || 'unexpected payload shape')}</small>`,
        'warn');
    }
  } else {
    _hideServerBadge(root);
  }

  // -------- browser path (default + fallback) --------------------------
  // RNG: deterministic in demo mode (so the significant cell is reproducible);
  // Math.random in production (so reruns don't have artificial reproducibility).
  const rng = _demoActive ? mulberry32(42) : Math.random;

  let result;
  try {
    result = runInterchromosomalTests(_envelopes, {
      focal_inversion_id: focalId,
      class_scope:        classScope,
      n_permutations:     nPerms,
      rng:                rng,
      p_bh_alpha:         0.05,
    });
  } catch (e) {
    html += `<div class="ic-empty">Compute failed: ${esc((e && e.message) || String(e))}</div>`;
    slot.innerHTML = html;
    return;
  }

  _lastResult = result;
  html += renderResultTable(result);
  slot.innerHTML = html;
}

function onExport(root) {
  if (!_lastResult || !_lastResult.rows || _lastResult.rows.length === 0) return;
  const rows = _lastResult.rows;
  const cols = ['focal_inversion_id', 'tested_chrom', 'is_focal_chrom',
                'n_het', 'n_nonhet', 'mean_diff', 't_stat',
                'p_value', 'p_bonf', 'p_bh', 'sig_flag',
                'local_inv_n', 'local_inv_total_length_bp'];
  const tsv = [cols.join('\t')].concat(rows.map(r => {
    const b = r.local_inv_burden || {};
    return [
      r.focal_inversion_id, r.tested_chrom, String(!!r.is_focal_chrom),
      r.n_het, r.n_nonhet,
      r.mean_diff, r.t_stat, r.p_value, r.p_bonf, r.p_bh, String(!!r.sig_flag),
      b.n_local_invs || 0, b.total_local_length_bp || 0,
    ].map(v => v == null ? '' : String(v)).join('\t');
  })).join('\n');

  const blob = new Blob([tsv], { type: 'text/tab-separated-values' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = `interchromosomal_${_lastResult.summary.focal_inversion_id}.tsv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
