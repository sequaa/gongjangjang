#!/usr/bin/env python3
"""IMS Bearing Set 2 raw .ascii -> features.csv (offline, deterministic).

Set 2 (verified against the official "Readme Document for IMS Bearing Data.pdf"
and the raw files themselves):
  - 984 files, each a 1-second snapshot of 20,480 rows x 4 channels @ 20 kHz,
    recorded every 10 minutes. Filename = timestamp YYYY.MM.DD.hh.mm.ss.
  - Channel arrangement: Bearing 1 = Ch 1, Bearing 2 = Ch 2, Bearing 3 = Ch 3,
    Bearing 4 = Ch 4. At end of run, OUTER RACE failure occurred in bearing 1.
  - We track bearing 1 = column index 0 (the failure bearing => run-to-failure trace).

Per snapshot we compute scalar vibration features on the bearing-1 channel:
  rms   = sqrt(mean(x^2))
  kurtosis = scipy.stats.kurtosis(x)            (Fisher, excess kurtosis)
  crest = peak / rms,  peak = max(abs(x))

Output columns (exact): snapshot_index, recorded_at, rms, kurtosis, crest
recorded_at = filename timestamp parsed as ISO-8601.

Requires numpy + scipy. If the active python lacks them, run with the local venv:
  data/nasa/.venv/bin/python data/nasa/preprocess.py
"""
from __future__ import annotations

import csv
import re
import sys
from datetime import datetime
from pathlib import Path

# Data filename = timestamp YYYY.MM.DD.hh.mm.ss (no extension); ignore stray files (.DS_Store).
FNAME_RE = re.compile(r"^\d{4}\.\d{2}\.\d{2}\.\d{2}\.\d{2}\.\d{2}$")

try:
    import numpy as np
    from scipy.stats import kurtosis as scipy_kurtosis
except ImportError as e:  # pragma: no cover
    sys.exit(
        f"missing dependency ({e}). install numpy+scipy, e.g.:\n"
        "  python3 -m venv data/nasa/.venv && "
        "data/nasa/.venv/bin/pip install numpy scipy\n"
        "then run: data/nasa/.venv/bin/python data/nasa/preprocess.py"
    )

HERE = Path(__file__).resolve().parent
SET2_DIR = HERE / "raw" / "2nd_test"   # IMS Set 2 (bearing 1 outer-race failure)
BEARING1_COL = 0                       # Ch 1 -> bearing 1
OUT_CSV = HERE / "features.csv"


def parse_recorded_at(filename: str) -> str:
    """'2004.02.12.10.32.39' -> ISO-8601 '2004-02-12T10:32:39'."""
    dt = datetime.strptime(filename, "%Y.%m.%d.%H.%M.%S")
    return dt.isoformat()


def main() -> None:
    if not SET2_DIR.is_dir():
        sys.exit(f"Set 2 dir not found: {SET2_DIR}\nUnzip raw IMS first (see README).")

    # Lexical filename sort == chronological (fixed-width YYYY.MM.DD.hh.mm.ss).
    files = sorted(
        p for p in SET2_DIR.iterdir() if p.is_file() and FNAME_RE.match(p.name)
    )
    if not files:
        sys.exit(f"no data files in {SET2_DIR}")

    rows = []
    for idx, path in enumerate(files):
        data = np.loadtxt(path)
        x = data[:, BEARING1_COL].astype(np.float64)
        rms = float(np.sqrt(np.mean(x ** 2)))
        peak = float(np.max(np.abs(x)))
        kurt = float(scipy_kurtosis(x))          # Fisher (excess), bias=True default
        crest = peak / rms if rms > 0 else 0.0
        rows.append(
            {
                "snapshot_index": idx,
                "recorded_at": parse_recorded_at(path.name),
                "rms": f"{rms:.10g}",
                "kurtosis": f"{kurt:.10g}",
                "crest": f"{crest:.10g}",
            }
        )

    with open(OUT_CSV, "w", newline="") as f:
        w = csv.DictWriter(
            f, fieldnames=["snapshot_index", "recorded_at", "rms", "kurtosis", "crest"]
        )
        w.writeheader()
        w.writerows(rows)

    print(f"wrote {OUT_CSV} ({len(rows)} snapshots)")


if __name__ == "__main__":
    main()
