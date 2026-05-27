# SPEC — `meiosis_interchromosomal_effect_test` HEADLINE chain promotion

**Status**: SHIPPED. The third and final chain bloc promoted from
browser JS to a server-side biomod module. **Zero stale chains
remain** in the catalogue payload.

**Implemented in:**
- [`atlases/meiosis/registries/runners/meiosis_interchromosomal_effect.py`](../atlases/meiosis/registries/runners/meiosis_interchromosomal_effect.py) — 1:1 port of `atlases/meiosis/pages/hub/interchromosomal/_stats.js`. Reuses `welch_t` from `runners.meiosis_intrachromosomal_co`; the only new pieces are the family-aware permutation engine + BH/Bonferroni adjusters + mulberry32 PRNG (ported so JS and Python paths give identical sequences when seeded).
- [`atlases/meiosis/registries/runners/compute_interchromosomal_effect.py`](../atlases/meiosis/registries/runners/compute_interchromosomal_effect.py) — multi-source chain action runner.
- [`atlases/meiosis/registries/extractors/normalize_interchromosomal_effect_result.py`](../atlases/meiosis/registries/extractors/normalize_interchromosomal_effect_result.py) — passthrough.
- [`atlases/meiosis/registries/schemas/schema_in/compute_interchromosomal_effect_v1.schema.json`](../atlases/meiosis/registries/schemas/schema_in/compute_interchromosomal_effect_v1.schema.json) — action input (supports both named-keys and ordered `source_layer_ids` target forms).
- [`atlases/meiosis/registries/schemas/schema_out/inversion_meiosis_effects_v1.schema.json`](../atlases/meiosis/registries/schemas/schema_out/inversion_meiosis_effects_v1.schema.json) — output envelope.
- Registry entries: `compute_interchromosomal_inversion_effect` action + `extract_inversion_meiosis_effects_v1` extractor.
- [`atlases/meiosis/registries/test_interchromosomal_effect.py`](../atlases/meiosis/registries/test_interchromosomal_effect.py) — 55 assertions (mulberry32 vs canonical test vector + lookup helpers + per-parent rate aggregation + family-aware-permutation block invariant over 200 trials + perm-test add-one smoothing + BH classic-example values + orchestrator end-to-end with designed-significant fixture + seeded determinism check + 3-envelope workspace round-trip via both named-keys and ordered target forms).

---

## 1. Math

Pure functions, no third-party dependency:

- `mulberry32(seed)` — JS port. First 4 outputs at seed=1 byte-match a
  canonical reference vector cross-verified against multiple public
  implementations.
- `parent_co_rates_by_chrom(events, include_co, include_dco)` — sums
  `n_co [+ n_dco]` per `(parent_id, chrom)` and divides by
  `chrom_len_bp · 1e6`. Skips rows missing chrom_len.
- `karyotypes_at_focal` / `permutation_blocks` /
  `focal_chrom_from_controls` / `local_inv_burden_by_chrom` — direct
  Python ports of the same-named JS helpers.
- `permute_karyotypes(karyo_labels, blocks, rng)` — Fisher-Yates shuffle
  of karyotype labels **within each `permutation_block`**, never
  across. The block-respect invariant is verified by the smoke test
  over 200 trials (zero violations). Parents without a block id are
  dropped (matches JS behaviour).
- `perm_test(compute_t, permute_and_compute_t, n_perms, rng)` —
  two-sided permutation p with add-one smoothing
  `p = (1 + #{|t_perm| ≥ |t_obs|}) / (N_finite + 1)`.
- `bh_adjust(p_values)` — Benjamini-Hochberg step-up with monotone
  enforcement from the top. NaN inputs are preserved at their original
  index.
- `bonf_adjust(p_values)` — `min(1, p · m_finite)`.
- `welch_t` — reused from `runners.meiosis_intrachromosomal_co`
  (already shipped + tested with its own correctness suite).

## 2. Orchestrator

`run_interchromosomal_tests(envelopes, params)`:

1. Auto-pick `focal_inversion_id` from sorted-unique `fapd` ids when
   not supplied.
2. Build per-parent CO rate map from `cme` events.
3. Pull karyotype + permutation_block + focal chrom + local-inv burden
   from `fapd` and `lic`.
4. For each tested chromosome: compute observed Welch t, run N
   permutations (shuffle karyotype within block, recompute t),
   permutation p-value, and a row with the local-inv burden flag.
5. BH + Bonferroni across **off-focal-chrom** rows only — the focal-
   chrom row is reported (so the user sees intrachromosomal effect
   strength) but excluded from alpha control because the biological
   question is about OTHER chromosomes. Its `p_bh` / `p_bonf` are null.
6. `sig_flag = (p_bh < p_bh_alpha)`, default α = 0.05.

## 3. Dispatch contract

```json
POST /api/actions
{
  "type":   "compute_interchromosomal_inversion_effect",
  "target": {
    "events_layer_id":   "<chromosome_meiosis_events_v1 layer_id>",
    "design_layer_id":   "<family_aware_permutation_design_v1 layer_id>",
    "controls_layer_id": "<local_inv_controls_v1 layer_id>"
  },
  "params": {
    "focal_inversion_id": null,
    "include_co":         true,
    "include_dco":        false,
    "n_permutations":     10000,
    "seed":               null,
    "p_bh_alpha":         0.05
  }
}
```

`controls_layer_id` is optional but recommended — it supplies the
focal-chrom detection and the per-row `local_inv_burden` caveat flag.
`seed` enables byte-deterministic permutation p-values (mulberry32);
omit for non-deterministic runs. An ordered
`target.source_layer_ids: [events, controls, design]` form is also
accepted for callers that prefer the array shape.

## 4. Catalogue payload state — FINAL

After this promotion all three chain modules are `ready`:

| biomod_status                 | count | modules |
|-------------------------------|-------|---------|
| `external_producer`           | 2     | ngsTracts producers |
| `experimental`                | 4     | adapter builders |
| **`ready`**                   | **3** | **NCO HEADLINE + intrachromosomal HEADLINE + interchromosomal HEADLINE** |
| `contract_only`               | 3     | per-candidate track builders (no producer) |
| `stale: promotion_from_browser_js` | **0** | **NONE — chain promotion complete** |

Every chain bloc in the meiosis-atlas now has a real server-side
dispatch path; the workflows page's badge row reads "3 chains · constraints PASS"
with three green `● ready` chips.

## 5. What's open

- Browser pages still reference the inlined `_stats.js`. A follow-on
  refactor can swap the browser compute for a `POST /api/actions` call
  to the new endpoint — the renderers already work against the same
  payload shape, so the change is local to `interchromosomal.js`
  mount(). This is a UX migration, not a correctness one (both paths
  produce the same numbers with the same seed).
- Atlas-core-side forwarder (SessionStart hook / Makefile) that pulls
  `catalogue_outbound/*.jsonl` into
  `atlas-core/toolkit_registries/meiosis/01_registry/`. Lives in
  atlas-core, deferred.
- Per-candidate track builders (`crossover_track`, `nco_gc_track`,
  `prdm9_motif`) — still `contract_only` because no producer pipeline
  emits the per-candidate JSON yet. Out of scope for the chain
  promotion track.
