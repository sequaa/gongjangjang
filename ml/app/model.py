"""AnomalyModel: IsolationForest wrapper with sign-flipped scoring."""

import joblib
import numpy as np
from sklearn.ensemble import IsolationForest


class AnomalyModel:
    def __init__(self, n_estimators: int = 100, contamination: float = 0.05, random_state: int = 42):
        self._clf = IsolationForest(
            n_estimators=n_estimators,
            contamination=contamination,
            random_state=random_state,
        )

    def fit(self, X) -> "AnomalyModel":
        self._clf.fit(X)
        return self

    def anomaly_score(self, x) -> float:
        """Higher = more anomalous (sign-flipped decision_function)."""
        arr = np.asarray(x, dtype=float).reshape(1, -1)
        return float(-self._clf.decision_function(arr)[0])

    def is_anomaly(self, x) -> bool:
        """True when IsolationForest predicts -1 (outlier)."""
        arr = np.asarray(x, dtype=float).reshape(1, -1)
        return bool(self._clf.predict(arr)[0] == -1)

    def save(self, path) -> None:
        joblib.dump(self, path)

    @classmethod
    def load(cls, path) -> "AnomalyModel":
        return joblib.load(path)
