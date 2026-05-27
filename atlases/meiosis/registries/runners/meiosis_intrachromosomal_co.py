"""Welch's t-test for the intrachromosomal CO-rate karyotype effect.

Per tested chromosome: compares per-dyad CO_per_mb values between
karyotype=='het' and karyotype ∈ {'homA','homB'} dyads. The rate-ratio
< 0.7 flag is the manuscript intrachromosomal-suppression signal.

Pure functions, no third-party dependencies. The t-distribution CDF is
hand-rolled via Lentz's continued-fraction evaluation of the regularized
incomplete beta function (Press et al., Numerical Recipes 3rd ed., §6.4)
— the same standard recipe scipy.special.betainc implements.

Promoted from the browser-side `crossovers.js` karyo_strat view so the
catalogue brain can dispatch this chain via the standard
POST /api/actions path. See SPEC_nco_enrichment_chain_module.md for the
template this follows.
"""
from __future__ import annotations

import math
from typing import Any, Dict, Iterable, List, Optional


_DEFAULT_FLAG_THRESHOLD = 0.7  # rate_ratio < 0.7 → flag (manuscript heuristic)
_NON_HET_BUCKET = frozenset({"homA", "homB"})


# ---------------------------------------------------------------------------
# Numerical foundations: regularized incomplete beta → t-distribution CDF.
# ---------------------------------------------------------------------------

def _betacf(a: float, b: float, x: float) -> float:
    """Continued-fraction expansion for the incomplete beta function.
    Lentz's method per Numerical Recipes §6.4. Returns the continued
    fraction value to be used inside `_betainc`. Convergence checked
    against eps=1e-15 with max 200 iterations (plenty for our regime).
    """
    MAXIT = 200
    EPS   = 1e-15
    FPMIN = 1e-30

    qab = a + b
    qap = a + 1.0
    qam = a - 1.0
    c = 1.0
    d = 1.0 - qab * x / qap
    if abs(d) < FPMIN: d = FPMIN
    d = 1.0 / d
    h = d
    for m in range(1, MAXIT + 1):
        m2 = 2 * m
        aa = m * (b - m) * x / ((qam + m2) * (a + m2))
        d = 1.0 + aa * d
        if abs(d) < FPMIN: d = FPMIN
        c = 1.0 + aa / c
        if abs(c) < FPMIN: c = FPMIN
        d = 1.0 / d
        h *= d * c
        aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2))
        d = 1.0 + aa * d
        if abs(d) < FPMIN: d = FPMIN
        c = 1.0 + aa / c
        if abs(c) < FPMIN: c = FPMIN
        d = 1.0 / d
        delta = d * c
        h *= delta
        if abs(delta - 1.0) < EPS:
            return h
    # If we hit MAXIT, return current best estimate. In our usage the
    # incomplete beta converges well within ~50 iterations.
    return h


def _betainc(a: float, b: float, x: float) -> float:
    """Regularized incomplete beta function I_x(a, b). Standard symmetry
    flip for x > (a+1)/(a+b+2) to keep the continued fraction in its
    fast-converging regime."""
    if x < 0.0 or x > 1.0:
        raise ValueError(f"x must be in [0,1], got {x}")
    if x == 0.0: return 0.0
    if x == 1.0: return 1.0
    # log of front factor
    bt = math.exp(
        math.lgamma(a + b) - math.lgamma(a) - math.lgamma(b)
        + a * math.log(x) + b * math.log(1.0 - x)
    )
    if x < (a + 1.0) / (a + b + 2.0):
        return bt * _betacf(a, b, x) / a
    return 1.0 - bt * _betacf(b, a, 1.0 - x) / b


def t_cdf(t: float, df: float) -> float:
    """CDF of Student's t distribution at `t` with `df` degrees of
    freedom. Symmetric reflection for t<0; identity I_x(df/2, 1/2)
    relation for t>=0."""
    if df <= 0:
        return float("nan")
    x = df / (df + t * t)
    half = 0.5 * _betainc(0.5 * df, 0.5, x)
    return 1.0 - half if t >= 0 else half


def t_two_sided_p(t: float, df: float) -> float:
    """Two-sided p for Student's t. P(|T| >= |t|) = 2 * (1 - CDF(|t|))."""
    if df <= 0 or not math.isfinite(t):
        return float("nan")
    return 2.0 * (1.0 - t_cdf(abs(t), df))


# ---------------------------------------------------------------------------
# Welch's t-test (two-sample, unequal variance).
# ---------------------------------------------------------------------------

def _mean_var(xs: List[float]) -> tuple[float, float]:
    """Returns (mean, unbiased sample variance). Variance is NaN for n<2."""
    n = len(xs)
    if n == 0:
        return (float("nan"), float("nan"))
    m = sum(xs) / n
    if n < 2:
        return (m, float("nan"))
    s2 = sum((x - m) ** 2 for x in xs) / (n - 1)
    return (m, s2)


def welch_t(xs: List[float], ys: List[float]) -> Dict[str, float]:
    """Welch's two-sample t-test on raw sample lists. Returns
    {welch_t, welch_df, p_two_sided, mean_x, mean_y, n_x, n_y}.
    NaN when degenerate (n<2 in either group, or zero variance in both)."""
    nx = len(xs); ny = len(ys)
    mx, vx = _mean_var(xs)
    my, vy = _mean_var(ys)

    if nx < 2 or ny < 2 or not (math.isfinite(vx) and math.isfinite(vy)):
        return {
            "welch_t":     float("nan"),
            "welch_df":    float("nan"),
            "p_two_sided": float("nan"),
            "mean_x": mx, "mean_y": my, "n_x": nx, "n_y": ny,
        }

    se2 = vx / nx + vy / ny
    if se2 == 0:
        return {
            "welch_t":     float("nan"),
            "welch_df":    float("nan"),
            "p_two_sided": float("nan"),
            "mean_x": mx, "mean_y": my, "n_x": nx, "n_y": ny,
        }
    se = math.sqrt(se2)
    t = (mx - my) / se

    # Welch-Satterthwaite df. Add small epsilon to keep it stable when one
    # variance is 0 (the other dominates so df should still be finite).
    num = se2 ** 2
    den = (vx / nx) ** 2 / max(nx - 1, 1) + (vy / ny) ** 2 / max(ny - 1, 1)
    df = num / den if den > 0 else float("nan")
    p = t_two_sided_p(t, df) if math.isfinite(df) else float("nan")
    return {
        "welch_t": t, "welch_df": df, "p_two_sided": p,
        "mean_x": mx, "mean_y": my, "n_x": nx, "n_y": ny,
    }


# ---------------------------------------------------------------------------
# Per-chromosome CO-rate karyotype split.
# ---------------------------------------------------------------------------

def _row_co_per_mb(row: Dict[str, Any]) -> Optional[float]:
    """Pull (or derive) co_per_mb from a chromosome_meiosis_events_v1 row."""
    v = row.get("co_per_mb")
    if v is not None:
        try: return float(v)
        except (TypeError, ValueError): pass
    n_co = row.get("n_co")
    L = row.get("chrom_len_bp")
    if isinstance(n_co, (int, float)) and isinstance(L, (int, float)) and L > 0:
        return float(n_co) / float(L) * 1e6
    return None


def split_by_karyotype(events: Iterable[Dict[str, Any]]) -> Dict[str, Dict[str, List[float]]]:
    """Group co_per_mb per (chrom × karyotype-bucket). Returns
    {chrom: {'het': [...rates], 'non_het': [...rates]}}. Skips rows
    missing karyotype_at_focal_inv or a derivable co_per_mb."""
    out: Dict[str, Dict[str, List[float]]] = {}
    for row in events or []:
        kar = row.get("karyotype_at_focal_inv")
        if kar not in ("het",) and kar not in _NON_HET_BUCKET:
            continue
        rate = _row_co_per_mb(row)
        if rate is None:
            continue
        chrom = row.get("chrom")
        if not chrom:
            continue
        bucket = "het" if kar == "het" else "non_het"
        out.setdefault(chrom, {"het": [], "non_het": []})[bucket].append(rate)
    return out


def compute_intrachromosomal_co(events: Iterable[Dict[str, Any]],
                                flag_threshold: float = _DEFAULT_FLAG_THRESHOLD,
                                ) -> Dict[str, Any]:
    """End-to-end: split rows by chrom×karyotype, run Welch per chrom,
    emit `intrachromosomal_co_effect_v1`-shaped payload."""
    grouped = split_by_karyotype(events)
    per_chrom = []
    n_excluded_chroms = 0
    n_flagged = 0

    def _f(v: float) -> Any:
        if v is None or (isinstance(v, float) and (math.isnan(v) or math.isinf(v))):
            return None
        return v

    for chrom in sorted(grouped.keys()):
        het = grouped[chrom]["het"]
        non = grouped[chrom]["non_het"]
        if len(het) < 2 or len(non) < 2:
            n_excluded_chroms += 1
            per_chrom.append({
                "chrom":               chrom,
                "n_dyads_het":         len(het),
                "n_dyads_non_het":     len(non),
                "mean_co_per_mb_het":     _f(sum(het) / len(het)) if het else None,
                "mean_co_per_mb_non_het": _f(sum(non) / len(non)) if non else None,
                "rate_ratio_het_over_non_het": None,
                "welch_t":  None,
                "welch_df": None,
                "p_two_sided": None,
                "flag_below_threshold": False,
                "excluded_reason": "insufficient_dyads",
            })
            continue

        res = welch_t(het, non)
        ratio = (res["mean_x"] / res["mean_y"]) if res["mean_y"] not in (0, 0.0) else None
        flag  = bool(ratio is not None and ratio < flag_threshold)
        if flag:
            n_flagged += 1
        per_chrom.append({
            "chrom":                       chrom,
            "n_dyads_het":                 res["n_x"],
            "n_dyads_non_het":             res["n_y"],
            "mean_co_per_mb_het":          _f(res["mean_x"]),
            "mean_co_per_mb_non_het":      _f(res["mean_y"]),
            "rate_ratio_het_over_non_het": _f(ratio),
            "welch_t":                     _f(res["welch_t"]),
            "welch_df":                    _f(res["welch_df"]),
            "p_two_sided":                 _f(res["p_two_sided"]),
            "flag_below_threshold":        flag,
        })

    return {
        "per_chrom": per_chrom,
        "summary": {
            "n_chroms_total":     len(per_chrom),
            "n_chroms_tested":    len(per_chrom) - n_excluded_chroms,
            "n_chroms_excluded":  n_excluded_chroms,
            "n_chroms_flagged":   n_flagged,
            "flag_threshold":     float(flag_threshold),
        },
    }
