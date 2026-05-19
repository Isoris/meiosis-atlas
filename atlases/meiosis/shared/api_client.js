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
