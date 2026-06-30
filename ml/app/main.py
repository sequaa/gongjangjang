"""FastAPI service: POST /score, GET /health."""

import os
from typing import List

from fastapi import FastAPI
from pydantic import BaseModel

from app.model import AnomalyModel

_model_path = os.environ.get("ML_MODEL_PATH", "model.joblib")
_model: AnomalyModel = AnomalyModel.load(_model_path)

app = FastAPI()


class ScoreRequest(BaseModel):
    features: List[float]


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/score")
def score(req: ScoreRequest):
    return {
        "anomaly_score": _model.anomaly_score(req.features),
        "is_anomaly": _model.is_anomaly(req.features),
    }
