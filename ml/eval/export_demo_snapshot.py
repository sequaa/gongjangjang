"""Deterministic offline snapshot generator for the GitHub Pages demo.

Reproduce command:
    cd ml && ./.venv/bin/python eval/export_demo_snapshot.py

Writes frontend/src/demo/snapshot.json and frontend/src/demo/leadtime.json.
Pass --out-dir DIR to redirect both outputs (used by tests so they never touch
the repo working tree).

Design rules (see 04-02-PLAN.md Task 2):
  - NEVER reimplement detector logic — import spc_fired_series + AnomalyModel.
  - NEVER recompute lead-time numbers — copy them verbatim from leadtime_fpr_f1.json (D-05).
  - Byte-deterministic output: json.dumps with sort_keys=True, fixed indent, trailing newline.
"""

from __future__ import annotations

import argparse
import collections
import json
import statistics
import sys
from datetime import datetime
from pathlib import Path

# Same sys.path setup as run_eval.py — makes eval.* and app.* importable.
ML_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ML_ROOT))

import pandas as pd  # noqa: E402

from app.model import AnomalyModel  # noqa: E402
from eval.run_eval import spc_fired_series  # noqa: E402  (import ensures no logic drift)

REPO_ROOT = ML_ROOT.parent
FEATURES_CSV = REPO_ROOT / "data" / "nasa" / "features.csv"
BASELINE_JSON = REPO_ROOT / "data" / "nasa" / "baseline.frozen.json"
MODEL_JOBLIB = ML_ROOT / "model.joblib"
SOURCE_LEADTIME = ML_ROOT / "eval" / "results" / "leadtime_fpr_f1.json"
DEFAULT_OUT_DIR = REPO_ROOT / "frontend" / "src" / "demo"

FEATURE_ORDER = ["rms", "kurtosis", "crest"]
DEVICE_ID = "device-001"
METRIC = "rms"
SPC_WINDOW = 10  # mirrors signal.spc.window=10 in application.properties


def _epoch_ms(iso: str) -> int:
    return int(datetime.fromisoformat(iso).timestamp() * 1000)


def build_readings(df: pd.DataFrame) -> list[dict]:
    rows = []
    for _, row in df.iterrows():
        rows.append({
            "deviceId": DEVICE_ID,
            "metric": METRIC,
            "publishedAtMs": _epoch_ms(str(row["recorded_at"])),
            "recordedAt": str(row["recorded_at"]),
            "value": float(row["rms"]),
        })
    return rows


def build_baseline(raw: dict) -> dict:
    cl = raw["control_limits"]
    sl = raw["spec_limits"]
    thr = raw["threshold"]
    return {
        "lcl": cl["lcl"],
        "lsl": sl["lsl"],
        "mu": cl["mu"],
        "sigma": cl["sigma"],
        "thresholdMax": thr["max"],
        "thresholdMin": thr["min"],
        "ucl": cl["ucl"],
        "usl": sl["usl"],
    }


def build_ml_scores(df: pd.DataFrame, model: AnomalyModel) -> list[dict]:
    X = df[FEATURE_ORDER].values.astype(float)
    rows = []
    times = df["recorded_at"].tolist()
    for i in range(len(df)):
        score = float(model.anomaly_score(X[i]))
        rows.append({
            "detector": "ml",
            "deviceId": DEVICE_ID,
            "metric": METRIC,
            "occurredAt": str(times[i]),
            "signalType": "anomaly_score",
            "value": score,
        })
    return rows


def build_spc_cpk(df: pd.DataFrame, usl: float, lsl: float) -> list[dict]:
    """Rolling Cpk replicating Java SpcState: deque maxlen=10, sample stddev ddof=1.

    Omits the initial window<2 point (idx=0 has only 1 sample — stdev undefined).
    cpk = min((usl - rm) / (3*rs), (rm - lsl) / (3*rs))
    """
    rms = df["rms"].tolist()
    times = df["recorded_at"].tolist()
    window: collections.deque = collections.deque(maxlen=SPC_WINDOW)
    rows = []
    for i, v in enumerate(rms):
        window.append(v)
        if len(window) < 2:
            continue  # skip idx=0; stdev requires >= 2 samples
        rm = statistics.mean(window)
        rs = statistics.stdev(window)  # ddof=1 (sample stddev, matches Java SpcState)
        cpk = min((usl - rm) / (3 * rs), (rm - lsl) / (3 * rs))
        rows.append({
            "deviceId": DEVICE_ID,
            "metric": METRIC,
            "occurredAt": str(times[i]),
            "signalType": "cpk",
            "value": cpk,
        })
    return rows


def build_alarms(source: dict, rms: list[float], ml_scores: list[dict]) -> list[dict]:
    """One first-fire alarm per detector using the K=3 fire_time verbatim (D-07).

    severity convention mirrors SignalEvaluationConsumer: threshold=critical, spc/ml=warning.
    firstOccurredAt is copied from leadtime_fpr_f1.json K=3 fire_time — NOT recomputed.
    """
    dets = source["detectors"]
    detector_defs = [
        ("threshold", 1, "THRESHOLD_BREACH", "critical"),
        ("spc", 2, "WE_RULE", "warning"),
        ("ml", 3, "ANOMALY_SCORE", "warning"),
    ]
    alarms = []
    for det, alarm_id, rule, severity in detector_defs:
        k3 = dets[det]["k_consecutive_lead_time"]["3"]
        fire_time = k3["fire_time"]
        fire_index = k3["fire_index"]
        if det == "ml":
            value = ml_scores[fire_index]["value"]
        else:
            value = float(rms[fire_index])
        alarms.append({
            "detector": det,
            "deviceId": DEVICE_ID,
            "firstOccurredAt": fire_time,
            "id": alarm_id,
            "metric": METRIC,
            "rule": rule,
            "severity": severity,
            "state": "created",
            "value": value,
        })
    return alarms


def build_leadtime(source: dict) -> dict:
    """Verbatim copy of detectors subtree + primary_finding (D-05, no recompute)."""
    return {
        "detectors": source["detectors"],
        "primary_finding": source["primary_finding"],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Export deterministic demo snapshot.")
    parser.add_argument(
        "--out-dir",
        default=str(DEFAULT_OUT_DIR),
        help="Output directory (default: frontend/src/demo)",
    )
    args = parser.parse_args()
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    df = pd.read_csv(FEATURES_CSV)
    raw_baseline = json.loads(BASELINE_JSON.read_text())
    source_leadtime = json.loads(SOURCE_LEADTIME.read_text())
    model = AnomalyModel.load(MODEL_JOBLIB)

    baseline = build_baseline(raw_baseline)
    readings = build_readings(df)
    ml_scores = build_ml_scores(df, model)
    usl = raw_baseline["spec_limits"]["usl"]
    lsl = raw_baseline["spec_limits"]["lsl"]
    spc_cpk = build_spc_cpk(df, usl, lsl)
    rms_list = df["rms"].tolist()
    alarms = build_alarms(source_leadtime, rms_list, ml_scores)
    leadtime = build_leadtime(source_leadtime)

    snapshot = {
        "alarms": alarms,
        "baseline": baseline,
        "mlScore": ml_scores,
        "readings": readings,
        "spcCpk": spc_cpk,
    }

    dump_kwargs: dict = {"indent": 2, "sort_keys": True}
    (out_dir / "snapshot.json").write_text(json.dumps(snapshot, **dump_kwargs) + "\n")
    (out_dir / "leadtime.json").write_text(json.dumps(leadtime, **dump_kwargs) + "\n")
    print(f"Wrote snapshot.json and leadtime.json to {out_dir}")


if __name__ == "__main__":
    main()
