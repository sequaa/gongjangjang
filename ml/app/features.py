"""Feature extraction: fixed-order [rms, kurtosis, crest]."""


def feature_vector(reading: dict) -> list[float]:
    """Return [rms, kurtosis, crest] from a reading dict."""
    return [float(reading["rms"]), float(reading["kurtosis"]), float(reading["crest"])]
