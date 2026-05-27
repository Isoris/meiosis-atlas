# SPEC — `meiosis_intrachromosomal_co_test` chain module promotion

**Status**: SHIPPED. Second chain bloc promoted from browser JS to a
server-side biomod module.

**Implemented in:**
- [`atlases/meiosis/registries/runners/meiosis_intrachromosomal_co.py`](../atlases/meiosis/registries/runners/meiosis_intrachromosomal_co.py) — pure math: Welch's two-sample t + hand-rolled t-distribution CDF via Lentz's continued-fraction evaluation of the regularized incomplete beta (the same standard recipe scipy.special.betainc implements). No third-party dependency.
- [`atlases/meiosis/registries/runners/compute_intrachromosomal_co.py`](../atlases/meiosis/registries/runners/compute_intrachromosomal_co.py) — chain action runner.
- [`atlases/meiosis/registries/extractors/normalize_intrachromosomal_co_result.py`](../atlases/meiosis/registries/extractors/normalize_intrachromosomal_co_result.py) — passthrough extractor.
- [`atlases/meiosis/registries/schemas/schema_in/compute_intrachromosomal_co_v1.schema.json`](../atlases/meiosis/registries/schemas/schema_in/compute_intrachromosomal_co_v1.schema.json) — action input.
- [`atlases/meiosis/registries/schemas/schema_out/intrachromosomal_co_effect_v1.schema.json`](../atlases/meiosis/registries/schemas/schema_out/intrachromosomal_co_effect_v1.schema.json) — output envelope.
- Registry entries: `compute_intrachromosomal_co_karyotype_effect` action + `extract_intrachromosomal_co_effect_v1` extractor.
- [`atlases/meiosis/registries/test_intrachromosomal_co.py`](../atlases/meiosis/registries/test_intrachromosomal_co.py) — 44 assertions (t-CDF correctness vs verified reference + Welch internal consistency + karyotype split + payload shape + flag threshold + full runner+extractor round-trip in temp workspace).

---

## 1. Math

Hand-rolled, no scipy:

- `_betacf(a, b, x)` — Lentz's continued-fraction expansion for the
  incomplete beta function (NumRec §6.4). Convergence at eps=1e-15, max
  200 iterations.
- `_betainc(a, b, x)` — regularized incomplete beta I_x(a, b). Standard
  symmetry flip for x > (a+1)/(a+b+2) to stay in the fast-convergence
  regime.
- `t_cdf(t, df)` — Student's t CDF via the identity
  `F(t, ν) = 1 - 0.5·I_x(ν/2, 1/2)` for t ≥ 0 (symmetric for t < 0),
  where x = ν/(ν+t²).
- `t_two_sided_p(t, df)` — `2·(1 - F(|t|, ν))`.
- `welch_t(xs, ys)` — Welch's two-sample t with Welch-Satterthwaite df.
  NaN-safe degeneracies (n<2 in either group, zero variance in both).

Correctness validated against verified t.cdf values and an internal
consistency check (`two_sided_p == 2·(1−CDF(|t|))` identity).

## 2. Per-chromosome test

`compute_intrachromosomal_co(events, flag_threshold=0.7)`:

1. Group rows by `chrom × karyotype_bucket` where bucket is `het` vs
   `non_het` (= homA ∪ homB).
2. Per row, pull `co_per_mb` (or derive from `n_co / chrom_len_bp · 1e6`).
3. Skip rows missing karyotype, missing derivable rate, or with
   unknown chrom.
4. Per chromosome with ≥2 dyads in each bucket, run Welch's t.
   Emit `welch_t`, `welch_df`, `p_two_sided`, `rate_ratio`,
   `flag_below_threshold = (rate_ratio < flag_threshold)`.
5. Chromosomes with <2 dyads in either bucket emit null statistics +
   `excluded_reason: "insufficient_dyads"`.

## 3. Dispatch contract

```json
POST /api/actions
{
  "type":   "compute_intrachromosomal_co_karyotype_effect",
  "target": { "source_layer_id": "<chromosome_meiosis_events_v1 layer_id>" },
  "params": { "flag_threshold": 0.7 }
}
```

Returns an envelope with the `intrachromosomal_co_effect_v1` payload.

## 4. Catalogue payload state

After this promotion the workflows-page status distribution reads:

| biomod_status                 | count | modules |
|-------------------------------|-------|---------|
| `external_producer`           | 2     | ngsTracts producers |
| `experimental`                | 4     | adapter builders (chromosome_meiosis_events, coincidence_matrix, local_inv_controls, family_aware_permutation_design) |
| `ready`                       | 2     | meiosis_nco_enrichment_test (NCO HEADLINE), **meiosis_intrachromosomal_co_test (intrachromosomal HEADLINE)** |
| `contract_only`               | 3     | per_candidate_co_track_builder, per_candidate_nco_gc_track_builder, prdm9_motif_finder |
| `stale: promotion_from_browser_js` | 1 | **meiosis_interchromosomal_effect_test** (interchromosomal HEADLINE) — the only remaining inlined chain |

## 5. What's left

One chain still inlined in browser JS:

- `meiosis_interchromosomal_effect_test` —
  [`atlases/meiosis/pages/hub/interchromosomal/_stats.js`](../atlases/meiosis/pages/hub/interchromosomal/_stats.js).
  Welch's t + family-aware permutation null (shuffle karyotype labels
  within `permutation_block`) + BH + Bonferroni across off-focal chrom
  tests. The permutation engine is the bulk of the work — Welch + BH
  pieces can reuse the math module already shipped by this SPEC.
  Estimated effort: ~2–3 days.
