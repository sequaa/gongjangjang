"""Pure evaluation formula functions for the 3-metric objectivity ladder.

No I/O, no external dependencies — stdlib datetime only.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Optional


def _to_dt(value: str | datetime) -> datetime:
    if isinstance(value, datetime):
        return value
    return datetime.fromisoformat(value)


def lead_time_seconds(
    failure_time: str | datetime,
    first_detection_time: Optional[str | datetime],
) -> Optional[float]:
    """Return (failure_time - first_detection_time) in seconds.

    Positive means the detector fired before failure (good).
    Returns None when first_detection_time is None (never detected).
    """
    if first_detection_time is None:
        return None
    fail = _to_dt(failure_time)
    det = _to_dt(first_detection_time)
    return (fail - det).total_seconds()


def healthy_fpr(flags: list[bool]) -> float:
    """Return fraction of healthy-window points on which the detector fired.

    Empty list -> 0.0 (no healthy points observed).
    """
    if not flags:
        return 0.0
    return sum(flags) / len(flags)


def time_anchor_labels(
    times: list[str | datetime],
    failure_time: str | datetime,
    p_hours: float,
) -> list[bool]:
    """Return per-point bool: True iff point is in [failure - p_hours, failure] (inclusive).

    Points strictly after failure_time are False.
    """
    fail = _to_dt(failure_time)
    window_start = fail - timedelta(hours=p_hours)
    result = []
    for t in times:
        dt = _to_dt(t)
        result.append(window_start <= dt <= fail)
    return result


def precision_recall_f1(
    predicted: list[bool],
    actual: list[bool],
) -> dict[str, float]:
    """Compute precision, recall, and F1 from per-point bool lists.

    Zero-division convention (sklearn zero_division=0 style):
      - TP+FP == 0  -> precision = 0.0
      - TP+FN == 0  -> recall    = 0.0
      - P+R == 0    -> f1        = 0.0
    """
    tp = sum(p and a for p, a in zip(predicted, actual))
    fp = sum(p and not a for p, a in zip(predicted, actual))
    fn = sum(not p and a for p, a in zip(predicted, actual))

    precision = tp / (tp + fp) if (tp + fp) > 0 else 0.0
    recall = tp / (tp + fn) if (tp + fn) > 0 else 0.0
    f1 = (2 * precision * recall) / (precision + recall) if (precision + recall) > 0 else 0.0

    return {"precision": precision, "recall": recall, "f1": f1}
