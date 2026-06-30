package com.gongjangjang.backend.signal;

import java.util.Collections;
import java.util.Set;

/**
 * Immutable per-point result returned by {@link SpcEvaluator#evaluate(double)}.
 */
public class SpcResult {

    private final Set<String> firedRules;
    private final double cpk;
    private final double ucl;
    private final double lcl;

    SpcResult(Set<String> firedRules, double cpk, double ucl, double lcl) {
        this.firedRules = Collections.unmodifiableSet(firedRules);
        this.cpk = cpk;
        this.ucl = ucl;
        this.lcl = lcl;
    }

    /** Western Electric rules fired on this point (e.g. "rule_1" … "rule_4"). Empty when none. */
    public Set<String> firedRules() { return firedRules; }

    /** Cpk computed over the current rolling window (rolling μ/σ vs frozen USL/LSL).
     *  May be {@link Double#NaN} before the window has ≥2 distinct points. */
    public double cpk() { return cpk; }

    /** Frozen UCL echoed from the baseline (D-05: no recompute). */
    public double ucl() { return ucl; }

    /** Frozen LCL echoed from the baseline (D-05: no recompute). */
    public double lcl() { return lcl; }
}
