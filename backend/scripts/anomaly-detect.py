#!/usr/bin/env python3
"""
backend/scripts/anomaly-detect.py

Reads a JSON feature array from stdin, runs IsolationForest on a
3-column matrix [mtbf, mttr, cost], and writes results to stdout.

Input  (stdin):
    {"features": [{"mtbf": 30, "mttr": 8, "cost": 5000, "technicianId": "T1"}, ...]}

Output (stdout):
    {"anomalies": [false, false, true, false, ...]}
    (boolean per record — true = anomalous)

Edge cases:
    - Fewer than 5 records → return all false (not enough data to model)
    - NaN / null / missing values → replaced with 0
"""

import sys
import json
import math


def safe_float(value):
    """Convert value to float, returning 0.0 for None / NaN / non-numeric."""
    try:
        v = float(value)
        return 0.0 if math.isnan(v) or math.isinf(v) else v
    except (TypeError, ValueError):
        return 0.0


def main():
    # ── 1. Read JSON from stdin ───────────────────────────────────────────────
    try:
        raw = sys.stdin.read().strip()
        if not raw:
            raise ValueError("Empty stdin")
        payload = json.loads(raw)
    except Exception as e:
        sys.stderr.write(f"[anomaly-detect] Failed to read input: {e}\n")
        print(json.dumps({"anomalies": [], "error": str(e)}))
        sys.exit(1)

    features = payload.get("features", [])
    n = len(features)

    # ── 2. Edge case: fewer than 5 records ───────────────────────────────────
    if n < 5:
        sys.stderr.write(f"[anomaly-detect] Only {n} records — need ≥ 5 for IsolationForest. Returning all-false.\n")
        print(json.dumps({"anomalies": [False] * n}))
        sys.exit(0)

    # ── 3. Build N×3 feature matrix [mtbf, mttr, cost] ───────────────────────
    try:
        import numpy as np

        X = np.array([
            [
                safe_float(r.get("mtbf")),
                safe_float(r.get("mttr")),
                safe_float(r.get("cost")),
            ]
            for r in features
        ], dtype=float)

    except ImportError:
        sys.stderr.write("[anomaly-detect] numpy not available\n")
        print(json.dumps({"anomalies": [False] * n, "error": "numpy not installed"}))
        sys.exit(1)

    # ── 4. Run IsolationForest ────────────────────────────────────────────────
    try:
        from sklearn.ensemble import IsolationForest

        model = IsolationForest(
            n_estimators=100,
            contamination=0.1,   # expect ~10% anomalies
            random_state=42,
        )

        preds = model.fit_predict(X)
        # IsolationForest: -1 = anomaly, +1 = normal
        anomalies = [bool(p == -1) for p in preds]

    except ImportError:
        sys.stderr.write("[anomaly-detect] scikit-learn not available\n")
        print(json.dumps({"anomalies": [False] * n, "error": "scikit-learn not installed"}))
        sys.exit(1)

    except Exception as e:
        sys.stderr.write(f"[anomaly-detect] IsolationForest failed: {e}\n")
        print(json.dumps({"anomalies": [False] * n, "error": str(e)}))
        sys.exit(1)

    # ── 5. Output JSON to stdout ──────────────────────────────────────────────
    print(json.dumps({"anomalies": anomalies}))
    sys.exit(0)


if __name__ == "__main__":
    main()
