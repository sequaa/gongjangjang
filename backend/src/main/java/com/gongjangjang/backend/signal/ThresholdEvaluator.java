package com.gongjangjang.backend.signal;

/**
 * Evaluates a single sensor value against the FROZEN threshold band (D-05 — no
 * post-hoc tuning). Reads only {@code thresholdMin} / {@code thresholdMax} from the
 * baseline; does not recompute limits.
 *
 * <p>Strict boundary semantics: {@code value > max} → "max_violation";
 * {@code value < min} → "min_violation"; boundary equality is normal.
 */
public class ThresholdEvaluator {

    private final FrozenBaseline baseline;

    public ThresholdEvaluator(FrozenBaseline baseline) {
        this.baseline = baseline;
    }

    /**
     * Evaluates {@code value} against the frozen threshold band.
     *
     * @param value the sensor reading to check
     * @return result carrying violation flag, rule name, and the original value
     */
    public ThresholdResult evaluate(double value) {
        if (value > baseline.thresholdMax()) {
            return new ThresholdResult(true, "max_violation", value);
        }
        if (value < baseline.thresholdMin()) {
            return new ThresholdResult(true, "min_violation", value);
        }
        return new ThresholdResult(false, null, value);
    }
}
