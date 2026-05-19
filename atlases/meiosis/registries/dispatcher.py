"""Meiosis-atlas dispatcher — invoked by atlas-core's atlas_server.py
on POST /api/actions.

Mirrors the relatedness-atlas dispatcher verbatim (the dispatcher logic
is atlas-agnostic — it only reads from data/actions.registry.json,
data/extractors.registry.json, and the schemas/ directory under its own
parent). When a copy-tweak is desired, change relatedness first; this
file should stay byte-equivalent in spirit so the action-pipeline
contract is uniform across atlases.

Per atlas-core/toolkit_registries/PIPELINE_FLOW.md the dispatcher's job is:

  1. Validate the manifest against schemas/schema_in/<type>_v1.schema.json
     (uses `jsonschema` if installed; falls back to a shallow required-key
     walk so the registry stays dependency-light).
  2. Resolve the runner from data/actions.registry.json and call it.
     The runner returns {name: path} for raw output files.
  3. For each expected output, resolve the extractor from
     data/extractors.registry.json, call parser(raw_outputs, params) to
     produce a layer payload, validate the payload against
     schemas/schema_out/<schema_version>.schema.json (for normalized
     stages only).
  4. Wrap each payload in a layer_envelope dict and return them.

The server (atlas_server.py) writes the envelopes to
<workspace>/layers/<layer_type>/<dataset_id>/<layer_id>.json and indexes
them in <workspace>/registry/layers.registry.json. This dispatcher does
NOT write to disk or call the layer registry directly.
"""
from __future__ import annotations

import importlib
import json
import pathlib
import time
from typing import Any, Dict, List, Optional


HERE        = pathlib.Path(__file__).parent
SCHEMA_IN   = HERE / "schemas" / "schema_in"
SCHEMA_OUT  = HERE / "schemas" / "schema_out"


def _load_json(path: pathlib.Path) -> Dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _load_registries() -> Dict[str, Any]:
    """Lazy-load actions + extractors so hot-edits during development
    are picked up on the next call without restarting the server."""
    return {
        "actions":    _load_json(HERE / "data" / "actions.registry.json"),
        "extractors": _load_json(HERE / "data" / "extractors.registry.json"),
    }


def _shallow_required_check(obj: Any, schema: Dict[str, Any], path: str = "$") -> None:
    """Walk `required` + `properties.X.required` one level deep. Cheap,
    dep-free, catches the typical 'missing target.groups' case. Full
    draft-07 validation needs the optional `jsonschema` library — used
    when available."""
    if not isinstance(schema, dict):
        return
    if isinstance(obj, dict):
        for k in (schema.get("required") or []):
            if k not in obj:
                raise ValueError(f"{path}: missing required key '{k}'")
        for k, sub in (schema.get("properties") or {}).items():
            if k in obj and isinstance(sub, dict):
                _shallow_required_check(obj[k], sub, f"{path}.{k}")


def _validate(obj: Any, schema: Dict[str, Any]) -> None:
    """Prefer `jsonschema` if installed; fall back to the shallow walk."""
    try:
        import jsonschema  # type: ignore
        jsonschema.validate(obj, schema)
    except ImportError:
        _shallow_required_check(obj, schema, "$")


def _validate_manifest(manifest: Dict[str, Any]) -> None:
    schema_name = f"{manifest['type']}_v1"
    schema_path = SCHEMA_IN / f"{schema_name}.schema.json"
    if not schema_path.exists():
        raise FileNotFoundError(
            f"no schema_in for action type '{manifest['type']}': {schema_path}"
        )
    _validate(manifest, _load_json(schema_path))


def _validate_payload(payload: Any, schema_version: str, stage: str) -> None:
    if stage != "normalized":
        return  # staging is loose by design
    schema_path = SCHEMA_OUT / f"{schema_version}.schema.json"
    if not schema_path.exists():
        raise FileNotFoundError(
            f"no schema_out for schema_version '{schema_version}': {schema_path}"
        )
    _validate(payload, _load_json(schema_path))


def _import(dotted: str):
    mod, fn = dotted.rsplit(".", 1)
    return getattr(importlib.import_module(mod), fn)


def _now_iso_z() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _new_layer_id(layer_type: str, manifest: Dict[str, Any]) -> str:
    """Stable-ish id: <layer_type>_<dataset_id>[_<chrom>]_<action_suffix>.

    The 3-char suffix from action_id keeps reruns distinguishable while
    still being readable in the layers index."""
    suffix = manifest["action_id"].rsplit("_", 1)[-1]
    parts: List[str] = [layer_type, manifest["dataset_id"]]
    chrom = (manifest.get("target") or {}).get("chrom")
    if chrom:
        parts.append(chrom)
    parts.append(suffix)
    return "_".join(parts)


def _build_envelope(
    layer_type:     str,
    schema_version: str,
    stage:          str,
    payload:        Any,
    manifest:       Dict[str, Any],
    runner_path:    str,
    parser_path:    str,
    raw_outputs:    Dict[str, str],
) -> Dict[str, Any]:
    target = manifest.get("target") or {}
    envelope: Dict[str, Any] = {
        "layer_id":       _new_layer_id(layer_type, manifest),
        "layer_type":     layer_type,
        "schema_version": schema_version,
        "stage":          stage,
        "dataset_id":     manifest["dataset_id"],
        "status":         "review" if stage == "staging" else "active",
        "created_at":     _now_iso_z(),
        "source_files":   [str(p) for p in raw_outputs.values()],
        "provenance": {
            "action_id": manifest["action_id"],
            "runner":    runner_path,
            "extractor": parser_path,
        },
        "payload": payload,
    }
    if "chrom" in target:
        coord: Dict[str, Any] = {"chrom": target["chrom"]}
        if "start_bp" in target: coord["start_bp"] = int(target["start_bp"])
        if "end_bp"   in target: coord["end_bp"]   = int(target["end_bp"])
        envelope["coordinate"] = coord
    if isinstance(target.get("groups"), dict):
        envelope["sample_scope"] = {"group_ids": list(target["groups"].keys())}
    # Lineage: when the manifest names source envelope(s) (the staging-
    # to-normalized promotion pattern from PIPELINE_FLOW.md), echo them
    # into provenance.source_layer_ids so the new envelope traces back
    # to whatever it was derived from. Accepts either a scalar
    # 'source_layer_id' or a list 'source_layer_ids'.
    src_ids = target.get("source_layer_ids")
    if not src_ids and target.get("source_layer_id"):
        src_ids = [target["source_layer_id"]]
    if src_ids:
        envelope["provenance"]["source_layer_ids"] = list(src_ids)
    return envelope


def dispatch_action(manifest: Dict[str, Any], client: Any) -> List[Dict[str, Any]]:
    """Entry point called by atlas_server. Validates, runs, parses,
    wraps; returns one envelope per expected output. The server writes
    the envelopes."""
    _validate_manifest(manifest)
    reg = _load_registries()

    actions = (reg["actions"] or {}).get("actions") or {}
    if manifest["type"] not in actions:
        raise KeyError(
            f"unknown action type '{manifest['type']}' "
            f"(registered: {sorted(actions.keys())})"
        )
    runner_path = actions[manifest["type"]]["runner"]
    runner = _import(runner_path)
    raw_outputs = runner(manifest, client)
    if not isinstance(raw_outputs, dict):
        raise TypeError(
            f"runner {runner_path} returned {type(raw_outputs).__name__}, "
            f"expected dict[str, str] of named raw paths"
        )

    extractors_list = (reg["extractors"] or {}).get("extractors") or []
    envelopes: List[Dict[str, Any]] = []
    for spec in (manifest.get("expected_outputs") or []):
        layer_type     = spec["layer_type"]
        schema_version = spec["schema_version"]
        stage          = spec.get("stage", "normalized")
        match = next(
            (e for e in extractors_list
             if e.get("layer_type") == layer_type
             and e.get("schema_version") == schema_version),
            None,
        )
        if match is None:
            raise KeyError(
                f"no extractor for layer_type='{layer_type}', "
                f"schema_version='{schema_version}' "
                f"(check data/extractors.registry.json)"
            )
        parser = _import(match["parser"])
        payload = parser(raw_outputs, match.get("params") or {})
        _validate_payload(payload, schema_version, stage)
        envelopes.append(_build_envelope(
            layer_type, schema_version, stage, payload, manifest,
            runner_path=runner_path,
            parser_path=match["parser"],
            raw_outputs=raw_outputs,
        ))
    return envelopes
