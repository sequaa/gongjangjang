"""ANLZ-03 — IsolationForest scoring + FastAPI /score & /health contract.

GREEN contract this test pins:

  ml/app/features.py
    feature_vector(reading) -> list[float] in fixed order [rms, kurtosis, crest];
    shared by train + score.

  ml/app/model.py
    class AnomalyModel  (wraps sklearn.ensemble.IsolationForest)
      .fit(X)                  -> self / None ; train on the healthy slice
      .anomaly_score(x) -> float   HIGHER = more anomalous
                                   (flip the sign of decision_function so it is
                                   monotone in that direction)
      .is_anomaly(x)    -> bool    (True == predict == -1)
      .save(path) / classmethod-or-staticmethod load(path)  via joblib

  ml/app/main.py
    FastAPI `app`.
      POST /score  body = ScoreRequest(features: list[float])
                   -> {"anomaly_score": float, "is_anomaly": bool}
                   malformed body (missing/typed/wrong field) -> 422
      GET  /health -> 200
    Model is loaded at import/startup from env ML_MODEL_PATH (default
    "model.joblib"). === MODEL-INJECTION SEAM FOR GREEN ===
    main.py MUST read the model path from os.environ["ML_MODEL_PATH"]
    (fallback "model.joblib") at import time, so this test can train a fixture
    model, save it to a tmp path, set the env var, and only THEN import app.main.

RED expectation: `from app.model import AnomalyModel` / `from app.main import app`
raise ModuleNotFoundError -> all tests fail. Valid RED.
"""

import importlib

import pytest


def _build_trained_model(features_csv_path, baseline_json_path):
    """Train an AnomalyModel on the frozen healthy slice (no leakage)."""
    from app.model import AnomalyModel
    import train

    X = train.load_training_data(features_csv_path, baseline_json_path)
    model = AnomalyModel()
    model.fit(X)
    return model


# --------------------------------------------------------------------------- #
# Model scoring: healthy LOW / not-anomaly, degraded HIGH / anomaly
# --------------------------------------------------------------------------- #
def test_degraded_scores_higher_than_healthy(
    features_csv_path, baseline_json_path, healthy_vector, degraded_vector
):
    model = _build_trained_model(features_csv_path, baseline_json_path)
    # Relative + absolute checks (robust to contamination="auto" edge effects).
    assert model.anomaly_score(degraded_vector) > model.anomaly_score(healthy_vector)


def test_healthy_vector_is_not_flagged(
    features_csv_path, baseline_json_path, healthy_vector
):
    model = _build_trained_model(features_csv_path, baseline_json_path)
    assert model.is_anomaly(healthy_vector) is False


def test_degraded_vector_is_flagged(
    features_csv_path, baseline_json_path, degraded_vector
):
    model = _build_trained_model(features_csv_path, baseline_json_path)
    assert model.is_anomaly(degraded_vector) is True


def test_feature_vector_order_matches_csv_columns(features_df):
    """feature_vector must emit [rms, kurtosis, crest] in that exact order."""
    from app.features import feature_vector

    row = features_df[features_df["snapshot_index"] == 0].iloc[0]
    reading = {"rms": float(row["rms"]),
               "kurtosis": float(row["kurtosis"]),
               "crest": float(row["crest"])}
    assert feature_vector(reading) == [reading["rms"], reading["kurtosis"], reading["crest"]]


# --------------------------------------------------------------------------- #
# FastAPI TestClient: /health 200, malformed /score 422
# --------------------------------------------------------------------------- #
@pytest.fixture
def client(features_csv_path, baseline_json_path, tmp_path, monkeypatch):
    """Train a fixture model, persist it, point app.main at it, then import.

    Uses the ML_MODEL_PATH seam so app.main can load a real model at import
    time without depending on a committed model.joblib.
    """
    from fastapi.testclient import TestClient

    model = _build_trained_model(features_csv_path, baseline_json_path)
    model_path = tmp_path / "model.joblib"
    model.save(model_path)

    monkeypatch.setenv("ML_MODEL_PATH", str(model_path))
    # Fresh import so the module-level model load picks up ML_MODEL_PATH.
    import app.main as main_mod
    main_mod = importlib.reload(main_mod)

    return TestClient(main_mod.app)


def test_health_returns_200(client):
    assert client.get("/health").status_code == 200


def test_score_valid_payload_returns_shape(client, healthy_vector):
    resp = client.post("/score", json={"features": healthy_vector})
    assert resp.status_code == 200
    body = resp.json()
    assert set(body) == {"anomaly_score", "is_anomaly"}
    assert isinstance(body["anomaly_score"], float)
    assert isinstance(body["is_anomaly"], bool)


@pytest.mark.parametrize(
    "bad_payload",
    [
        {},                                # missing `features`
        {"features": "not-a-list"},        # wrong type
        {"features": [1.0, "x", 3.0]},     # non-numeric element
    ],
)
def test_score_malformed_payload_returns_422(client, bad_payload):
    assert client.post("/score", json=bad_payload).status_code == 422
