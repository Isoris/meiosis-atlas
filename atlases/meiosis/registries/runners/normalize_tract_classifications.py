"""Meiosis-atlas normalizer — promotes staging_tract_classifications_v0 →
tract_classifications_v1.

Mirrors relatedness-atlas's normalize_relatedness runner. Pure file-IO:
reads the workspace layers index to find the source envelope path, copies
its JSON into raw_results/ for provenance, and hands the path to the
extractor. No server callbacks needed.

PIPELINE_FLOW.md §'Reversibility — staging today, normalized tomorrow'.
"""
from __future__ import annotations

import json
import os
import pathlib
import shutil
from typing import Any, Dict


def _project_root() -> pathlib.Path:
    root = os.environ.get("ATLAS_PROJECT_ROOT")
    return pathlib.Path(root) if root else pathlib.Path.cwd()


def _workdir(manifest: Dict[str, Any]) -> pathlib.Path:
    return _project_root() / "raw_results" / "meiosis_normalized" / manifest["action_id"]


def _resolve_source_envelope(source_layer_id: str) -> pathlib.Path:
    """Look up `source_layer_id` in <workspace>/registry/layers.registry.json
    and return the absolute path to the envelope JSON. Raises with a clear
    message if either the index or the file is missing."""
    root = _project_root().resolve()
    idx_path = root / "registry" / "layers.registry.json"
    if not idx_path.exists():
        raise FileNotFoundError(
            f"layers index missing at {idx_path}. The action pipeline has "
            f"not produced any envelopes in this workspace yet."
        )
    idx = json.loads(idx_path.read_text(encoding="utf-8"))
    entry = next(
        (r for r in (idx.get("layers") or []) if r.get("layer_id") == source_layer_id),
        None,
    )
    if entry is None:
        raise KeyError(
            f"source_layer_id not found in layers index: {source_layer_id!r}"
        )
    rel = entry.get("path")
    if not rel:
        raise KeyError(
            f"layer index entry for {source_layer_id!r} has no 'path' field"
        )
    env_path = (root / rel).resolve()
    if not env_path.exists():
        raise FileNotFoundError(
            f"source envelope file missing on disk: {env_path}"
        )
    return env_path


def normalize(manifest: Dict[str, Any], client: Any) -> Dict[str, str]:
    """Load source envelope; copy into raw_results/ for provenance."""
    target = manifest.get("target") or {}
    src_id = target.get("source_layer_id")
    if not src_id and target.get("source_layer_ids"):
        src_id = target["source_layer_ids"][0]
    if not src_id:
        raise KeyError("target.source_layer_id (or source_layer_ids) required")

    env_path = _resolve_source_envelope(src_id)

    out_dir = _workdir(manifest)
    out_dir.mkdir(parents=True, exist_ok=True)
    copy_path = out_dir / f"source_{src_id}.json"
    shutil.copyfile(env_path, copy_path)
    return {
        "source_envelope": str(copy_path),
        "source_layer_id": src_id,
    }
