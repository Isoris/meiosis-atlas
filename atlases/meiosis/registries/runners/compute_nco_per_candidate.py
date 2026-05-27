"""Chain action runner — compute_nco_per_candidate_enrichment.

Multi-source chain (v2 of compute_nco_inside_vs_outside_inversion):
reads `tract_classifications_v1` (this atlas) + `inversion_candidates.v1`
(cross-atlas: inversion-atlas) envelopes from the workspace, runs
per-candidate Fisher + BH via the pure math module, emits a typed
`nco_per_candidate_enrichment_v1` envelope.

Target accepts named keys (`tracts_layer_id`, `candidates_layer_id`)
or the ordered fallback `target.source_layer_ids = [tracts, candidates]`.
"""
from __future__ import annotations

import json
import os
import pathlib
from typing import Any, Dict, Optional

from runners.meiosis_nco_per_candidate import compute_nco_per_candidate


def _project_root() -> pathlib.Path:
    root = os.environ.get("ATLAS_PROJECT_ROOT")
    return pathlib.Path(root) if root else pathlib.Path.cwd()


def _workdir(manifest: Dict[str, Any]) -> pathlib.Path:
    return _project_root() / "raw_results" / "meiosis_nco_per_candidate" / manifest["action_id"]


def _load_envelope(layer_id: str) -> Dict[str, Any]:
    root = _project_root().resolve()
    idx_path = root / "registry" / "layers.registry.json"
    if not idx_path.exists():
        raise FileNotFoundError(f"layers index missing at {idx_path}")
    idx = json.loads(idx_path.read_text(encoding="utf-8"))
    entry = next((r for r in (idx.get("layers") or []) if r.get("layer_id") == layer_id), None)
    if entry is None:
        raise KeyError(f"source_layer_id not found: {layer_id!r}")
    rel = entry.get("path")
    if not rel:
        raise KeyError(f"layer entry for {layer_id!r} has no 'path'")
    env_path = (root / rel).resolve()
    if not env_path.exists():
        raise FileNotFoundError(f"envelope file missing: {env_path}")
    return json.loads(env_path.read_text(encoding="utf-8"))


def _resolve_ids(target: Dict[str, Any]) -> Dict[str, Optional[str]]:
    tracts_id     = target.get("tracts_layer_id")
    candidates_id = target.get("candidates_layer_id")
    if not (tracts_id and candidates_id):
        ids = target.get("source_layer_ids") or []
        if not tracts_id     and len(ids) >= 1: tracts_id     = ids[0]
        if not candidates_id and len(ids) >= 2: candidates_id = ids[1]
    if not tracts_id or not candidates_id:
        raise KeyError(
            "compute_nco_per_candidate_enrichment requires both "
            "tracts_layer_id (tract_classifications_v1) and "
            "candidates_layer_id (inversion_candidates.v1) in target."
        )
    return {"tracts": tracts_id, "candidates": candidates_id}


def compute(manifest: Dict[str, Any], client: Any) -> Dict[str, str]:
    target = manifest.get("target") or {}
    ids = _resolve_ids(target)

    tracts_env     = _load_envelope(ids["tracts"])
    candidates_env = _load_envelope(ids["candidates"])

    params       = manifest.get("params") or {}
    target_class = params.get("target_class", "MOSAIC_SHORT")
    p_bh_alpha   = float(params.get("p_bh_alpha", 0.05))

    tracts     = (tracts_env.get("payload")     or {}).get("tracts")     or []
    candidates = (candidates_env.get("payload") or {}).get("candidates") \
                 or (candidates_env.get("payload") or {}).get("inversions") \
                 or []

    payload = compute_nco_per_candidate(tracts, candidates,
                                        target_class=target_class,
                                        p_bh_alpha=p_bh_alpha)
    payload["provenance"] = {
        "tracts_layer_id":     ids["tracts"],
        "candidates_layer_id": ids["candidates"],
        "target_class":        target_class,
        "p_bh_alpha":          p_bh_alpha,
        "module":              "meiosis_nco_per_candidate_test",
        "module_version":      "v1.0.0",
    }

    out_dir = _workdir(manifest)
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / "nco_per_candidate_enrichment.json"
    out_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return {
        "nco_per_candidate_payload": str(out_path),
        "tracts_layer_id":           ids["tracts"],
        "candidates_layer_id":       ids["candidates"],
    }
