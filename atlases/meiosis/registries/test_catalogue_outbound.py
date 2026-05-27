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

    assert len(modules) > 0,  "module_registry.jsonl empty"
    assert len(analyses) > 0, "analysis_registry.jsonl empty"
    assert len(modes) > 0,    "analysis_modes.jsonl empty"
    assert len(layers) > 0,   "layer_registry.jsonl empty"

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

    tar = OUTDIR / "meiosis_catalogue_outbound.tar.gz"
    assert tar.exists(), f"tarball missing: {tar}"
    assert tar.stat().st_size > 0, "tarball empty"

    if errors:
        print(f"FAILED ({len(errors)} errors):", file=sys.stderr)
        for e in errors:
            print(f"  - {e}", file=sys.stderr)
        return 1

    print(f"OK  modules={len(modules)} analyses={len(analyses)} "
          f"modes={len(modes)} layers={len(layers)} tarball={tar.stat().st_size}B")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
