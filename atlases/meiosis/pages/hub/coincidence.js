// atlases/relatedness/pages/hub/coincidence.js
// =============================================================================
// Coincidence — 2D per-window-pair heatmap of C = r_ij / (r_i · r_j) for
// one chromosome. Sandler-style interference map. Click a cell to inspect
// the underlying pair (CO counts, expected DCOs under independence,
// observed DCOs, C, I).
// =============================================================================

import { $, el, fmt } from '../../../relatedness/shared/utils.js';
import { DEMO } from '../../../relatedness/shared/demo_data.js';
import { state } from '../../../relatedness/shared/state.js';
import { on } from '../../../relatedness/shared/page_hooks.js';
import {
  windowsForChrom, pairsForChrom, chromosomesWithRecomb,
  coincidence, interferenceFromC, coRatePerMeiosis,
} from '../../shared/recomb_data.js';
import { renderCoincidenceHeatmap, renderRampLegend } from '../../shared/recomb_track.js';
import { renderKaryotypeTable } from '../../../relatedness/shared/karyotype_table.js';
import { _setActiveState } from './coincidence/_state.js';

function _populateChromPicker() {
  const sel = $('#coinChrom');
  sel.innerHTML = '';
  for (const c of chromosomesWithRecomb()) {
    sel.appendChild(el('option', { value: c, text: c }));
  }
  sel.value = state.recomb.chromosome;
}
function _populateHighlightPicker() {
  const sel = $('#coinHighlight');
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

function _renderSummary() {
  const slot = $('#coinSummary');
  slot.innerHTML = '';
  const wins = windowsForChrom(state.recomb.chromosome);
  const pairs = pairsForChrom(state.recomb.chromosome);
  let n_finite = 0, n_low = 0, n_high = 0, c_sum = 0;
  for (const p of pairs) {
    const C = coincidence(p, wins);
    if (!Number.isFinite(C)) continue;
    n_finite++; c_sum += C;
    if (C < 0.5) n_low++;
    if (C > 1.5) n_high++;
  }
  const mean = n_finite ? c_sum / n_finite : NaN;
  slot.appendChild(_sumCell('chromosome',  state.recomb.chromosome));
  slot.appendChild(_sumCell('pairs (n)',    pairs.length, null, `${n_finite} have finite C`));
  slot.appendChild(_sumCell('mean C',       fmt(mean),
                            Number.isFinite(mean) && mean < 0.5 ? 'warn' : null));
  slot.appendChild(_sumCell('C < 0.5',      n_low,  n_low  > 0 ? 'warn' : null,
                            'positive interference'));
  slot.appendChild(_sumCell('C > 1.5',      n_high, n_high > 0 ? 'fail' : null,
                            'negative — check sample size'));
}

function _renderKaryo() {
  const cands = DEMO.inversion_candidates_full
    .filter(i => i.chromosome === state.recomb.chromosome);
  const cols = cands.length
    ? cands.slice(0, 4).map(c => c.chromosome)
    : [state.recomb.chromosome];
  renderKaryotypeTable('#coinKaryoSlot', {
    rows: DEMO.individuals,
    columns: cols,
  });
}

function _onCellClick(i, j, C) {
  const wins = windowsForChrom(state.recomb.chromosome);
  const pairs = pairsForChrom(state.recomb.chromosome);
  const wi = wins[i], wj = wins[j];
  const pair = pairs.find(p => (p.i === i && p.j === j) || (p.i === j && p.j === i));
  const I = interferenceFromC(C);
  const r_i = coRatePerMeiosis(wi), r_j = coRatePerMeiosis(wj);
  const exp_DCO = r_i * r_j * (DEMO.recomb_n_meioses || 1);
  const slot = $('#coinCellDetail');
  slot.innerHTML = '';
  slot.appendChild(el('div', { class: 'ie-conclusion tier-moderate',
    html: '<div class="verdict">PAIR DETAIL · window ' + i + ' × window ' + j + '</div>'
        + '<div style="font-family: var(--mono); font-size: 10.5px; line-height: 1.55;">'
        + `${state.recomb.chromosome} · ${wi.start_mb}-${wi.end_mb} Mb &times; ${wj.start_mb}-${wj.end_mb} Mb<br/>`
        + `r₁ (CO/meiosis) = ${fmt(r_i)} · r₂ = ${fmt(r_j)}<br/>`
        + `n_DCO observed = ${pair ? pair.n_DCO : '?'} · expected under independence = ${fmt(exp_DCO)}<br/>`
        + `<b>C = ${fmt(C)}</b> · I = 1 − C = ${fmt(I)}<br/>`
        + (wi.inside_inversion || wj.inside_inversion
            ? `<span style="color:var(--warn)">at least one window inside `
              + (wi.inside_inversion || wj.inside_inversion) + '</span>'
            : '')
        + '</div>'
  }));
}

function _draw() {
  renderCoincidenceHeatmap('#coinHeatmap', {
    chromosome: state.recomb.chromosome,
    highlight: state.recomb.highlight_inversion || null,
    bandMax: parseInt($('#coinBand').value, 10) || 999,
    onCellClick: _onCellClick,
  });
  renderRampLegend('#coinLegend', {
    vmin: 0, vmax: 2, scheme: 'diverging', label: 'C  ·  1 = indep',
  });
  _renderSummary();
  _renderKaryo();
}

function wireCoincidence() {
  $('#coinChrom').addEventListener('change', e => {
    state.recomb.chromosome = e.target.value;
    state.recomb.highlight_inversion = null;
    _populateHighlightPicker();
    _draw();
  });
  $('#coinHighlight').addEventListener('change', e => {
    state.recomb.highlight_inversion = e.target.value || null;
    _draw();
  });
  $('#coinBand').addEventListener('change', _draw);
}

let _unsubChr = null;

export async function mount(root, atlasState, registry) {
  _setActiveState({ atlasState, registry });
  _populateChromPicker();
  _populateHighlightPicker();
  wireCoincidence();
  _draw();
  _unsubChr = on('chromosome_changed', () => {
    if (state.selected_chromosome) {
      state.recomb.chromosome = state.selected_chromosome;
      $('#coinChrom').value = state.recomb.chromosome;
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
