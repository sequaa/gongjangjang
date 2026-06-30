package com.gongjangjang.backend.signal;

import java.util.ArrayDeque;
import java.util.Deque;

/**
 * Internal rolling-window and Western Electric run-state for {@link SpcEvaluator}.
 * Holds the last {@code windowSize} values plus separate UP/DOWN consecutive-run counters.
 */
class SpcState {

    private final int windowSize;
    private final Deque<Double> window;
    private int consecutiveUpRun;   // consecutive points strictly above mu
    private int consecutiveDownRun; // consecutive points strictly below mu

    SpcState(int windowSize) {
        this.windowSize = windowSize;
        this.window = new ArrayDeque<>(windowSize + 1);
    }

    /**
     * Append {@code value} to the rolling window, evict the oldest if full,
     * and update the consecutive same-side run counters for Rule 4.
     */
    void add(double value, double mu) {
        window.addLast(value);
        if (window.size() > windowSize) {
            window.removeFirst();
        }
        if (value > mu) {
            consecutiveUpRun++;
            consecutiveDownRun = 0;
        } else if (value < mu) {
            consecutiveDownRun++;
            consecutiveUpRun = 0;
        } else {
            // exactly on the center line — resets both sides
            consecutiveUpRun = 0;
            consecutiveDownRun = 0;
        }
    }

    /**
     * Returns the last {@code n} values in chronological order,
     * or fewer if the window has not yet accumulated {@code n} entries.
     */
    double[] lastN(int n) {
        Double[] all = window.toArray(new Double[0]);
        int size = Math.min(n, all.length);
        double[] result = new double[size];
        int start = all.length - size;
        for (int i = 0; i < size; i++) {
            result[i] = all[start + i];
        }
        return result;
    }

    int consecutiveUpRun()   { return consecutiveUpRun; }
    int consecutiveDownRun() { return consecutiveDownRun; }

    double rollingMean() {
        if (window.isEmpty()) return 0.0;
        double sum = 0.0;
        for (double v : window) sum += v;
        return sum / window.size();
    }

    /** Sample standard deviation (ddof=1). Returns {@link Double#NaN} when window size < 2. */
    double rollingSampleStdDev() {
        if (window.size() < 2) return Double.NaN;
        double m = rollingMean();
        double ss = 0.0;
        for (double v : window) ss += (v - m) * (v - m);
        return Math.sqrt(ss / (window.size() - 1));
    }
}
