"""Extractor — passes the runner's already-shaped payload through as the
nco_per_candidate_enrichment_v1 layer body."""
from __future__ import annotations

import json
import pathlib
from typing import Any, Dict


def extract(raw_outputs: Dict[str, str], params: Dict[str, Any]) -> Dict[str, Any]:
    payload_path = raw_outputs.get("nco_per_candidate_payload")
    if not payload_path:
        raise KeyError(
            "compute_nco_per_candidate runner must return "
            "{'nco_per_candidate_payload': path}"
        )
    payload = json.loads(pathlib.Path(payload_path).read_text(encoding="utf-8"))
    for key in ("per_candidate", "summary"):
        if key not in payload:
            raise KeyError(f"computed payload missing required block: {key!r}")
    return payload
