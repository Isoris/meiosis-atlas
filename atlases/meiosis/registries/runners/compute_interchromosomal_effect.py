"""Chain action runner — compute_interchromosomal_inversion_effect.

Multi-source chain: reads chromosome_meiosis_events_v1 +
local_inv_controls_v1 + family_aware_permutation_design_v1 envelopes
from the workspace, dispatches the family-aware permutation pipeline
via the pure math module, and emits a result envelope that the matching
extractor passes through to a typed inversion_meiosis_effects_v1 layer.

Target shape extends the single-source pattern with named layer ids
(`events_layer_id`, `controls_layer_id`, `design_layer_id`) so the
multi-input contract is explicit. Falls back to ordered
`target.source_layer_ids` for callers that prefer the array form
(order: events, controls, design).
"""
from __future__ import annotations

import json
import os
import pathlib
from typing import Any, Dict, Optional

from runners.meiosis_interchromosomal_effect import run_interchromosomal_tests


def _project_root() -> pathlib.Path:
    root = os.environ.get("ATLAS_PROJECT_ROOT")
    return pathlib.Path(root) if root else pathlib.Path.cwd()


def _workdir(manifest: Dict[str, Any]) -> pathlib.Path:
    return _project_root() / "raw_results" / "meiosis_interchromosomal_effect" / manifest["action_id"]


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


def _resolve_target_ids(target: Dict[str, Any]) -> Dict[str, Optional[str]]:
    """Pull named layer ids out of target, falling back to ordered
    source_layer_ids[0..2] (events, controls, design). Raises if neither
    form supplies the required events + design layers."""
    events_id   = target.get("events_layer_id")
    controls_id = target.get("controls_layer_id")
    design_id   = target.get("design_layer_id")
    if not (events_id and design_id):
        ids = target.get("source_layer_ids") or []
        if not events_id   and len(ids) >= 1: events_id   = ids[0]
        if not controls_id and len(ids) >= 2: controls_id = ids[1]
        if not design_id   and len(ids) >= 3: design_id   = ids[2]
    if not events_id or not design_id:
        raise KeyError(
            "compute_interchromosomal_inversion_effect requires both "
            "events_layer_id (chromosome_meiosis_events_v1) and "
            "design_layer_id (family_aware_permutation_design_v1) in target."
        )
    return {"events": events_id, "controls": controls_id, "design": design_id}


def compute(manifest: Dict[str, Any], client: Any) -> Dict[str, str]:
    target = manifest.get("target") or {}
    ids = _resolve_target_ids(target)

    cme  = _load_envelope(ids["events"])
    fapd = _load_envelope(ids["design"])
    lic  = _load_envelope(ids["controls"]) if ids["controls"] else {"payload": {"controls": []}}

    params = manifest.get("params") or {}
    payload = run_interchromosomal_tests(
        envelopes={"cme": cme, "lic": lic, "fapd": fapd, "cm": None},
        params=params,
    )
    payload["provenance"] = {
        "events_layer_id":   ids["events"],
        "controls_layer_id": ids["controls"],
        "design_layer_id":   ids["design"],
        "module":            "meiosis_interchromosomal_effect_test",
        "module_version":    "v1.0.0",
        "params":            {
            "focal_inversion_id": params.get("focal_inversion_id"),
            "include_co":         params.get("include_co", True),
            "include_dco":        params.get("include_dco", False),
            "n_permutations":     params.get("n_permutations", 10_000),
            "seed":               params.get("seed"),
            "p_bh_alpha":         params.get("p_bh_alpha", 0.05),
        },
    }

    out_dir = _workdir(manifest)
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / "interchromosomal_effect_result.json"
    out_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return {
        "interchromosomal_effect_payload": str(out_path),
        "events_layer_id":   ids["events"],
        "controls_layer_id": ids["controls"] or "",
        "design_layer_id":   ids["design"],
    }
