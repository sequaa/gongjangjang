package com.gongjangjang.backend.signal;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Path;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * RED-phase unit tests for {@link ThresholdEvaluator} + {@link FrozenBaseline}
 * (Task 1, plan 03-01 — frozen threshold min/max violation logic, D-05 no
 * post-hoc tuning).
 *
 * <p><b>No Spring context.</b> {@code FrozenBaseline} is constructed directly
 * from a {@code java.nio.file.Path} POJO-style — no bean, no schema init, no
 * {@code @SpringBootTest}. The fixture is a hermetic copy of the frozen asset at
 * {@code src/test/resources/baseline.frozen.json} (mirrors the real
 * {@code data/nasa/baseline.frozen.json} structure: threshold.min/max,
 * control_limits.*, spec_limits.*). It is resolved off the test classpath so the
 * test does not depend on the process working directory.
 *
 * <p>API this RED test commits GREEN to:
 * <ul>
 *   <li>{@code new FrozenBaseline(java.nio.file.Path path)} — loads JSON once,
 *       getters {@code thresholdMin() thresholdMax() ucl() lcl() usl() lsl()
 *       mu() sigma()} all returning {@code double}.</li>
 *   <li>{@code new ThresholdEvaluator(FrozenBaseline baseline)} with
 *       {@code ThresholdResult evaluate(double value)}.</li>
 *   <li>{@code ThresholdResult} record: {@code boolean violation()},
 *       {@code String rule()} ("max_violation" | "min_violation" | null when
 *       normal), {@code double value()}.</li>
 * </ul>
 *
 * <p>Frozen values from baseline.frozen.json: thresholdMax=0.085867012,
 * thresholdMin=0.068644285, mu=0.077255648.
 */
class ThresholdEvaluatorTest {

    private static final double THRESHOLD_MAX = 0.085867012;
    private static final double THRESHOLD_MIN = 0.068644285;
    private static final double MU = 0.077255648;

    private ThresholdEvaluator evaluator;

    private static Path fixturePath() {
        try {
            return Path.of(
                    ThresholdEvaluatorTest.class.getResource("/baseline.frozen.json").toURI());
        } catch (Exception e) {
            throw new IllegalStateException("test fixture baseline.frozen.json not found", e);
        }
    }

    @BeforeEach
    void setUp() {
        FrozenBaseline baseline = new FrozenBaseline(fixturePath());
        evaluator = new ThresholdEvaluator(baseline);
    }

    /** FrozenBaseline loads the frozen min/max from the JSON asset. */
    @Test
    void frozenBaselineExposesThresholdMinMax() {
        FrozenBaseline baseline = new FrozenBaseline(fixturePath());
        assertThat(baseline.thresholdMax()).isEqualTo(THRESHOLD_MAX);
        assertThat(baseline.thresholdMin()).isEqualTo(THRESHOLD_MIN);
    }

    /** value > thresholdMax -> violation, rule=max_violation, value echoed. */
    @Test
    void valueAboveMaxIsMaxViolation() {
        double value = THRESHOLD_MAX + 0.01;
        ThresholdResult result = evaluator.evaluate(value);
        assertThat(result.violation()).isTrue();
        assertThat(result.rule()).isEqualTo("max_violation");
        assertThat(result.value()).isEqualTo(value);
    }

    /** value < thresholdMin -> violation, rule=min_violation, value echoed. */
    @Test
    void valueBelowMinIsMinViolation() {
        double value = THRESHOLD_MIN - 0.01;
        ThresholdResult result = evaluator.evaluate(value);
        assertThat(result.violation()).isTrue();
        assertThat(result.rule()).isEqualTo("min_violation");
        assertThat(result.value()).isEqualTo(value);
    }

    /** thresholdMin <= value <= thresholdMax (mu) -> normal, rule null. */
    @Test
    void valueWithinBandIsNormal() {
        ThresholdResult result = evaluator.evaluate(MU);
        assertThat(result.violation()).isFalse();
        assertThat(result.rule()).isNull();
        assertThat(result.value()).isEqualTo(MU);
    }

    /** Boundary: value == thresholdMax is NOT a violation (strict > only). */
    @Test
    void valueExactlyAtMaxIsNotViolation() {
        ThresholdResult result = evaluator.evaluate(THRESHOLD_MAX);
        assertThat(result.violation()).isFalse();
        assertThat(result.rule()).isNull();
    }

    /** Boundary: value == thresholdMin is NOT a violation (strict < only). */
    @Test
    void valueExactlyAtMinIsNotViolation() {
        ThresholdResult result = evaluator.evaluate(THRESHOLD_MIN);
        assertThat(result.violation()).isFalse();
        assertThat(result.rule()).isNull();
    }
}
