# FastAPI anomaly-scoring service (03-03) containerized for the one-click stack
# (OPS-01 / D-17). NARROW COPY only — never `COPY . .`: that would drag the mac
# host .venv binaries, __pycache__ and .pytest_cache into the image and risk not
# shipping model.joblib. The explicit copies below guarantee model.joblib ships
# so AnomalyModel.load succeeds at import, and app.model is importable under
# WORKDIR /app for the joblib unpickle. No host port is published for this
# service in compose — /score is unauthenticated and stays network-internal.
FROM python:3.13-slim

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY model.joblib ./

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
