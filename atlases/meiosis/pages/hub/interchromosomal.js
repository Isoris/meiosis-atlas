// atlases/meiosis/pages/hub/interchromosomal.js
// =============================================================================
// Interchromosomal page — HEADLINE.
// Tests whether a focal inversion's karyotype on chrom X alters meiosis
// (CO rate, DCO rate, C) on chromosomes OTHER than X.
// Stub: structure + mount/unmount lifecycle only.
//
// Folds four registered meiosis_atlas products together:
//   - coincidence_matrix.v1                  (C per interval pair)
//   - local_inv_controls.v1                  (covariates)
//   - family_aware_permutation_design.v1     (null model)
//   - inversion_meiosis_effects.v1           (interchromosomal slice)
//
// Question registered: meiosis_interchromosomal_effects.
// =============================================================================

const _wired = new Set();

function wire(el, evt, fn) {
  el.addEventListener(evt, fn);
  _wired.add(() => el.removeEventListener(evt, fn));
}

export async function mount(root, ctx = {}) {
  const runBtn    = root.querySelector('#icRunBtn');
  const exportBtn = root.querySelector('#icExportBtn');
  if (runBtn)    wire(runBtn,    'click', () => onRun(ctx));
  if (exportBtn) wire(exportBtn, 'click', () => onExport(ctx));
}

export async function unmount(root) {
  for (const off of _wired) off();
  _wired.clear();
}

function onRun(_ctx) {
  const slot = document.querySelector('#icResultSlot');
  if (slot) slot.innerHTML = '<em style="color: var(--ink-dim);">Stub — interchromosomal compute pipeline not wired yet (needs four registered products, all currently missing builders).</em>';
}

function onExport(_ctx) {
  // Stub.
}
