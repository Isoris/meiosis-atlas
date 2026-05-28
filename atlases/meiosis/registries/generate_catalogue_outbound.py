"""Regenerate the catalogue_outbound payload from atlas state + config.

Pipeline:
  1. Read atlases/meiosis/registries/data/actions.registry.json.
     For each `normalize_<X>` action, derive an atomic-adapter bloc
     producing layer `<X>_v1`, applying module-metadata overlay from
     catalogue_outbound_config.json.atomic_module_overlay[X].
  2. Add per-candidate track blocs from config.per_candidate_tracks
     (these builders live outside actions.registry.json today).
  3. Add CHAIN blocs from config.chains.
  4. Emit four JSONL files into catalogue_outbound/.
  5. Validate against the three atlas-core hard constraints:
        - every analysis_modes.analysis_type ∈ analysis_registry.analysis_id
        - every analysis_modes.produces is single-valued AND
          ∈ that registry row's declared produces
        - every analysis_modes.module_name ∈ module_registry.module_name
  6. Re-bundle catalogue_outbound/ as a tarball alongside the JSONL.
  7. Refresh the README with regeneration timestamp + row counts.

Add new chains by editing catalogue_outbound_config.json, not the JSONL.
"""
from __future__ import annotations

import datetime as _dt
import json
import pathlib
import sys
import tarfile

HERE     = pathlib.Path(__file__).parent
ATLAS    = HERE.parent
DATA     = HERE / "data"
OUTDIR   = HERE / "catalogue_outbound"
CONFIG   = HERE / "catalogue_outbound_config.json"
MANIFEST = ATLAS / "manifest.json"


def _load_json(p: pathlib.Path) -> dict:
    return json.loads(p.read_text(encoding="utf-8"))


def _normalize_actions(actions: dict) -> list[str]:
    """Return the list of layer-type stems backing `normalize_<X>` actions."""
    stems = []
    for name in actions:
        if name.startswith("normalize_"):
            stems.append(name[len("normalize_"):])
    return stems


def _empty_module_row(name: str, atlas: str, family: str, n_samples: int,
                      biomod_env: str) -> dict:
    return {
        "module_name": name,
        "version": "v0.1.0",
        "family": family,
        "atlas": atlas,
        "biomod_status": "experimental",
        "installed": "true",
        "ready": "true",
        "stale": "",
        "stale_reason": "",
        "parent": "",
        "derivatives": "",
        "last_run_id": "",
        "last_run_status": "",
        "last_run_qc": "",
        "last_run_started": "",
        "last_run_seconds": "",
        "n_samples": n_samples,
        "conda_env_path": "",
        "biomod_env": biomod_env,
        "synced_at": "",
    }


def _empty_layer_row(layer_id: str, entity_type: str, label: str,
                     description: str) -> dict:
    return {
        "layer_id": layer_id,
        "source_kind": "analysis_result",
        "entity_type": entity_type,
        "label": label,
        "description": description,
        "status": "experimental",
        "scope": "",
        "container_layer": "",
        "default_groupset": "",
        "n_intervals": "",
        "n_groups": "",
        "notes": "",
    }


def build_rows(actions: dict, config: dict) -> tuple[list, list, list, list]:
    cohort   = config["cohort"]
    atlas    = cohort["atlas"]
    family   = cohort["family"]
    nsam     = cohort["n_samples"]
    benv     = cohort["biomod_env"]
    overlay  = config["atomic_module_overlay"]

    modules, analyses, modes, layers = [], [], [], []
    seen_modules = set()

    # 1. External producers (e.g. ngsTracts)
    for ext in config.get("external_producers", []):
        m = _empty_module_row(ext["module_name"], atlas, family, nsam,
                              ext.get("biomod_env", benv))
        m["version"]        = ext.get("version", "v1.0.0")
        m["biomod_status"]  = ext.get("biomod_status", "external_producer")
        m["parent"]         = ext.get("parent", "")
        m["derivatives"]    = ext.get("derivatives", "")
        modules.append(m)
        seen_modules.add(m["module_name"])

    # 2. Atomic adapter blocs from actions.registry.json
    for stem in _normalize_actions(actions):
        if stem not in overlay:
            print(f"  WARN: normalize_{stem} has no overlay in config; skipping", file=sys.stderr)
            continue
        ov = overlay[stem]
        layer_id  = f"{stem}_v1"
        mod_name  = ov["module_name"]

        if mod_name not in seen_modules:
            m = _empty_module_row(mod_name, atlas, family, nsam, benv)
            m["version"]        = "v1.0.0"
            m["biomod_status"]  = ov.get("module_biomod_status", "experimental")
            m["parent"]         = ov.get("module_parent", "")
            m["derivatives"]    = layer_id
            modules.append(m)
            seen_modules.add(mod_name)

        analyses.append({
            "analysis_id": stem,
            "label":       ov["analysis_label"],
            "family":      family,
            "atlas":       atlas,
            "kind":        ov["analysis_kind"],
            "produces":    [layer_id],
            "status":      "experimental",
            "notes":       ov["analysis_notes"],
        })

        modes.append({
            "analysis_type":       stem,
            "mode":                "default",
            "label":               ov["mode_label"],
            "module_name":         mod_name,
            "produces":            layer_id,
            "required_dimensions": ov["required_dimensions"],
            "group_policy":        ov["group_policy"],
            "interval_policy":     ov["interval_policy"],
            "site_policy":         ov["site_policy"],
            "value_policy":        ov["value_policy"],
            "notes":               ov["mode_notes"],
        })

        layers.append(_empty_layer_row(
            layer_id, ov["layer_entity_type"], ov["analysis_label"],
            ov["layer_description"],
        ))

    # 3. Per-candidate track blocs (config-declared, not in actions.registry)
    for t in config.get("per_candidate_tracks", []):
        mod_name = t["module_name"]
        if mod_name not in seen_modules:
            m = _empty_module_row(mod_name, atlas, family, nsam, benv)
            m["biomod_status"]    = t.get("module_biomod_status", "contract_only")
            m["installed"]        = t.get("module_installed", "false")
            m["ready"]            = t.get("module_ready", "false")
            m["stale"]            = t.get("module_stale", "")
            m["stale_reason"]     = t.get("module_stale_reason", "")
            m["parent"]           = t.get("module_parent", "")
            m["derivatives"]      = t["produces_layer"]
            modules.append(m)
            seen_modules.add(mod_name)

        analyses.append({
            "analysis_id": t["analysis_id"],
            "label":       t["analysis_label"],
            "family":      family,
            "atlas":       atlas,
            "kind":        t["analysis_kind"],
            "produces":    [t["produces_layer"]],
            "status":      "experimental",
            "notes":       t["analysis_notes"],
        })

        modes.append({
            "analysis_type":       t["analysis_id"],
            "mode":                "default",
            "label":               t["mode_label"],
            "module_name":         mod_name,
            "produces":            t["produces_layer"],
            "required_dimensions": t["required_dimensions"],
            "group_policy":        t["group_policy"],
            "interval_policy":     t["interval_policy"],
            "site_policy":         t["site_policy"],
            "value_policy":        t["value_policy"],
            "notes":               t["mode_notes"],
        })

        layers.append(_empty_layer_row(
            t["produces_layer"], t["layer_entity_type"], t["analysis_label"],
            t["layer_description"],
        ))

    # 4. CHAIN blocs
    for c in config.get("chains", []):
        mod_name = c["module_name"]
        if mod_name not in seen_modules:
            m = _empty_module_row(mod_name, atlas, family, nsam, benv)
            m["version"]          = c.get("module_version", "v0.1.0")
            m["biomod_status"]    = c.get("module_biomod_status", "experimental")
            m["installed"]        = c.get("module_installed", "true")
            m["ready"]            = c.get("module_ready", "true")
            m["stale"]            = c.get("module_stale", "")
            m["stale_reason"]     = c.get("module_stale_reason", "")
            m["parent"]           = c.get("module_parent", "")
            m["derivatives"]      = c["produces_layer"]
            # Optional: dispatch action (POST /api/actions type) for chains
            # that have been promoted out of browser JS into a real runner.
            if c.get("module_dispatch_action"):
                m["dispatch_action"] = c["module_dispatch_action"]
            modules.append(m)
            seen_modules.add(mod_name)

        analyses.append({
            "analysis_id": c["analysis_id"],
            "label":       c["analysis_label"],
            "family":      family,
            "atlas":       atlas,
            "kind":        c["analysis_kind"],
            "produces":    [c["produces_layer"]],
            "status":      "experimental",
            "notes":       c["analysis_notes"],
        })

        modes.append({
            "analysis_type":       c["analysis_id"],
            "mode":                "default",
            "label":               c["mode_label"],
            "module_name":         mod_name,
            "produces":            c["produces_layer"],
            "required_dimensions": c["required_dimensions"],
            "group_policy":        c["group_policy"],
            "interval_policy":     c["interval_policy"],
            "site_policy":         c["site_policy"],
            "value_policy":        c["value_policy"],
            "notes":               c["mode_notes"],
        })

        layers.append(_empty_layer_row(
            c["produces_layer"], c["layer_entity_type"], c["analysis_label"],
            c["layer_description"],
        ))

    return modules, analyses, modes, layers


def build_upstream(config: dict, analyses: list[dict], modes: list[dict]) -> list[dict]:
    """Emit one row per analysis that consumes cross-atlas / external
    products. Each row lists the upstream producers, their availability,
    and a derived `runnable` flag (True iff every producer is available).
    Sourced from config.cross_atlas_inputs. Returns [] when the block is
    absent."""
    cai = config.get("cross_atlas_inputs") or {}
    atlases    = cai.get("atlases") or {}
    by_analysis = cai.get("by_analysis") or {}
    if not by_analysis:
        return []

    module_of = {m["analysis_type"]: m["module_name"] for m in modes}

    rows = []
    for analysis_id in sorted(by_analysis.keys()):
        sources = list(by_analysis[analysis_id])
        unavailable = [s for s in sources
                       if not (atlases.get(s) or {}).get("available", False)]
        rows.append({
            "analysis_id":      analysis_id,
            "module_name":      module_of.get(analysis_id, ""),
            "upstream_sources": sources,
            "blocked_on":       unavailable,
            "runnable":         len(unavailable) == 0,
        })
    return rows


def annotate_modules_with_blocking(modules: list[dict], upstream: list[dict]) -> None:
    """Stamp blocked_on + runnable onto each module row in place, derived
    from the upstream-dependency rows. A module is runnable only when its
    backing analysis has every upstream source available; modules with no
    declared cross-atlas dependency are left runnable=True / blocked_on=''."""
    block_by_module: dict[str, list[str]] = {}
    for u in upstream:
        mod = u.get("module_name")
        if not mod:
            continue
        # A module may back >1 analysis; union the blockers.
        block_by_module.setdefault(mod, [])
        for b in u["blocked_on"]:
            if b not in block_by_module[mod]:
                block_by_module[mod].append(b)
    for m in modules:
        blockers = block_by_module.get(m["module_name"], [])
        m["blocked_on"] = ",".join(blockers)
        m["runnable"]   = "false" if blockers else "true"


def build_pages(manifest: dict, pages_reg: dict, cohort: dict, layers: list[dict]) -> list[dict]:
    """Cross-join manifest.pages[] with pages.registry.json to emit one row
    per hub page. Pulls _label / _doc / _products / requires_layers from the
    registry; pulls fragment / module / stylesheet / tooltip from the
    manifest. Pages may reference layers that don't ship from this atlas
    yet (cross-atlas reads) — those aren't constraint-violated; they're
    surfaced in the missing_layers field instead so atlas-core can see the
    cross-atlas dependency.
    """
    atlas  = cohort["atlas"]
    family = cohort["family"]

    by_id = {p["id"]: p for p in manifest.get("pages", [])}
    reg   = pages_reg.get("pages", {})
    known_layer_ids = {l["layer_id"] for l in layers}

    rows = []
    for pid, manifest_entry in by_id.items():
        reg_entry = reg.get(pid, {})
        req       = list(reg_entry.get("requires_layers") or [])
        missing   = [l for l in req if l not in known_layer_ids]
        rows.append({
            "page_id":             pid,
            "atlas":               atlas,
            "family":              family,
            "stage":               manifest_entry.get("stage", ""),
            "label":               manifest_entry.get("label", reg_entry.get("_label", "")),
            "tooltip":             manifest_entry.get("tooltip", ""),
            "fragment":            manifest_entry.get("fragment", ""),
            "module":              manifest_entry.get("module", ""),
            "stylesheet":          manifest_entry.get("stylesheet", ""),
            "products":            list(reg_entry.get("_products") or []),
            "requires_layers":     req,
            "missing_layers":      missing,
            "requires_operations": list(reg_entry.get("requires_operations") or []),
            "doc":                 reg_entry.get("_doc", ""),
            "status_note":         reg_entry.get("_status_note", ""),
        })
    return rows


def validate(modules, analyses, modes) -> list[str]:
    """Apply atlas-core's three hard constraints. Return error list."""
    errors = []
    mod_names    = {m["module_name"] for m in modules}
    analysis_ids = {a["analysis_id"] for a in analyses}
    produces_by  = {a["analysis_id"]: set(a["produces"]) for a in analyses}

    for m in modes:
        at = m["analysis_type"]
        mn = m["module_name"]
        pr = m["produces"]
        if at not in analysis_ids:
            errors.append(f"mode analysis_type {at!r} not in analysis_registry")
        if mn not in mod_names:
            errors.append(f"mode module_name {mn!r} not in module_registry")
        if isinstance(pr, list):
            errors.append(f"mode produces must be single-valued, got list for {at!r}")
        elif at in produces_by and pr not in produces_by[at]:
            errors.append(
                f"mode produces {pr!r} not in analysis_registry[{at!r}].produces={produces_by[at]}"
            )
    return errors


def write_jsonl(path: pathlib.Path, rows: list[dict]) -> None:
    with path.open("w", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")


def write_readme(modules, analyses, modes, layers, pages, upstream) -> None:
    n_mod, n_ana, n_mode, n_lay, n_pg, n_up = (
        len(modules), len(analyses), len(modes), len(layers), len(pages), len(upstream),
    )
    n_runnable = sum(1 for u in upstream if u["runnable"])
    n_blocked  = n_up - n_runnable
    ts = _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%d %H:%M:%SZ")
    (OUTDIR / "README.md").write_text(f"""# catalogue_outbound — meiosis-atlas → atlas-core Workflow Catalogue

**Auto-generated artefact** — do not edit by hand. Re-run
`python atlases/meiosis/registries/generate_catalogue_outbound.py` to
refresh. Source of truth: `atlases/meiosis/registries/data/actions.registry.json`
+ `atlases/meiosis/registries/catalogue_outbound_config.json`
+ `atlases/meiosis/manifest.json`
+ `atlases/meiosis/registries/data/pages.registry.json`.

Last regenerated: **{ts}**

Mirrors the popstats / unified-ancestry registration shape (one bloc per
single stat or per CHAIN; scope is a runtime parameter, NOT a registry
row).

**Drop target (atlas-core):**
`atlas-core/toolkit_registries/meiosis/01_registry/`

## Files

| file | rows | what it carries |
|---|---|---|
| `module_registry.jsonl` | {n_mod} | one row per biomod module backing the blocs (all `atlas: "meiosis_atlas"`) |
| `analysis_registry.jsonl` | {n_ana} | atomic stats + CHAIN analyses (single declared `produces` each) |
| `analysis_modes.jsonl` | {n_mode} | one row per bloc; `mode: "default"` (no scope fan-out) |
| `layer_registry.jsonl` | {n_lay} | output layer ids referenced by `produces` (all `source_kind: "analysis_result"`, `status: "experimental"`) |
| `pages_registry.jsonl` | {n_pg} | one row per hub page (page_id × stage × label × tooltip × fragment × module × stylesheet × products × requires_layers × missing_layers). Joins manifest.pages with pages.registry.json. |
| `upstream_dependencies.jsonl` | {n_up} | one row per analysis that consumes cross-atlas / external products: upstream_sources, blocked_on, runnable. {n_runnable} runnable / {n_blocked} blocked today. |

## Upstream dependencies & run-blocking

`biomod_status` describes whether the COMPUTE code is implemented; it does
NOT mean the analysis can run on the cohort. An analysis is **runnable**
only when every upstream producer it consumes is available. Today the
upstream atlases are NOT producing (per `cross_atlas_inputs.atlases` in
the config): `relatedness_atlas` (family structure — a faster rewrite is
in progress, untested), `inversion_atlas` (candidates + karyotypes),
`ngsTracts` + `ngsPedigree` (the external event classifier + dyad rates).
Each module row carries `blocked_on` (comma-joined unavailable producers)
and `runnable` so the catalogue brain can show WHY a `ready` chain cannot
yet be dispatched on real data. The interchromosomal HEADLINE chain is
blocked on all four; the cohort NCO enrichment is blocked only on
ngsTracts.

## Hard constraints (atlas-core smoke test)

- every `analysis_modes.analysis_type` ∈ `analysis_registry.analysis_id`
- every `analysis_modes.produces` is single-valued AND ∈ that registry row's declared `produces`
- every `analysis_modes.module_name` ∈ `module_registry.module_name`

Validated at generation time. Re-validated by
`atlases/meiosis/registries/test_catalogue_outbound.py`.

## Cohort

226-sample hatchery *Clarias gariepinus*, ref `fClaHyb_Gar_LG`. No
cross-species rows.

## How to add a new bloc

- **New atomic adapter**: add a `normalize_<X>` action in
  `data/actions.registry.json` (with its `import_<X>` partner) and add a
  matching `<X>` entry under `atomic_module_overlay` in
  `catalogue_outbound_config.json`. Re-run the generator.
- **New CHAIN workflow**: append an entry to `chains[]` in
  `catalogue_outbound_config.json`. Re-run the generator.
- **New per-candidate track**: append an entry to
  `per_candidate_tracks[]` in `catalogue_outbound_config.json`.

## Caveat: chain module promotion

Some chain modules (e.g. `meiosis_interchromosomal_effect_test`) are
flagged `stale: "promotion_from_browser_js"` because the test pipeline
currently lives in browser JS (`interchromosomal/_stats.js`). The
catalogue brain can resolve the module_name but cannot dispatch compute
until the test is wrapped as a server-side biomod module. The
registration is the contract; the promotion is open work.
""", encoding="utf-8")


def write_tarball() -> pathlib.Path:
    out = OUTDIR / "meiosis_catalogue_outbound.tar.gz"
    # Bundle the 5 JSONL + README under a `catalogue_outbound/` prefix so
    # `tar -xzf … --strip-components=1` lands the files in 01_registry/.
    with tarfile.open(out, "w:gz") as tf:
        for name in ("README.md", "module_registry.jsonl",
                     "analysis_registry.jsonl", "analysis_modes.jsonl",
                     "layer_registry.jsonl", "pages_registry.jsonl",
                     "upstream_dependencies.jsonl"):
            tf.add(OUTDIR / name, arcname=f"catalogue_outbound/{name}")
    return out


def main() -> int:
    actions   = _load_json(DATA / "actions.registry.json")["actions"]
    config    = _load_json(CONFIG)
    manifest  = _load_json(MANIFEST)
    pages_reg = _load_json(DATA / "pages.registry.json")

    modules, analyses, modes, layers = build_rows(actions, config)
    pages = build_pages(manifest, pages_reg, config["cohort"], layers)
    upstream = build_upstream(config, analyses, modes)
    annotate_modules_with_blocking(modules, upstream)

    errors = validate(modules, analyses, modes)
    if errors:
        print("VALIDATION FAILED:", file=sys.stderr)
        for e in errors:
            print(f"  - {e}", file=sys.stderr)
        return 1

    OUTDIR.mkdir(parents=True, exist_ok=True)
    write_jsonl(OUTDIR / "module_registry.jsonl",        modules)
    write_jsonl(OUTDIR / "analysis_registry.jsonl",      analyses)
    write_jsonl(OUTDIR / "analysis_modes.jsonl",         modes)
    write_jsonl(OUTDIR / "layer_registry.jsonl",         layers)
    write_jsonl(OUTDIR / "pages_registry.jsonl",         pages)
    write_jsonl(OUTDIR / "upstream_dependencies.jsonl",  upstream)
    write_readme(modules, analyses, modes, layers, pages, upstream)
    tar = write_tarball()

    n_runnable = sum(1 for u in upstream if u["runnable"])
    print(f"OK  modules={len(modules)} analyses={len(analyses)} "
          f"modes={len(modes)} layers={len(layers)} pages={len(pages)} "
          f"upstream={len(upstream)} (runnable={n_runnable}/{len(upstream)})")
    print(f"OK  tarball={tar.relative_to(ATLAS.parent.parent)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
