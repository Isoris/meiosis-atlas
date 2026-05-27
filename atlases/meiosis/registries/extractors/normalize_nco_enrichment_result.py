"""Extractor — passes the runner's already-shaped payload through as the
nco_enrichment_result_v1 layer body. Validates only that the required
keys are present; the dispatcher then validates the full envelope
against schema_out/nco_enrichment_result_v1.schema.json.
"""
from __future__ import annotations

import json
import pathlib
from typing import Any, Dict


def extract(raw_outputs: Dict[str, str], params: Dict[str, Any]) -> Dict[str, Any]:
    payload_path = raw_outputs.get("nco_enrichment_payload")
    if not payload_path:
        raise KeyError(
            "compute_nco_enrichment runner must return {'nco_enrichment_payload': path}"
        )
    payload = json.loads(pathlib.Path(payload_path).read_text(encoding="utf-8"))

    for key in ("result", "summary"):
        if key not in payload:
            raise KeyError(f"computed payload missing required block: {key!r}")
    return payload
