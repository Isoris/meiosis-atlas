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
import { probeModeB, renderModeBBadge } from '../../../../core/mode_b_badge.js';
import {
  renderTractIdeogramSVG,
  renderTractCurveSVG,
} from './nco_per_candidate/_render.js';
import { isDemoMode, DEMO_NCO_PAYLOAD } from './nco_per_candidate/_demo.js';

/**
 * Swap the static mockup inside a card with a real SVG render. Same hook
 * as the sibling page; finds the mockup container by class selector,
 * wipes it, inserts `svg`.
 */
function _swapMockupSVG(root, mockupSelector, svg) {
  if (!root || !root.querySelector || !svg) return;
  const el = root.querySelector(mockupSelector);
  if (!el) return;
  el.innerHTML = svg;
  el.classList.add('ga-real-render');
}

/**
 * Render the two views against the given nco_gc_track payload.
 */
export function renderNcoPerCandidate(state) {
  if (!state || !state.payload) return;
  const root = state.root || (typeof document !== 'undefined' ? document : null);
  if (!root) return;
  const payload = state.payload;

  _swapMockupSVG(root, '.ga-ideogram-mockup',     renderTractIdeogramSVG(payload));
  // The page HTML uses .ga-co-curve-mockup as the curve container name
  // (inherited from the genome-atlas page12 scaffold pre-migration).
  // We try that selector first; fall back to a more specific one if the
  // scaffold gets renamed in a future round.
  _swapMockupSVG(root, '.ga-co-curve-mockup',     renderTractCurveSVG(payload));
  _swapMockupSVG(root, '.ga-tract-curve-mockup',  renderTractCurveSVG(payload));
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
  legacyState.root = root;
  _setActiveState(legacyState);
  try { refreshNcoPerCandidate(legacyState); }
  catch (e) { console.warn('nco_per_candidate.mount: refresh threw —', e); }
  if (atlasState.meiosis) atlasState.meiosis._ncoPerCandidateState = legacyState;

  // Demo-mode short-circuit (same pattern as the sibling page).
  if (isDemoMode(atlasState && atlasState.shared && atlasState.shared.demoCtx)) {
    _renderDemoBanner(root);
    legacyState.payload = DEMO_NCO_PAYLOAD;
    try { renderNcoPerCandidate(legacyState); }
    catch (e) { console.warn('nco_per_candidate.mount: demo render threw —', e); }
    return;
  }

  // Mode-B probe — non-blocking. CONTRACT-ONLY layer in round 1; the
  // badge says "○ data pending" until ngsTracts STEP_TRC_01 ships
  // data/nco_gc/<candidate_id>.json. Auto-flips to ● once a file lands.
  // When the probe DOES return a payload, feed it to the renderers so
  // the static mockups are replaced by real SVG charts.
  _renderNcoCandidateBadge(atlasState, registry, root, legacyState).catch((e) => {
    console.warn('nco_per_candidate.mount: badge probe threw —', e);
  });
}

/**
 * Demo-mode banner (matches the sibling page).
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
    '⚙ <strong>DEMO MODE</strong> — synthetic nco_gc_track loaded ' +
    'from <code>nco_per_candidate/_demo.js</code>. No production data.';
  const title = root.querySelector('.ga-title') || root.firstElementChild;
  if (title && title.parentNode) {
    title.parentNode.insertBefore(banner, title);
  } else {
    root.insertBefore(banner, root.firstChild);
  }
}

async function _renderNcoCandidateBadge(atlasState, registry, root, legacyState) {
  const slot = (typeof document !== 'undefined')
    ? document.getElementById('ncopcModeBBadge')
    : null;
  if (!slot) return;
  const cand = (atlasState && atlasState.shared && atlasState.shared.candidate) || null;
  const candidate_id = cand && (cand.candidate_id || cand.id) || null;
  if (!candidate_id) {
    slot.style.display = 'none';
    return;
  }
  slot.style.display = 'block';

  const probe = await probeModeB(registry, 'nco_gc_track', { candidate_id }, {
    extractRows: (p) => (p && Array.isArray(p.tracts)) ? p.tracts : null,
  });

  renderModeBBadge('ncopcModeBBadge', probe, {
    label:    'NCO + GC tracts on disk',
    layerKey: 'nco_gc_track',
    context:  candidate_id,
    compare:  (probeResult) => {
      let nNco = 0, nGc = 0, nOther = 0;
      for (const t of probeResult.rows) {
        if (!t) continue;
        if (t.kind === 'nco')      nNco++;
        else if (t.kind === 'gc')  nGc++;
        else                       nOther++;
      }
      const span = probeResult.payload && probeResult.payload.candidate_span;
      const spanTag = (span && span.chrom)
        ? `${span.chrom}:${(span.start_bp/1e6).toFixed(2)}-${(span.end_bp/1e6).toFixed(2)} Mb`
        : 'no candidate_span';
      return {
        pass: probeResult.n > 0 && (nNco > 0 || nGc > 0),
        summary: `${probeResult.n} tracts (NCO ${nNco} · GC ${nGc}` +
                 (nOther > 0 ? ` · other ${nOther}` : '') +
                 `) · ${spanTag}`,
      };
    },
  });

  // Real payload → render real SVG charts in place of the mockups.
  if (probe.ok && probe.payload && legacyState) {
    legacyState.payload = probe.payload;
    try { renderNcoPerCandidate(legacyState); }
    catch (e) { console.warn('nco_per_candidate: render against probed payload threw —', e); }
  }
}

export async function unmount(root) {
  _setActiveState(null);
}

function _buildLegacyState(atlasState) {
  const me = atlasState.meiosis || {};
  return Object.assign({}, me);
}
