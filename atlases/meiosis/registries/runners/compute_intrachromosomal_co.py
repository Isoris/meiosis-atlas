"""Chain action runner — compute_intrachromosomal_co_karyotype_effect.

Reads a chromosome_meiosis_events_v1 envelope from the workspace layers
index, runs Welch's t per chromosome via the pure math module
(meiosis_intrachromosomal_co), and emits a result envelope that the
matching extractor passes through to a typed
intrachromosomal_co_effect_v1 layer.

Second chain promotion (after compute_nco_enrichment), same scaffold.
"""
from __future__ import annotations

import json
import os
import pathlib
from typing import Any, Dict

from runners.meiosis_intrachromosomal_co import compute_intrachromosomal_co


def _project_root() -> pathlib.Path:
    root = os.environ.get("ATLAS_PROJECT_ROOT")
    return pathlib.Path(root) if root else pathlib.Path.cwd()


def _workdir(manifest: Dict[str, Any]) -> pathlib.Path:
    return _project_root() / "raw_results" / "meiosis_intrachromosomal_co" / manifest["action_id"]


def _resolve_source_envelope(source_layer_id: str) -> pathlib.Path:
    root = _project_root().resolve()
    idx_path = root / "registry" / "layers.registry.json"
    if not idx_path.exists():
        raise FileNotFoundError(
            f"layers index missing at {idx_path}. Run normalize_chromosome_meiosis_events first."
        )
    idx = json.loads(idx_path.read_text(encoding="utf-8"))
    entry = next(
        (r for r in (idx.get("layers") or []) if r.get("layer_id") == source_layer_id),
        None,
    )
    if entry is None:
        raise KeyError(f"source_layer_id not found: {source_layer_id!r}")
    rel = entry.get("path")
    if not rel:
        raise KeyError(f"layer entry for {source_layer_id!r} has no 'path'")
    env_path = (root / rel).resolve()
    if not env_path.exists():
        raise FileNotFoundError(f"source envelope file missing: {env_path}")
    return env_path


def compute(manifest: Dict[str, Any], client: Any) -> Dict[str, str]:
    target = manifest.get("target") or {}
    src_id = target.get("source_layer_id")
    if not src_id and target.get("source_layer_ids"):
        src_id = target["source_layer_ids"][0]
    if not src_id:
        raise KeyError("target.source_layer_id (or source_layer_ids) required")

    params = manifest.get("params") or {}
    flag_threshold = float(params.get("flag_threshold", 0.7))

    env_path = _resolve_source_envelope(src_id)
    envelope = json.loads(env_path.read_text(encoding="utf-8"))
    events = (envelope.get("payload") or {}).get("events") or []

    payload = compute_intrachromosomal_co(events, flag_threshold=flag_threshold)
    payload["provenance"] = {
        "source_layer_id": src_id,
        "flag_threshold":  flag_threshold,
        "module":          "meiosis_intrachromosomal_co_test",
        "module_version":  "v1.0.0",
    }

    out_dir = _workdir(manifest)
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / "intrachromosomal_co_effect.json"
    out_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return {
        "intrachromosomal_co_payload": str(out_path),
        "source_layer_id":             src_id,
    }
