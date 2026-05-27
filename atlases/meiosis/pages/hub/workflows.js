// atlases/meiosis/pages/hub/workflows.js
// =============================================================================
// Workflows page — user-facing view of the catalogue_outbound forwarding
// payload. Reads the four JSONL files emitted by
// generate_catalogue_outbound.py and joins them so each row in the
// table shows: analysis_id × kind × module (with biomod_status) × produces
// × required dimensions × computed bloc-status badge.
//
// JSONL files are static repo artefacts; the page fetches them directly.
// For `ready` chain rows the detail panel ALSO exposes a Run button that
// dispatches the chain action via POST /api/actions and renders the
// typed result envelope inline. Tests mock both fetches.
// =============================================================================

import { runAction } from '../../shared/api_client.js';

const CATALOGUE_BASE = '/atlases/meiosis/registries/catalogue_outbound';
const FILES = {
  modules:  'module_registry.jsonl',
  analyses: 'analysis_registry.jsonl',
  modes:    'analysis_modes.jsonl',
  layers:   'layer_registry.jsonl',
  pages:    'pages_registry.jsonl',
};

const _wired = new Set();
let _payload = null;          // { modules, analyses, modes, layers } or null
let _payloadError = null;     // string when fetch failed (fail-soft)

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
// JSONL parsing + payload fetch
// ---------------------------------------------------------------------------

export function parseJSONL(text) {
  const out = [];
  for (const line of String(text || '').split('\n')) {
    const s = line.trim();
    if (!s) continue;
    out.push(JSON.parse(s));
  }
  return out;
}

async function _fetchJSONL(name) {
  const url = `${CATALOGUE_BASE}/${name}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`${resp.status} on ${url}`);
  return parseJSONL(await resp.text());
}

async function _fetchJSONLOptional(name) {
  // pages_registry.jsonl may not yet exist on older atlas-core installs;
  // treat 404 as an empty list rather than a hard failure.
  try {
    return await _fetchJSONL(name);
  } catch (e) {
    if (String(e?.message || '').startsWith('404 ')) return [];
    throw e;
  }
}

export async function fetchPayload() {
  const [modules, analyses, modes, layers, pages] = await Promise.all([
    _fetchJSONL(FILES.modules),
    _fetchJSONL(FILES.analyses),
    _fetchJSONL(FILES.modes),
    _fetchJSONL(FILES.layers),
    _fetchJSONLOptional(FILES.pages),
  ]);
  return { modules, analyses, modes, layers, pages };
}

// ---------------------------------------------------------------------------
// Join + status inference
// ---------------------------------------------------------------------------

// Compute the per-row bloc status from a module entry.
// 'contract_only' = no builder yet (installed=false OR biomod_status=contract_only)
// 'stale'         = stale flag set (e.g. promotion_from_browser_js)
// 'ready'         = installed + not stale
export function inferBlocStatus(mod) {
  if (!mod) return 'unknown';
  if (String(mod.biomod_status) === 'contract_only') return 'contract_only';
  if (String(mod.installed).toLowerCase() === 'false') return 'contract_only';
  if (mod.stale && String(mod.stale).trim()) return 'stale';
  return 'ready';
}

// Returns sorted joined rows: one per analysis_modes row, with referenced
// analysis + module pulled into the same object for ergonomic rendering.
export function joinPayload(p) {
  const modByName  = new Map(p.modules.map(m => [m.module_name, m]));
  const anaById    = new Map(p.analyses.map(a => [a.analysis_id, a]));
  const layerById  = new Map(p.layers.map(l => [l.layer_id, l]));

  return p.modes.map(mode => {
    const ana   = anaById.get(mode.analysis_type)   || null;
    const mod   = modByName.get(mode.module_name)   || null;
    const layer = layerById.get(mode.produces)      || null;
    return {
      analysis_id: mode.analysis_type,
      kind:        ana ? ana.kind : 'unknown',
      label:       ana ? ana.label : mode.label,
      module_name: mode.module_name,
      biomod_status: mod ? mod.biomod_status : 'unknown',
      bloc_status: inferBlocStatus(mod),
      produces:    mode.produces,
      layer_label: layer ? layer.label : '',
      required_dimensions: mode.required_dimensions || [],
      notes:       mode.notes || (ana && ana.notes) || '',
      stale_reason: mod ? (mod.stale_reason || '') : '',
    };
  });
}

// ---------------------------------------------------------------------------
// Constraint validation (mirrors atlas-core's smoke test)
// ---------------------------------------------------------------------------

export function validateConstraints(p) {
  const errors = [];
  const modNames    = new Set(p.modules.map(m => m.module_name));
  const analysisIds = new Set(p.analyses.map(a => a.analysis_id));
  const producesBy  = new Map(p.analyses.map(a => [a.analysis_id, new Set(a.produces || [])]));

  for (const m of p.modes) {
    if (!analysisIds.has(m.analysis_type)) {
      errors.push(`mode analysis_type ${m.analysis_type} not in analysis_registry`);
    }
    if (!modNames.has(m.module_name)) {
      errors.push(`mode module_name ${m.module_name} not in module_registry`);
    }
    if (Array.isArray(m.produces)) {
      errors.push(`mode produces must be single-valued, got list for ${m.analysis_type}`);
    } else if (analysisIds.has(m.analysis_type) && !producesBy.get(m.analysis_type).has(m.produces)) {
      errors.push(`mode produces ${m.produces} not in analysis_registry[${m.analysis_type}].produces`);
    }
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function _statusChip(status) {
  if (status === 'ready')         return `<span class="wf-chip wf-chip-ok">● ready</span>`;
  if (status === 'stale')         return `<span class="wf-chip wf-chip-warn">◐ stale</span>`;
  if (status === 'contract_only') return `<span class="wf-chip wf-chip-dim">○ contract-only</span>`;
  return `<span class="wf-chip wf-chip-dim">? unknown</span>`;
}

function _kindChip(kind) {
  const k = String(kind || 'unknown').replace(/_/g, ' ');
  const cls = kind === 'chain' ? 'wf-kind-chain'
            : kind === 'adapter' ? 'wf-kind-adapter'
            : 'wf-kind-track';
  return `<span class="wf-kind-chip ${cls}">${esc(k)}</span>`;
}

export function renderBadge(p, errors) {
  const n_chain = p.analyses.filter(a => a.kind === 'chain').length;
  const n_atom  = p.analyses.filter(a => a.kind === 'adapter').length;
  const n_track = p.analyses.filter(a => a.kind === 'track_builder' || a.kind === 'motif_finder').length;
  const n_pg    = (p.pages || []).length;
  const ok = errors.length === 0;
  const okClass = ok ? 'wf-badge-ok' : 'wf-badge-warn';
  const okText = ok
    ? `${esc(p.modes.length)} blocs · ${n_atom} atomic · ${n_chain} chain · ${n_track} track · ${n_pg} pages · constraints PASS`
    : `${errors.length} constraint violation(s) — see console`;
  return `<div class="wf-badge ${okClass}">${okText}</div>`;
}

export function renderPagesTable(pages) {
  if (!pages || pages.length === 0) return '';
  const tr = pages.map(p => {
    const miss = (p.missing_layers || []).length
      ? `<div class="wf-sub wf-miss">missing layers: ${esc((p.missing_layers || []).join(', '))}</div>`
      : '';
    const prods = (p.products || []).join(', ');
    return `
      <tr class="wf-pg-row">
        <td><code>${esc(p.page_id)}</code><div class="wf-sub">${esc(p.label || '')}</div></td>
        <td class="wf-dim">${esc(p.stage || '')}</td>
        <td class="wf-dim">${esc((p.requires_layers || []).join(', ')) || '—'}${miss}</td>
        <td class="wf-dim">${esc(prods) || '—'}</td>
      </tr>`;
  }).join('');
  return `
    <details class="wf-pages-block" open>
      <summary>pages (${pages.length})</summary>
      <table class="wf-tbl wf-pg-tbl">
        <thead><tr>
          <th>page_id</th><th>stage</th><th>requires_layers</th><th>products</th>
        </tr></thead>
        <tbody>${tr}</tbody>
      </table>
    </details>`;
}

export function renderTable(rows) {
  if (rows.length === 0) {
    return `<div class="wf-empty">No blocs match this filter.</div>`;
  }
  const tr = rows.map(r => `
    <tr class="wf-row wf-status-${esc(r.bloc_status)}" data-analysis-id="${esc(r.analysis_id)}" tabindex="0" title="Click for details">
      <td>${_kindChip(r.kind)}</td>
      <td><code>${esc(r.analysis_id)}</code><div class="wf-sub">${esc(r.label)}</div></td>
      <td><code>${esc(r.module_name)}</code><div class="wf-sub">${esc(r.biomod_status)}</div></td>
      <td><code>${esc(r.produces)}</code>${r.layer_label ? `<div class="wf-sub">${esc(r.layer_label)}</div>` : ''}</td>
      <td class="wf-dim">${esc((r.required_dimensions || []).join(', '))}</td>
      <td>${_statusChip(r.bloc_status)}${r.stale_reason ? `<div class="wf-sub">${esc(r.stale_reason)}</div>` : ''}</td>
    </tr>`).join('');
  return `
    <table class="wf-tbl">
      <thead><tr>
        <th>kind</th><th>analysis</th><th>module</th><th>produces</th>
        <th>required_dimensions</th><th>status</th>
      </tr></thead>
      <tbody>${tr}</tbody>
    </table>`;
}

export function filterRows(rows, { kind, status }) {
  return rows.filter(r => {
    if (kind   && kind   !== 'all' && r.kind        !== kind)   return false;
    if (status && status !== 'all' && r.bloc_status !== status) return false;
    return true;
  });
}

// ---------------------------------------------------------------------------
// Details panel — opened on row click or via #workflows/<analysis_id> hash.
// Pulls the full analysis + module + layer + mode entries side-by-side.
// ---------------------------------------------------------------------------

export function buildDetail(p, analysisId) {
  if (!p) return null;
  const ana   = p.analyses.find(a => a.analysis_id === analysisId) || null;
  const mode  = p.modes.find(m => m.analysis_type === analysisId)  || null;
  const mod   = mode ? p.modules.find(m => m.module_name === mode.module_name) : null;
  const layer = mode ? p.layers.find(l  => l.layer_id    === mode.produces)    : null;
  if (!ana && !mode) return null;
  return { analysisId, ana, mode, mod, layer };
}

function _kvRow(label, value, mono) {
  if (value == null || value === '') return '';
  const v = mono ? `<code>${esc(value)}</code>` : esc(value);
  return `<tr><th>${esc(label)}</th><td>${v}</td></tr>`;
}

// Per-action target-shape contract — drives the Run section's input
// fields. Keyed by module.dispatch_action so the lookup matches the
// promoted server-side action exactly. Each entry lists the inputs the
// runner expects (their `key` is the field name inside POST body
// `target`); `optional: true` skips inclusion when blank.
export const TARGET_SHAPES = {
  'compute_nco_inside_vs_outside_inversion': {
    fields: [
      { key: 'source_layer_id', label: 'tract_classifications_v1 layer_id' },
    ],
    paramFields: [
      { key: 'target_class', label: 'target_class', default: 'MOSAIC_SHORT',
        hint: 'MOSAIC_SHORT or NCO' },
    ],
  },
  'compute_nco_per_candidate_enrichment': {
    fields: [
      { key: 'tracts_layer_id',     label: 'tract_classifications_v1 layer_id' },
      { key: 'candidates_layer_id', label: 'inversion_candidates_v1 layer_id (cross-atlas)' },
    ],
    paramFields: [
      { key: 'target_class', label: 'target_class', default: 'MOSAIC_SHORT' },
    ],
  },
  'compute_intrachromosomal_co_karyotype_effect': {
    fields: [
      { key: 'source_layer_id', label: 'chromosome_meiosis_events_v1 layer_id (karyo-stratified)' },
    ],
    paramFields: [
      { key: 'flag_threshold', label: 'flag_threshold', default: '0.7',
        hint: 'rate_ratio < threshold → flagged' },
    ],
  },
  'compute_interchromosomal_inversion_effect': {
    fields: [
      { key: 'events_layer_id',   label: 'chromosome_meiosis_events_v1 layer_id' },
      { key: 'design_layer_id',   label: 'family_aware_permutation_design_v1 layer_id' },
      { key: 'controls_layer_id', label: 'local_inv_controls_v1 layer_id (optional)',
        optional: true },
    ],
    paramFields: [
      { key: 'focal_inversion_id', label: 'focal_inversion_id',
        hint: 'leave blank to auto-pick the first sorted id' },
      { key: 'n_permutations',     label: 'n_permutations', default: '10000' },
      { key: 'seed',               label: 'seed (deterministic; leave blank for Math.random)',
        optional: true },
    ],
  },
};

// Build the POST /api/actions {target, params} from the form inputs.
// Strips blank-but-optional fields; coerces numeric param defaults.
export function buildDispatchManifest(dispatchAction, inputs, paramInputs) {
  const shape = TARGET_SHAPES[dispatchAction];
  if (!shape) {
    throw new Error(`unknown dispatch action: ${dispatchAction}`);
  }
  const target = {};
  for (const f of shape.fields) {
    const v = (inputs[f.key] || '').trim();
    if (!v) {
      if (f.optional) continue;
      throw new Error(`missing required input: ${f.label}`);
    }
    target[f.key] = v;
  }
  const params = {};
  for (const f of (shape.paramFields || [])) {
    let v = (paramInputs[f.key] ?? '').toString().trim();
    if (v === '') {
      if (f.optional) continue;
      if (f.default != null) v = String(f.default);
      else continue;
    }
    // Coerce numeric defaults — params declared with a numeric default
    // (n_permutations, seed, flag_threshold) get sent as numbers.
    if (f.default != null && /^-?\d+(\.\d+)?$/.test(String(f.default))) {
      const n = Number(v);
      if (!Number.isNaN(n)) v = n;
    } else if (f.key === 'seed' && /^-?\d+$/.test(v)) {
      v = Number(v);
    } else if (f.key === 'n_permutations' && /^-?\d+$/.test(v)) {
      v = Number(v);
    } else if (f.key === 'flag_threshold' && /^-?\d+(\.\d+)?$/.test(v)) {
      v = Number(v);
    }
    params[f.key] = v;
  }
  return { type: dispatchAction, target, params };
}

function _renderRunSection(detail) {
  const dispatchAction = detail?.mod?.dispatch_action;
  const status = detail?.mod ? inferBlocStatus(detail.mod) : 'unknown';
  if (!dispatchAction || status !== 'ready') return '';
  const shape = TARGET_SHAPES[dispatchAction];
  if (!shape) {
    return `<section class="wf-detail-section wf-run-section">
      <h4>run</h4>
      <div class="wf-empty">No target-shape registered for <code>${esc(dispatchAction)}</code>.</div>
    </section>`;
  }
  const inputRows = shape.fields.map(f => `
    <tr>
      <th><label for="wf-run-tgt-${esc(f.key)}">${esc(f.label)}${f.optional ? ' <small>(optional)</small>' : ''}</label></th>
      <td><input type="text" id="wf-run-tgt-${esc(f.key)}" data-target-key="${esc(f.key)}"
                 placeholder="layer_id…" /></td>
    </tr>`).join('');
  const paramRows = (shape.paramFields || []).map(f => `
    <tr>
      <th><label for="wf-run-param-${esc(f.key)}">${esc(f.label)}${f.optional ? ' <small>(optional)</small>' : ''}</label></th>
      <td><input type="text" id="wf-run-param-${esc(f.key)}" data-param-key="${esc(f.key)}"
                 placeholder="${esc(f.default ?? '')}" />
          ${f.hint ? `<small class="wf-run-hint">${esc(f.hint)}</small>` : ''}</td>
    </tr>`).join('');
  return `
    <section class="wf-detail-section wf-run-section">
      <h4>run · <code>${esc(dispatchAction)}</code></h4>
      <table class="wf-kv wf-run-form">
        <tbody>${inputRows}${paramRows}</tbody>
      </table>
      <div class="wf-run-actions">
        <button id="wf-run-btn" class="wf-run-btn"
                data-dispatch-action="${esc(dispatchAction)}">Dispatch</button>
        <span id="wf-run-status" class="wf-run-status"></span>
      </div>
      <div id="wf-run-result" class="wf-run-result" hidden></div>
    </section>`;
}

export function renderDetail(detail) {
  if (!detail) {
    return `<div class="wf-empty">No bloc with that analysis_id.</div>`;
  }
  const { ana, mode, mod, layer } = detail;
  const required = (mode?.required_dimensions || []).join(', ') || '—';
  const produces = mode?.produces || (ana?.produces || []).join(', ');

  const anaBlock = ana ? `
    <section class="wf-detail-section">
      <h4>analysis_registry</h4>
      <table class="wf-kv">
        ${_kvRow('analysis_id',  ana.analysis_id, true)}
        ${_kvRow('kind',         ana.kind)}
        ${_kvRow('label',        ana.label)}
        ${_kvRow('family',       ana.family)}
        ${_kvRow('atlas',        ana.atlas)}
        ${_kvRow('produces',     (ana.produces || []).join(', '), true)}
        ${_kvRow('status',       ana.status)}
        ${_kvRow('notes',        ana.notes)}
      </table>
    </section>` : '';

  const modeBlock = mode ? `
    <section class="wf-detail-section">
      <h4>analysis_modes — <code>${esc(mode.mode || 'default')}</code></h4>
      <table class="wf-kv">
        ${_kvRow('module_name',         mode.module_name, true)}
        ${_kvRow('produces',            produces, true)}
        ${_kvRow('required_dimensions', required)}
        ${_kvRow('group_policy',        mode.group_policy)}
        ${_kvRow('interval_policy',     mode.interval_policy)}
        ${_kvRow('site_policy',         mode.site_policy)}
        ${_kvRow('value_policy',        mode.value_policy)}
        ${_kvRow('notes',               mode.notes)}
      </table>
    </section>` : '';

  const modBlock = mod ? `
    <section class="wf-detail-section">
      <h4>module_registry</h4>
      <table class="wf-kv">
        ${_kvRow('module_name',   mod.module_name, true)}
        ${_kvRow('version',       mod.version)}
        ${_kvRow('biomod_status', mod.biomod_status)}
        ${_kvRow('installed',     mod.installed)}
        ${_kvRow('ready',         mod.ready)}
        ${_kvRow('stale',         mod.stale)}
        ${_kvRow('stale_reason',  mod.stale_reason)}
        ${_kvRow('parent',        mod.parent, true)}
        ${_kvRow('derivatives',   mod.derivatives, true)}
        ${_kvRow('n_samples',     mod.n_samples)}
        ${_kvRow('biomod_env',    mod.biomod_env)}
        ${_kvRow('last_run_id',   mod.last_run_id)}
        ${_kvRow('last_run_status', mod.last_run_status)}
      </table>
    </section>` : '';

  const layerBlock = layer ? `
    <section class="wf-detail-section">
      <h4>layer_registry — <code>${esc(layer.layer_id)}</code></h4>
      <table class="wf-kv">
        ${_kvRow('entity_type',  layer.entity_type)}
        ${_kvRow('source_kind',  layer.source_kind)}
        ${_kvRow('label',        layer.label)}
        ${_kvRow('description',  layer.description)}
        ${_kvRow('status',       layer.status)}
      </table>
    </section>` : '';

  const runBlock = _renderRunSection(detail);
  return anaBlock + modeBlock + modBlock + layerBlock + runBlock;
}

// Render the chain dispatch result inline in the panel. Pretty-prints
// a few well-known summary keys for each chain type; falls through to
// a compact JSON dump for anything else.
export function renderDispatchResult(actionType, body) {
  if (!body || typeof body !== 'object') {
    return `<div class="wf-empty">Empty response.</div>`;
  }
  const payload = (body && body.payload) || body;
  const layerId = body.layer_id || '';
  const head = layerId ? `<div class="wf-run-result-head">result layer: <code>${esc(layerId)}</code></div>` : '';

  // Summary line per action type — pulls the headline stat without
  // duplicating the full per-page renderer.
  let summary = '';
  const s = payload.summary || {};
  if (actionType === 'compute_nco_inside_vs_outside_inversion' && payload.result) {
    const r = payload.result;
    summary = `MOSAIC_SHORT × inside: OR=${_fmtNum(r.odds_ratio)} · p<sub>1-sided</sub>=${_fmtNum(r.p_fisher_one_sided_greater)}`;
  } else if (actionType === 'compute_nco_per_candidate_enrichment') {
    summary = `${s.n_candidates_tested ?? 0} candidates tested · ${s.n_candidates_sig_bh ?? 0} sig at BH α=${s.p_bh_alpha ?? '?'}`;
  } else if (actionType === 'compute_intrachromosomal_co_karyotype_effect') {
    summary = `${s.n_chroms_tested ?? 0} chroms tested · ${s.n_chroms_flagged ?? 0} flagged (rate_ratio < ${s.flag_threshold ?? '?'})`;
  } else if (actionType === 'compute_interchromosomal_inversion_effect') {
    summary = `${s.n_tests ?? 0} off-focal tests · ${s.n_sig_bh ?? 0} sig at BH α=${s.p_bh_alpha ?? '?'} · focal_chrom=<code>${esc(s.focal_chrom || '?')}</code>`;
  }

  // Compact JSON tail for inspection (truncated to keep the panel tidy).
  const json = JSON.stringify(payload, null, 2);
  const truncated = json.length > 2000 ? (json.slice(0, 2000) + '\n…') : json;
  return `
    ${head}
    ${summary ? `<div class="wf-run-result-summary">${summary}</div>` : ''}
    <pre class="wf-run-result-json">${esc(truncated)}</pre>`;
}

function _fmtNum(v, d = 4) {
  if (v == null || (typeof v === 'number' && Number.isNaN(v))) return '—';
  if (typeof v !== 'number') return String(v);
  if (Math.abs(v) < 0.001 || Math.abs(v) >= 1000) {
    return v.toExponential(d).replace(/e([+-])0+/, 'e$1');
  }
  return v.toFixed(d);
}

// URL-hash routing. Atlas-core's router controls the leading `#<page_id>`
// segment; we extend it with `/<analysis_id>` for the panel.
const HASH_PREFIX = '#workflows/';

export function parseDeepLink(hash) {
  const s = String(hash || '');
  if (!s.startsWith(HASH_PREFIX)) return null;
  const tail = s.slice(HASH_PREFIX.length).trim();
  return tail ? decodeURIComponent(tail) : null;
}

function _setDeepLink(analysisId) {
  if (typeof history === 'undefined') return;
  const newHash = analysisId ? `${HASH_PREFIX}${encodeURIComponent(analysisId)}` : '#workflows';
  if (location.hash !== newHash) {
    history.replaceState(null, '', newHash);
  }
}

function _openDetail(root, analysisId) {
  const panel = root.querySelector('#wfDetailPanel');
  const title = root.querySelector('#wfDetailTitle');
  const body  = root.querySelector('#wfDetailBody');
  if (!panel || !body) return;
  const d = buildDetail(_payload, analysisId);
  title.textContent = analysisId;
  body.innerHTML = renderDetail(d);
  panel.hidden = false;
  _setDeepLink(analysisId);

  // Wire the Run button if it was rendered. Listener is auto-removed
  // on the next renderDetail (innerHTML replacement drops the node).
  const runBtn = body.querySelector('#wf-run-btn');
  if (runBtn) {
    runBtn.addEventListener('click', () => _onDispatchClick(root, body, d));
  }
}

async function _onDispatchClick(root, body, detail) {
  const btn       = body.querySelector('#wf-run-btn');
  const statusEl  = body.querySelector('#wf-run-status');
  const resultEl  = body.querySelector('#wf-run-result');
  if (!btn || !statusEl || !resultEl) return;

  const dispatchAction = btn.getAttribute('data-dispatch-action');
  const inputs = {};
  for (const el of body.querySelectorAll('[data-target-key]')) {
    inputs[el.getAttribute('data-target-key')] = el.value;
  }
  const paramInputs = {};
  for (const el of body.querySelectorAll('[data-param-key]')) {
    paramInputs[el.getAttribute('data-param-key')] = el.value;
  }

  let manifest;
  try {
    manifest = buildDispatchManifest(dispatchAction, inputs, paramInputs);
  } catch (e) {
    statusEl.className = 'wf-run-status wf-run-warn';
    statusEl.textContent = `◐ ${e.message}`;
    resultEl.hidden = true;
    return;
  }

  btn.disabled = true;
  statusEl.className = 'wf-run-status wf-run-info';
  statusEl.innerHTML = `Dispatching <code>${esc(dispatchAction)}</code>…`;
  resultEl.hidden = true;

  try {
    const responseBody = await runAction(manifest.type, manifest.target, manifest.params);
    statusEl.className = 'wf-run-status wf-run-ok';
    statusEl.innerHTML = `● dispatched OK`;
    resultEl.hidden = false;
    resultEl.innerHTML = renderDispatchResult(manifest.type, responseBody);
  } catch (e) {
    statusEl.className = 'wf-run-status wf-run-warn';
    statusEl.innerHTML = `◐ dispatch failed: <small>${esc((e && e.message) || String(e))}</small>`;
    resultEl.hidden = true;
  } finally {
    btn.disabled = false;
  }
}

function _closeDetail(root) {
  const panel = root.querySelector('#wfDetailPanel');
  if (!panel) return;
  panel.hidden = true;
  _setDeepLink(null);
}

export function toTSV(rows) {
  const head = ['kind', 'analysis_id', 'label', 'module_name', 'biomod_status',
                'produces', 'required_dimensions', 'bloc_status', 'stale_reason', 'notes'];
  const lines = [head.join('\t')];
  for (const r of rows) {
    lines.push([
      r.kind, r.analysis_id, r.label, r.module_name, r.biomod_status,
      r.produces, (r.required_dimensions || []).join('|'),
      r.bloc_status, r.stale_reason, r.notes,
    ].map(v => String(v ?? '').replace(/\t/g, ' ').replace(/\n/g, ' ')).join('\t'));
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Mount / unmount
// ---------------------------------------------------------------------------

function _render(root) {
  const resultSlot = root.querySelector('#wfResultSlot');
  const badgeSlot  = root.querySelector('#wfBadgeSlot');
  if (!resultSlot || !badgeSlot) return;

  if (_payloadError) {
    badgeSlot.innerHTML  = `<div class="wf-badge wf-badge-warn">payload error — ${esc(_payloadError)}</div>`;
    resultSlot.innerHTML = `<div class="wf-empty">Catalogue payload could not be loaded. Did you run <code>generate_catalogue_outbound.py</code>?</div>`;
    return;
  }
  if (!_payload) {
    badgeSlot.innerHTML  = '';
    resultSlot.innerHTML = `<div class="wf-empty">Loading catalogue payload…</div>`;
    return;
  }

  const errors = validateConstraints(_payload);
  badgeSlot.innerHTML  = renderBadge(_payload, errors);
  if (errors.length) {
    for (const e of errors) console.warn('[workflows] constraint:', e);
  }

  const kind   = root.querySelector('#wfKind')?.value   || 'all';
  const status = root.querySelector('#wfStatus')?.value || 'all';
  const joined = joinPayload(_payload);
  const rows   = filterRows(joined, { kind, status });
  resultSlot.innerHTML = renderTable(rows) + renderPagesTable(_payload.pages || []);
}

function _exportTSV(root) {
  if (!_payload) return;
  const kind   = root.querySelector('#wfKind')?.value   || 'all';
  const status = root.querySelector('#wfStatus')?.value || 'all';
  const rows   = filterRows(joinPayload(_payload), { kind, status });
  const blob = new Blob([toTSV(rows)], { type: 'text/tab-separated-values;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'meiosis_workflows.tsv';
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

export async function mount(root) {
  if (!root) return;
  _payload = null;
  _payloadError = null;
  _render(root);

  try {
    _payload = await fetchPayload();
  } catch (e) {
    _payloadError = e?.message || String(e);
  }
  _render(root);

  wire(root.querySelector('#wfRunBtn'),    'click',  () => _render(root));
  wire(root.querySelector('#wfExportBtn'), 'click',  () => _exportTSV(root));
  wire(root.querySelector('#wfKind'),      'change', () => _render(root));
  wire(root.querySelector('#wfStatus'),    'change', () => _render(root));

  // Row click → open detail panel. Event-delegated so dynamically-rendered
  // rows pick it up without re-wiring.
  const resultSlot = root.querySelector('#wfResultSlot');
  if (resultSlot) {
    const onRowClick = (ev) => {
      const tr = ev.target.closest('tr.wf-row');
      if (!tr) return;
      const id = tr.getAttribute('data-analysis-id');
      if (id) _openDetail(root, id);
    };
    resultSlot.addEventListener('click', onRowClick);
    _wired.add(() => resultSlot.removeEventListener('click', onRowClick));

    const onRowKey = (ev) => {
      if (ev.key !== 'Enter') return;
      const tr = ev.target.closest('tr.wf-row');
      if (!tr) return;
      const id = tr.getAttribute('data-analysis-id');
      if (id) _openDetail(root, id);
    };
    resultSlot.addEventListener('keydown', onRowKey);
    _wired.add(() => resultSlot.removeEventListener('keydown', onRowKey));
  }

  wire(root.querySelector('#wfDetailClose'), 'click', () => _closeDetail(root));

  // Esc closes the panel.
  const onEsc = (ev) => { if (ev.key === 'Escape') _closeDetail(root); };
  document.addEventListener('keydown', onEsc);
  _wired.add(() => document.removeEventListener('keydown', onEsc));

  // Initial deep-link: open the panel if the URL points at a row.
  const initialId = parseDeepLink(typeof location !== 'undefined' ? location.hash : '');
  if (initialId && _payload) _openDetail(root, initialId);
}

export function unmount() {
  for (const off of _wired) { try { off(); } catch { /* ignore */ } }
  _wired.clear();
  _payload = null;
  _payloadError = null;
}

export default { mount, unmount };
