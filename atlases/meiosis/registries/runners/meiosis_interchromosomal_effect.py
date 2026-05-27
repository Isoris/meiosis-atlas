"""Interchromosomal inversion-effect chain — Welch's t on per-parent
CO rates (het vs non-het) + family-aware permutation null + BH +
Bonferroni across off-focal tested chromosomes.

This is the manuscript HEADLINE. Promoted 1:1 from the browser-side
`atlases/meiosis/pages/hub/interchromosomal/_stats.js`. The Welch
primitive is reused from `runners.meiosis_intrachromosomal_co`; the
only new pieces here are the per-parent rate aggregation, the
family-aware permutation engine, and the BH / Bonferroni adjusters.

Per (focal_inversion × tested_chrom):
  1. parent_co_rates_by_chrom — sum n_co (+ optionally n_dco) per
     (parent_id, chrom), divide by chrom_len_bp · 1e6.
  2. karyotypes_at_focal — Map<parent_id, karyotype> from
     family_aware_permutation_design.v1 for the chosen focal_inv.
  3. permutation_blocks — Map<parent_id, block> from the same envelope.
  4. welch_t (reused) — observed t on rates, het vs non-het (= homA+homB).
  5. perm_test — N shuffles of karyotype within block, recompute t per
     shuffle, p = (1 + #{|t_perm| ≥ |t_obs|}) / (N + 1).
  6. bh_adjust / bonf_adjust — multi-comparison correction across the
     off-focal-chrom tests; focal-chrom row is reported but excluded
     from the alpha control (the biological question is about OTHER
     chromosomes).

Determinism: mulberry32 PRNG (port of the JS implementation) is used
when `seed` is supplied so smoke tests can pin permutation p-values.
"""
from __future__ import annotations

import math
from typing import Any, Callable, Dict, Iterable, List, Optional, Tuple

from runners.meiosis_intrachromosomal_co import welch_t


# ---------------------------------------------------------------------------
# PRNG (mulberry32 port from interchromosomal/_stats.js).
# ---------------------------------------------------------------------------

def mulberry32(seed: int) -> Callable[[], float]:
    """Mulberry32 — small, fast, period 2^32. Same byte-arithmetic as
    the JS port so a seeded run cross-validates with the browser path.
    Returns a closure that yields a float in [0, 1) on each call.
    """
    state = [seed & 0xFFFFFFFF]

    def _rng() -> float:
        state[0] = (state[0] + 0x6D2B79F5) & 0xFFFFFFFF
        t = state[0]
        # Math.imul semantics (32-bit signed multiplication, low 32 bits)
        t = _imul(t ^ (t >> 15), t | 1)
        t ^= (t + _imul(t ^ (t >> 7), t | 61)) & 0xFFFFFFFF
        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296.0
    return _rng


def _imul(a: int, b: int) -> int:
    """32-bit integer multiplication matching JS Math.imul (low 32 bits,
    interpreted as unsigned for the bit ops below)."""
    return (a * b) & 0xFFFFFFFF


# ---------------------------------------------------------------------------
# Karyotype + block lookups
# ---------------------------------------------------------------------------

def karyotypes_at_focal(fapd_assignments: Iterable[Dict[str, Any]],
                        focal_inversion_id: str) -> Dict[str, str]:
    out: Dict[str, str] = {}
    for a in fapd_assignments or []:
        if a.get("focal_inversion_id") == focal_inversion_id \
                and a.get("parent_id") and a.get("karyotype"):
            out[a["parent_id"]] = a["karyotype"]
    return out


def permutation_blocks(fapd_assignments: Iterable[Dict[str, Any]],
                       focal_inversion_id: str) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    for a in fapd_assignments or []:
        if a.get("focal_inversion_id") == focal_inversion_id \
                and a.get("parent_id") and a.get("permutation_block") is not None:
            out[a["parent_id"]] = a["permutation_block"]
    return out


def focal_chrom_from_controls(lic_controls: Iterable[Dict[str, Any]],
                              focal_inversion_id: str) -> Optional[str]:
    for c in lic_controls or []:
        if c.get("inversion_id") == focal_inversion_id and c.get("inversion_chrom"):
            return c["inversion_chrom"]
    return None


def local_inv_burden_by_chrom(lic_controls: Iterable[Dict[str, Any]]) -> Dict[str, Dict[str, float]]:
    out: Dict[str, Dict[str, float]] = {}
    for c in lic_controls or []:
        tc = c.get("tested_chrom")
        if not tc: continue
        entry = out.setdefault(tc, {"n_local_invs": 0, "total_local_length_bp": 0})
        entry["n_local_invs"] += 1
        L = c.get("length_bp")
        if isinstance(L, (int, float)):
            entry["total_local_length_bp"] += L
    return out


# ---------------------------------------------------------------------------
# Per-parent CO rates from chromosome_meiosis_events_v1
# ---------------------------------------------------------------------------

def parent_co_rates_by_chrom(events: Iterable[Dict[str, Any]],
                             include_co: bool = True,
                             include_dco: bool = False,
                             ) -> Dict[str, Dict[str, float]]:
    """Aggregate sum(n_co [+ n_dco]) and chrom_len_bp per (parent, chrom),
    then divide for CO_per_mb. Mirrors the JS parentCoRatesByChrom."""
    agg: Dict[Tuple[str, str], Dict[str, float]] = {}
    for e in events or []:
        pid = e.get("parent_id"); chrom = e.get("chrom")
        if not pid or not chrom:
            continue
        n = 0
        if include_co and isinstance(e.get("n_co"), (int, float)):
            n += e["n_co"]
        if include_dco and isinstance(e.get("n_dco"), (int, float)):
            n += e["n_dco"]
        entry = agg.setdefault((pid, chrom), {"n": 0, "len": 0})
        entry["n"] += n
        L = e.get("chrom_len_bp")
        if isinstance(L, (int, float)) and L > 0:
            entry["len"] = L

    out: Dict[str, Dict[str, float]] = {}
    for (pid, chrom), v in agg.items():
        if v["len"] <= 0:
            continue
        out.setdefault(pid, {})[chrom] = v["n"] / v["len"] * 1e6
    return out


# ---------------------------------------------------------------------------
# Family-aware permutation
# ---------------------------------------------------------------------------

def _split_rates(parent_rates: Dict[str, Dict[str, float]],
                 tested_chrom: str,
                 karyo_labels: Dict[str, str],
                 ) -> Tuple[List[float], List[float]]:
    """Return (xs_het, xs_nonhet) for the given karyotype labeling."""
    xs_het: List[float] = []
    xs_non: List[float] = []
    for pid, kary in karyo_labels.items():
        m = parent_rates.get(pid)
        if not m:
            continue
        r = m.get(tested_chrom)
        if not isinstance(r, (int, float)):
            continue
        if kary == "het":
            xs_het.append(r)
        else:
            xs_non.append(r)  # homA + homB merged
    return xs_het, xs_non


def permute_karyotypes(karyo_labels: Dict[str, str],
                       blocks: Dict[str, Any],
                       rng: Callable[[], float],
                       ) -> Dict[str, str]:
    """Shuffle karyotype labels WITHIN each permutation_block. Parents
    without a block id are dropped (matches the JS implementation)."""
    by_block: Dict[Any, Tuple[List[str], List[str]]] = {}
    for pid, kary in karyo_labels.items():
        block = blocks.get(pid)
        if block is None:
            continue
        if block not in by_block:
            by_block[block] = ([], [])
        parents, karyos = by_block[block]
        parents.append(pid)
        karyos.append(kary)

    out: Dict[str, str] = {}
    for parents, karyos in by_block.values():
        # Fisher-Yates in-place — exact port of _shuffleInPlace.
        for i in range(len(karyos) - 1, 0, -1):
            j = int(rng() * (i + 1))
            karyos[i], karyos[j] = karyos[j], karyos[i]
        for k, pid in enumerate(parents):
            out[pid] = karyos[k]
    return out


def perm_test(compute_t: Callable[[], float],
              permute_and_compute_t: Callable[[Callable[[], float]], float],
              n_perms: int,
              rng: Callable[[], float],
              ) -> Dict[str, Any]:
    """Two-sided permutation p-value with add-one smoothing.
    p = (1 + #{|t_perm| ≥ |t_obs|}) / (N_finite + 1)
    Mirrors the JS permTest verbatim.
    """
    observed = compute_t()
    if not math.isfinite(observed):
        return {"observed": float("nan"), "perm_ts": [], "p_value": float("nan"),
                "n_perms_with_t": 0}
    abs_obs = abs(observed)
    perm_ts: List[float] = []
    n_ge = 0
    for _ in range(n_perms):
        t = permute_and_compute_t(rng)
        if math.isfinite(t):
            perm_ts.append(t)
            if abs(t) >= abs_obs:
                n_ge += 1
    p = (1 + n_ge) / (len(perm_ts) + 1)
    return {"observed": observed, "perm_ts": perm_ts,
            "p_value": p, "n_perms_with_t": len(perm_ts)}


# ---------------------------------------------------------------------------
# BH + Bonferroni
# ---------------------------------------------------------------------------

def bh_adjust(p_values: List[float]) -> List[float]:
    """Benjamini-Hochberg step-up. Returns adjusted p-values in input order,
    NaN preserved where the input was non-finite."""
    n = len(p_values)
    if n == 0:
        return []
    indexed = [{"p": p, "i": i, "valid": math.isfinite(p)} for i, p in enumerate(p_values)]
    valid = [x for x in indexed if x["valid"]]
    valid.sort(key=lambda x: x["p"])
    m = len(valid)
    running = 1.0
    for r in range(m - 1, -1, -1):
        adj = min(running, valid[r]["p"] * m / (r + 1))
        valid[r]["q"] = adj
        running = adj
    out: List[float] = [float("nan")] * n
    for x in valid:
        out[x["i"]] = x["q"]
    return out


def bonf_adjust(p_values: List[float]) -> List[float]:
    m = sum(1 for p in p_values if math.isfinite(p))
    return [min(1.0, p * m) if math.isfinite(p) else float("nan") for p in p_values]


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------

def run_interchromosomal_tests(envelopes: Dict[str, Any],
                               params: Dict[str, Any],
                               ) -> Dict[str, Any]:
    """End-to-end pipeline → `inversion_meiosis_effects_v1`-shaped payload.

    envelopes: {
      cme:  chromosome_meiosis_events_v1 envelope dict (required),
      lic:  local_inv_controls_v1 envelope dict (optional but recommended
            — drives focal-chrom detection + burden flag),
      fapd: family_aware_permutation_design_v1 envelope dict (required),
      cm:   coincidence_matrix_v1 envelope dict (reserved; not used in v1),
    }
    params: {
      focal_inversion_id: str|None,    # autopicks first sorted id when None
      include_co:         bool=True,
      include_dco:        bool=False,
      n_permutations:     int=10_000,
      seed:               int|None,    # mulberry32 seed; falls back to non-deterministic random
      p_bh_alpha:         float=0.05,
    }
    """
    cme  = envelopes.get("cme")  or {}
    lic  = envelopes.get("lic")  or {}
    fapd = envelopes.get("fapd") or {}

    include_co  = bool(params.get("include_co",  True))
    include_dco = bool(params.get("include_dco", False))
    n_perms     = int(params.get("n_permutations", 10_000))
    seed        = params.get("seed")
    alpha       = float(params.get("p_bh_alpha", 0.05))

    if seed is not None:
        rng = mulberry32(int(seed))
    else:
        import random as _random
        rng = _random.random

    cme_rows  = ((cme.get("payload")  or {}).get("events"))      or []
    lic_rows  = ((lic.get("payload")  or {}).get("controls"))    or []
    fapd_rows = ((fapd.get("payload") or {}).get("assignments")) or []

    # Auto-pick focal_inversion_id when not supplied.
    focal_id = params.get("focal_inversion_id")
    if not focal_id:
        ids = sorted({a.get("focal_inversion_id") for a in fapd_rows
                      if a.get("focal_inversion_id")})
        focal_id = ids[0] if ids else None

    if not focal_id:
        return {
            "rows": [],
            "summary": {
                "n_tests": 0, "n_sig_bh": 0,
                "focal_inversion_id": None, "focal_chrom": None,
                "class_scope": {"co": include_co, "dco": include_dco},
                "n_permutations": n_perms, "p_bh_alpha": alpha,
            },
        }

    karyo_labels = karyotypes_at_focal(fapd_rows, focal_id)
    blocks       = permutation_blocks(fapd_rows, focal_id)
    focal_chrom  = focal_chrom_from_controls(lic_rows, focal_id)
    burden       = local_inv_burden_by_chrom(lic_rows)

    parent_rates = parent_co_rates_by_chrom(cme_rows, include_co, include_dco)
    tested_chroms = sorted({e.get("chrom") for e in cme_rows if e.get("chrom")})

    def _f(v: Any) -> Any:
        if v is None or (isinstance(v, float) and (math.isnan(v) or math.isinf(v))):
            return None
        return v

    tests: List[Dict[str, Any]] = []
    for chrom in tested_chroms:
        def _compute_t(_chrom=chrom):
            xs_h, xs_n = _split_rates(parent_rates, _chrom, karyo_labels)
            return welch_t(xs_h, xs_n)["welch_t"]

        def _perm_and_t(r, _chrom=chrom):
            shuf = permute_karyotypes(karyo_labels, blocks, r)
            xs_h, xs_n = _split_rates(parent_rates, _chrom, shuf)
            return welch_t(xs_h, xs_n)["welch_t"]

        xs_h, xs_n = _split_rates(parent_rates, chrom, karyo_labels)
        obs = welch_t(xs_h, xs_n)
        perm = perm_test(_compute_t, _perm_and_t, n_perms, rng)
        b = burden.get(chrom) or {"n_local_invs": 0, "total_local_length_bp": 0}
        tests.append({
            "focal_inversion_id": focal_id,
            "tested_chrom":       chrom,
            "is_focal_chrom":     focal_chrom is not None and chrom == focal_chrom,
            "n_het":              obs["n_x"],
            "n_nonhet":           obs["n_y"],
            "mean_diff":          _f((obs["mean_x"] - obs["mean_y"]) if math.isfinite(obs["mean_x"])
                                                                       and math.isfinite(obs["mean_y"]) else float("nan")),
            "t_stat":             _f(obs["welch_t"]),
            "p_value":            _f(perm["p_value"]),
            "local_inv_burden":   b,
        })

    # Multi-comparison correction across off-focal-chrom tests only.
    off_focal = [t for t in tests if not t["is_focal_chrom"]]
    pvals = [t["p_value"] if t["p_value"] is not None else float("nan") for t in off_focal]
    p_bh   = bh_adjust(pvals)
    p_bonf = bonf_adjust(pvals)
    j = 0
    for t in tests:
        if t["is_focal_chrom"]:
            t["p_bonf"]   = None
            t["p_bh"]     = None
            t["sig_flag"] = False
        else:
            t["p_bonf"]   = _f(p_bonf[j])
            t["p_bh"]     = _f(p_bh[j])
            t["sig_flag"] = bool(t["p_bh"] is not None and t["p_bh"] < alpha)
            j += 1

    n_sig = sum(1 for t in tests if t["sig_flag"])
    return {
        "rows": tests,
        "summary": {
            "n_tests":            len(off_focal),
            "n_sig_bh":           n_sig,
            "focal_inversion_id": focal_id,
            "focal_chrom":        focal_chrom,
            "class_scope":        {"co": include_co, "dco": include_dco},
            "n_permutations":     n_perms,
            "p_bh_alpha":         alpha,
        },
    }
