// atlases/relatedness/pages/hub/inversion_signature.js
// =============================================================================
// Inversion signature — three stacked tracks for one chromosome (NCO, CO,
// resolution) plus per-candidate verdict cards. The cross-layer rule from
// the Sandler translation is applied per inversion via
// recomb_data.insideFlankSummary + inversionVerdict.
// =============================================================================

import { $, el, fmt } from '../../../relatedness/shared/utils.js';
import { DEMO } from '../../../relatedness/shared/demo_data.js';
import { state } from '../../../relatedness/shared/state.js';
import { on } from '../../../relatedness/shared/page_hooks.js';
import {
  chromosomesWithRecomb, eligibility, resolution, coRatePerMeiosis,
  insideFlankSummary, inversionVerdict,
} from '../../shared/recomb_data.js';
import { renderTrack } from '../../shared/recomb_track.js';
import { renderKaryotypeTable } from '../../../relatedness/shared/karyotype_table.js';
import { _setActiveState } from './inversion_signature/_state.js';

const VERDICT_TIER = {
  consistent:  'tier-strong',
  rejected:    'tier-weak',
  cold_region: 'tier-moderate',
  ambiguous:   'tier-warn-family',
};

function _populateChromPicker() {
  const sel = $('#invsigChrom');
  sel.innerHTML = '';
  for (const c of chromosomesWithRecomb()) {
    sel.appendChild(el('option', { value: c, text: c }));
  }
  sel.value = state.recomb.chromosome;
}
function _populateHighlightPicker() {
  const sel = $('#invsigHighlight');
  sel.innerHTML = '<option value="">(none)</option>';
  DEMO.inversion_candidates_full
    .filter(i => i.chromosome === state.recomb.chromosome)
    .forEach(i => sel.appendChild(el('option', {
      value: i.candidate, text: `${i.candidate} (${i.status})`,
    })));
  sel.value = state.recomb.highlight_inversion || '';
}

function _renderVerdicts() {
  const slot = $('#invsigVerdictSlot');
  slot.innerHTML = '';
  const cands = DEMO.inversion_candidates_full
    .filter(i => i.chromosome === state.recomb.chromosome);
  if (!cands.length) {
    slot.appendChild(el('div', { class: 'ie-conclusion tier-weak',
      html: '<div class="verdict">NO CANDIDATES ON THIS CHROMOSOME</div>'
          + 'Pick another chromosome — the Inversions tab lists every chromosome that has at least one candidate.'
    }));
    return;
  }
  for (const inv of cands) {
    const sum = insideFlankSummary(inv, state.recomb.chromosome);
    const verdict = inversionVerdict(sum);
    const card = el('div', {
      class: 'ie-conclusion ' + (VERDICT_TIER[verdict.code] || 'tier-weak'),
      style: { marginBottom: '8px' },
    });
    card.appendChild(el('div', { class: 'verdict',
      html: `${inv.candidate} · ${inv.chromosome} ${inv.start_mb}–${inv.end_mb} Mb`
          + ` <span style="color:var(--ink-dim);font-weight:400;">(${inv.status})</span>`
          + ` · <b>${verdict.label}</b>` }));
    card.appendChild(el('div', {
      style: { fontFamily: 'var(--mono)', fontSize: '10.5px',
               color: 'var(--ink-dim)', marginTop: '4px' },
      html:
        `NCO inside / flank = ${fmt(sum.nco_in)} / ${fmt(sum.nco_fl)}`
        + ` &rarr; ratio ${fmt(sum.nco_ratio)}<br/>`
        + `CO  inside / flank = ${fmt(sum.co_in)} / ${fmt(sum.co_fl)}`
        + ` &rarr; ratio ${fmt(sum.co_ratio)}<br/>`
        + `n windows inside = ${sum.n_windows_inside} · flank = ${sum.n_windows_flank}`,
    }));
    slot.appendChild(card);
  }
}

function _renderKaryo() {
  const cands = DEMO.inversion_candidates_full
    .filter(i => i.chromosome === state.recomb.chromosome);
  const cols = cands.length
    ? cands.slice(0, 4).map(c => c.chromosome)
    : [state.recomb.chromosome];
  renderKaryotypeTable('#invsigKaryoSlot', {
    rows: DEMO.individuals,
    columns: cols,
  });
}

function _draw() {
  const hl = state.recomb.highlight_inversion || null;
  renderTrack('#invsigTrackNco', {
    chromosome: state.recomb.chromosome,
    valueFn: eligibility,
    vmin: 0, vmax: 4, scheme: 'warm', label: 'NCO/Mb',
    highlight: hl,
  });
  renderTrack('#invsigTrackCo', {
    chromosome: state.recomb.chromosome,
    valueFn: coRatePerMeiosis,
    vmin: 0, vmax: 0.6, scheme: 'cool', label: 'CO/meiosis',
    highlight: hl,
  });
  renderTrack('#invsigTrackRes', {
    chromosome: state.recomb.chromosome,
    valueFn: (w) => resolution(w, 3),
    vmin: 0, vmax: 1, scheme: 'cool', label: 'CO/(N+C)',
    highlight: hl,
  });
  _renderVerdicts();
  _renderKaryo();
}

function wireInvSig() {
  $('#invsigChrom').addEventListener('change', e => {
    state.recomb.chromosome = e.target.value;
    state.recomb.highlight_inversion = null;
    _populateHighlightPicker();
    _draw();
  });
  $('#invsigHighlight').addEventListener('change', e => {
    state.recomb.highlight_inversion = e.target.value || null;
    _draw();
  });
}

let _unsubChr = null;

export async function mount(root, atlasState, registry) {
  _setActiveState({ atlasState, registry });
  _populateChromPicker();
  _populateHighlightPicker();
  wireInvSig();
  _draw();
  _unsubChr = on('chromosome_changed', () => {
    if (state.selected_chromosome) {
      state.recomb.chromosome = state.selected_chromosome;
      $('#invsigChrom').value = state.recomb.chromosome;
      _populateHighlightPicker();
      _draw();
    }
  });
}

export async function unmount(root) {
  _setActiveState(null);
  if (_unsubChr) _unsubChr();
  _unsubChr = null;
}
