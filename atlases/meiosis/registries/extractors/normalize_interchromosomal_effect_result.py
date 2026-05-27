"""Extractor — passes the runner's already-shaped payload through as the
inversion_meiosis_effects_v1 layer body."""
from __future__ import annotations

import json
import pathlib
from typing import Any, Dict


def extract(raw_outputs: Dict[str, str], params: Dict[str, Any]) -> Dict[str, Any]:
    payload_path = raw_outputs.get("interchromosomal_effect_payload")
    if not payload_path:
        raise KeyError(
            "compute_interchromosomal_effect runner must return "
            "{'interchromosomal_effect_payload': path}"
        )
    payload = json.loads(pathlib.Path(payload_path).read_text(encoding="utf-8"))
    for key in ("rows", "summary"):
        if key not in payload:
            raise KeyError(f"computed payload missing required block: {key!r}")
    return payload
