"""ANLZ-04 — evaluation FORMULAS (pure math, no detector / no I/O).

This RED test pins the GREEN contract for ``ml/eval/metrics.py``, a pure-formula
module that ``run_eval.py`` will import. The three objective metrics of the
3-metric objectivity ladder (03-RESEARCH §"평가 아키텍처"):

  - lead-time (primary, objective): how long BEFORE end-of-life the detector
    first fired. Bigger = earlier warning = better.
  - healthy-window FPR (primary, objective): fraction of the known-healthy
    points on which the detector wrongly fired. Smaller = better.
  - time-anchor F1 (secondary): precision/recall/F1 where the POSITIVE ground
    truth is the END-OF-LIFE TIME ANCHOR — the last P hours before
    ``failure_time`` (03-RESEARCH Pitfall 1 / 03-CONTEXT D-07). It is NOT the
    detector's own change-points, and NOT a threshold-alarm time. P is swept
    (``f1_anchor_candidates_hours``) to show anchor sensitivity (A6).

===========================================================================
GREEN CONTRACT — ml/eval/metrics.py — the functions GREEN MUST satisfy
===========================================================================

lead_time_seconds(failure_time, first_detection_time) -> float | None
    Returns (failure_time - first_detection_time) in SECONDS.
      * positive  => detector fired BEFORE failure (good, earlier = larger).
      * first_detection_time is None (never detected) => return None.
    Both timestamps are ISO-8601 strings (or datetime); parse with
    datetime.fromisoformat semantics.

healthy_fpr(flags) -> float
    flags = per-point bools ("detector fired on this healthy point").
    Returns sum(flags) / len(flags). All-False => 0.0. Empty list => 0.0
    (no healthy points => no false positives observable). All-True => 1.0.

time_anchor_labels(times, failure_time, p_hours) -> list[bool]
    Returns one bool per element of ``times``: True iff the point lies in the
    closed positive window  [failure_time - p_hours,  failure_time]  (BOTH
    endpoints inclusive). Everything earlier than the window, and anything
    strictly after failure_time, is False. times/failure_time are ISO strings
    (or datetime); p_hours is a float number of hours.

precision_recall_f1(predicted, actual) -> dict
    predicted, actual = equal-length per-point bool lists.
    Returns {"precision": float, "recall": float, "f1": float} with the
    standard confusion-matrix definitions:
      TP = pred & act, FP = pred & ~act, FN = ~pred & act
      precision = TP/(TP+FP)   recall = TP/(TP+FN)   f1 = 2PR/(P+R)
    Zero-denominator convention (sklearn zero_division=0 style):
      * no predicted-positives (TP+FP == 0) => precision = 0.0
      * no actual-positives    (TP+FN == 0) => recall    = 0.0
      * precision+recall == 0              => f1        = 0.0
"""

import math
from datetime import datetime, timedelta

import pytest

from eval.metrics import (
    healthy_fpr,
    lead_time_seconds,
    precision_recall_f1,
    time_anchor_labels,
)

# --- shared anchors from the frozen baseline contract ---------------------
FAILURE_TIME_ISO = "2004-02-19T06:22:39"
_FAIL = datetime.fromisoformat(FAILURE_TIME_ISO)


def _iso(dt: datetime) -> str:
    return dt.isoformat()


# ===========================================================================
# 1. lead_time_seconds
# ===========================================================================
def test_lead_time_detection_one_hour_before_failure():
    detection = _iso(_FAIL - timedelta(seconds=3600))
    assert lead_time_seconds(FAILURE_TIME_ISO, detection) == pytest.approx(3600.0)


def test_lead_time_never_detected_is_none():
    assert lead_time_seconds(FAILURE_TIME_ISO, None) is None


# ===========================================================================
# 2. healthy_fpr
# ===========================================================================
def test_healthy_fpr_all_false_is_zero():
    assert healthy_fpr([False, False, False, False]) == pytest.approx(0.0)


def test_healthy_fpr_one_in_four_is_quarter():
    assert healthy_fpr([True, False, False, False]) == pytest.approx(0.25)


def test_healthy_fpr_all_true_is_one():
    assert healthy_fpr([True, True, True]) == pytest.approx(1.0)


# ===========================================================================
# 3. time_anchor_labels  (closed window [failure - P, failure])
# ===========================================================================
def test_time_anchor_labels_window_boundaries_P_small():
    p_hours = 8.19  # f1_anchor_candidates_hours[0]
    times = [
        _iso(_FAIL),                                  # 0: at failure -> True (right edge incl.)
        _iso(_FAIL - timedelta(hours=4.0)),           # 1: inside window -> True
        _iso(_FAIL - timedelta(hours=p_hours)),       # 2: exact left edge -> True (incl.)
        _iso(_FAIL - timedelta(hours=9.0)),           # 3: just before window -> False
        _iso(_FAIL - timedelta(hours=20.0)),          # 4: long before -> False
        _iso(_FAIL + timedelta(hours=1.0)),           # 5: after failure -> False
    ]
    assert time_anchor_labels(times, FAILURE_TIME_ISO, p_hours) == [
        True, True, True, False, False, False,
    ]


def test_time_anchor_labels_P_sensitivity_widens_window():
    # Same point set; a larger P pulls the -9h point INTO the positive window.
    p_hours = 16.38  # f1_anchor_candidates_hours[1]
    times = [
        _iso(_FAIL),                                  # at failure -> True
        _iso(_FAIL - timedelta(hours=9.0)),           # now inside (9 < 16.38) -> True
        _iso(_FAIL - timedelta(hours=20.0)),          # still outside -> False
    ]
    assert time_anchor_labels(times, FAILURE_TIME_ISO, p_hours) == [True, True, False]


# ===========================================================================
# 4. precision_recall_f1
# ===========================================================================
def test_prf1_hand_computed_confusion_matrix():
    # predicted=[T,T,F,F], actual=[T,F,F,F]
    #   TP=1 (idx0), FP=1 (idx1), FN=0, TN=2
    #   precision = 1/2 = 0.5 ; recall = 1/1 = 1.0 ; f1 = 2*.5*1/(.5+1) = 0.6667
    out = precision_recall_f1([True, True, False, False], [True, False, False, False])
    assert out["precision"] == pytest.approx(0.5)
    assert out["recall"] == pytest.approx(1.0)
    assert out["f1"] == pytest.approx(0.6666666667, abs=1e-4)


def test_prf1_no_predicted_positives_precision_zero():
    out = precision_recall_f1([False, False, False], [True, False, False])
    assert out["precision"] == pytest.approx(0.0)
    assert out["recall"] == pytest.approx(0.0)   # TP=0 with actual-positive present
    assert out["f1"] == pytest.approx(0.0)


def test_prf1_no_actual_positives_recall_zero():
    out = precision_recall_f1([True, False, False], [False, False, False])
    assert out["recall"] == pytest.approx(0.0)
    assert out["precision"] == pytest.approx(0.0)  # TP=0 => precision 0 too
    assert out["f1"] == pytest.approx(0.0)
