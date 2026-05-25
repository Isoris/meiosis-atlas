// atlases/relatedness/pages/hub/resolution.js
// =============================================================================
// Resolution — per-window CO / (NCO + CO) track. The "x map" in the Sandler
// translation: CO share given a precondition was met. Windows below the
// min-n threshold are greyed out (insufficient power).
// =============================================================================

import { $, el, fmt } from '../../../relatedness/shared/utils.js';
import { DEMO } from '../../../relatedness/shared/demo_data.js';
import { state } from '../../../relatedness/shared/state.js';
import { on } from '../../../relatedness/shared/page_hooks.js';
import {
  windowsForChrom, chromosomesWithRecomb, resolution,
} from '../../shared/recomb_data.js';
import { renderTrack, renderRampLegend } from '../../shared/recomb_track.js';
import { renderKaryotypeTable } from '../../../relatedness/shared/karyotype_table.js';
import { _setActiveState } from './resolution/_state.js';

function _populateChromPicker() {
  const sel = $('#resoChrom');
  sel.innerHTML = '';
  for (const c of chromosomesWithRecomb()) {
    sel.appendChild(el('option', { value: c, text: c }));
  }
  sel.value = state.recomb.chromosome;
}

function _populateHighlightPicker() {
  const sel = $('#resoHighlight');
  sel.innerHTML = '<option value="">(none)</option>';
  DEMO.inversion_candidates_full
    .filter(i => i.chromosome === state.recomb.chromosome)
    .forEach(i => sel.appendChild(el('option', {
      value: i.candidate, text: `${i.candidate} (${i.status})`,
    })));
  sel.value = state.recomb.highlight_inversion || '';
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

function _renderSummary(minN) {
  const slot = $('#resoSummary');
  slot.innerHTML = '';
  const wins = windowsForChrom(state.recomb.chromosome);
  const values = wins.map(w => resolution(w, minN)).filter(Number.isFinite);
  const greyed = wins.length - values.length;
  const mean = values.length ? values.reduce((a,b) => a+b, 0) / values.length : NaN;
  const min = values.length ? Math.min(...values) : NaN;
  slot.appendChild(_sumCell('chromosome',           state.recomb.chromosome));
  slot.appendChild(_sumCell('windows',              wins.length, null,
                            greyed > 0 ? `${greyed} below min n` : ''));
  slot.appendChild(_sumCell('mean CO/(CO+NCO)',     fmt(mean)));
  slot.appendChild(_sumCell('coldest window',       fmt(min),
                            Number.isFinite(min) && min < 0.10 ? 'fail' : null));
  slot.appendChild(_sumCell('min n threshold',      minN));
}

function _renderKaryo() {
  const cands = DEMO.inversion_candidates_full
    .filter(i => i.chromosome === state.recomb.chromosome);
  const cols = cands.length
    ? cands.slice(0, 4).map(c => c.chromosome)
    : [state.recomb.chromosome];
  renderKaryotypeTable('#resoKaryoSlot', {
    rows: DEMO.individuals,
    columns: cols,
  });
}

function _draw() {
  const minN = parseInt($('#resoMinN').value, 10);
  renderTrack('#resoTrack', {
    chromosome: state.recomb.chromosome,
    valueFn: (w) => resolution(w, minN),
    vmin: 0, vmax: 1,
    scheme: 'cool',
    label: 'CO/(N+C)',
    highlight: state.recomb.highlight_inversion || null,
  });
  renderRampLegend('#resoLegend', {
    vmin: 0, vmax: 1, scheme: 'cool', label: 'CO/(NCO+CO)',
  });
  _renderSummary(minN);
  _renderKaryo();
}

function wireResolution() {
  $('#resoChrom').addEventListener('change', e => {
    state.recomb.chromosome = e.target.value;
    state.recomb.highlight_inversion = null;
    _populateHighlightPicker();
    _draw();
  });
  $('#resoMinN').addEventListener('change', _draw);
  $('#resoHighlight').addEventListener('change', e => {
    state.recomb.highlight_inversion = e.target.value || null;
    _draw();
  });
}

let _unsubChr = null;

export async function mount(root, atlasState, registry) {
  _setActiveState({ atlasState, registry });
  _populateChromPicker();
  _populateHighlightPicker();
  wireResolution();
  _draw();
  _unsubChr = on('chromosome_changed', () => {
    if (state.selected_chromosome) {
      state.recomb.chromosome = state.selected_chromosome;
      $('#resoChrom').value = state.recomb.chromosome;
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
