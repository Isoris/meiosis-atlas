// atlases/meiosis/pages/hub/nco.js
// =============================================================================
// NCO page — gene conversion / non-crossover events.
// Stub: structure + mount/unmount lifecycle only.
//
// Data source: ngsTracts tract_classifications.tsv, filtered to
//   class ∈ {NCO, MOSAIC_SHORT, MOSAIC_LONG}.
// Primary signal: MOSAIC_SHORT enrichment inside inversions
//   (50-200 kb gene-conversion tracts that the legacy CO classifier
//    would have miscalled).
// =============================================================================

const _wired = new Set();

function wire(el, evt, fn) {
  el.addEventListener(evt, fn);
  _wired.add(() => el.removeEventListener(evt, fn));
}

export async function mount(root, ctx = {}) {
  const runBtn    = root.querySelector('#ncoRunBtn');
  const exportBtn = root.querySelector('#ncoExportBtn');
  if (runBtn)    wire(runBtn,    'click', () => onRender(ctx));
  if (exportBtn) wire(exportBtn, 'click', () => onExport(ctx));
}

export async function unmount(root) {
  for (const off of _wired) off();
  _wired.clear();
}

function onRender(_ctx) {
  const slot = document.querySelector('#ncoResultSlot');
  if (slot) slot.innerHTML = '<em style="color: var(--ink-dim);">Stub — needs ngsTracts loader (tract_classifications.tsv) + inversion-interval join.</em>';
}

function onExport(_ctx) {
  // Stub.
}
