// atlases/meiosis/shared/api_client.js
// =============================================================================
// Self-contained client surface for the atlas-core unified server.
//
// Per-atlas convention: every atlas owns a shared/api_client.js so pages
// import via a stable atlas-local path (`'../../shared/api_client.js'`) and
// tests can mock `globalThis.fetch` to drive the helpers without spinning
// up the server. Implementations mirror the relatedness-atlas pattern;
// future file/compute helpers can land here when a page needs them.
//
// Wraps:
//   GET /api/layers              — list/filter the envelope index
//   GET /api/layers/{layer_id}   — fetch one envelope (full JSON)
// =============================================================================

const BASE = '';   // same-origin

async function _safeText(resp) {
  try { return await resp.text(); } catch { return ''; }
}

export class ApiError extends Error {
  constructor(status, url, body) {
    super(`${status} on ${url}: ${(body || '').slice(0, 200)}`);
    this.name = 'ApiError';
    this.status = status;
    this.url = url;
    this.body = body;
  }
}

// GET /api/layers — filter the envelope index.
//   filters: { layer_type, dataset_id, stage, status, limit }
// Returns: { layers: [...index_rows], n, total }
export async function listLayers(filters = {}) {
  const q = new URLSearchParams();
  for (const k of ['layer_type', 'dataset_id', 'stage', 'status']) {
    const v = filters[k];
    if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
  }
  if (filters.limit !== undefined && filters.limit !== null) {
    q.set('limit', String(Number(filters.limit) | 0));
  }
  const qs = q.toString();
  const url = `${BASE}/api/layers${qs ? '?' + qs : ''}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new ApiError(resp.status, url, await _safeText(resp));
  return resp.json();
}

// GET /api/layers/{layer_id} — fetch one full envelope.
export async function getLayer(layer_id) {
  if (!layer_id) throw new Error('api_client.getLayer: layer_id required');
  const url = `${BASE}/api/layers/${encodeURIComponent(layer_id)}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new ApiError(resp.status, url, await _safeText(resp));
  return resp.json();
}

// Convenience: most-recent envelope of `layer_type` matching the
// optional dataset_id / stage / status filters. Returns null when no
// match exists (NOT an error — pages branch on null).
export async function resolveLatestLayer(layer_type, opts = {}) {
  if (!layer_type) throw new Error('api_client.resolveLatestLayer: layer_type required');
  const list = await listLayers({ ...opts, layer_type });
  const rows = (list && list.layers) || [];
  if (rows.length === 0) return null;
  return getLayer(rows[rows.length - 1].layer_id);
}

// POST /api/actions — dispatch a server-side action (adapter import,
// adapter normalize, or chain compute) and return whatever the server
// emits. Atlas-core's dispatcher validates the manifest against
// schemas/schema_in/<schema_in>.json and writes the result envelopes
// into the workspace layers index; this client just returns the
// response body so the caller can pull the new layer_id from it.
//
// Usage (chain dispatch — the catalogue brain's POST path):
//   await runAction('compute_nco_inside_vs_outside_inversion',
//                   { source_layer_id: 'tracts_2026_01' },
//                   { target_class: 'MOSAIC_SHORT' });
//
// Throws ApiError on non-2xx (preserving status + body for the caller).
export async function runAction(type, target, params = {}) {
  if (!type) throw new Error('api_client.runAction: type required');
  if (!target || typeof target !== 'object') {
    throw new Error('api_client.runAction: target object required');
  }
  const url = `${BASE}/api/actions`;
  const body = JSON.stringify({ type, target, params });
  const resp = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
  if (!resp.ok) throw new ApiError(resp.status, url, await _safeText(resp));
  return resp.json();
}

// Known dispatch contracts for the three meiosis chain actions. Pages
// invoke these instead of building the inline browser stats; the
// catalogue brain's Run button does the same. Returns the result
// envelope payload (already typed per the matching schema_out).
//
// Mode 'auto' (default) tries the server action first and on any
// network/HTTP failure returns { ok: false, error }. Mode 'strict'
// re-throws on failure so callers that require the server path fail
// loud. The browser-inline fallback in pages is wired separately.
export async function dispatchMeiosisChain(chainName, target, params = {}, opts = {}) {
  const ACTION_TYPES = {
    nco:               'compute_nco_inside_vs_outside_inversion',
    intrachromosomal:  'compute_intrachromosomal_co_karyotype_effect',
    interchromosomal:  'compute_interchromosomal_inversion_effect',
  };
  const type = ACTION_TYPES[chainName];
  if (!type) {
    throw new Error(`api_client.dispatchMeiosisChain: unknown chain '${chainName}'; expected one of ${Object.keys(ACTION_TYPES).join(', ')}`);
  }
  const mode = opts.mode || 'auto';
  try {
    const body = await runAction(type, target, params);
    return { ok: true, type, body };
  } catch (e) {
    if (mode === 'strict') throw e;
    return { ok: false, type, error: String(e && e.message || e) };
  }
}
