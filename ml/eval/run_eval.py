"""PORTFOLIO HEADLINE eval: K-persistence lead-time + healthy-FPR + (secondary) F1.

Reproducible one-liner:  cd ml && ./.venv/bin/python eval/run_eval.py

Applies the three detectors (threshold, SPC, ML) over the frozen NASA IMS
Set-2 bearing-1 feature series and reports an HONEST detection ladder using the
TESTED pure formulas in eval.metrics. No tuning peeks at the failure-region
lead-time (D-05/D-09); every ML candidate (winners AND losers) is recorded.

Why this file is shaped the way it is (advisor-mandated honesty):
  A naive "first single snapshot past the limit" (first-touch, K=1) rewards a
  noisy/spiky detector: a single reverting score spike can clip a low threshold
  and look "early". Real condition-monitoring alarms require PERSISTENCE, so we
  report a K-consecutive sensitivity table for K in {1,3,5}, applied IDENTICALLY
  to all three detectors, and we report the WHOLE table rather than pick a K.

  Anti-circularity (the D-05 parallel for ML): the ML threshold is frozen by a
  PRE-COMMITTED rule = healthy-window p99 of the anomaly score (idx 0..299
  only). We KEEP healthy_p99 as the primary rule but ALSO report the healthy_max
  rule, because the two give OPPOSITE verdicts (p99 -> early via a spike; max ->
  very late). That rule-sensitivity is itself a finding: ML's ranking is fragile
  to the threshold choice, while threshold/SPC are not.

  Detection-time convention: an alarm fires at the K-th consecutive exceedance
  (the run-END / persistence-confirmation index), measured only at idx>=300 (the
  frozen healthy/degradation boundary, healthy_window.end_index=299, D-08). This
  is conservative (later = smaller lead-time, never overstates ML) and at K=1
  reproduces the single-touch headline indices exactly.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.covariance import EllipticEnvelope
from sklearn.svm import OneClassSVM

# Make `eval` and `app` importable when run from ml/.
ML_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ML_ROOT))

from app.model import AnomalyModel  # noqa: E402
from eval.metrics import (  # noqa: E402
    healthy_fpr,
    lead_time_seconds,
    precision_recall_f1,
    time_anchor_labels,
)

FEATURES_CSV = ML_ROOT.parent / "data" / "nasa" / "features.csv"
BASELINE_JSON = ML_ROOT.parent / "data" / "nasa" / "baseline.frozen.json"
MODEL_JOBLIB = ML_ROOT / "model.joblib"
RESULTS_DIR = ML_ROOT / "eval" / "results"
ML_THRESHOLD_RULE = "healthy_p99"  # PRE-COMMITTED primary. Do NOT change to flatter ML.
FEATURE_ORDER = ["rms", "kurtosis", "crest"]
K_SET = [1, 3, 5]  # SAME persistence set for ALL detectors. Do NOT pick a K to flatter one.


# --------------------------------------------------------------------------- #
# SPC detector — re-implements SpcEvaluator/SpcState EXACTLY (window irrelevant
# to firing: WE rules use lastN(3)/lastN(5)/run-counters, all independent of
# window>=5; window only feeds rolling Cpk, which firing does not need).
# Strict >/< everywhere; run counters reset to 0 when value==mu.
# --------------------------------------------------------------------------- #
def spc_fired_series(values, mu, sigma, ucl, lcl):
    fired = []
    history = []  # full chronological history; lastN slices the tail
    up_run = 0
    down_run = 0
    for v in values:
        history.append(v)
        if v > mu:
            up_run += 1
            down_run = 0
        elif v < mu:
            down_run += 1
            up_run = 0
        else:  # exactly on the center line resets both
            up_run = 0
            down_run = 0

        rules = False
        # Rule 1: beyond +-3 sigma (outside frozen control limits)
        if v > ucl or v < lcl:
            rules = True
        # Rule 2: 2 of last 3 beyond +-2 sigma, same side
        last3 = history[-3:]
        if sum(x > mu + 2 * sigma for x in last3) >= 2 or sum(x < mu - 2 * sigma for x in last3) >= 2:
            rules = True
        # Rule 3: 4 of last 5 beyond +-1 sigma, same side
        last5 = history[-5:]
        if sum(x > mu + sigma for x in last5) >= 4 or sum(x < mu - sigma for x in last5) >= 4:
            rules = True
        # Rule 4: 8 consecutive on the same side of mu
        if up_run >= 8 or down_run >= 8:
            rules = True
        fired.append(bool(rules))
    return fired


# --------------------------------------------------------------------------- #
# ML scoring helpers (convention: higher = more anomalous).
# --------------------------------------------------------------------------- #
def if_scores(model: AnomalyModel, X):
    return np.array([model.anomaly_score(x) for x in X])


def ocsvm_scores(X_healthy, X_all):
    clf = OneClassSVM(gamma="scale", nu=0.05)
    clf.fit(X_healthy)
    return -clf.decision_function(X_all)  # decision_function > 0 = inlier


def mahalanobis_scores(X_healthy, X_all):
    clf = EllipticEnvelope(contamination=0.05, random_state=42)
    clf.fit(X_healthy)
    return clf.mahalanobis(X_all)  # squared Mahalanobis distance, higher = anomalous


def frozen_threshold_p99(scores_healthy):
    """PRE-COMMITTED primary rule: healthy-window p99 of the anomaly score."""
    return float(np.percentile(scores_healthy, 99))


# --------------------------------------------------------------------------- #
# K-consecutive persistence: first run of K consecutive firings at idx>=lo.
# Alarm fires at the K-th consecutive exceedance (run-END = confirmation index).
# --------------------------------------------------------------------------- #
def first_k_run(fired, k, lo):
    run = 0
    for i in range(lo, len(fired)):
        if fired[i]:
            run += 1
            if run >= k:
                return i - k + 1, i  # (run_start_index, run_end_index = fire index)
        else:
            run = 0
    return None, None


def k_sensitivity(fired, times, failure_time, n_healthy, k_set):
    """Per-K first-run lead-time at idx>=n_healthy. Reports the WHOLE table."""
    table = {}
    for k in k_set:
        run_start, fire_idx = first_k_run(fired, k, n_healthy)
        fire_time = None if fire_idx is None else times[fire_idx]
        lt = lead_time_seconds(failure_time, fire_time)
        table[str(k)] = {
            "fired": fire_idx is not None,
            "run_start_index": run_start,
            "fire_index": fire_idx,  # run-END / alarm-confirmation index
            "fire_time": fire_time,
            "lead_time_hours": None if lt is None else round(lt / 3600, 2),
            "lead_time_seconds": lt,
        }
    return table


def f1_by_p(fired, times, failure_time, anchor_hours):
    out = {}
    for p in anchor_hours:
        actual = time_anchor_labels(times, failure_time, p)
        out[str(p)] = precision_recall_f1(fired, actual)
    return out


def main():
    df = pd.read_csv(FEATURES_CSV)
    times = df["recorded_at"].tolist()
    rms = df["rms"].tolist()
    X = df[FEATURE_ORDER].values.astype(float)

    baseline = json.loads(BASELINE_JSON.read_text())
    cl = baseline["control_limits"]
    mu, sigma, ucl, lcl = cl["mu"], cl["sigma"], cl["ucl"], cl["lcl"]
    thr = baseline["threshold"]
    failure_time = baseline["failure_time"]
    healthy_end = baseline["healthy_window"]["end_index"]
    n_healthy = healthy_end + 1
    anchor_hours = baseline["f1_anchor_candidates_hours"]

    # --- threshold detector --------------------------------------------------
    threshold_fired = [bool(v > thr["max"] or v < thr["min"]) for v in rms]

    # --- SPC detector --------------------------------------------------------
    spc_fired = spc_fired_series(rms, mu, sigma, ucl, lcl)

    # --- ML candidates (limited tuning; losers included) --------------------
    X_healthy = X[:n_healthy]
    candidate_scores = {
        "isolation_forest": if_scores(AnomalyModel.load(MODEL_JOBLIB), X),  # deployed model.joblib, no refit
        "one_class_svm": ocsvm_scores(X_healthy, X),
        "elliptic_envelope_mahalanobis": mahalanobis_scores(X_healthy, X),
    }
    HEADLINE_ML = "isolation_forest"

    # ML tuning candidates (primary p99 rule) -- winners AND losers recorded.
    ml_tuning = {}
    for name, scores in candidate_scores.items():
        thr_p99 = frozen_threshold_p99(scores[:n_healthy])
        fired = [bool(s > thr_p99) for s in scores]
        ml_tuning[name] = {
            "frozen_threshold": thr_p99,
            "threshold_rule": ML_THRESHOLD_RULE,
            "healthy_fpr": healthy_fpr(fired[:n_healthy]),
            "k_consecutive_lead_time": k_sensitivity(fired, times, failure_time, n_healthy, K_SET),
            "f1_by_p_hours": f1_by_p(fired, times, failure_time, anchor_hours),
        }

    # ----- headline-ML threshold-RULE sensitivity: p99 vs max ----------------
    head_scores = candidate_scores[HEADLINE_ML]
    thr_p99 = frozen_threshold_p99(head_scores[:n_healthy])
    thr_max = float(np.max(head_scores[:n_healthy]))
    fired_p99 = [bool(s > thr_p99) for s in head_scores]
    fired_max = [bool(s > thr_max) for s in head_scores]
    ml_rule_sensitivity = {
        "note": (
            "OPPOSITE verdicts from the SAME ML model: under healthy_p99 the ML fires "
            "'early' (K=1 idx 398) only because a single reverting score spike clips the "
            "low p99 threshold; under healthy_max it fires very late (K=1 idx 761) and "
            "vanishes entirely under persistence (K>=3). Threshold/SPC have no such "
            "rule-sensitivity. healthy_p99 stays the pre-committed PRIMARY rule; healthy_max "
            "is the comparison, not a swap."
        ),
        "healthy_p99": {
            "ml_threshold": thr_p99,
            "healthy_fpr": healthy_fpr(fired_p99[:n_healthy]),
            "k_consecutive_lead_time": k_sensitivity(fired_p99, times, failure_time, n_healthy, K_SET),
        },
        "healthy_max": {
            "ml_threshold": thr_max,
            "healthy_fpr": healthy_fpr(fired_max[:n_healthy]),
            "k_consecutive_lead_time": k_sensitivity(fired_max, times, failure_time, n_healthy, K_SET),
        },
    }

    # ----- root cause: healthy vs degradation score-distribution OVERLAP -----
    deg = head_scores[n_healthy:]
    n_below_max = int(np.sum(deg < thr_max))
    n_ge_max = int(np.sum(deg >= thr_max))
    first_ge = next((i for i in range(n_healthy, len(head_scores)) if head_scores[i] >= thr_max), None)
    root_cause = {
        "healthy_anomaly_score_max": thr_max,
        "n_degradation_scores": int(len(deg)),
        "n_degradation_scores_below_healthy_max": n_below_max,
        "n_degradation_scores_at_or_above_healthy_max": n_ge_max,
        "frac_degradation_scores_below_healthy_max": round(float(np.mean(deg < thr_max)), 4),
        "first_degradation_index_exceeding_healthy_max": first_ge,
        "note": (
            "The healthy anomaly-score max (%.4f) exceeds %.2f%% of ALL degradation-region "
            "scores; only %d of %d degradation snapshots ever reach it, the first at idx %s. "
            "The healthy and degradation score distributions OVERLAP, so any ML 'earliness' "
            "is threshold-placement luck on noise, not separable signal."
        ) % (thr_max, round(float(np.mean(deg < thr_max)) * 100, 2), n_ge_max, len(deg), first_ge),
    }

    # ----- primary metrics: K-persistence lead-time + healthy FPR -------------
    detectors = {
        "threshold": {
            "healthy_fpr": healthy_fpr(threshold_fired[:n_healthy]),
            "k_consecutive_lead_time": k_sensitivity(threshold_fired, times, failure_time, n_healthy, K_SET),
        },
        "spc": {
            "healthy_fpr": healthy_fpr(spc_fired[:n_healthy]),
            "k_consecutive_lead_time": k_sensitivity(spc_fired, times, failure_time, n_healthy, K_SET),
        },
        "ml": {  # headline ML under the PRIMARY healthy_p99 rule
            "threshold_rule": ML_THRESHOLD_RULE,
            "healthy_fpr": healthy_fpr(fired_p99[:n_healthy]),
            "k_consecutive_lead_time": k_sensitivity(fired_p99, times, failure_time, n_healthy, K_SET),
        },
    }

    # Per-K honest ranking (lead-time desc; "none" sorts last). Shows ML's
    # K=1 first-touch lead EVAPORATES once persistence is required.
    ranking_by_k = {}
    for k in K_SET:
        rows = []
        for name, d in detectors.items():
            lt = d["k_consecutive_lead_time"][str(k)]["lead_time_hours"]
            rows.append([name, lt])
        rows.sort(key=lambda kv: (kv[1] is not None, kv[1] if kv[1] is not None else 0), reverse=True)
        ranking_by_k[str(k)] = rows

    # ----- secondary: time-anchor F1 (demoted, with the caveat) --------------
    secondary_f1 = {
        "note": (
            "SECONDARY metric (RESEARCH already demoted F1). Time-anchor labels the clearly-"
            "degrading region (idx ~538+) as 'negative' whenever it falls outside the last "
            "P hours before failure, so a CORRECT early threshold detection is counted as a "
            "false positive. This makes F1 a weak basis for RANKING detectors; it is kept for "
            "completeness only. Lead-time + healthy-FPR are the primary metrics."
        ),
        "by_detector": {
            "threshold": f1_by_p(threshold_fired, times, failure_time, anchor_hours),
            "spc": f1_by_p(spc_fired, times, failure_time, anchor_hours),
            "ml": f1_by_p(fired_p99, times, failure_time, anchor_hours),
        },
    }

    # ----- one-line honest finding + tradeoff write-up -----------------------
    finding = (
        "On this RMS-dominated bearing signal, multivariate ML buys no robust earlier "
        "detection; the pre-frozen RMS threshold is the most defensible detector."
    )
    headline_note = (
        "Honest tradeoff (NOT 'ML wins'): "
        "(1) THRESHOLD detects latest at first-touch (K=1, 74.17h) but has 0%% healthy FPR "
        "and is K-robust -- once RMS crosses it stays crossed, so persistence only nudges it "
        "(idx 538->550->557). "
        "(2) SPC detects mid-to-early but at a noisy ~9.7%% healthy FPR. "
        "(3) ML is 'earliest' ONLY on first-touch (K=1, 97.5h) and ONLY via a single reverting "
        "score spike at idx 398 (idx 400 is already back below the threshold); it COLLAPSES to "
        "LAST under persistence (K=3 -> ~61h, idx 617) and FLIPS to latest/vanishing under the "
        "healthy_max rule (K=1 idx 761; K>=3 never fires). "
        "This generalizes past the deployed IF model: ALL THREE multivariate candidates lose "
        "their K=1 earliness under persistence -- OCSVM 105h@353 -> 46.5h@704 (becomes LATEST), "
        "Mahalanobis 105h@353 -> 74.83h@534 (merely CONVERGES to the threshold's own idx~538 "
        "detection region, not earlier), IF 97.5h@398 -> 61h@617. None buys a robust earlier "
        "detection. "
        "Root cause: the healthy anomaly-score max (%.4f) exceeds %.2f%% of all degradation "
        "scores -- the healthy and degradation score distributions overlap -- so ML's apparent "
        "earliness is threshold-placement luck on noise, not separable signal. "
        "%s"
    ) % (
        thr_max,
        round(float(np.mean(deg < thr_max)) * 100, 2),
        finding,
    )

    # Freeze the headline-ML threshold + rule to a small committed artifact.
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    ml_threshold_artifact = {
        "model": HEADLINE_ML,
        "source": "model.joblib",
        "rule": ML_THRESHOLD_RULE,
        "rule_description": (
            "Frozen BEFORE measuring lead-time: ML_THRESHOLD = 99th percentile of the "
            "anomaly_score over the HEALTHY window (idx 0..%d). Pre-committed; NOT chosen "
            "to maximize ML lead-time (anti-circularity, the D-05 parallel)." % healthy_end
        ),
        "ml_threshold": thr_p99,
        "healthy_window_end_index": healthy_end,
        "comparison_rule_healthy_max": thr_max,
        "comparison_note": (
            "healthy_max is reported alongside p99 to expose ML's threshold-rule sensitivity; "
            "it does NOT replace the pre-committed healthy_p99 primary rule."
        ),
    }
    (RESULTS_DIR / "ml_threshold.frozen.json").write_text(
        json.dumps(ml_threshold_artifact, indent=2, sort_keys=True) + "\n"
    )

    output = {
        "dataset": baseline.get("source"),
        "n_rows": len(df),
        "failure_time": failure_time,
        "healthy_window_end_index": healthy_end,
        "headline_ml": HEADLINE_ML,
        "ml_threshold_rule": ML_THRESHOLD_RULE,
        "detection_rule": (
            "first run of K consecutive snapshots past the limit; alarm fires at the K-th "
            "consecutive exceedance (run-END index); lead-time measured only from idx>=%d "
            "(frozen healthy/degradation boundary). K=1 reproduces single-touch first-occurrence."
        ) % n_healthy,
        "k_set": K_SET,
        "primary_finding": finding,
        "headline_note": headline_note,
        "detectors": detectors,
        "ranking_by_k_lead_time_hours": ranking_by_k,
        "ml_threshold_rule_sensitivity": ml_rule_sensitivity,
        "root_cause_score_overlap": root_cause,
        "secondary_f1_time_anchor": secondary_f1,
        "f1_anchor_candidates_hours": anchor_hours,
        "frozen_baseline": {"threshold": thr, "control_limits": cl},
        "ml_tuning_candidates": ml_tuning,
    }

    out_path = RESULTS_DIR / "leadtime_fpr_f1.json"
    out_path.write_text(json.dumps(output, indent=2, sort_keys=True) + "\n")

    # ----- console summary ---------------------------------------------------
    print("=== K-consecutive lead-time (idx>=%d; fire = K-th consecutive) ===" % n_healthy)
    print("%-10s %8s | %s" % ("detector", "FPR", "  ".join("K=%d" % k for k in K_SET)))
    for name, d in detectors.items():
        cells = []
        for k in K_SET:
            e = d["k_consecutive_lead_time"][str(k)]
            cells.append("%s@%s" % (
                ("%.2fh" % e["lead_time_hours"]) if e["lead_time_hours"] is not None else "none",
                e["fire_index"],
            ))
        print("%-10s %8.4f | %s" % (name, d["healthy_fpr"], "  ".join(cells)))

    print("\n=== ML threshold-RULE sensitivity (same model) ===")
    for rule in ("healthy_p99", "healthy_max"):
        r = ml_rule_sensitivity[rule]
        cells = []
        for k in K_SET:
            e = r["k_consecutive_lead_time"][str(k)]
            cells.append("K%d=%s@%s" % (
                k,
                ("%.2fh" % e["lead_time_hours"]) if e["lead_time_hours"] is not None else "none",
                e["fire_index"],
            ))
        print("%-12s thr=%.5f  %s" % (rule, r["ml_threshold"], "  ".join(cells)))

    print("\n=== per-K ranking (lead-time desc) ===")
    for k in K_SET:
        print("K=%d: %s" % (k, ranking_by_k[str(k)]))

    print("\n=== root cause ===")
    print(root_cause["note"])

    print("\n=== ML tuning candidates (incl losers; healthy_p99 rule, K=1) ===")
    for name, m in ml_tuning.items():
        e = m["k_consecutive_lead_time"]["1"]
        print("%-30s thr=%.5f FPR=%.4f K1=%s@%s" % (
            name, m["frozen_threshold"], m["healthy_fpr"],
            ("%.2fh" % e["lead_time_hours"]) if e["lead_time_hours"] is not None else "none",
            e["fire_index"],
        ))

    print("\n=== secondary F1 (NOT a ranking basis) ===")
    for name, fp in secondary_f1["by_detector"].items():
        print("%-10s %s" % (name, " ".join("P%s=%.3f" % (p, fp[str(p)]["f1"]) for p in anchor_hours)))

    print("\nFINDING:", finding)
    print("wrote", out_path)


if __name__ == "__main__":
    main()
