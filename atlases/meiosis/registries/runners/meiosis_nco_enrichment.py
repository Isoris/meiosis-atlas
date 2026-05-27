"""Hand-rolled Fisher exact test for a 2×2 contingency table + helpers
for the NCO inside-vs-outside-inversion enrichment crosstab.

Pure functions, no third-party dependencies (math.lgamma only). Promoted
from the browser-side `nco.js` renderer so the catalogue brain can
dispatch this chain via the standard POST /api/actions path instead of
treating it as `stale: "promotion_from_browser_js"`.

Manuscript headline test:
    MOSAIC_SHORT × inside_inversion=yes  (the gene-conversion-inside-
    inversion enrichment that demonstrates the meiotic-suppression
    signal). Two-sided + one-sided-greater p-values both reported.
"""
from __future__ import annotations

import math
from typing import Any, Dict, Iterable, List


_DEFAULT_TARGET_CLASS = "MOSAIC_SHORT"
# All NCO-like classes (NCO + MOSAIC_SHORT). Used to compute the "other"
# bucket for the contingency table so the test stays inside the
# gene-conversion-like population rather than including CO/DCO.
_NCO_LIKE = frozenset({"NCO", "MOSAIC_SHORT"})


def _log_hypergeom(a: int, b: int, c: int, d: int) -> float:
    """log P(2×2 table with cell counts a,b,c,d) under the Fisher null
    (fixed marginals). Uses math.lgamma for numerical stability across
    table sizes encountered in the 226-sample cohort."""
    n = a + b + c + d
    return (
        math.lgamma(a + b + 1) + math.lgamma(c + d + 1)
        + math.lgamma(a + c + 1) + math.lgamma(b + d + 1)
        - math.lgamma(n + 1)
        - math.lgamma(a + 1) - math.lgamma(b + 1)
        - math.lgamma(c + 1) - math.lgamma(d + 1)
    )


def fisher_exact_2x2(a: int, b: int, c: int, d: int) -> Dict[str, float]:
    """Two-sided + one-sided (greater) Fisher exact + odds ratio for the
    2×2 table [[a,b],[c,d]]. Marginal-conditioned enumeration over all
    valid a' values; two-sided uses the standard 'sum of tables at most
    as probable as observed' definition. Returns p in [0, 1]; odds ratio
    is +inf when the denominator is 0 and a*d > 0, NaN when the table is
    degenerate (any marginal == 0).
    """
    for v in (a, b, c, d):
        if not isinstance(v, int) or v < 0:
            raise ValueError(f"cell counts must be non-negative ints, got {(a,b,c,d)!r}")

    n   = a + b + c + d
    r1  = a + b
    c1  = a + c

    # Degenerate: any zero marginal → undefined test.
    if n == 0 or r1 == 0 or c1 == 0 or r1 == n or c1 == n:
        return {
            "p_two_sided":           float("nan"),
            "p_one_sided_greater":   float("nan"),
            "odds_ratio":            float("nan"),
            "log_odds":              float("nan"),
        }

    # Odds ratio + (haldane) log-odds. Haldane correction (add 0.5 to each
    # cell) keeps log_odds finite when one cell is zero — but only for the
    # diagnostic; the raw OR keeps the original definition (inf when b*c==0
    # and a*d > 0, 0 when a*d==0).
    if b * c == 0:
        odds = float("inf") if a * d > 0 else float("nan")
    else:
        odds = (a * d) / (b * c)

    log_odds = math.log(((a + 0.5) * (d + 0.5)) / ((b + 0.5) * (c + 0.5)))

    # Enumerate over a' from max(0, r1-c2) to min(r1, c1); for each,
    # b'=r1-a', c'=c1-a', d'=n-a'-b'-c'.
    a_lo = max(0, r1 + c1 - n)
    a_hi = min(r1, c1)
    log_p_obs = _log_hypergeom(a, b, c, d)

    log_ps: List[float] = []
    for ap in range(a_lo, a_hi + 1):
        bp = r1 - ap
        cp = c1 - ap
        dp = n - ap - bp - cp
        log_ps.append(_log_hypergeom(ap, bp, cp, dp))

    # Two-sided: sum probabilities for tables with prob <= observed.
    # Use log-sum-exp on the subset, then exponentiate.
    eps = 1e-9  # tolerance against floating-point ties
    sel = [lp for lp in log_ps if lp <= log_p_obs + eps]
    p_two_sided = _log_sum_exp(sel) if sel else 0.0

    # One-sided greater: tables with a' >= a.
    sel_g = [log_ps[k - a_lo] for k in range(a, a_hi + 1)]
    p_one_g = _log_sum_exp(sel_g) if sel_g else 0.0

    return {
        "p_two_sided":         min(1.0, math.exp(p_two_sided)),
        "p_one_sided_greater": min(1.0, math.exp(p_one_g)),
        "odds_ratio":          odds,
        "log_odds":            log_odds,
    }


def _log_sum_exp(xs: List[float]) -> float:
    """Stable log of sum of exp(xs). Returns -inf if xs is empty."""
    if not xs:
        return float("-inf")
    m = max(xs)
    return m + math.log(sum(math.exp(x - m) for x in xs))


def crosstab_mosaic_short_inside_inv(
    tracts: Iterable[Dict[str, Any]],
    target_class: str = _DEFAULT_TARGET_CLASS,
) -> Dict[str, int]:
    """Build the 2×2 contingency table for {class == target} × inside_inv.
    Restricted to NCO-like tracts so the test stays inside the
    gene-conversion population (CO/DCO/AMBIG/LOW_CONFIDENCE are excluded).
    Tracts with inside_inversion ∉ {'yes','no'} are excluded (e.g.
    'partial' is conservatively dropped). Returns the four cells used by
    Fisher exact + cohort totals.
    """
    n_in_target  = 0  # MOSAIC_SHORT × inside
    n_out_target = 0  # MOSAIC_SHORT × outside
    n_in_other   = 0  # other-NCO-like × inside
    n_out_other  = 0  # other-NCO-like × outside
    n_total      = 0  # all tracts seen (for diagnostic)
    n_excluded   = 0  # non-NCO-like or 'partial' tracts

    for t in tracts or []:
        n_total += 1
        cls = t.get("class")
        inv = t.get("inside_inversion")
        if cls not in _NCO_LIKE or inv not in ("yes", "no"):
            n_excluded += 1
            continue
        if cls == target_class:
            if inv == "yes": n_in_target  += 1
            else:            n_out_target += 1
        else:
            if inv == "yes": n_in_other  += 1
            else:            n_out_other += 1

    return {
        "n_in_target":  n_in_target,
        "n_out_target": n_out_target,
        "n_in_other":   n_in_other,
        "n_out_other":  n_out_other,
        "n_total":      n_total,
        "n_excluded":   n_excluded,
        "target_class": target_class,
    }


def compute_nco_enrichment(tracts: Iterable[Dict[str, Any]],
                           target_class: str = _DEFAULT_TARGET_CLASS) -> Dict[str, Any]:
    """End-to-end: crosstab + Fisher → result payload matching the
    `nco_enrichment_result_v1` schema. Pure; tested standalone.
    """
    xt = crosstab_mosaic_short_inside_inv(tracts, target_class=target_class)
    fisher = fisher_exact_2x2(
        a=xt["n_in_target"],  b=xt["n_out_target"],
        c=xt["n_in_other"],   d=xt["n_out_other"],
    )

    def _f(v: float) -> Any:
        # JSON can't carry NaN/Inf in strict mode; emit null.
        if v is None or (isinstance(v, float) and (math.isnan(v) or math.isinf(v))):
            return None
        return v

    n_inside_target  = xt["n_in_target"]
    n_inside_other   = xt["n_in_other"]
    n_outside_target = xt["n_out_target"]
    n_outside_other  = xt["n_out_other"]
    n_inside_total   = n_inside_target + n_inside_other
    n_outside_total  = n_outside_target + n_outside_other
    n_target_total   = n_inside_target + n_outside_target

    return {
        "result": {
            "target_class":               xt["target_class"],
            "n_inside_target":            n_inside_target,
            "n_outside_target":           n_outside_target,
            "n_inside_other_nco_like":    n_inside_other,
            "n_outside_other_nco_like":   n_outside_other,
            "odds_ratio":                 _f(fisher["odds_ratio"]),
            "log_odds":                   _f(fisher["log_odds"]),
            "p_fisher_two_sided":         _f(fisher["p_two_sided"]),
            "p_fisher_one_sided_greater": _f(fisher["p_one_sided_greater"]),
        },
        "summary": {
            "n_total_tracts":         xt["n_total"],
            "n_excluded_tracts":      xt["n_excluded"],
            "n_inside_inversion":     n_inside_total,
            "n_outside_inversion":    n_outside_total,
            "n_target_class_overall": n_target_total,
        },
    }
