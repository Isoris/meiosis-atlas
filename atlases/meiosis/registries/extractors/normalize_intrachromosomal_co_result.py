"""Extractor — passes the runner's already-shaped payload through as the
intrachromosomal_co_effect_v1 layer body. Validates required keys; the
dispatcher then validates the full envelope against the schema.
"""
from __future__ import annotations

import json
import pathlib
from typing import Any, Dict


def extract(raw_outputs: Dict[str, str], params: Dict[str, Any]) -> Dict[str, Any]:
    payload_path = raw_outputs.get("intrachromosomal_co_payload")
    if not payload_path:
        raise KeyError(
            "compute_intrachromosomal_co runner must return "
            "{'intrachromosomal_co_payload': path}"
        )
    payload = json.loads(pathlib.Path(payload_path).read_text(encoding="utf-8"))

    for key in ("per_chrom", "summary"):
        if key not in payload:
            raise KeyError(f"computed payload missing required block: {key!r}")
    return payload
