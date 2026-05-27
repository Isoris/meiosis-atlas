"""Chain action runner — compute_nco_inside_vs_outside_inversion.

Reads a tract_classifications_v1 envelope from the workspace layers
index, runs Fisher exact on the MOSAIC_SHORT × inside-inv crosstab via
the pure math module, and emits a result envelope that the matching
extractor passes through to a typed nco_enrichment_result_v1 layer.

This is the v1 promotion of the chain bloc
`nco_inside_vs_outside_inversion` from browser JS to a server-side
biomod. Once this lands the catalogue brain can dispatch the chain
directly instead of just listing it as `stale:
"promotion_from_browser_js"`.
"""
from __future__ import annotations

import json
import os
import pathlib
from typing import Any, Dict

from runners.meiosis_nco_enrichment import compute_nco_enrichment


def _project_root() -> pathlib.Path:
    root = os.environ.get("ATLAS_PROJECT_ROOT")
    return pathlib.Path(root) if root else pathlib.Path.cwd()


def _workdir(manifest: Dict[str, Any]) -> pathlib.Path:
    return _project_root() / "raw_results" / "meiosis_nco_enrichment" / manifest["action_id"]


def _resolve_source_envelope(source_layer_id: str) -> pathlib.Path:
    """Look up source_layer_id in <workspace>/registry/layers.registry.json.
    Mirrors normalize_tract_classifications._resolve_source_envelope (kept
    inline rather than imported to avoid coupling the chain runner to
    sibling runner internals)."""
    root = _project_root().resolve()
    idx_path = root / "registry" / "layers.registry.json"
    if not idx_path.exists():
        raise FileNotFoundError(
            f"layers index missing at {idx_path}. Run normalize_tract_classifications first."
        )
    idx = json.loads(idx_path.read_text(encoding="utf-8"))
    entry = next(
        (r for r in (idx.get("layers") or []) if r.get("layer_id") == source_layer_id),
        None,
    )
    if entry is None:
        raise KeyError(f"source_layer_id not found in layers index: {source_layer_id!r}")
    rel = entry.get("path")
    if not rel:
        raise KeyError(f"layer index entry for {source_layer_id!r} has no 'path' field")
    env_path = (root / rel).resolve()
    if not env_path.exists():
        raise FileNotFoundError(f"source envelope file missing: {env_path}")
    return env_path


def compute(manifest: Dict[str, Any], client: Any) -> Dict[str, str]:
    """Load tract_classifications_v1 envelope, compute the enrichment
    payload, write to raw_results/ for the extractor to pick up."""
    target = manifest.get("target") or {}
    src_id = target.get("source_layer_id")
    if not src_id and target.get("source_layer_ids"):
        src_id = target["source_layer_ids"][0]
    if not src_id:
        raise KeyError("target.source_layer_id (or source_layer_ids) required")

    params = manifest.get("params") or {}
    target_class = params.get("target_class", "MOSAIC_SHORT")

    env_path = _resolve_source_envelope(src_id)
    envelope = json.loads(env_path.read_text(encoding="utf-8"))
    tracts = (envelope.get("payload") or {}).get("tracts") or []

    payload = compute_nco_enrichment(tracts, target_class=target_class)
    payload["provenance"] = {
        "source_layer_id": src_id,
        "target_class":    target_class,
        "module":          "meiosis_nco_enrichment_test",
        "module_version":  "v1.0.0",
    }

    out_dir = _workdir(manifest)
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / "nco_enrichment_result.json"
    out_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return {
        "nco_enrichment_payload": str(out_path),
        "source_layer_id":        src_id,
    }
