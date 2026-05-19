# SPEC — meiosis-atlas `interchromosomal` page (HEADLINE)

**Status**: scaffold only. Page mounts; **blocked by 3 missing product
builders** (registry says "missing — builder needed" for all three).

**Scaffolded in:**
- [`atlases/meiosis/pages/hub/interchromosomal.html`](../atlases/meiosis/pages/hub/interchromosomal.html)
- [`atlases/meiosis/pages/hub/interchromosomal.js`](../atlases/meiosis/pages/hub/interchromosomal.js)

**Note on naming**: this page tests **inter**chromosomal effects (focal
inversion on chrom X → meiosis on chrom Y ≠ X). A separate intrachromosomal
view exists as the `karyo_strat` view of the [`crossovers`](SPEC_crossovers_page.md)
page (does het-inversion suppress CO on its OWN chromosome). The two
views together answer the atlas lead question
`inversion_effect_on_meiosis_per_chromosome`.

---

## 1. Goal

For each focal inversion (chrom X, karyotype dimorphism), test whether
heterozygous carriers show altered crossover rate, double-crossover rate,
or coefficient of coincidence (C) on chromosomes **other than X**.

This is the manuscript-grade headline of the entire meiosis-atlas. Backs
the registered research question
[`meiosis_interchromosomal_effects`](../../atlas-core/toolkit_registries/relatedness/01_registry/questions.jsonl).

## 2. Data dependencies

| envelope                              | role                                  | status |
|---------------------------------------|---------------------------------------|--------|
| `inversion_candidates.v1`             | enumerate focal inversions             | inversion-atlas; available |
| `inversion_karyotypes.v1`             | het/non-het classification per parent  | inversion-atlas; available |
| `chromosome_meiosis_events.v1`        | CO/DCO counts per dyad × chrom        | partial (14/29 chroms); **adapter pending** ([SPEC_crossovers_page.md §3.1](SPEC_crossovers_page.md)) |
| `coincidence_matrix.v1`               | C per interval pair                    | **missing — builder needed** |
| `local_inv_controls.v1`               | covariate matrix                       | **missing — builder needed** |
| `family_aware_permutation_design.v1`  | null model                             | **missing — builder needed** |
| intra slice of `inversion_meiosis_effects.v1` | per-(inv × chrom × karyo) estimate | **missing — builder needed** |

Each of the 4 missing builders needs its own SPEC + adapter pair (use
[atlas-core/docs/SPEC_atlas_adapter_cookbook.md](../../atlas-core/docs/SPEC_atlas_adapter_cookbook.md)).

## 3. The test

Per row in the result table (one focal inversion × one tested chromosome):

```
H0: CO_rate(parent het at focal inv, tested chrom)
  = CO_rate(parent non-het at focal inv, tested chrom)
H1: rates differ.
```

**Adjustment**: include `local_inv_controls.v1` covariates so a hit on
chrom Y isn't actually driven by an unmodelled local inversion on Y itself.

**Null model**: `family_aware_permutation_design.v1` shuffles karyotype
assignments WITHIN family blocks — preserves sib-correlation structure.

**Multiple comparisons**: ~30 chroms × ~50 focal inversions = ~1500 tests.
Bonferroni at α=0.05 → p < 3.3e-5 for raw significance. Provide
unadjusted + Bonferroni + Benjamini-Hochberg columns.

## 4. Surface

Per the page HTML:

| control                | options                                                                  |
|------------------------|--------------------------------------------------------------------------|
| `#icFocalInv`          | populated from `inversion_candidates.v1` (sort by chrom, start_bp)       |
| `#icTestChroms`        | `all_other` (default — every chrom except focal's) \| `specific`         |
| `#icStat`              | `co_rate` \| `dco_rate` \| `c_coincidence` \| `all` (matrix view)        |
| `#icContrast`          | `het_vs_nonhet` (default) \| `all_three` (homA / het / homB)             |
| `#icControls`          | `on` (default — use local_inv_controls.v1) \| `off`                      |
| `#icPermN`             | `1,000` \| `10,000` (default) \| `100,000`                               |

Run button → result table:
- rows: tested chromosomes
- cols: statistic value (point estimate + 95% CI), p-value (perm), p-Bonf, p-BH, flag
- highlight: rows with p-BH < 0.05

Plus a small text summary above the table: "Focal inversion `INV_LG28_01`
shows altered `co_rate` on chrom Y at p-BH < 0.05 in N of M tested
chromosomes."

## 5. Why this page is the headline

Inversions are known to suppress recombination **within** themselves. The
biologically interesting question is whether they also alter meiosis on
**other** chromosomes — interchromosomal effects (ICE).

Classical Drosophila genetics shows ICE exists for some inversions (the
"interchromosomal effect of inversion heterozygosity"). Whether it
generalises to fish has not been tested at this scale. A positive result
on the 226-sample hatchery cohort is the manuscript hook.

## 6. Build order

Per [`SPEC_meiosis_atlas_pages.md` §2.3](SPEC_meiosis_atlas_pages.md):

1. **`local_inv_controls.v1`** (simplest — filter `inversion_candidates.v1` by chrom × frequency)
2. **`chromosome_meiosis_events.v1`** adapter pair (input feeds the entire chain)
3. **`coincidence_matrix.v1`** (depends on chromosome_meiosis_events being normalized)
4. **`family_aware_permutation_design.v1`** (depends on relatedness-atlas's `family_hubs.v1`)
5. **`inversion_meiosis_effects.v1`** builder that integrates the four above
6. Wire `interchromosomal.js` to consume the result

Each step has its own SPEC + adapter pair. Estimated cost: 1-2 hours of
adapter scaffolding per step + 2-4 hours of actual statistical
implementation per builder = roughly a week total.

## 7. Promotion criteria

In addition to the standard 4 per [SPEC_meiosis_atlas_pages.md §4](SPEC_meiosis_atlas_pages.md):

- [ ] All 4 missing builders shipped (each with its own specs_done/ entry)
- [ ] End-to-end smoke that drives a synthetic focal inversion → null model → result table
- [ ] At least one row in the result table shows a p-BH < 0.05 highlight rendering correctly (synthetic positive case)
- [ ] Manuscript-figure export — TSV download of the full results table

## 8. Open biological design questions

These need decision before the builders ship; consult the producer side
(ngsTracts / ngsPedigree authors):

- **How to handle the 1-2 chromosomes adjacent to the focal inv** — physically close on the chromosome map (none in catfish since LGs are independent) or chromatin-adjacent (per Hi-C, if available)? Currently treated as "any chrom != focal."
- **Recombination unit** — `co_per_mb` is the obvious metric, but `co_per_morgan` would be biology-correct if a genetic map exists. ngsTracts emits bp positions; bp-to-cM conversion needs a separate genetic-map envelope.
- **Karyotype-by-sex interaction** — do we test het effect within males and females separately, or pool? Default: pool, but expose as a `params.split_by_sex` flag.
- **DCO definition for ICE** — registry says "50–200 kb return-to-flank" for DCO, but the classical ICE result was about TOTAL CO count, not DCO specifically. Whether to expose DCO rate as a separate statistic or only as a sanity check is open.
