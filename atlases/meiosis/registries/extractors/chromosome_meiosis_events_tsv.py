"""Meiosis-atlas staging extractor — per-(chromosome × dyad) event-count TSV
→ staging rows.

Twin of `tract_classifications_tsv.py`. Parses any tab- (or whitespace-)
separated file into {columns, rows} and tags it with optional scope /
source metadata. Type coercion happens in the
normalize_chromosome_meiosis_events extractor downstream.
"""
from __future__ import annotations

import csv
import pathlib
from typing import Any, Dict, List


def extract(raw_outputs: Dict[str, str], params: Dict[str, Any]) -> Dict[str, Any]:
    path = pathlib.Path(raw_outputs["tsv_path"])
    has_header = bool(params.get("has_header", True))
    max_rows = int(params.get("max_rows") or 0)

    columns: List[str] = []
    rows: List[Dict[str, Any]] = []
    with path.open("r", encoding="utf-8", newline="") as fh:
        sample = fh.read(4096)
        fh.seek(0)
        delim = "\t" if "\t" in sample else None
        reader = (csv.reader(fh, delimiter=delim or " ", skipinitialspace=True)
                  if delim is None else csv.reader(fh, delimiter=delim))
        it = iter(reader)
        if has_header:
            try:
                columns = [c.strip() for c in next(it)]
            except StopIteration:
                return {
                    "scope":   raw_outputs.get("scope", ""),
                    "source":  raw_outputs.get("source_rel", str(path)),
                    "columns": [],
                    "rows":    [],
                    "n_rows":  0,
                }
        else:
            try:
                first = next(it)
            except StopIteration:
                columns, rows = [], []
                first = None
            if first is not None:
                columns = [f"col{i+1}" for i in range(len(first))]
                it = iter([first] + list(it))
        for i, row in enumerate(it):
            if max_rows and i >= max_rows:
                break
            row = [c for c in row if c != ""] if delim is None else row
            obj = {columns[j] if j < len(columns) else f"col{j+1}": row[j]
                   for j in range(len(row))}
            rows.append(obj)

    return {
        "scope":   raw_outputs.get("scope", ""),
        "source":  raw_outputs.get("source_rel", str(path)),
        "columns": columns,
        "rows":    rows,
        "n_rows":  len(rows),
    }
