// atlases/meiosis/pages/hub/meiosis.js
// =============================================================================
// Meiosis / crossover observables — sub-tab #8.
//
// Minimal scaffold. Exposes only what's actually identifiable from offspring
// genotype data:
//
//   single CO  — r1, r2          (per-interval recombination frequencies)
//   double CO  — r12             (joint exchange in both intervals)
//   C          — r12 / (r1 · r2) (coefficient of coincidence)
//   I          — 1 − C           (interference)
//
// The two-step Müller/Owen-style latent model
//
//   r1  = x · (a + d)
//   r2  = x · (b + d)
//   r12 = x² · d
//
// has 4 unknowns (a, b, d, x) for 3 observed quantities, so d (precondition
// for both intervals) and x (exchange probability given precondition) are
// NOT identifiable from genotype counts alone. To separate them you need
// an independent assay — DSBs, recombination nodules, SPO11 oligos, MLH1
// foci — which is out of scope for this atlas. The page documents the
// model and refuses to estimate d / x. Only r1, r2, r12, C, I leave this
// module.
//
// Per-inversion-carrier CO frequency (Section C in the HTML) is a stub
// until a per-individual CO call layer arrives from ngsPedigree Stage 3
// (chromosome inheritance map) or a cytological marker layer.
// =============================================================================

import { $, el, fmt } from '../../../relatedness/shared/utils.js';
import { state } from '../../../relatedness/shared/state.js';
import { _setActiveState } from './meiosis/_state.js';

// ─── Compute ──────────────────────────────────────────────────────────────

function computeCI(r1, r2, r12) {
  const denom = r1 * r2;
  const C = (denom > 0) ? (r12 / denom) : NaN;
  const I = Number.isFinite(C) ? (1 - C) : NaN;
  return { r1, r2, r12, C, I };
}

function _interpret(C) {
  if (!Number.isFinite(C)) return { label: '—', tier: 'tier-weak',
    note: 'r1 · r2 is zero — provide non-zero single-CO frequencies.' };
  if (C < 0.5)  return { label: 'POSITIVE INTERFERENCE', tier: 'tier-moderate',
    note: 'Fewer double crossovers than expected under independence — the standard meiotic pattern.' };
  if (C > 1.5)  return { label: 'NEGATIVE INTERFERENCE', tier: 'tier-warn-family',
    note: 'More double crossovers than expected. Check counts for genotyping / pedigree error before interpreting biologically.' };
  return { label: 'NEAR INDEPENDENCE', tier: 'tier-weak',
    note: 'Double-CO rate is close to r1 · r2. No strong interference signal.' };
}

// ─── Render ───────────────────────────────────────────────────────────────

function _sumCell(label, value, sub = '') {
  return el('div', { class: 'mend-summary-cell' },
    el('div', { class: 'lbl', text: label }),
    el('div', { class: 'val', text: String(value) }),
    sub ? el('div', { class: 'sub', text: sub }) : null,
  );
}

function renderSummary() {
  const r = state.meiosis.last_result;
  const slot = $('#meioSummary');
  slot.innerHTML = '';
  if (!r) return;
  const C = r.C, I = r.I;
  slot.appendChild(_sumCell('r₁', fmt(r.r1)));
  slot.appendChild(_sumCell('r₂', fmt(r.r2)));
  slot.appendChild(_sumCell('r₁₂', fmt(r.r12)));
  slot.appendChild(_sumCell('C (coincidence)', fmt(C),
    Number.isFinite(C) ? 'r₁₂ / (r₁·r₂)' : ''));
  slot.appendChild(_sumCell('I (interference)', fmt(I),
    Number.isFinite(I) ? '1 − C' : ''));
  const interp = _interpret(C);
  slot.appendChild(el('div', {
    class: 'ie-conclusion ' + interp.tier,
    style: { gridColumn: '1 / -1', marginTop: '4px' },
    html: '<div class="verdict">' + interp.label + '</div>' + interp.note
        + '<br/><br/><b>Latent parameters d, x are not estimated</b> from these counts — '
        + 'genotype data underdetermines them. To separate the precondition probability '
        + 'from the exchange probability you need an independent assay '
        + '(DSBs, recombination nodules, SPO11 oligos, MLH1 foci).'
  }));
}

// ─── Wiring ───────────────────────────────────────────────────────────────

function runCompute() {
  const r1  = parseFloat($('#meioR1').value);
  const r2  = parseFloat($('#meioR2').value);
  const r12 = parseFloat($('#meioR12').value);
  if (!Number.isFinite(r1) || !Number.isFinite(r2) || !Number.isFinite(r12)) {
    alert('Provide numeric r₁, r₂, r₁₂.'); return;
  }
  state.meiosis.r1 = r1; state.meiosis.r2 = r2; state.meiosis.r12 = r12;
  state.meiosis.last_result = computeCI(r1, r2, r12);
  renderSummary();
}

function wireMeiosis() {
  $('#meioComputeBtn').addEventListener('click', runCompute);
  $('#meioResetBtn').addEventListener('click', () => {
    state.meiosis.last_result = null;
    $('#meioR1').value  = '0.10';
    $('#meioR2').value  = '0.20';
    $('#meioR12').value = '0.005';
    state.meiosis.r1 = 0.10; state.meiosis.r2 = 0.20; state.meiosis.r12 = 0.005;
    $('#meioSummary').innerHTML = '';
  });
}

function _restoreFromState() {
  if (Number.isFinite(state.meiosis.r1))  $('#meioR1').value  = state.meiosis.r1;
  if (Number.isFinite(state.meiosis.r2))  $('#meioR2').value  = state.meiosis.r2;
  if (Number.isFinite(state.meiosis.r12)) $('#meioR12').value = state.meiosis.r12;
}

// ─── Lifecycle ────────────────────────────────────────────────────────────

export async function mount(root, atlasState, registry) {
  _setActiveState({ atlasState, registry });
  _restoreFromState();
  wireMeiosis();
  if (state.meiosis.last_result) renderSummary();
}

export async function unmount(root) {
  _setActiveState(null);
}
