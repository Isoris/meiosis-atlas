// atlases/meiosis/pages/hub/crossovers.js
// =============================================================================
// Crossovers page — non-NCO meiosis events (CO + DCO).
// Stub: structure + mount/unmount lifecycle only.
//
// Data sources:
//   - ngsTracts tract_classifications.tsv (class ∈ {CO, DCO})
//   - ngsTracts traversal_breakpoints.tsv (refined CO breakpoints, optional)
//   - chromosome_meiosis_events.v1 (per-chrom counts)
//   - inversion_meiosis_effects.v1, intrachromosomal slice
//     (does focal inversion's karyotype change CO rate on its own chrom?)
// =============================================================================

const _wired = new Set();

function wire(el, evt, fn) {
  el.addEventListener(evt, fn);
  _wired.add(() => el.removeEventListener(evt, fn));
}

export async function mount(root, ctx = {}) {
  const runBtn    = root.querySelector('#coRunBtn');
  const exportBtn = root.querySelector('#coExportBtn');
  if (runBtn)    wire(runBtn,    'click', () => onRender(ctx));
  if (exportBtn) wire(exportBtn, 'click', () => onExport(ctx));
}

export async function unmount(root) {
  for (const off of _wired) off();
  _wired.clear();
}

function onRender(_ctx) {
  const slot = document.querySelector('#coResultSlot');
  if (slot) slot.innerHTML = '<em style="color: var(--ink-dim);">Stub — loaders not wired yet.</em>';
}

function onExport(_ctx) {
  // Stub.
}
