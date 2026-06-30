"""D-12 inference-latency bench (RESEARCH §"D-12 측정").

Measures Spring->FastAPI per-reading scoring latency the honest way: it does NOT
assert "sub-ms"; it POSTs N representative NASA feature rows to the running
FastAPI `/score` endpoint and MEASURES per-call latency (model inference + local
HTTP roundtrip), then writes a raw p50/p95/p99/mean summary to
`eval/results/score_latency.json`.

Rows are taken from `data/nasa/features.csv` ([rms, kurtosis, crest]) — the exact
vectors the live Spring consumer sends — spanning the full run (healthy ->
degraded) so the latency reflects the real score distribution, not one regime.

Reproduce (one command; service must be up — see eval/README note):

    cd ml && ML_MODEL_PATH=model.joblib ./.venv/bin/uvicorn app.main:app --port 8000 &
    ./.venv/bin/python eval/score_latency.py
"""

import csv
import json
import os
import statistics
import time
import urllib.request
from pathlib import Path

_ML_DIR = Path(__file__).resolve().parent.parent
_REPO_ROOT = _ML_DIR.parent
_FEATURES_CSV = _REPO_ROOT / "data" / "nasa" / "features.csv"
_OUT = _ML_DIR / "eval" / "results" / "score_latency.json"

SERVICE_URL = os.environ.get("ML_SERVICE_URL", "http://localhost:8000")
N = int(os.environ.get("SCORE_LATENCY_N", "1000"))


def load_feature_rows(limit):
    rows = []
    with open(_FEATURES_CSV, newline="") as f:
        for r in csv.DictReader(f):
            rows.append([float(r["rms"]), float(r["kurtosis"]), float(r["crest"])])
    # Cycle the available rows up to N so we measure a representative mix.
    if not rows:
        raise SystemExit("no feature rows found")
    return [rows[i % len(rows)] for i in range(limit)]


def wait_for_health(timeout_s=30):
    """Poll /health until the service is up (uvicorn takes ~3s to start), so the
    documented one-line reproduce works even when uvicorn is still booting."""
    deadline = time.time() + timeout_s
    last_err = None
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(f"{SERVICE_URL}/health", timeout=2) as resp:
                if resp.status == 200:
                    return
        except Exception as e:  # noqa: BLE001 - connection refused while booting
            last_err = e
        time.sleep(0.5)
    raise SystemExit(f"ML service not healthy at {SERVICE_URL} after {timeout_s}s: {last_err}")


def post_score(features):
    body = json.dumps({"features": features}).encode()
    req = urllib.request.Request(
        f"{SERVICE_URL}/score",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=5) as resp:
        return json.load(resp)


def percentile(sorted_vals, p):
    """Nearest-rank percentile (p in [0,100])."""
    if not sorted_vals:
        return None
    k = max(0, min(len(sorted_vals) - 1, int(round(p / 100 * len(sorted_vals) + 0.5)) - 1))
    return sorted_vals[k]


def main():
    wait_for_health()
    rows = load_feature_rows(N)

    # Warm-up (JIT/connection/model first-call) excluded from the measured set.
    for features in rows[: min(20, len(rows))]:
        post_score(features)

    latencies_ms = []
    for features in rows:
        t0 = time.perf_counter()
        post_score(features)
        latencies_ms.append((time.perf_counter() - t0) * 1000.0)

    latencies_ms.sort()
    summary = {
        "n": len(latencies_ms),
        "service_url": SERVICE_URL,
        "features_csv": str(_FEATURES_CSV.relative_to(_REPO_ROOT)),
        "measures": "per-call latency = FastAPI inference + local HTTP roundtrip (ms)",
        "warmup_calls": min(20, len(rows)),
        "p50_ms": round(percentile(latencies_ms, 50), 4),
        "p95_ms": round(percentile(latencies_ms, 95), 4),
        "p99_ms": round(percentile(latencies_ms, 99), 4),
        "mean_ms": round(statistics.fmean(latencies_ms), 4),
        "min_ms": round(latencies_ms[0], 4),
        "max_ms": round(latencies_ms[-1], 4),
    }
    _OUT.parent.mkdir(parents=True, exist_ok=True)
    _OUT.write_text(json.dumps(summary, indent=2) + "\n")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
