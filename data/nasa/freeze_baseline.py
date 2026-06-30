#!/usr/bin/env python3
"""Freeze the anti-circularity baseline asset from features.csv (Task 03-00 / D-05,06,07).

Deterministic: same features.csv in -> byte-identical baseline.frozen.json out.
All limits are derived ONCE here, from a healthy (fresh-bearing) window, and committed
BEFORE any ladder measurement (threshold / SPC / ML) so post-hoc tuning is structurally
impossible (D-05). Re-running must reproduce the same file exactly.

Cpk is intentionally NOT computed here: on a frozen baseline Cpk collapses to a constant
(~1.0, RESEARCH Pitfall 2). Only USL/LSL are frozen; Cpk is computed in 03-02 from the
rolling/current window mu/sigma.

Run:  python3 data/nasa/freeze_baseline.py
"""
import csv
import json
import os
import statistics
from datetime import datetime

# --- Explicit, documented constants (the "we defined it this way" interview defense) ---
METRIC = "rms"            # target scalar feature for the bearing-1 outer-race run
HEALTHY_K = 300           # healthy window = first K snapshots (fresh bearing, flat RMS)
K_CONTROL = 3             # SPC I-chart control limits: mu +/- 3*sigma (Shewhart standard)
K_SPEC = 6               # operating spec limits (D-06 Option a): mu +/- 6*sigma (six-sigma band)
M_THRESHOLD = 8          # coarse operator threshold band: mu +/- 8*sigma (naive, widest)
ROUND = 9                # decimal places for deterministic, stable JSON output

HERE = os.path.dirname(os.path.abspath(__file__))
FEATURES = os.path.join(HERE, "features.csv")
OUT = os.path.join(HERE, "baseline.frozen.json")


def main():
    with open(FEATURES, newline="") as f:
        rows = list(csv.DictReader(f))

    # Healthy window: first HEALTHY_K snapshots. Justification (verified on this run):
    # RMS is stably ~0.077 (sd ~0.0011) across these snapshots; the first sample exceeding
    # mu+6*sigma is idx 533 and the first sustained degradation (>0.1) is idx 647, both far
    # AFTER idx 299. So [0, 299] is unambiguously the fresh-bearing healthy region and the
    # later degradation + end-of-life shutdown collapse (idx ~982-983, RMS~0) are excluded.
    window = rows[:HEALTHY_K]
    start_index = int(window[0]["snapshot_index"])
    end_index = int(window[-1]["snapshot_index"])
    start_time = window[0]["recorded_at"]
    end_time = window[-1]["recorded_at"]

    vals = [float(r[METRIC]) for r in window]
    mu = statistics.mean(vals)
    # sample standard deviation (ddof=1) as the estimate of the population sigma
    sigma = statistics.stdev(vals)

    cl = round(mu, ROUND)
    ucl = round(mu + K_CONTROL * sigma, ROUND)
    lcl = round(mu - K_CONTROL * sigma, ROUND)

    thr_max = round(mu + M_THRESHOLD * sigma, ROUND)
    thr_min = round(mu - M_THRESHOLD * sigma, ROUND)

    usl = round(mu + K_SPEC * sigma, ROUND)
    # lsl = mu - k*sigma stays positive here (k=6 -> ~0.0708), so no floor at 0 is needed.
    lsl = round(mu - K_SPEC * sigma, ROUND)

    # failure_time / end-of-life anchor (D-07): LAST snapshot recorded_at = physical run end.
    # NOTE: its RMS is ~0 (post-failure machine shutdown), but per D-07 the ground-truth
    # anchor is the run-end timestamp, NOT a threshold-alarm time. F1 anchor sensitivity is
    # handled downstream via f1_anchor_candidates_hours.
    failure_time = rows[-1]["recorded_at"]

    # F1 time-anchor candidate lead windows (03-04 sensitivity input, D-07 / Open Q2):
    # last 5% / 10% / 20% of the total run duration.
    t0 = datetime.fromisoformat(rows[0]["recorded_at"])
    t1 = datetime.fromisoformat(rows[-1]["recorded_at"])
    duration_h = (t1 - t0).total_seconds() / 3600.0
    f1_anchor_candidates_hours = [round(duration_h * frac, 2) for frac in (0.05, 0.10, 0.20)]

    baseline = {
        "metric": METRIC,
        "source": "NASA IMS Bearing Set 2, bearing-1 outer-race run-to-failure",
        "control_limits": {
            "cl": cl,
            "ucl": ucl,
            "lcl": lcl,
            "mu": cl,
            "sigma": round(sigma, ROUND),
            "k": K_CONTROL,
        },
        "threshold": {
            "min": thr_min,
            "max": thr_max,
            "m": M_THRESHOLD,
        },
        "spec_limits": {
            "usl": usl,
            "lsl": lsl,
            "k": K_SPEC,
        },
        "healthy_window": {
            "start_index": start_index,
            "end_index": end_index,
            "start_time": start_time,
            "end_time": end_time,
            "n": HEALTHY_K,
        },
        "failure_time": failure_time,
        "run_duration_hours": round(duration_h, 2),
        "f1_anchor_candidates_hours": f1_anchor_candidates_hours,
        "provenance": [
            (
                "Healthy window = first {k} snapshots (idx {s}..{e}, {st} .. {et}). Chosen because "
                "RMS is stably ~{mu:.5f} (sample sd ~{sg:.5f}) across this range; the first sample above "
                "mu+6*sigma is idx 533 and sustained degradation (>0.1) starts idx 647, both far after "
                "idx {e}. This isolates the fresh-bearing region and excludes both the degradation ramp "
                "and the end-of-life shutdown collapse (idx ~982-983, RMS~0)."
            ).format(k=HEALTHY_K, s=start_index, e=end_index, st=start_time, et=end_time, mu=mu, sg=sigma),
            (
                "mu_base = mean(rms) and sigma_base = sample stdev (ddof=1) over the healthy window. "
                "sigma uses ddof=1 as the unbiased estimate of the population sigma."
            ),
            (
                "control_limits (SPC I-chart, individuals): cl=mu_base, ucl=mu_base+3*sigma_base, "
                "lcl=mu_base-3*sigma_base (k=3, standard Shewhart 3-sigma). lcl stays positive for this RMS."
            ),
            (
                "threshold (naive coarse operator band): min/max = mu_base +/- {m}*sigma_base. m={m} is "
                "deliberately wider than the 3-sigma control limits so the threshold method is the coarsest "
                "(latest-detecting) rung of the ladder, defined by rule and frozen before measurement (no tuning)."
            ).format(m=M_THRESHOLD),
            (
                "spec_limits (D-06 Option a): usl=mu_base+{k}*sigma_base, lsl=mu_base-{k}*sigma_base (k={k}, "
                "six-sigma operating spec derived from the healthy baseline since the vibration signal has no "
                "natural engineering spec). lsl is positive here so it is NOT floored at 0. Cpk is computed "
                "later (03-02) from rolling/current mu/sigma against these frozen USL/LSL; computing Cpk on "
                "the frozen baseline would collapse to a constant (RESEARCH Pitfall 2)."
            ).format(k=K_SPEC),
            (
                "failure_time = last snapshot recorded_at ({ft}) = physical run end / end-of-life anchor "
                "(D-07 ground truth). It is NOT a threshold-alarm time. Its own RMS is ~0 (post-failure "
                "shutdown), which is expected; F1 anchor sensitivity is parameterized by f1_anchor_candidates_hours."
            ).format(ft=failure_time),
            (
                "f1_anchor_candidates_hours = last 5%/10%/20% of the {d:.2f}h run duration = {c}. These are "
                "inputs to the 03-04 F1 time-anchor sensitivity table (Open Q2)."
            ).format(d=duration_h, c=f1_anchor_candidates_hours),
        ],
    }

    with open(OUT, "w") as f:
        json.dump(baseline, f, indent=2, ensure_ascii=False, sort_keys=True)
        f.write("\n")
    print("wrote", OUT)


if __name__ == "__main__":
    main()
