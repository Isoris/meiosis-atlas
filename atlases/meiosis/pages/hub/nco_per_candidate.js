// atlases/meiosis/pages/hub/nco_per_candidate.js
// =============================================================================
// nco_per_candidate — NCO / gene conversion, per inversion candidate
// (stage: hub)
//
// Sister page to crossovers_per_candidate. Two views around one inversion
// candidate at a time: tract ideogram (green NCO ticks on the left, yellow
// GC ticks on the right, candidate span as a translucent band) and tract
// rate vs. relative telomere distance (LOESS curve + 95% CI band per kind).
//
// The active candidate is read from shared.candidate; the renderer fetches
// data/nco_gc/<candidate_id>.json.
//
// Migrated 2026-05-19 from genome-atlas/pages/annotation/page12.{html,js}.
// Round-1 status (post-migration): spec only.
// =============================================================================

import { _pageState, _setActiveState } from './nco_per_candidate/_state.js';

export function renderNcoPerCandidate(/* state */) {
  // No-op. Phase C wires View 1 (ideogram) + View 2 (telomere curve) from
  // nco_gc_track. No optional cards on this page in round 1.
  return;
}

export const NCO_PER_CANDIDATE_META = {
  id: 'nco_per_candidate',
  stage: 'hub',
  label: 'NCO / gene conversion (per candidate)',
  static: true,
};

export function refreshNcoPerCandidate(state) {
  if (state) _setActiveState(state);
  return renderNcoPerCandidate(state || _pageState || {});
}

export async function mount(root, atlasState, registry) {
  const legacyState = _buildLegacyState(atlasState);
  _setActiveState(legacyState);
  try { refreshNcoPerCandidate(legacyState); }
  catch (e) { console.warn('nco_per_candidate.mount: refresh threw —', e); }
  if (atlasState.meiosis) atlasState.meiosis._ncoPerCandidateState = legacyState;
}

export async function unmount(root) {
  _setActiveState(null);
}

function _buildLegacyState(atlasState) {
  const me = atlasState.meiosis || {};
  return Object.assign({}, me);
}
