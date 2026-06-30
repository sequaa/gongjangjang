"""D-08 / Pitfall 3 — the critical no-leakage test for ML training data.

GREEN contract this test pins (see ml/train.py):
    load_training_data(features_csv_path, baseline_json_path) -> X
        Returns ONLY the feature rows whose snapshot_index <= the frozen
        healthy_window.end_index (== 299). X is the training matrix in the
        fixed column order [rms, kurtosis, crest] (shape (300, 3)); it must
        NOT contain any degraded/future row (no leakage).
    main()
        Trains on that healthy slice, writes the model to ML_MODEL_PATH
        (default ml/model.joblib via joblib), and PRINTS the explicit
        train/eval time boundary to stdout (the "recorded boundary").

RED expectation: `import train` raises ModuleNotFoundError (ml/train.py does
not exist yet) -> every test below fails at collection/setup. That is valid RED.
"""

import numpy as np

from conftest import FEATURE_COLUMNS, feature_tuple


def _load_train():
    # Imported lazily inside each test so the ModuleNotFoundError surfaces as a
    # test failure (RED) rather than a collection error that hides intent.
    import train as train_mod

    return train_mod


def test_training_slice_stays_within_frozen_healthy_boundary(
    features_csv_path, baseline_json_path, healthy_end_index
):
    """No row beyond healthy_window.end_index (299) may enter training."""
    X = _load_train().load_training_data(features_csv_path, baseline_json_path)
    X = np.asarray(X, dtype=float)

    # Boundary is explicit/recorded: the slice size equals the frozen window
    # (idx 0..299 inclusive => 300 rows). end_index is read from the committed
    # baseline.frozen.json by the fixture, NOT hardcoded here.
    assert X.shape[0] == healthy_end_index + 1 == 300
    assert X.shape[1] == len(FEATURE_COLUMNS)  # [rms, kurtosis, crest]


def test_degraded_tail_rows_are_not_in_training_set(
    features_csv_path, baseline_json_path, features_df
):
    """The degraded peak (idx 979) and shutdown (idx 983) must be excluded."""
    X = _load_train().load_training_data(features_csv_path, baseline_json_path)
    # Build membership set from the returned training matrix.
    train_rows = {
        tuple(round(float(v), 8) for v in row)
        for row in np.asarray(X, dtype=float)
    }

    for idx in (979, 983):  # degraded peak + post-failure shutdown collapse
        row = features_df[features_df["snapshot_index"] == idx].iloc[0]
        assert feature_tuple(row) not in train_rows, f"leakage: idx {idx} in train"


def test_boundary_is_inclusive_at_299_exclusive_at_300(
    features_csv_path, baseline_json_path, features_df, healthy_end_index
):
    """Strict boundary: idx 299 included, the very next row (idx 300) excluded."""
    X = _load_train().load_training_data(features_csv_path, baseline_json_path)
    train_rows = {
        tuple(round(float(v), 8) for v in row)
        for row in np.asarray(X, dtype=float)
    }

    boundary = features_df[features_df["snapshot_index"] == healthy_end_index].iloc[0]
    first_excluded = features_df[features_df["snapshot_index"] == healthy_end_index + 1].iloc[0]

    assert feature_tuple(boundary) in train_rows       # idx 299 trained
    assert feature_tuple(first_excluded) not in train_rows  # idx 300 not trained


def test_main_records_explicit_train_eval_boundary(tmp_path, capsys, monkeypatch):
    """main() trains, writes the model, and prints the train/eval boundary.

    GREEN: main() should resolve the data assets relative to the repo (so cwd
    does not matter) and honor ML_MODEL_PATH for the output location, then print
    the boundary (the frozen end_index 299) so the train/eval split is recorded.
    """
    model_path = tmp_path / "model.joblib"
    monkeypatch.setenv("ML_MODEL_PATH", str(model_path))

    _load_train().main()

    out = capsys.readouterr().out
    assert "299" in out, "main() must print the explicit healthy/eval boundary index"
    assert model_path.exists(), "main() must persist the trained model.joblib"
