"""Per-candidate NCO enrichment — v2 fan-out of the cohort NCO chain.

For each inversion candidate, build a 2x2 crosstab of
    {target_class, default=MOSAIC_SHORT} × {tract intersects candidate span, yes/no}
restricted to NCO-like tracts (NCO + MOSAIC_SHORT), run Fisher exact
(reusing fisher_exact_2x2 from meiosis_nco_enrichment), then adjust
p-values across candidates with Benjamini-Hochberg.

Cross-atlas dependency: candidates come from `inversion_candidates.v1`
(inversion-atlas). Tracts come from `tract_classifications_v1` (this
atlas). The join is purely interval-based (chrom + start_bp + end_bp).

Returns the typed `nco_per_candidate_enrichment_v1` payload shape:
per_candidate list + summary. NaN/Inf serialized as null for strict
JSON.
"""
from __future__ import annotations

import math
from typing import Any, Dict, Iterable, List

from runners.meiosis_nco_enrichment import fisher_exact_2x2
from runners.meiosis_interchromosomal_effect import bh_adjust, bonf_adjust


_DEFAULT_TARGET_CLASS = "MOSAIC_SHORT"
_NCO_LIKE = frozenset({"NCO", "MOSAIC_SHORT"})


def _intersects(t_chrom: str, t_start: int, t_end: int,
                c_chrom: str, c_start: int, c_end: int) -> bool:
    """Half-open-style overlap on the same chromosome. Returns True if
    the tract [t_start, t_end] overlaps the candidate span [c_start, c_end]
    by at least 1 bp."""
    if t_chrom != c_chrom: return False
    return not (t_end < c_start or t_start > c_end)


def crosstab_per_candidate(tracts: Iterable[Dict[str, Any]],
                           candidate: Dict[str, Any],
                           target_class: str = _DEFAULT_TARGET_CLASS,
                           ) -> Dict[str, int]:
    """Build the 2x2 crosstab for one candidate. Cells:
       a = target_class × inside
       b = target_class × outside (on same chrom as candidate)
       c = other-NCO-like × inside
       d = other-NCO-like × outside (on same chrom as candidate)

    Tracts on chromosomes other than the candidate's are not counted —
    the per-candidate test compares enrichment INSIDE vs OUTSIDE the
    candidate span on the candidate's own chromosome. (Cohort-level
    enrichment is the v1 chain; this v2 keeps the question candidate-
    local.)
    """
    c_chrom = candidate.get("chrom")
    c_start = candidate.get("start_bp")
    c_end   = candidate.get("end_bp")
    if not (c_chrom and isinstance(c_start, (int, float)) and isinstance(c_end, (int, float))):
        return {"n_in_target": 0, "n_out_target": 0,
                "n_in_other": 0, "n_out_other": 0,
                "n_total_on_chrom": 0, "n_excluded": 0,
                "target_class": target_class, "skipped": True}

    a = b = c_count = d = 0
    on_chrom = 0
    excluded = 0
    for t in tracts or []:
        t_chrom = t.get("chrom")
        if t_chrom != c_chrom:
            continue
        on_chrom += 1
        cls = t.get("class")
        if cls not in _NCO_LIKE:
            excluded += 1
            continue
        t_start = t.get("start")
        t_end   = t.get("end")
        if not (isinstance(t_start, (int, float)) and isinstance(t_end, (int, float))):
            excluded += 1
            continue
        inside = _intersects(t_chrom, t_start, t_end, c_chrom, c_start, c_end)
        if cls == target_class:
            if inside: a += 1
            else:      b += 1
        else:
            if inside: c_count += 1
            else:      d += 1
    return {
        "n_in_target":      a,
        "n_out_target":     b,
        "n_in_other":       c_count,
        "n_out_other":      d,
        "n_total_on_chrom": on_chrom,
        "n_excluded":       excluded,
        "target_class":     target_class,
        "skipped":          False,
    }


def compute_nco_per_candidate(tracts: Iterable[Dict[str, Any]],
                              candidates: Iterable[Dict[str, Any]],
                              target_class: str = _DEFAULT_TARGET_CLASS,
                              p_bh_alpha: float = 0.05,
                              ) -> Dict[str, Any]:
    """End-to-end: per-candidate Fisher exact + BH/Bonferroni across the
    candidate set. Candidates without {chrom, start_bp, end_bp} fields
    are emitted with skipped=True and null statistics."""
    cand_list = list(candidates or [])

    def _f(v: Any) -> Any:
        if v is None or (isinstance(v, float) and (math.isnan(v) or math.isinf(v))):
            return None
        return v

    rows: List[Dict[str, Any]] = []
    pvals: List[float] = []   # parallel to rows, NaN for skipped
    for cand in cand_list:
        xt = crosstab_per_candidate(tracts, cand, target_class=target_class)
        cand_id = cand.get("candidate_id") or cand.get("id") or cand.get("inversion_id")
        if xt["skipped"]:
            rows.append({
                "candidate_id":          cand_id,
                "chrom":                 cand.get("chrom"),
                "start_bp":              cand.get("start_bp"),
                "end_bp":                cand.get("end_bp"),
                "skipped":               True,
                "skipped_reason":        "candidate missing chrom / start_bp / end_bp",
                "n_in_target": 0, "n_out_target": 0,
                "n_in_other":  0, "n_out_other":  0,
                "n_total_on_chrom": 0, "n_excluded": 0,
                "odds_ratio":               None,
                "log_odds":                 None,
                "p_fisher_two_sided":       None,
                "p_fisher_one_sided_greater": None,
                "p_bh":   None,
                "p_bonf": None,
                "sig_flag": False,
            })
            pvals.append(float("nan"))
            continue

        fisher = fisher_exact_2x2(
            a=xt["n_in_target"], b=xt["n_out_target"],
            c=xt["n_in_other"],  d=xt["n_out_other"],
        )
        p_one = fisher["p_one_sided_greater"]
        rows.append({
            "candidate_id":          cand_id,
            "chrom":                 cand.get("chrom"),
            "start_bp":              cand.get("start_bp"),
            "end_bp":                cand.get("end_bp"),
            "skipped":               False,
            "n_in_target":           xt["n_in_target"],
            "n_out_target":          xt["n_out_target"],
            "n_in_other":            xt["n_in_other"],
            "n_out_other":           xt["n_out_other"],
            "n_total_on_chrom":      xt["n_total_on_chrom"],
            "n_excluded":            xt["n_excluded"],
            "odds_ratio":                  _f(fisher["odds_ratio"]),
            "log_odds":                    _f(fisher["log_odds"]),
            "p_fisher_two_sided":          _f(fisher["p_two_sided"]),
            "p_fisher_one_sided_greater":  _f(p_one),
            # p_bh / p_bonf / sig_flag filled in below after BH across all candidates.
        })
        pvals.append(p_one if isinstance(p_one, (int, float)) and math.isfinite(p_one)
                     else float("nan"))

    # BH + Bonferroni across the finite p-values; NaNs (skipped + degenerate)
    # propagate through.
    bh   = bh_adjust(pvals)
    bonf = bonf_adjust(pvals)
    n_sig = 0
    for r, q_bh, q_bonf in zip(rows, bh, bonf):
        if r.get("skipped"):
            continue
        r["p_bh"]    = _f(q_bh)
        r["p_bonf"]  = _f(q_bonf)
        sig = bool(r["p_bh"] is not None and r["p_bh"] < p_bh_alpha)
        r["sig_flag"] = sig
        if sig: n_sig += 1

    return {
        "per_candidate": rows,
        "summary": {
            "n_candidates_total":    len(rows),
            "n_candidates_tested":   sum(1 for r in rows if not r.get("skipped")),
            "n_candidates_skipped":  sum(1 for r in rows if r.get("skipped")),
            "n_candidates_sig_bh":   n_sig,
            "target_class":          target_class,
            "p_bh_alpha":            float(p_bh_alpha),
        },
    }
