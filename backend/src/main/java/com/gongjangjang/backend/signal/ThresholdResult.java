package com.gongjangjang.backend.signal;

/**
 * Immutable result of a single threshold evaluation.
 *
 * @param violation {@code true} when the value is outside the frozen band
 * @param rule      "max_violation" | "min_violation" | {@code null} when normal
 * @param value     the original sensor value echoed back
 */
public record ThresholdResult(boolean violation, String rule, double value) {}
