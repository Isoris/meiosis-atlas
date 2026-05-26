// atlases/meiosis/pages/hub/eligibility.js
// =============================================================================
// Eligibility — per-window NCO/Mb track for one chromosome. The "p map" in
// the Sandler translation: NCO traces meiotic precondition / substrate
// availability. Pages reads DEMO.recomb_windows via shared/recomb_data.js
// and renders via shared/recomb_track.js so the math + drawing are decoupled
// from the page.
// =============================================================================

import { $, el, fmt } from '../../../relatedness/shared/utils.js';
import { DEMO } from '../../../relatedness/shared/demo_data.js';
import { state } from '../../../relatedness/shared/state.js';
import { on } from '../../../relatedness/shared/page_hooks.js';
import {
  windowsForChrom, chromosomesWithRecomb, eligibility,
} from '../../shared/recomb_data.js';
import { renderTrack, renderRampLegend } from '../../shared/recomb_track.js';
import { renderKaryotypeTable } from '../../../relatedness/shared/karyotype_table.js';
import { _setActiveState } from './eligibility/_state.js';

function _populateChromPicker() {
  const sel = $('#eligChrom');
  sel.innerHTML = '';
  for (const c of chromosomesWithRecomb()) {
    sel.appendChild(el('option', { value: c, text: c }));
  }
  sel.value = state.recomb.chromosome;
}

function _populateHighlightPicker() {
  const sel = $('#eligHighlight');
  sel.innerHTML = '<option value="">(none)</option>';
  DEMO.inversion_candidates_full
    .filter(i => i.chromosome === state.recomb.chromosome)
    .forEach(i => sel.appendChild(el('option', {
      value: i.candidate,
      text: `${i.candidate} (${i.status})`,
    })));
  sel.value = state.recomb.highlight_inversion || '';
}

function _renderSummary() {
  const slot = $('#eligSummary');
  slot.innerHTML = '';
  const wins = windowsForChrom(state.recomb.chromosome);
  if (!wins.length) return;
  const values = wins.map(eligibility).filter(Number.isFinite);
  const mean = values.reduce((a,b) => a+b, 0) / Math.max(1, values.length);
  const max = Math.max(...values);
  const min = Math.min(...values);
  slot.appendChild(_sumCell('chromosome',     state.recomb.chromosome));
  slot.appendChild(_sumCell('windows',         wins.length, null, `${DEMO.recomb_window_mb} Mb each`));
  slot.appendChild(_sumCell('mean NCO/Mb',     fmt(mean)));
  slot.appendChild(_sumCell('hottest window',  fmt(max)));
  slot.appendChild(_sumCell('coldest window',  fmt(min)));
}

function _sumCell(label, value, severity = null, sub = '') {
  const cell = el('div', { class: 'mend-summary-cell' },
    el('div', { class: 'lbl', text: label }),
    el('div', { class: 'val', text: String(value) }),
    sub ? el('div', { class: 'sub', text: sub }) : null,
  );
  if (severity === 'fail')      cell.style.borderColor = 'rgba(224,85,92,0.55)';
  else if (severity === 'warn') cell.style.borderColor = 'rgba(232,196,76,0.55)';
  return cell;
}

function _renderKaryo() {
  const cands = DEMO.inversion_candidates_full
    .filter(i => i.chromosome === state.recomb.chromosome);
  // If no candidates on the active chrom, show one column with the active
  // chrom anyway so the user sees "no candidate here".
  const cols = cands.length
    ? cands.slice(0, 4).map(c => c.chromosome)
    : [state.recomb.chromosome];
  renderKaryotypeTable('#eligKaryoSlot', {
    rows: DEMO.individuals,
    columns: cols,
  });
}

function _draw() {
  renderTrack('#eligTrack', {
    chromosome: state.recomb.chromosome,
    valueFn: eligibility,
    vmin: 0, vmax: 4,           // NCO/Mb domain
    scheme: 'warm',
    label: 'NCO/Mb',
    highlight: state.recomb.highlight_inversion || null,
  });
  renderRampLegend('#eligLegend', {
    vmin: 0, vmax: 4, scheme: 'warm', label: 'NCO / Mb',
  });
  _renderSummary();
  _renderKaryo();
}

function wireEligibility() {
  $('#eligChrom').addEventListener('change', e => {
    state.recomb.chromosome = e.target.value;
    state.recomb.highlight_inversion = null;
    _populateHighlightPicker();
    _draw();
  });
  $('#eligHighlight').addEventListener('change', e => {
    state.recomb.highlight_inversion = e.target.value || null;
    _draw();
  });
}

// ─── Lifecycle ───────────────────────────────────────────────────────────

let _unsubChr = null;

export async function mount(root, atlasState, registry) {
  _setActiveState({ atlasState, registry });
  _populateChromPicker();
  _populateHighlightPicker();
  wireEligibility();
  _draw();
  _unsubChr = on('chromosome_changed', () => {
    if (state.selected_chromosome) {
      state.recomb.chromosome = state.selected_chromosome;
      $('#eligChrom').value = state.recomb.chromosome;
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
