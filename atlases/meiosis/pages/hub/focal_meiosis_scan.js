// atlases/meiosis/pages/hub/focal_meiosis_scan.js
// =============================================================================
// Focal inversion × meiosis coincidence scan — sub-tab #13.
//
// Page is intentionally thin: it wires the picker / scope / n-perm controls
// to shared/inversion_meiosis.js::runFocalScan and renders the rows. All
// math (carriers, baseline C, carrier effect, permutation null, readiness)
// lives in the shared module so it can migrate to the Meiosis Atlas
// without page-side changes.
//
// Architecture pointer (per the user's summary):
//   Inversion Atlas      → inversion candidates / boundaries / karyotypes
//   Relatedness Atlas    → family hubs / parent-offspring edges / valid dyads
//   ngsPedigree/ngsTract → inheritance tracts / SCO+DCO counts / coincidence
//   Meiosis Atlas        → this analysis once that atlas is created
// =============================================================================

import { $, el, fmt } from '../../../relatedness/shared/utils.js';
import { DEMO } from '../../../relatedness/shared/demo_data.js';
import { state } from '../../../relatedness/shared/state.js';
import { on } from '../../../relatedness/shared/page_hooks.js';
import { renderKaryotypeTable } from '../../../relatedness/shared/karyotype_table.js';
import {
  runFocalScan, readinessLevels, STATUS_LABEL,
  carriersOf, controlsOf, focalChromOf, carrierHubShare,
  dosageGroups, inversionBurden, confounderProfile,
  perFamilyScan, directionConsistency,
  negativeControlNull,
  causalLadder, CAUSAL_LEVEL_LABEL,
} from '../../shared/inversion_meiosis.js';
import { _setActiveState } from './focal_meiosis_scan/_state.js';

// ─── Pickers ────────────────────────────────────────────────────────────

function _populateFocalPicker() {
  const sel = $('#fmsFocal');
  sel.innerHTML = '';
  // Prefer pass / warn candidates first, then everything else.
  const order = (c) =>
    (c.status === 'pass' ? 0 : c.status === 'warn' ? 1 : c.status === 'fail' ? 2 : 3);
  const cands = (DEMO.inversion_candidates_full || []).slice()
    .sort((a, b) => order(a) - order(b));
  for (const inv of cands) {
    sel.appendChild(el('option', {
      value: inv.candidate,
      text: `${inv.candidate} · ${inv.chromosome} ${inv.start_mb}-${inv.end_mb} Mb · ${inv.status}`,
    }));
  }
  sel.value = state.focal_meiosis.focal_inv || (cands[0] && cands[0].candidate);
  state.focal_meiosis.focal_inv = sel.value;
}

// ─── Readiness ──────────────────────────────────────────────────────────

const READINESS_LABELS = {
  basic_ready:        'basic — carriers vs non-carriers possible',
  family_ready:       'family — hubs available for permutation null',
  controlled_ready:   'controlled — other inv karyotypes for local control',
  interaction_ready:  'interaction — N enough for inv × inv tests',
  phenotype_ready:    'phenotype — survival / fertility table loaded',
};

function _renderReadiness() {
  const slot = $('#fmsReadiness');
  slot.innerHTML = '';
  const r = readinessLevels(state.focal_meiosis.focal_inv);
  const order = ['basic_ready','family_ready','controlled_ready','interaction_ready','phenotype_ready'];
  for (const k of order) {
    const ok = !!r[k];
    const row = el('div', { class: 'fms-readiness-row' },
      el('span', {
        class: 'fms-readiness-pill ' + (ok ? 'ready' : 'blocked'),
        text: ok ? '✓ ready' : '✗ blocked',
      }),
      el('span', { class: 'fms-readiness-label', text: READINESS_LABELS[k] }),
    );
    slot.appendChild(row);
  }
  // counts footer
  slot.appendChild(el('div', { class: 'fms-readiness-footer',
    text: `n_carriers=${r.n_carriers} · n_controls=${r.n_controls}`
        + ` · n_hubs(carriers)=${r.n_hubs} · n_other_invs=${r.n_other_invs}`
  }));
}

// ─── Summary cells (carriers / controls / hub share) ───────────────────

function _sumCell(label, value, severity = null, sub = '') {
  const cell = el('div', { class: 'mend-summary-cell' },
    el('div', { class: 'lbl', text: label }),
    el('div', { class: 'val', text: String(value) }),
    sub ? el('div', { class: 'sub', text: sub }) : null,
  );
  if (severity === 'fail')      cell.style.borderColor = 'rgba(224,85,92,0.55)';
  else if (severity === 'warn') cell.style.borderColor = 'rgba(232,196,76,0.55)';
  else if (severity === 'good') cell.style.borderColor = 'rgba(95,212,154,0.55)';
  return cell;
}

function _renderSummary() {
  const slot = $('#fmsSummary');
  slot.innerHTML = '';
  const f = state.focal_meiosis.focal_inv;
  const carriers = carriersOf(f);
  const controls = controlsOf(f);
  const hub = carrierHubShare(carriers);
  slot.appendChild(_sumCell('focal',            f));
  slot.appendChild(_sumCell('focal chrom',      focalChromOf(f) || '—'));
  slot.appendChild(_sumCell('carriers',         carriers.length,
    carriers.length === 0 ? 'fail' : null));
  slot.appendChild(_sumCell('controls',         controls.length,
    controls.length === 0 ? 'fail' : null));
  slot.appendChild(_sumCell('top hub share',    (hub.share * 100).toFixed(0) + '%',
    hub.share >= 0.80 ? 'fail' : (hub.share >= 0.60 ? 'warn' : null),
    hub.hub ? `${hub.count} / ${carriers.length} carriers in ${hub.hub}` : ''));
}

// ─── Results table ──────────────────────────────────────────────────────

const STATUS_TIER = {
  strong_effect:     'fail',
  moderate_effect:   'warn',
  weak_effect:       'warn',
  no_effect:         null,
  family_confounded: 'fail',
  no_data:           null,
};

function _renderResults() {
  const slot = $('#fmsResultSlot');
  slot.innerHTML = '';
  const res = state.focal_meiosis.last_results;
  if (!res) return;
  const tbl = el('table', { class: 'data-table' });
  const thead = el('thead'); const tr = el('tr');
  ['Tested','Relation','n carriers','n controls','C carrier','C control','ΔC','p_perm','Status']
    .forEach(h => tr.appendChild(el('th', { text: h })));
  thead.appendChild(tr); tbl.appendChild(thead);
  const tbody = el('tbody');
  // Sort: intra first, then by |ΔC| desc.
  const rows = res.rows.slice().sort((a, b) => {
    if (a.relation !== b.relation) return a.relation === 'intra' ? -1 : 1;
    const aD = Math.abs(a.delta_C || 0), bD = Math.abs(b.delta_C || 0);
    return bD - aD;
  });
  rows.forEach(r => {
    const t = el('tr', { class: 'clickable' });
    t.addEventListener('click', () => _renderDetail(r));
    t.appendChild(el('td', { class: 'sample-id', text: r.tested_chr }));
    const relTd = el('td');
    relTd.appendChild(el('span', {
      class: 'fms-rel-pill ' + (r.relation === 'intra' ? 'intra' : 'inter'),
      text: r.relation.toUpperCase(),
    }));
    t.appendChild(relTd);
    t.appendChild(el('td', { class: 'num', text: String(r.n_carriers) }));
    t.appendChild(el('td', { class: 'num', text: String(r.n_controls) }));
    t.appendChild(el('td', { class: 'num', text: fmt(r.C_carrier) }));
    t.appendChild(el('td', { class: 'num', text: fmt(r.C_control) }));
    const dTd = el('td', { class: 'num', text: fmt(r.delta_C) });
    if (Number.isFinite(r.delta_C)) {
      if (Math.abs(r.delta_C) >= 0.30) dTd.style.color = 'var(--bad)';
      else if (Math.abs(r.delta_C) >= 0.15) dTd.style.color = 'var(--warn)';
    }
    t.appendChild(dTd);
    const pTd = el('td', { class: 'num', text: fmt(r.p_perm) });
    if (Number.isFinite(r.p_perm) && r.p_perm < 0.05) pTd.style.color = 'var(--bad)';
    t.appendChild(pTd);
    const stTd = el('td');
    const sev = STATUS_TIER[r.status];
    stTd.appendChild(el('span', {
      class: 'status-pill-cell ' + (sev === 'fail' ? 'fail' : sev === 'warn' ? 'warn' : 'pass'),
      text: STATUS_LABEL[r.status] || r.status,
    }));
    t.appendChild(stTd);
    tbody.appendChild(t);
  });
  tbl.appendChild(tbody);
  slot.appendChild(tbl);
  // Auto-open the highest-effect row.
  if (rows.length) _renderDetail(rows[0]);

  // Causal ladder + confounder profile + per-family direction +
  // negative controls + dose preview — render once per scan.
  _renderCausalLadder();
  _renderConfounderProfile();
  _renderPerFamily();
  _renderNegativeControlNull();
  _renderDoseClasses();
}

// ─── Causal ladder block ────────────────────────────────────────────────

function _renderCausalLadder() {
  const slot = $('#fmsCausalSlot');
  if (!slot) return;
  slot.innerHTML = '';
  const res = state.focal_meiosis.last_results;
  if (!res) return;
  const conf = confounderProfile(carriersOf(res.focal_inv), controlsOf(res.focal_inv));
  const ladder = causalLadder(res, { confounders: conf });
  const tier = ladder.level >= 4 ? 'tier-strong'
             : ladder.level >= 3 ? 'tier-moderate'
             : ladder.level >= 2 ? 'tier-warn-family'
             : ladder.level >= 1 ? 'tier-weak'
             : 'tier-conflict';
  const reasonsHtml = ladder.reasons
    .map(r => `<li>${r}</li>`).join('');
  slot.appendChild(el('div', {
    class: 'ie-conclusion ' + tier,
    html: `<div class="verdict">${CAUSAL_LEVEL_LABEL[ladder.level]}</div>`
        + `<div style="font-size: 10.5px; color: var(--ink-dim);">`
        + `Reaching the next level requires the first ✗ in the list below to flip to ✓.</div>`
        + `<ol style="margin: 6px 0 0 18px; padding: 0; line-height: 1.55; font-size: 10.5px;">`
        + reasonsHtml + `</ol>`
        + `<div style="margin-top: 8px; font-size: 10px; color: var(--ink-dim); font-style: italic;">`
        + `Honest framing: observational catfish data can support up to L4. L5 needs controlled crosses.`
        + `</div>`
  }));
}

// ─── Confounder profile block ───────────────────────────────────────────

function _renderConfounderProfile() {
  const slot = $('#fmsConfoundSlot');
  if (!slot) return;
  slot.innerHTML = '';
  const res = state.focal_meiosis.last_results;
  if (!res) return;
  const carriers = carriersOf(res.focal_inv);
  const controls = controlsOf(res.focal_inv);
  const conf = confounderProfile(carriers, controls);

  const grid = el('div', { class: 'bdmi-summary' });
  grid.appendChild(_sumCell('ancestry L1 (carriers vs controls)',
    fmt(conf.ancestry_l1),
    conf.ancestry_l1 >= 0.50 ? 'fail' : (conf.ancestry_l1 >= 0.25 ? 'warn' : 'good'),
    conf.ancestry_l1 >= 0.50 ? 'large mismatch — ancestry could explain a fake effect' : ''));
  grid.appendChild(_sumCell('mean inversion burden — carriers',
    fmt(conf.burden_carrier), null, `controls: ${fmt(conf.burden_control)}`));
  grid.appendChild(_sumCell('|burden delta|',
    fmt(Math.abs(conf.burden_delta)),
    Math.abs(conf.burden_delta) >= 1.5 ? 'fail' : (Math.abs(conf.burden_delta) >= 0.75 ? 'warn' : 'good'),
    'large delta = "carriers carry many inversions" confound'));
  grid.appendChild(_sumCell('top hub carrier share',
    (conf.hub_share.share * 100).toFixed(0) + '%',
    conf.hub_share.share >= 0.80 ? 'fail' : (conf.hub_share.share >= 0.60 ? 'warn' : 'good'),
    conf.hub_share.hub
      ? `${conf.hub_share.count} / ${carriers.length} carriers in ${conf.hub_share.hub}`
      : ''));
  slot.appendChild(grid);

  // Hub-balance sub-table.
  const tbl = el('table', { class: 'data-table',
    style: { marginTop: '10px' } });
  const thead = el('thead'); const tr = el('tr');
  ['Family hub','n carriers','n controls','balance'].forEach(h =>
    tr.appendChild(el('th', { text: h })));
  thead.appendChild(tr); tbl.appendChild(thead);
  const tbody = el('tbody');
  Object.entries(conf.hub_balance).forEach(([fam, b]) => {
    const t = el('tr');
    t.appendChild(el('td', { class: 'sample-id', text: fam }));
    t.appendChild(el('td', { class: 'num', text: String(b.carriers) }));
    t.appendChild(el('td', { class: 'num', text: String(b.controls) }));
    const bal = b.carriers + b.controls > 0
      ? (b.carriers === 0 ? 'controls only'
        : b.controls === 0 ? 'carriers only'
        : 'mixed')
      : '—';
    const bd = el('td', { text: bal });
    if (bal === 'carriers only' || bal === 'controls only') bd.style.color = 'var(--warn)';
    t.appendChild(bd);
    tbody.appendChild(t);
  });
  tbl.appendChild(tbody);
  slot.appendChild(tbl);
}

// ─── Per-family direction-consistency block ─────────────────────────────

function _renderPerFamily() {
  const slot = $('#fmsPerFamilySlot');
  if (!slot) return;
  slot.innerHTML = '';
  const res = state.focal_meiosis.last_results;
  if (!res || !res.rows.length) return;
  const informative = res.rows.filter(r => Number.isFinite(r.delta_C));
  if (!informative.length) return;
  const leading = informative.slice()
    .sort((a,b) => Math.abs(b.delta_C) - Math.abs(a.delta_C))[0];
  const perFam = perFamilyScan(res.focal_inv, leading.tested_chr);
  const cons = directionConsistency(perFam, leading.delta_C);

  slot.appendChild(el('div', {
    class: 'ie-conclusion ' + (cons.score >= 0.66 ? 'tier-moderate' : 'tier-warn-family'),
    style: { marginBottom: '8px' },
    html: `<div class="verdict">LEADING ROW: ${leading.focal_inv} → ${leading.tested_chr} `
        + `(${leading.relation}, pooled ΔC = ${fmt(leading.delta_C)})</div>`
        + `<div style="font-size: 10.5px;">Direction concordance across hubs: `
        + `<b>${cons.n_concordant} / ${cons.n_informative}</b> informative families share the pooled sign `
        + `(${(cons.score * 100 || 0).toFixed(0)}%). `
        + (cons.score >= 0.66
            ? 'Strong consistency — supports a real effect rather than one-family artefact.'
            : 'Weak consistency — a real effect should reproduce across hubs.')
        + '</div>'
  }));

  const tbl = el('table', { class: 'data-table' });
  const thead = el('thead'); const tr = el('tr');
  ['Family','n carriers','n controls','C carrier','C control','ΔC','direction']
    .forEach(h => tr.appendChild(el('th', { text: h })));
  thead.appendChild(tr); tbl.appendChild(thead);
  const tbody = el('tbody');
  perFam.forEach(r => {
    const t = el('tr');
    t.appendChild(el('td', { class: 'sample-id', text: r.family }));
    t.appendChild(el('td', { class: 'num', text: String(r.n_c) }));
    t.appendChild(el('td', { class: 'num', text: String(r.n_n) }));
    t.appendChild(el('td', { class: 'num', text: fmt(r.C_carrier) }));
    t.appendChild(el('td', { class: 'num', text: fmt(r.C_control) }));
    const d = el('td', { class: 'num', text: fmt(r.delta_C) });
    if (Number.isFinite(r.delta_C)) {
      if (Math.sign(r.delta_C) === Math.sign(leading.delta_C)) d.style.color = 'var(--good)';
      else if (Math.abs(r.delta_C) > 0.05) d.style.color = 'var(--bad)';
    }
    t.appendChild(d);
    const dirTd = el('td');
    dirTd.appendChild(el('span', {
      class: 'fms-rel-pill ' + (
        r.direction === 'positive' ? 'inter'
        : r.direction === 'negative' ? 'intra'
        : 'inter'),
      style: r.direction === 'no_data' ? { background: 'rgba(138,148,163,0.18)', color: 'var(--ink-dim)' } : {},
      text: r.direction.toUpperCase(),
    }));
    t.appendChild(dirTd);
    tbody.appendChild(t);
  });
  tbl.appendChild(tbody);
  slot.appendChild(tbl);
}

// ─── Negative-controls block ────────────────────────────────────────────

function _renderNegativeControlNull() {
  const slot = $('#fmsNegCtrlSlot');
  if (!slot) return;
  slot.innerHTML = '';
  const res = state.focal_meiosis.last_results;
  if (!res || !res.rows.length) return;
  const informative = res.rows.filter(r => Number.isFinite(r.delta_C));
  if (!informative.length) return;
  const leading = informative.slice()
    .sort((a,b) => Math.abs(b.delta_C) - Math.abs(a.delta_C))[0];
  // Use a smaller K for the negative control to keep this responsive.
  const K = Math.min(state.focal_meiosis.n_perm || 1000, 200);
  const nc = negativeControlNull(res.focal_inv, leading.tested_chr, K);
  const tier = nc.p_outside < 0.05 ? 'tier-moderate' : 'tier-warn-family';
  slot.appendChild(el('div', {
    class: 'ie-conclusion ' + tier,
    html: `<div class="verdict">FAKE-LABEL NULL on ${leading.tested_chr}</div>`
        + `<div style="font-size: 10.5px; line-height: 1.5;">`
        + `K = ${nc.n_fake} fake-focal label sets sampled across the full population `
        + `(no hub stratification — that's the whole point of a negative control).<br/>`
        + `Observed |ΔC| = <b>${fmt(nc.observed_abs_delta)}</b>; mean fake-label |ΔC| = ${fmt(nc.mean_abs_delta)}.<br/>`
        + `Fraction of fake labels with |ΔC| ≥ observed: <b>${fmt(nc.p_outside)}</b>.<br/>`
        + (nc.p_outside < 0.05
            ? '<b style="color: var(--good);">Observed effect exceeds the fake-label null</b> — '
              + 'the method is not detecting random fluctuation.'
            : '<b style="color: var(--bad);">Observed effect not separable from random fake labels</b> — '
              + 'reduce confidence in the leading row, or the effect needs a denser dataset.')
        + `</div>`
  }));
}

// ─── Dose / genotype-class block ────────────────────────────────────────

function _renderDoseClasses() {
  const slot = $('#fmsDoseSlot');
  if (!slot) return;
  slot.innerHTML = '';
  const f = state.focal_meiosis.focal_inv;
  if (!f) return;
  const dose = dosageGroups(f);
  const grid = el('div', { class: 'bdmi-summary' });
  grid.appendChild(_sumCell('hom_ref (0/0)', dose.hom_ref.length, null, 'control class'));
  grid.appendChild(_sumCell('het (0/1)',     dose.het.length,
    dose.het.length === 0 ? 'fail' : null,
    'usually the strongest local pairing effect'));
  grid.appendChild(_sumCell('hom_alt (1/1)', dose.hom_alt.length,
    dose.hom_alt.length === 0 ? 'warn' : null,
    'may show different interchromosomal effect than het'));
  // Mean burden per dose class.
  const meanBurden = (g) => g.length
    ? (g.reduce((s, ind) => s + inversionBurden(ind), 0) / g.length).toFixed(2)
    : '—';
  grid.appendChild(_sumCell('mean burden — hom_ref', meanBurden(dose.hom_ref)));
  grid.appendChild(_sumCell('mean burden — het',     meanBurden(dose.het)));
  grid.appendChild(_sumCell('mean burden — hom_alt', meanBurden(dose.hom_alt)));
  slot.appendChild(grid);
  slot.appendChild(el('div', {
    class: 'meiosis-caption',
    style: { marginTop: '6px' },
    text: 'The current scan groups het and hom_alt as "carriers". A clean dose pattern '
        + '(het ≠ baseline ≠ hom_alt) strengthens the causal interpretation, but separating '
        + 'het from hom_alt as their own scan rows requires more N than the current demo cohort '
        + 'supplies. Use this card as a power check before claiming a dose effect.'
  }));
}

function _renderDetail(r) {
  const slot = $('#fmsDetailSlot');
  slot.innerHTML = '';
  const tier = STATUS_TIER[r.status] === 'fail' ? 'tier-conflict'
             : STATUS_TIER[r.status] === 'warn' ? 'tier-warn-family'
             : 'tier-weak';
  const body = `<b>${r.focal_inv}</b> on <b>${r.focal_chr}</b> &times; tested <b>${r.tested_chr}</b> `
    + `(${r.relation}). `
    + `n_carriers=${r.n_carriers}, n_controls=${r.n_controls}, n_pairs=${r.n_pairs}.<br/>`
    + `C carrier = ${fmt(r.C_carrier)}, C control = ${fmt(r.C_control)}, `
    + `ΔC = ${fmt(r.delta_C)}, family-aware p_perm = ${fmt(r.p_perm)}.<br/>`
    + `Top-hub carrier share = ${(r.carrier_share_in_hub * 100).toFixed(0)}% `
    + `&nbsp;·&nbsp; local-inv control: ${r.local_inv_controlled ? 'on (badge-only in demo)' : 'off'}.`
    + `<br/><br/>`
    + _interpretRow(r);
  slot.appendChild(el('div', {
    class: 'ie-conclusion ' + tier,
    style: { marginTop: '12px' },
    html: '<div class="verdict">' + (STATUS_LABEL[r.status] || r.status) + '</div>' + body
  }));
}

function _interpretRow(r) {
  switch (r.status) {
    case 'strong_effect':
      return `Carriers of <b>${r.focal_inv}</b> show a large, family-controlled change in `
           + `coincidence on <b>${r.tested_chr}</b> (${r.relation === 'intra'
              ? 'intra-chromosomal — direct local effect of the inversion'
              : 'inter-chromosomal — global meiosis effect or unmodelled covariate'}). `
           + `This is the kind of signal worth pushing into the next round of validation.`;
    case 'moderate_effect':
      return `Moderate ΔC at family-aware p &lt; 0.05. Treat as a candidate; rerun with more permutations and add the local-inversion control before reporting.`;
    case 'weak_effect':
      return `Weak signal — permutation p &lt; 0.05 but the effect size is small. May not survive multiple-testing correction across all tested chromosomes.`;
    case 'no_effect':
      return `Carriers and controls indistinguishable on this tested chromosome under the family-aware null.`;
    case 'family_confounded':
      return `<b>FAMILY CONFOUNDED</b> — top-hub carrier share is &ge; 80%, so the carrier-vs-non-carrier contrast is mostly comparing one family to the rest. Recompute within the dominant hub, or with matched non-carriers from the same hub, before interpreting biologically.`;
    case 'no_data':
      return `No informative pairs for <b>${r.tested_chr}</b>.`;
    default:
      return '';
  }
}

// ─── Karyotype matrix ───────────────────────────────────────────────────

function _renderKaryo() {
  const f = state.focal_meiosis.focal_inv;
  const focal_chr = focalChromOf(f);
  // Show all candidates on the focal chromosome so the user can see
  // co-inversions on the same chromosome.
  const cands = DEMO.inversion_candidates_full
    .filter(i => i.chromosome === focal_chr);
  const cols = cands.length ? cands.slice(0, 4).map(c => c.chromosome) : [focal_chr];
  renderKaryotypeTable('#fmsKaryoSlot', {
    rows: DEMO.individuals,
    columns: cols,
  });
}

// ─── Wiring ─────────────────────────────────────────────────────────────

function runScan() {
  const focal = state.focal_meiosis.focal_inv;
  const scope = $('#fmsScope').value;
  const n_perm = parseInt($('#fmsNperm').value, 10) || 1000;
  const control_local = $('#fmsControlLocal').checked;
  const unit = ($('#fmsUnit') && $('#fmsUnit').value) || 'parental_meiosis';
  const res = runFocalScan(focal, { scope, n_perm, control_local, unit });
  state.focal_meiosis.last_results = res;
  state.focal_meiosis.scope = scope;
  state.focal_meiosis.n_perm = n_perm;
  state.focal_meiosis.control_local = control_local;
  state.focal_meiosis.unit = unit;
  _renderResults();
}

function exportTsv() {
  const r = state.focal_meiosis.last_results;
  if (!r) { alert('Run the scan first.'); return; }
  const carriers = carriersOf(r.focal_inv);
  const controls = controlsOf(r.focal_inv);
  const conf = confounderProfile(carriers, controls);
  const ladder = causalLadder(r, { confounders: conf });
  const informative = r.rows.filter(row => Number.isFinite(row.delta_C));
  const leading = informative.length
    ? informative.slice().sort((a,b) => Math.abs(b.delta_C) - Math.abs(a.delta_C))[0]
    : null;
  const perFam = leading ? perFamilyScan(r.focal_inv, leading.tested_chr) : [];
  const cons = leading ? directionConsistency(perFam, leading.delta_C)
                       : { n_informative: 0, n_concordant: 0, score: NaN };
  const K = Math.min(state.focal_meiosis.n_perm || 1000, 200);
  const nc = leading ? negativeControlNull(r.focal_inv, leading.tested_chr, K)
                     : { observed_abs_delta: NaN, mean_abs_delta: NaN, p_outside: NaN, n_fake: 0 };
  const dose = dosageGroups(r.focal_inv);

  const lines = [
    '# Focal inversion x meiosis coincidence scan',
    '# Date: ' + new Date().toISOString(),
    '# Focal: ' + r.focal_inv + ' on ' + r.focal_chr,
    '# Scope: ' + r.scope + '  n_perm: ' + r.n_perm
      + '  control_local: ' + r.control_local,
    '#',
    '# === CAUSAL LADDER ===',
    '# Level: ' + ladder.level + ' (' + (CAUSAL_LEVEL_LABEL[ladder.level] || '') + ')',
    ...ladder.reasons.map(s => '#   ' + s),
    '#',
    '# === CONFOUNDER PROFILE ===',
    '# n_carriers: ' + carriers.length + '  n_controls: ' + controls.length,
    '# ancestry_l1 (carriers vs controls): ' + fmt(conf.ancestry_l1),
    '# burden_carrier: ' + fmt(conf.burden_carrier)
      + '  burden_control: ' + fmt(conf.burden_control)
      + '  delta: ' + fmt(conf.burden_delta),
    '# top_hub: ' + (conf.hub_share.hub || '-')
      + '  share: ' + (conf.hub_share.share * 100).toFixed(0) + '%'
      + '  (' + conf.hub_share.count + ' / ' + carriers.length + ' carriers)',
    '# hub_balance:',
    ...Object.entries(conf.hub_balance).map(([f, b]) =>
      '#   ' + f + '  carriers=' + b.carriers + '  controls=' + b.controls),
    '#',
    '# === DOSE / GENOTYPE CLASSES ===',
    '# n_hom_ref=' + dose.hom_ref.length
      + '  n_het=' + dose.het.length
      + '  n_hom_alt=' + dose.hom_alt.length,
    '#',
    '# === LEADING-ROW DETAIL ===',
    '# tested_chr: ' + (leading ? leading.tested_chr : '-')
      + '  relation: '   + (leading ? leading.relation : '-')
      + '  delta_C: '    + (leading ? fmt(leading.delta_C) : '-')
      + '  p_perm: '     + (leading ? fmt(leading.p_perm) : '-'),
    '#',
    '# === PER-FAMILY DIRECTION (on leading row) ===',
    '# concordance: ' + cons.n_concordant + ' / ' + cons.n_informative
      + ' (' + (Number.isFinite(cons.score) ? (cons.score * 100).toFixed(0) + '%' : '-') + ')',
    ...perFam.map(pf =>
      '#   ' + pf.family + '  n_c=' + pf.n_c + '  n_n=' + pf.n_n
      + '  deltaC=' + fmt(pf.delta_C) + '  direction=' + pf.direction),
    '#',
    '# === NEGATIVE-CONTROL NULL (on leading row, fake-label sets) ===',
    '# K_fake: ' + nc.n_fake
      + '  observed_abs_delta: ' + fmt(nc.observed_abs_delta)
      + '  mean_fake_abs_delta: ' + fmt(nc.mean_abs_delta)
      + '  p_outside: ' + fmt(nc.p_outside),
    '#',
    '# === PER-TESTED-CHROMOSOME ROWS ===',
  ];

  const cols = ['focal_inv','focal_chr','tested_chr','relation',
                'n_carriers','n_controls','n_pairs',
                'C_carrier','C_control','delta_C','p_perm',
                'carrier_share_in_hub','local_inv_controlled','status'];
  lines.push(cols.join('\t'));
  for (const row of r.rows) {
    lines.push([
      row.focal_inv, row.focal_chr, row.tested_chr, row.relation,
      row.n_carriers, row.n_controls, row.n_pairs,
      fmt(row.C_carrier), fmt(row.C_control), fmt(row.delta_C), fmt(row.p_perm),
      row.carrier_share_in_hub.toFixed(3),
      row.local_inv_controlled ? 'yes' : 'no',
      row.status,
    ].join('\t'));
  }

  const blob = new Blob([lines.join('\n') + '\n'], { type: 'text/tab-separated-values' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'focal_inv_meiosis_scan_' + r.focal_inv + '_' + Date.now() + '.tsv';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function wireFms() {
  $('#fmsFocal').addEventListener('change', e => {
    state.focal_meiosis.focal_inv = e.target.value;
    state.focal_meiosis.last_results = null;
    ['#fmsResultSlot','#fmsDetailSlot','#fmsCausalSlot','#fmsConfoundSlot',
     '#fmsPerFamilySlot','#fmsNegCtrlSlot','#fmsDoseSlot']
      .forEach(s => { const n = $(s); if (n) n.innerHTML = ''; });
    _renderReadiness();
    _renderSummary();
    _renderResults();
    _renderDoseClasses();
    _renderKaryo();
  });
  $('#fmsScope').addEventListener('change',         e => state.focal_meiosis.scope         = e.target.value);
  $('#fmsNperm').addEventListener('change',         e => state.focal_meiosis.n_perm        = parseInt(e.target.value, 10));
  $('#fmsControlLocal').addEventListener('change',  e => state.focal_meiosis.control_local = e.target.checked);
  if ($('#fmsUnit')) $('#fmsUnit').addEventListener('change', e => state.focal_meiosis.unit = e.target.value);
  $('#fmsRunBtn').addEventListener('click', runScan);
  $('#fmsResetBtn').addEventListener('click', () => {
    state.focal_meiosis.last_results = null;
    ['#fmsResultSlot','#fmsDetailSlot','#fmsCausalSlot','#fmsConfoundSlot',
     '#fmsPerFamilySlot','#fmsNegCtrlSlot','#fmsDoseSlot']
      .forEach(s => { const n = $(s); if (n) n.innerHTML = ''; });
  });
  $('#fmsExportBtn').addEventListener('click', exportTsv);
}

function _restoreFromState() {
  if (state.focal_meiosis.scope)    $('#fmsScope').value         = state.focal_meiosis.scope;
  if (state.focal_meiosis.n_perm)   $('#fmsNperm').value         = String(state.focal_meiosis.n_perm);
  if (state.focal_meiosis.control_local !== undefined) {
    $('#fmsControlLocal').checked = !!state.focal_meiosis.control_local;
  }
  if (state.focal_meiosis.unit && $('#fmsUnit')) $('#fmsUnit').value = state.focal_meiosis.unit;
}

// ─── Lifecycle ─────────────────────────────────────────────────────────

let _unsubChr = null;

export async function mount(root, atlasState, registry) {
  _setActiveState({ atlasState, registry });
  _populateFocalPicker();
  _restoreFromState();
  wireFms();
  _renderReadiness();
  _renderSummary();
  _renderDoseClasses();
  _renderKaryo();
  if (state.focal_meiosis.last_results) _renderResults();
  _unsubChr = on('chromosome_changed', () => {
    // No-op for now; the focal candidate drives the chromosome.
  });
}

export async function unmount(root) {
  _setActiveState(null);
  if (_unsubChr) _unsubChr();
  _unsubChr = null;
}
