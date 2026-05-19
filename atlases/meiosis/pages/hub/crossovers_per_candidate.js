// atlases/meiosis/pages/hub/crossovers_per_candidate.js
// =============================================================================
// crossovers_per_candidate — Crossovers, per inversion candidate (stage: hub)
//
// Three views over the recombination map around one inversion candidate at a
// time: sex-specific CO ideogram (red♀ / blue♂ dots with the candidate's
// inverted span as a translucent band), CO rate vs. relative telomere
// distance (LOESS + 95% CI band per sex), optional PRDM9 sequence logo.
//
// The active candidate is read from shared.candidate; the renderer fetches
// data/crossovers/<candidate_id>.json (under the Meiosis Atlas's data root).
// NCO / gene-conversion lives on the sibling nco_per_candidate page.
//
// Migrated 2026-05-19 from genome-atlas/pages/annotation/page11.{html,js}.
// The page is meiosis-topic (CO is a meiosis event), so it now lives next to
// the cohort-level crossovers stub and the interchromosomal HEADLINE page.
//
// Round-1 status (post-migration): spec only. _maybeHideOptionalCards() is
// the toggle hook used at render time to hide the PRDM9 logo card when
// prdm9_motif.pwm is null / missing.
// =============================================================================

import { _pageState, _setActiveState } from './crossovers_per_candidate/_state.js';

export function renderCrossoversPerCandidate(/* state */) {
  // No-op. Phase C wires View 1 (ideogram) + View 2 (telomere curve) from
  // crossover_track; View 3 (PRDM9 logo) wires only when prdm9_motif.pwm
  // exists. The optional-card toggle hook is _maybeHideOptionalCards().
  return;
}

export const CROSSOVERS_PER_CANDIDATE_META = {
  id: 'crossovers_per_candidate',
  stage: 'hub',
  label: 'crossovers (per candidate)',
  static: true,
};

export function refreshCrossoversPerCandidate(state) {
  if (state) _setActiveState(state);
  return renderCrossoversPerCandidate(state || _pageState || {});
}

export async function mount(root, atlasState, registry) {
  const legacyState = _buildLegacyState(atlasState);
  _setActiveState(legacyState);
  try { refreshCrossoversPerCandidate(legacyState); }
  catch (e) { console.warn('crossovers_per_candidate.mount: refresh threw —', e); }
  _maybeHideOptionalCards(root, legacyState);
  if (atlasState.meiosis) atlasState.meiosis._crossoversPerCandidateState = legacyState;
}

export async function unmount(root) {
  _setActiveState(null);
}

function _buildLegacyState(atlasState) {
  const me = atlasState.meiosis || {};
  return Object.assign({}, me);
}

// Hide cards marked [data-ga-optional="1"] when the layer that backs them is
// absent. Today the only optional card is the PRDM9 motif logo; this stays
// generic so the same hook can hide an NCO-specific card later.
function _maybeHideOptionalCards(root, state) {
  if (!root || !root.querySelectorAll) return;
  const layers = (state && state.layers) || {};
  const has_pwm =
    layers.prdm9_motif &&
    layers.prdm9_motif.pwm &&
    Array.isArray(layers.prdm9_motif.pwm) &&
    layers.prdm9_motif.pwm.length > 0;
  const motifCard = root.querySelector('[data-ga-card="prdm9-motif"]');
  if (motifCard) motifCard.style.display = has_pwm ? '' : 'none';
}
