"""Meiosis-atlas runners — TSV-only imports.

`import_tsv` resolves the target path under the workspace, copies it to
raw_results/meiosis/<action_id>/ for provenance, and hands the path to
the extractor. No server endpoints are called — meiosis outputs are
produced upstream by the ngsTracts classifier and this action is only
a capture step.
"""
from __future__ import annotations

import os
import pathlib
import shutil
from typing import Any, Dict


def _project_root() -> pathlib.Path:
    root = os.environ.get("ATLAS_PROJECT_ROOT")
    return pathlib.Path(root) if root else pathlib.Path.cwd()


def _resolve_target(rel: str) -> pathlib.Path:
    root = _project_root().resolve()
    target = (root / rel).resolve()
    try:
        target.relative_to(root)
    except ValueError:
        raise ValueError(f"target.path escapes project root: {rel!r}")
    if not target.exists():
        raise FileNotFoundError(f"target.path does not exist: {rel}")
    if not target.is_file():
        raise IsADirectoryError(f"target.path is not a file: {rel}")
    return target


def _workdir(manifest: Dict[str, Any]) -> pathlib.Path:
    return _project_root() / "raw_results" / "meiosis" / manifest["action_id"]


def import_tsv(manifest: Dict[str, Any], client: Any) -> Dict[str, str]:
    target = manifest["target"]
    src = _resolve_target(target["path"])
    out_dir = _workdir(manifest)
    out_dir.mkdir(parents=True, exist_ok=True)
    copy_path = out_dir / src.name
    shutil.copyfile(src, copy_path)
    return {
        "tsv_path":   str(copy_path),
        "source_rel": target["path"],
        "step":       target.get("step", "STEP_TRC_01"),
        "scope":      target.get("scope", ""),
    }
