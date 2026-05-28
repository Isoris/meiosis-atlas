# SPEC — upstream-dependency declaration & run-blocking

**Status**: SHIPPED.

**Implemented in:**
- [`atlases/meiosis/registries/catalogue_outbound_config.json`](../atlases/meiosis/registries/catalogue_outbound_config.json) — new `cross_atlas_inputs` block (`atlases` availability + `by_analysis` mapping).
- [`atlases/meiosis/registries/generate_catalogue_outbound.py`](../atlases/meiosis/registries/generate_catalogue_outbound.py) — `build_upstream()` + `annotate_modules_with_blocking()`; emits `upstream_dependencies.jsonl`; stamps `blocked_on` + `runnable` onto every module row.
- [`atlases/meiosis/registries/catalogue_outbound/upstream_dependencies.jsonl`](../atlases/meiosis/registries/catalogue_outbound/) — 9 rows (one per analysis with cross-atlas / external inputs).
- [`atlases/meiosis/registries/test_catalogue_outbound.py`](../atlases/meiosis/registries/test_catalogue_outbound.py) — upstream consistency constraints.

---

## 1. Why

`biomod_status: ready` was being read as "this analysis can run." It cannot.
Every meiosis chain consumes products from upstream atlases that are not
producing for this cohort yet — principally **`relatedness_atlas`** family
structure (`family_hubs.v1`, `pedigree_dyads.v1`,
`parent_offspring_edges.v1`), which feeds the family-aware permutation design
the headline interchromosomal test depends on. A faster reimplementation of the
relatedness pipeline is in progress but untested, so the products are absent.

The catalogue payload had no machine-readable way to express "code ready but
blocked on relatedness." This SPEC adds that.

## 2. What

`biomod_status` (code implemented?) is now separated from `runnable` (inputs
available?). The split is declared in `cross_atlas_inputs`:

- `atlases` — each upstream producer (`relatedness_atlas`, `inversion_atlas`,
  `ngsTracts`, `ngsPedigree`) with an `available` flag, the products it emits,
  and a note. All four are `available: false` today.
- `by_analysis` — each analysis_id → the list of upstream atlases it
  (transitively) needs.

The generator derives, per analysis with upstream inputs, a row in
`upstream_dependencies.jsonl`:

```
{ analysis_id, module_name, upstream_sources[], blocked_on[], runnable }
```

`blocked_on` is the subset of `upstream_sources` whose producer is unavailable;
`runnable` is true iff `blocked_on` is empty. Each module row in
`module_registry.jsonl` is then stamped with `blocked_on` (comma-joined union
over the analyses it backs) and `runnable`.

## 3. Current state (all blocked)

`upstream_dependencies.jsonl` = 9 rows, `runnable = 0/9`. The headline chain:

```
analysis_id  = interchromosomal_inversion_effect
module_name  = meiosis_interchromosomal_effect_test
biomod_status= ready          (compute implemented + tested)
runnable     = false
blocked_on   = ngsTracts, ngsPedigree, relatedness_atlas, inversion_atlas
```

## 4. Constraints (smoke-tested)

`test_catalogue_outbound.py` adds:

- every `upstream.analysis_id` ∈ `analysis_registry.analysis_id`
- every `upstream.module_name` ∈ `module_registry.module_name`
- `blocked_on` ⊆ `upstream_sources`
- `runnable` ⇔ (`blocked_on` empty)
- each module's stamped `blocked_on` = union of `blocked_on` over the analyses
  it backs, and its `runnable` agrees.

## 5. Unblocking

When `relatedness_atlas` (and the others) begin producing, flip
`available: true` on the corresponding `cross_atlas_inputs.atlases` entry and
re-run `make ship`. The affected analyses' `blocked_on` shrinks and `runnable`
flips to true automatically — no code change. When all of a chain's producers
are available, it becomes dispatchable on the cohort.
