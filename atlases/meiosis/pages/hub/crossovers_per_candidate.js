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
import { probeModeB, renderModeBBadge } from '../../../../core/mode_b_badge.js';
import {
  renderIdeogramSVG,
  renderTelomereCurveSVG,
  renderPrdm9LogoSVG,
} from './crossovers_per_candidate/_render.js';
import { isDemoMode, DEMO_CROSSOVER_PAYLOAD } from './crossovers_per_candidate/_demo.js';

/**
 * Swap the static mockup inside a card with a real SVG render. Finds the
 * card by an in-card class selector (e.g. '.ga-ideogram-mockup'), wipes
 * it, and inserts `svg`. No-op when the selector matches nothing (the
 * card already has its own structure or the HTML scaffold changed).
 */
function _swapMockupSVG(root, mockupSelector, svg) {
  if (!root || !root.querySelector || !svg) return;
  const el = root.querySelector(mockupSelector);
  if (!el) return;
  el.innerHTML = svg;
  el.classList.add('ga-real-render');  // CSS hook: kill mockup pseudo-elements
}

/**
 * Render all three views against the given crossover_track payload. View 3
 * (PRDM9 logo) is skipped + the card hidden when prdm9_motif.pwm is absent.
 */
export function renderCrossoversPerCandidate(state) {
  if (!state || !state.payload) return;
  const root = state.root || (typeof document !== 'undefined' ? document : null);
  if (!root) return;
  const payload = state.payload;

  _swapMockupSVG(root, '.ga-ideogram-mockup',  renderIdeogramSVG(payload));
  _swapMockupSVG(root, '.ga-co-curve-mockup',  renderTelomereCurveSVG(payload));

  const logoSVG = renderPrdm9LogoSVG(payload);
  const motifCard = root.querySelector ? root.querySelector('[data-ga-card="prdm9-motif"]') : null;
  if (logoSVG) {
    if (motifCard) motifCard.style.display = '';
    _swapMockupSVG(root, '.ga-logo-mockup', logoSVG);
  } else if (motifCard) {
    motifCard.style.display = 'none';
  }
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
  legacyState.root = root;
  _setActiveState(legacyState);
  try { refreshCrossoversPerCandidate(legacyState); }
  catch (e) { console.warn('crossovers_per_candidate.mount: refresh threw —', e); }
  _maybeHideOptionalCards(root, legacyState);
  if (atlasState.meiosis) atlasState.meiosis._crossoversPerCandidateState = legacyState;

  // Demo-mode short-circuit: load synthetic envelope, render, return.
  // The Mode-B badge probe is skipped (registry layer not real in demo).
  if (isDemoMode(atlasState && atlasState.shared && atlasState.shared.demoCtx)) {
    _renderDemoBanner(root);
    legacyState.payload = DEMO_CROSSOVER_PAYLOAD;
    try { renderCrossoversPerCandidate(legacyState); }
    catch (e) { console.warn('crossovers_per_candidate.mount: demo render threw —', e); }
    return;
  }

  // Mode-B probe — non-blocking. Today every meiosis layer is
  // CONTRACT-ONLY (round-1 stub), so this routinely surfaces "○ data
  // pending" until the pedigree CO pipeline writes the file. Flips to
  // ● automatically once data/crossovers/<candidate_id>.json lands.
  // When the probe DOES return a payload, we feed it to the renderers
  // so the mockup is replaced by the real chart.
  _renderCrossoversCandidateBadge(atlasState, registry, root, legacyState).catch((e) => {
    console.warn('crossovers_per_candidate.mount: badge probe threw —', e);
  });
}

/**
 * Append a small "demo mode" banner above the page title so the user can
 * never confuse demo content with production data.
 */
function _renderDemoBanner(root) {
  if (!root || !root.querySelector) return;
  if (root.querySelector('.ga-demo-banner')) return;
  const banner = document.createElement('div');
  banner.className = 'ga-demo-banner';
  banner.setAttribute('role', 'status');
  banner.style.cssText =
    'margin:4px 14px;padding:6px 10px;font-size:11.5px;line-height:1.4;' +
    'border:1px solid var(--accent);border-radius:4px;background:var(--panel-2);' +
    'color:var(--ink);font-weight:500;';
  banner.innerHTML =
    '⚙ <strong>DEMO MODE</strong> — synthetic crossover_track loaded ' +
    'from <code>crossovers_per_candidate/_demo.js</code>. No production data.';
  const title = root.querySelector('.ga-title') || root.firstElementChild;
  if (title && title.parentNode) {
    title.parentNode.insertBefore(banner, title);
  } else {
    root.insertBefore(banner, root.firstChild);
  }
}

async function _renderCrossoversCandidateBadge(atlasState, registry, root, legacyState) {
  const slot = (typeof document !== 'undefined')
    ? document.getElementById('copcModeBBadge')
    : null;
  if (!slot) return;
  const cand = (atlasState && atlasState.shared && atlasState.shared.candidate) || null;
  const candidate_id = cand && (cand.candidate_id || cand.id) || null;
  if (!candidate_id) {
    slot.style.display = 'none';
    return;
  }
  slot.style.display = 'block';

  // Primary: crossover_track for this candidate. Optional: prdm9_motif
  // (the PRDM9 logo card) — resolved in parallel; reported as a
  // secondary chip in the summary regardless of whether it's present.
  const [coProbe, motifProbe] = await Promise.all([
    probeModeB(registry, 'crossover_track', { candidate_id }, {
      extractRows: (p) => (p && Array.isArray(p.events)) ? p.events : null,
    }),
    probeModeB(registry, 'prdm9_motif', { candidate_id }, {
      // prdm9_motif lives EMBEDDED in the same per-candidate file
      // (per layers.registry.json _path_doc); the field of interest
      // is a PWM matrix [N×4]. Treat its rows as the probe's row set.
      extractRows: (p) => {
        if (!p || !p.prdm9_motif || !Array.isArray(p.prdm9_motif.pwm)) return null;
        return p.prdm9_motif.pwm;
      },
    }),
  ]);

  const motifTag = motifProbe.ok
    ? `PRDM9 PWM ${motifProbe.n}×4`
    : (motifProbe.reason === 'stub-payload' ? 'PRDM9 not present' : 'PRDM9 —');

  renderModeBBadge('copcModeBBadge', coProbe, {
    label:    'CO events on disk',
    layerKey: 'crossover_track',
    context:  candidate_id,
    compare:  (probeResult) => {
      const span = probeResult.payload && probeResult.payload.candidate_span;
      const sexes = new Set();
      for (const e of probeResult.rows) if (e && e.sex) sexes.add(e.sex);
      const spanTag = (span && span.chrom)
        ? `${span.chrom}:${(span.start_bp/1e6).toFixed(2)}-${(span.end_bp/1e6).toFixed(2)} Mb`
        : 'no candidate_span';
      return {
        pass: probeResult.n > 0,
        summary: `${probeResult.n} CO events · ${spanTag} · ` +
                 `sex coverage: ${sexes.size > 0 ? [...sexes].join('+') : '—'} · ${motifTag}`,
      };
    },
  });

  // When the probe returned a real payload, feed it through the renderers
  // so the static mockups are replaced by real SVG charts. Optional
  // prdm9_motif is part of the SAME payload (embedded), so we don't need
  // motifProbe.payload — renderPrdm9LogoSVG reads payload.prdm9_motif.
  if (coProbe.ok && coProbe.payload && legacyState) {
    legacyState.payload = coProbe.payload;
    try { renderCrossoversPerCandidate(legacyState); }
    catch (e) { console.warn('crossovers_per_candidate: render against probed payload threw —', e); }
  }
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
