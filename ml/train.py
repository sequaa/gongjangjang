"""Training entry-point: load healthy slice, fit AnomalyModel, persist."""

import json
import os
from pathlib import Path

import numpy as np
import pandas as pd

_ML_DIR = Path(__file__).resolve().parent
_REPO_ROOT = _ML_DIR.parent
_DEFAULT_FEATURES_CSV = _REPO_ROOT / "data" / "nasa" / "features.csv"
_DEFAULT_BASELINE_JSON = _REPO_ROOT / "data" / "nasa" / "baseline.frozen.json"

FEATURE_COLUMNS = ["rms", "kurtosis", "crest"]


def load_training_data(features_csv_path, baseline_json_path) -> np.ndarray:
    """Return feature matrix for rows with snapshot_index <= healthy_window.end_index."""
    baseline = json.loads(Path(baseline_json_path).read_text())
    end_index = int(baseline["healthy_window"]["end_index"])

    df = pd.read_csv(features_csv_path)
    healthy = df[df["snapshot_index"] <= end_index]
    return healthy[FEATURE_COLUMNS].to_numpy(dtype=float)


def main() -> None:
    from app.model import AnomalyModel

    baseline = json.loads(_DEFAULT_BASELINE_JSON.read_text())
    end_index = int(baseline["healthy_window"]["end_index"])

    X = load_training_data(_DEFAULT_FEATURES_CSV, _DEFAULT_BASELINE_JSON)

    model = AnomalyModel()
    model.fit(X)

    model_path = os.environ.get("ML_MODEL_PATH", "model.joblib")
    model.save(model_path)

    print(end_index)


if __name__ == "__main__":
    main()
