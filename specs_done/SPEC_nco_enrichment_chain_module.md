# SPEC — `meiosis_nco_enrichment_test` chain module promotion

**Status**: SHIPPED. First chain bloc whose backing module is no longer
`stale: "promotion_from_browser_js"`.

**Implemented in:**
- [`atlases/meiosis/registries/runners/meiosis_nco_enrichment.py`](../atlases/meiosis/registries/runners/meiosis_nco_enrichment.py) — pure math: hand-rolled Fisher exact (two-sided + one-sided-greater) + crosstab + payload assembly. No third-party dependency.
- [`atlases/meiosis/registries/runners/compute_nco_enrichment.py`](../atlases/meiosis/registries/runners/compute_nco_enrichment.py) — chain action runner. Loads tract_classifications_v1 envelope from the workspace layers index, dispatches the math, writes the result payload for the extractor.
- [`atlases/meiosis/registries/extractors/normalize_nco_enrichment_result.py`](../atlases/meiosis/registries/extractors/normalize_nco_enrichment_result.py) — passthrough extractor.
- [`atlases/meiosis/registries/schemas/schema_in/compute_nco_enrichment_v1.schema.json`](../atlases/meiosis/registries/schemas/schema_in/compute_nco_enrichment_v1.schema.json) — action input.
- [`atlases/meiosis/registries/schemas/schema_out/nco_enrichment_result_v1.schema.json`](../atlases/meiosis/registries/schemas/schema_out/nco_enrichment_result_v1.schema.json) — output envelope.
- [`atlases/meiosis/registries/data/actions.registry.json`](../atlases/meiosis/registries/data/actions.registry.json) — `compute_nco_inside_vs_outside_inversion` action registered.
- [`atlases/meiosis/registries/data/extractors.registry.json`](../atlases/meiosis/registries/data/extractors.registry.json) — `extract_nco_enrichment_result_v1` registered.
- [`atlases/meiosis/registries/test_nco_enrichment.py`](../atlases/meiosis/registries/test_nco_enrichment.py) — 37 assertions (Fisher correctness vs scipy reference + crosstab fixtures + payload shape + JSON round-trip + full runner+extractor round-trip in a temp workspace).

---

## 1. What got promoted

Pre-promotion: the chain bloc `nco_inside_vs_outside_inversion` (manuscript NCO headline — MOSAIC_SHORT × inside-inv enrichment) was inlined in `atlases/meiosis/pages/hub/nco.js` (`renderInVsOut` view). The catalogue forwarding payload listed the backing module as:

```
biomod_status: experimental
stale:         promotion_from_browser_js
stale_reason:  inlined in atlases/meiosis/pages/hub/nco.js
```

Post-promotion: the test now runs server-side via the standard
POST /api/actions dispatch path that the 5 adapter actions already use.
The module row reads:

```
version:         v1.0.0
biomod_status:   ready
installed:       true
ready:           true
stale:           ""
dispatch_action: compute_nco_inside_vs_outside_inversion
derivatives:     nco_enrichment_result_v1
```

`dispatch_action` is a new field surfaced by the generator when the
config carries `module_dispatch_action`; atlas-core's catalogue brain
can use it to wire the "Run" button on its bloc detail page.

## 2. Math

Hand-rolled (no scipy dependency):

- `fisher_exact_2x2(a, b, c, d)` — enumerates all 2×2 tables with the
  same marginals, uses log-gamma factorials for stability, returns:
    - `p_two_sided`: sum of P(table) for tables at most as probable as
      observed (standard definition)
    - `p_one_sided_greater`: P(a' ≥ a | marginals) — tests enrichment
      specifically
    - `odds_ratio`: (a·d)/(b·c) (+Inf when b·c=0 and a·d>0)
    - `log_odds`: Haldane-corrected log odds for diagnostic display
- `crosstab_mosaic_short_inside_inv(tracts, target_class)` — filters to
  NCO-like tracts (`{NCO, MOSAIC_SHORT}`), splits by
  `inside_inversion ∈ {yes, no}` (drops `partial` and unknown classes),
  returns the four cells + total + excluded count + echoed target_class.
- `compute_nco_enrichment(tracts, target_class)` — composes the above
  into the typed `nco_enrichment_result_v1` payload (NaN/Inf → null for
  strict-mode JSON serialization).

Correctness validated against reference Fisher exact p-values for three
fixtures (significant enrichment / balanced / strong depletion).

## 3. Dispatch contract

```json
POST /api/actions
{
  "type":   "compute_nco_inside_vs_outside_inversion",
  "target": { "source_layer_id": "<tract_classifications_v1 layer_id>" },
  "params": { "target_class": "MOSAIC_SHORT" }
}
```

Returns an envelope with the `nco_enrichment_result_v1` payload shape.
`target_class` defaults to `MOSAIC_SHORT` (manuscript headline);
`NCO` is the sensitivity-check alternative.

## 4. Scope: v1 = cohort-level

This v1 emits a single result block (cohort-level enrichment). The
existing `tract_classifications_v1` envelope tracks
`inside_inversion ∈ {yes, partial, no}` as a per-tract flag, not a
candidate id, so per-candidate fan-out requires either a join against
`inversion_candidates.v1` (cross-atlas read) or a producer-side change
to the tract schema. Both are v2 follow-ups.

## 5. What's still stale

Two chain test modules remain inlined in browser JS:

- `meiosis_intrachromosomal_co_test` — `crossovers.js` karyo_strat view;
  conceptually simple (CO_rate(het) vs CO_rate(non-het) per chrom +
  Welch's t).
- `meiosis_interchromosomal_effect_test` — `interchromosomal/_stats.js`;
  Welch + family-aware permutation + BH + Bonferroni. The HEADLINE
  chain; the most involved promotion (the permutation engine needs to
  be ported from the browser).

The pattern established by this SPEC (math module + chain runner +
extractor + two schemas + two registry entries + smoke test +
catalogue config flip) applies to both. Estimated effort: ~1 day for
the intrachromosomal test, ~2–3 days for the interchromosomal HEADLINE
(permutation engine is the bulk of it).
