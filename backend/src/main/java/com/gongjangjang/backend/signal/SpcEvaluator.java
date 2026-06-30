package com.gongjangjang.backend.signal;

import java.util.HashSet;
import java.util.Set;

/**
 * Stateful Western Electric SPC evaluator over a frozen statistical baseline.
 *
 * <p>Reads UCL/LCL/USL/LSL/mu/sigma from {@link FrozenBaseline} exactly once at
 * construction (D-05: no post-hoc recompute of limits). Maintains a rolling window
 * of size {@code windowSize} via an internal {@link SpcState}.
 *
 * <h3>Western Electric rules checked on each point</h3>
 * <ul>
 *   <li>Rule 1: point beyond ±3σ (outside frozen UCL/LCL).</li>
 *   <li>Rule 2: 2 of last 3 points beyond ±2σ on the SAME side.</li>
 *   <li>Rule 3: 4 of last 5 points beyond ±1σ on the SAME side.</li>
 *   <li>Rule 4: 8 consecutive points on the same side of mu.</li>
 * </ul>
 */
public class SpcEvaluator {

    private final FrozenBaseline baseline;
    private final SpcState state;

    public SpcEvaluator(FrozenBaseline baseline, int windowSize) {
        this.baseline = baseline;
        this.state = new SpcState(windowSize);
    }

    /**
     * Append {@code value} to the rolling window, evaluate all Western Electric rules,
     * and return the per-point {@link SpcResult}.
     */
    public SpcResult evaluate(double value) {
        double mu    = baseline.mu();
        double sigma = baseline.sigma();
        double ucl   = baseline.ucl();
        double lcl   = baseline.lcl();
        double usl   = baseline.usl();
        double lsl   = baseline.lsl();

        state.add(value, mu);

        Set<String> fired = new HashSet<>();

        // Rule 1: one point beyond 3σ (outside frozen control limits)
        if (value > ucl || value < lcl) {
            fired.add("rule_1");
        }

        // Rule 2: 2 of last 3 points beyond 2σ on the SAME side
        double[] last3 = state.lastN(3);
        int upCount2 = 0, downCount2 = 0;
        for (double v : last3) {
            if (v > mu + 2 * sigma) upCount2++;
            if (v < mu - 2 * sigma) downCount2++;
        }
        if (upCount2 >= 2 || downCount2 >= 2) {
            fired.add("rule_2");
        }

        // Rule 3: 4 of last 5 points beyond 1σ on the SAME side
        double[] last5 = state.lastN(5);
        int upCount1 = 0, downCount1 = 0;
        for (double v : last5) {
            if (v > mu + sigma) upCount1++;
            if (v < mu - sigma) downCount1++;
        }
        if (upCount1 >= 4 || downCount1 >= 4) {
            fired.add("rule_3");
        }

        // Rule 4: 8 consecutive on the same side of center line
        if (state.consecutiveUpRun() >= 8 || state.consecutiveDownRun() >= 8) {
            fired.add("rule_4");
        }

        // Rolling Cpk over the current window (sample stddev, ddof=1)
        double rollingMu    = state.rollingMean();
        double rollingSigma = state.rollingSampleStdDev();
        double rollingCpk;
        if (Double.isNaN(rollingSigma) || rollingSigma == 0.0) {
            rollingCpk = Double.NaN;
        } else {
            rollingCpk = cpk(rollingMu, rollingSigma, usl, lsl);
        }

        return new SpcResult(fired, rollingCpk, ucl, lcl);
    }

    /**
     * Pure Cpk formula: {@code min((usl - mu) / (3σ), (mu - lsl) / (3σ))}.
     *
     * <p>Calling this with the frozen baseline's mu/sigma yields a data-independent
     * constant (Pitfall 2 from 03-RESEARCH). Calling it with the rolling window's
     * mean/stddev yields the data-sensitive process-capability index.
     */
    public static double cpk(double mu, double sigma, double usl, double lsl) {
        return Math.min((usl - mu) / (3 * sigma), (mu - lsl) / (3 * sigma));
    }
}
