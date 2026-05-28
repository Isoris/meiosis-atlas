"""Smoke test for catalogue_outbound/. Re-runs the generator end-to-end
and re-validates the four JSONL files against atlas-core's three hard
constraints. Run from repo root:

    python3 atlases/meiosis/registries/test_catalogue_outbound.py

Exits non-zero on any failure.
"""
from __future__ import annotations

import json
import pathlib
import subprocess
import sys

HERE   = pathlib.Path(__file__).parent
OUTDIR = HERE / "catalogue_outbound"
GEN    = HERE / "generate_catalogue_outbound.py"


def _load_jsonl(name: str) -> list[dict]:
    return [json.loads(line) for line in (OUTDIR / name).read_text().splitlines() if line.strip()]


def main() -> int:
    rc = subprocess.run([sys.executable, str(GEN)], check=False).returncode
    assert rc == 0, f"generator exited {rc}"

    modules  = _load_jsonl("module_registry.jsonl")
    analyses = _load_jsonl("analysis_registry.jsonl")
    modes    = _load_jsonl("analysis_modes.jsonl")
    layers   = _load_jsonl("layer_registry.jsonl")
    pages    = _load_jsonl("pages_registry.jsonl")
    upstream = _load_jsonl("upstream_dependencies.jsonl")

    assert len(modules) > 0,  "module_registry.jsonl empty"
    assert len(analyses) > 0, "analysis_registry.jsonl empty"
    assert len(modes) > 0,    "analysis_modes.jsonl empty"
    assert len(layers) > 0,   "layer_registry.jsonl empty"
    assert len(pages) > 0,    "pages_registry.jsonl empty"
    assert len(upstream) > 0, "upstream_dependencies.jsonl empty"

    mod_names    = {m["module_name"] for m in modules}
    analysis_ids = {a["analysis_id"] for a in analyses}
    produces_by  = {a["analysis_id"]: set(a["produces"]) for a in analyses}
    layer_ids    = {l["layer_id"] for l in layers}

    errors = []

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

    for a in analyses:
        for p in a["produces"]:
            if p not in layer_ids:
                errors.append(
                    f"analysis {a['analysis_id']!r} produces {p!r} not in layer_registry"
                )

    for m in modules:
        d = m.get("derivatives", "")
        if d and d not in layer_ids:
            errors.append(
                f"module {m['module_name']!r} derivatives {d!r} not in layer_registry"
            )

    # pages_registry constraints:
    #   - page_id is non-empty and unique
    #   - every requires_layers entry is in layer_registry OR explicitly
    #     surfaced in the page's `missing_layers` (cross-atlas dependency)
    seen_page_ids = set()
    for p in pages:
        pid = p.get("page_id", "")
        if not pid:
            errors.append("page_id is empty in pages_registry")
        if pid in seen_page_ids:
            errors.append(f"duplicate page_id: {pid!r}")
        seen_page_ids.add(pid)

        req     = set(p.get("requires_layers")  or [])
        missing = set(p.get("missing_layers")   or [])
        unknown = (req - layer_ids) - missing
        if unknown:
            errors.append(
                f"page {pid!r} requires layers not in layer_registry and not in missing_layers: {sorted(unknown)}"
            )

    # upstream_dependencies constraints:
    #   - every analysis_id resolves to a declared analysis
    #   - every module_name resolves to a declared module
    #   - blocked_on is a subset of upstream_sources
    #   - runnable == (blocked_on is empty)
    #   - the module row's blocked_on/runnable agree with the union of its
    #     analyses' blockers (a module may back >1 analysis)
    module_blockers: dict = {}
    for u in upstream:
        aid = u.get("analysis_id", "")
        mn  = u.get("module_name", "")
        if aid not in analysis_ids:
            errors.append(f"upstream analysis_id {aid!r} not in analysis_registry")
        if mn and mn not in mod_names:
            errors.append(f"upstream module_name {mn!r} not in module_registry")
        srcs    = set(u.get("upstream_sources") or [])
        blocked = set(u.get("blocked_on") or [])
        if not blocked.issubset(srcs):
            errors.append(f"upstream {aid!r} blocked_on not subset of upstream_sources: {sorted(blocked - srcs)}")
        if bool(u.get("runnable")) != (len(blocked) == 0):
            errors.append(f"upstream {aid!r} runnable flag inconsistent with blocked_on")
        if mn:
            module_blockers.setdefault(mn, set()).update(blocked)

    mod_by_name = {m["module_name"]: m for m in modules}
    for mn, blockers in module_blockers.items():
        m = mod_by_name.get(mn)
        if not m:
            continue
        got = set((m.get("blocked_on") or "").split(",")) - {""}
        if got != blockers:
            errors.append(
                f"module {mn!r} blocked_on={sorted(got)} disagrees with upstream union {sorted(blockers)}"
            )
        want_runnable = "false" if blockers else "true"
        if m.get("runnable") != want_runnable:
            errors.append(f"module {mn!r} runnable={m.get('runnable')!r}, expected {want_runnable!r}")

    tar = OUTDIR / "meiosis_catalogue_outbound.tar.gz"
    assert tar.exists(), f"tarball missing: {tar}"
    assert tar.stat().st_size > 0, "tarball empty"

    if errors:
        print(f"FAILED ({len(errors)} errors):", file=sys.stderr)
        for e in errors:
            print(f"  - {e}", file=sys.stderr)
        return 1

    n_runnable = sum(1 for u in upstream if u.get("runnable"))
    print(f"OK  modules={len(modules)} analyses={len(analyses)} "
          f"modes={len(modes)} layers={len(layers)} pages={len(pages)} "
          f"upstream={len(upstream)} (runnable={n_runnable}/{len(upstream)}) "
          f"tarball={tar.stat().st_size}B")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
