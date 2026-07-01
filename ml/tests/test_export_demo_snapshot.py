"""RED: pins the GREEN contract for ``ml/eval/export_demo_snapshot.py``.

The script does NOT exist yet, so every test here fails at the point it invokes
the script (subprocess returncode != 0 -> ``_run_export`` fails, and the module
fixture ERRORs with the "No such file" stderr). That missing-script failure —
not a test bug — is the expected RED signal.

GREEN CONTRACT this file defines (04-02 Task 2, D-01/D-03/D-05/D-07):
  * ``python eval/export_demo_snapshot.py`` writes ``snapshot.json`` +
    ``leadtime.json`` to ``frontend/src/demo`` by DEFAULT, and accepts an
    OPTIONAL ``--out-dir DIR`` flag to redirect both outputs (used here so the
    tests never touch the repo working tree).
  * ``snapshot.json`` shape: {baseline, readings, alarms, spcCpk, mlScore}.
      - readings[*] keys EXACTLY {deviceId, metric, value, recordedAt,
        publishedAtMs}; deviceId="device-001", metric="rms".
      - baseline has all 8 ``Baseline`` keys (types.ts).
      - alarms: one first-occurrence per detector; alarm.detector in
        {threshold, spc, ml}; alarm.firstOccurredAt == that detector's K=3
        ``fire_time`` in the TOP-LEVEL ``detectors`` block of
        eval/results/leadtime_fpr_f1.json.
      - spcCpk[*]: {signalType:"cpk", value, occurredAt, ...}; the initial
        window<2 (NaN) point is omitted; value = rolling Cpk over the last 10
        rms with sample stddev (ddof=1) against frozen usl/lsl.
  * ``leadtime.json`` mirrors the source ``detectors`` subtree VERBATIM:
    leadtime["detectors"][det]["k_consecutive_lead_time"][K]["lead_time_hours"]
    equals the same path in leadtime_fpr_f1.json, and leadtime["primary_finding"]
    equals the source primary_finding (D-05: copied, never recomputed).

Determinism (behavior 1) uses two independent subprocess runs into two tmp dirs
and compares raw bytes — a stronger oracle than an in-process double call.
"""

import json
import statistics
import subprocess
import sys
from datetime import datetime
from pathlib import Path

import pandas as pd
import pytest

# --- paths (test file lives at ml/tests/) ---------------------------------- #
ML_ROOT = Path(__file__).resolve().parents[1]          # .../gongjangjang/ml
REPO_ROOT = ML_ROOT.parent                             # .../gongjangjang
SCRIPT = ML_ROOT / "eval" / "export_demo_snapshot.py"  # DOES NOT EXIST YET (RED)
FEATURES_CSV = REPO_ROOT / "data" / "nasa" / "features.csv"
BASELINE_JSON = REPO_ROOT / "data" / "nasa" / "baseline.frozen.json"
SOURCE_LEADTIME = ML_ROOT / "eval" / "results" / "leadtime_fpr_f1.json"

DETECTORS = ["threshold", "spc", "ml"]
K_SET = ["1", "3", "5"]
BASELINE_KEYS = {"thresholdMin", "thresholdMax", "ucl", "lcl", "usl", "lsl", "mu", "sigma"}
READING_KEYS = {"deviceId", "metric", "value", "recordedAt", "publishedAtMs"}


# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #
def _run_export(out_dir: Path):
    """Invoke the (not-yet-existing) script into ``out_dir``; return raw bytes.

    In RED the subprocess exits non-zero (No such file), so this fails loudly
    with the missing-script reason.
    """
    proc = subprocess.run(
        [sys.executable, str(SCRIPT), "--out-dir", str(out_dir)],
        cwd=str(ML_ROOT),
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        pytest.fail(
            f"export_demo_snapshot.py invocation failed (rc={proc.returncode}).\n"
            f"stderr:\n{proc.stderr}"
        )
    snap_path = out_dir / "snapshot.json"
    lead_path = out_dir / "leadtime.json"
    return snap_path.read_bytes(), lead_path.read_bytes()


@pytest.fixture(scope="module")
def exported(tmp_path_factory):
    """Run the export ONCE into a tmp dir; return parsed + raw payloads."""
    out = tmp_path_factory.mktemp("demo_export")
    snap_bytes, lead_bytes = _run_export(out)
    return {
        "snapshot": json.loads(snap_bytes),
        "leadtime": json.loads(lead_bytes),
        "snapshot_bytes": snap_bytes,
        "leadtime_bytes": lead_bytes,
    }


@pytest.fixture(scope="module")
def source_leadtime():
    return json.loads(SOURCE_LEADTIME.read_text())


def _epoch(iso: str) -> float:
    return datetime.fromisoformat(iso).timestamp()


# ===========================================================================
# behavior 1 — determinism: two runs produce byte-identical outputs
# ===========================================================================
def test_export_is_byte_deterministic(tmp_path):
    out_a = tmp_path / "a"
    out_b = tmp_path / "b"
    out_a.mkdir()
    out_b.mkdir()
    snap_a, lead_a = _run_export(out_a)
    snap_b, lead_b = _run_export(out_b)
    assert snap_a == snap_b, "snapshot.json bytes differ between runs (nondeterministic)"
    assert lead_a == lead_b, "leadtime.json bytes differ between runs (nondeterministic)"


# ===========================================================================
# behavior 2 — schema of readings + baseline
# ===========================================================================
def test_readings_and_baseline_schema(exported):
    snap = exported["snapshot"]
    readings = snap["readings"]
    assert len(readings) > 0
    for r in readings:
        assert set(r.keys()) == READING_KEYS
        assert r["deviceId"] == "device-001"
        assert r["metric"] == "rms"
        assert isinstance(r["value"], (int, float))
        assert isinstance(r["publishedAtMs"], (int, float))
    baseline = snap["baseline"]
    assert BASELINE_KEYS.issubset(baseline.keys())


# ===========================================================================
# behavior 3 — D-07 hygiene: no orphan alarms; count <= detector count
# ===========================================================================
def test_alarms_within_reading_range_and_bounded(exported):
    snap = exported["snapshot"]
    readings = snap["readings"]
    alarms = snap["alarms"]
    first_epoch = _epoch(readings[0]["recordedAt"])
    last_epoch = _epoch(readings[-1]["recordedAt"])
    assert len(alarms) <= len(DETECTORS)
    assert len(alarms) > 0
    for a in alarms:
        e = _epoch(a["firstOccurredAt"])
        assert first_epoch <= e <= last_epoch, (
            f"alarm firstOccurredAt {a['firstOccurredAt']} outside readings range"
        )


# ===========================================================================
# behavior 4 — D-07 consistency: alarm.firstOccurredAt == detector K=3 fire_time
# ===========================================================================
def test_alarm_times_match_k3_fire_time(exported, source_leadtime):
    alarms = exported["snapshot"]["alarms"]
    src = source_leadtime["detectors"]
    by_detector = {a["detector"]: a for a in alarms}
    # Every alarm's detector is a known one, no dupes.
    assert set(by_detector.keys()).issubset(set(DETECTORS))
    assert len(by_detector) == len(alarms)
    for det, alarm in by_detector.items():
        expected = src[det]["k_consecutive_lead_time"]["3"]["fire_time"]
        assert alarm["firstOccurredAt"] == expected, (
            f"{det} alarm firstOccurredAt {alarm['firstOccurredAt']} != K=3 fire_time {expected}"
        )


# ===========================================================================
# behavior 5 — D-05 verbatim: lead_time_hours copied, not recomputed
# ===========================================================================
def test_leadtime_values_are_verbatim(exported, source_leadtime):
    demo = exported["leadtime"]
    src = source_leadtime["detectors"]
    for det in DETECTORS:
        for k in K_SET:
            expected = src[det]["k_consecutive_lead_time"][k]["lead_time_hours"]
            actual = demo["detectors"][det]["k_consecutive_lead_time"][k]["lead_time_hours"]
            assert actual == expected, (
                f"{det} K={k} lead_time_hours {actual} != source {expected} (not verbatim)"
            )
    assert demo["primary_finding"] == source_leadtime["primary_finding"]


# ===========================================================================
# behavior 6 — Cpk drops below 1.0 in the degradation tail + matches formula
# ===========================================================================
def test_spc_cpk_degradation_and_formula(exported):
    snap = exported["snapshot"]
    cpk_by_time = {p["occurredAt"]: p["value"] for p in snap["spcCpk"]}
    assert all(p["signalType"] == "cpk" for p in snap["spcCpk"])

    # (a) degradation tail: Cpk drops below 1.0 somewhere.
    assert min(cpk_by_time.values()) < 1.0

    # (b) formula match at a known checkpoint (window=10, sample stddev ddof=1).
    df = pd.read_csv(FEATURES_CSV)
    rms = df["rms"].tolist()
    recorded = df["recorded_at"].tolist()
    baseline = json.loads(BASELINE_JSON.read_text())
    usl = baseline["spec_limits"]["usl"]
    lsl = baseline["spec_limits"]["lsl"]

    idx = 800  # deep in the degradation region, away from the shutdown collapse
    window = rms[idx - 9 : idx + 1]  # exactly 10 values
    assert len(window) == 10
    m = statistics.mean(window)
    sd = statistics.stdev(window)  # ddof=1
    expected_cpk = min((usl - m) / (3 * sd), (m - lsl) / (3 * sd))

    ts = recorded[idx]
    assert ts in cpk_by_time, f"no spcCpk point at checkpoint recordedAt {ts}"
    assert cpk_by_time[ts] == pytest.approx(expected_cpk, rel=1e-9)
