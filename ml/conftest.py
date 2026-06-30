"""Shared pytest fixtures + import path for the ML service tests.

Putting this conftest at the ``ml/`` root makes pytest prepend ``ml/`` onto
``sys.path`` during collection, so tests import the GREEN modules as:

    from app.features import feature_vector      # ml/app/features.py
    from app.model import AnomalyModel           # ml/app/model.py
    from app.main import app                     # ml/app/main.py  (FastAPI)
    import train                                 # ml/train.py

None of those modules exist yet (RED) -> ModuleNotFoundError is the expected
failure. The fixtures below only read committed data assets, so they are
import-safe and let the score/no-leakage tests share one source of truth.
"""

import json
import sys
from pathlib import Path

import pandas as pd
import pytest

ML_DIR = Path(__file__).resolve().parent          # .../gongjangjang/ml
REPO_ROOT = ML_DIR.parent                          # .../gongjangjang

# Ensure `app` / `train` resolve to the ml/ tree even if pytest is invoked
# from elsewhere.
if str(ML_DIR) not in sys.path:
    sys.path.insert(0, str(ML_DIR))

FEATURES_CSV = REPO_ROOT / "data" / "nasa" / "features.csv"
BASELINE_JSON = REPO_ROOT / "data" / "nasa" / "baseline.frozen.json"

# Feature order is fixed across train + score (contract): [rms, kurtosis, crest].
FEATURE_COLUMNS = ["rms", "kurtosis", "crest"]


@pytest.fixture(scope="session")
def features_csv_path() -> Path:
    return FEATURES_CSV


@pytest.fixture(scope="session")
def baseline_json_path() -> Path:
    return BASELINE_JSON


@pytest.fixture(scope="session")
def baseline(baseline_json_path) -> dict:
    return json.loads(baseline_json_path.read_text())


@pytest.fixture(scope="session")
def features_df(features_csv_path) -> pd.DataFrame:
    return pd.read_csv(features_csv_path)


@pytest.fixture(scope="session")
def healthy_end_index(baseline) -> int:
    # Read the frozen training-slice upper bound dynamically from the committed
    # baseline (== 299). Tests must NOT hardcode this number; it is the D-08
    # boundary of record.
    return int(baseline["healthy_window"]["end_index"])


@pytest.fixture(scope="session")
def healthy_vector(features_df, healthy_end_index) -> list[float]:
    """Centroid of the healthy slice -> strongest in-distribution inlier.

    Using the mean (not a single edge row) keeps the score test robust against
    IsolationForest contamination="auto" edge effects.
    """
    healthy = features_df[features_df["snapshot_index"] <= healthy_end_index]
    return [float(healthy[c].mean()) for c in FEATURE_COLUMNS]


@pytest.fixture(scope="session")
def degraded_vector(features_df) -> list[float]:
    """idx 979 = the degraded peak (rms~0.725, kurtosis~12.58). Clear outlier."""
    row = features_df[features_df["snapshot_index"] == 979].iloc[0]
    return [float(row[c]) for c in FEATURE_COLUMNS]


def feature_tuple(row) -> tuple:
    """Round a feature row to a hashable key for membership checks."""
    return tuple(round(float(row[c]), 8) for c in FEATURE_COLUMNS)
