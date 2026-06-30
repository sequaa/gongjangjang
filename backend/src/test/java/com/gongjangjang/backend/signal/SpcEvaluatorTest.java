package com.gongjangjang.backend.signal;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * RED-phase unit tests for {@link SpcEvaluator} / {@link SpcResult} / {@code SpcState}
 * (Task 1, plan 03-02 — SPC control chart: Western Electric rules + Cpk process
 * capability over a frozen baseline, D-05 no post-hoc tuning, anti-circularity per
 * 03-RESEARCH §"SPC 정확 공식" and §"Pitfall 2").
 *
 * <p><b>No Spring context.</b> {@code FrozenBaseline} is constructed directly from a
 * {@code java.nio.file.Path} (POJO-style), mirroring {@link ThresholdEvaluatorTest}.
 * The fixture is the hermetic frozen asset at
 * {@code src/test/resources/baseline.frozen.json}, resolved off the test classpath so
 * the test does not depend on the process working directory.
 *
 * <p><b>Frozen fixture values</b> (baseline.frozen.json): mu=0.077255648,
 * sigma=0.00107642, ucl=0.080484909 (=mu+3σ), lcl=0.074026387 (=mu-3σ),
 * usl=0.083714171 (=mu+6σ, k=6), lsl=0.070797125 (=mu-6σ). All σ-based zone
 * boundaries below are derived from {@code baseline.mu()} / {@code baseline.sigma()}
 * at test time — no hardcoded magic numbers — so the test stays pinned to the asset.
 *
 * <h3>API contract this RED test commits GREEN to (package {@code …signal})</h3>
 * <ul>
 *   <li>{@code new SpcEvaluator(FrozenBaseline baseline, int windowSize)} — stateful;
 *       reads frozen ucl/lcl/usl/lsl/mu/sigma from {@code baseline} only (no recompute,
 *       D-05). May delegate to an internal {@code SpcState(int windowSize)} holding the
 *       rolling window + separate UP/DOWN zone run-state (GREEN's internal choice;
 *       not exercised directly here).</li>
 *   <li>{@code SpcResult evaluate(double value)} — appends {@code value} to the rolling
 *       window, updates run-state, and returns the per-point result.</li>
 *   <li>{@code SpcResult} exposes:
 *       <ul>
 *         <li>{@code java.util.Set<String> firedRules()} — Western Electric rules fired
 *             ON THIS point, named {@code "rule_1"}, {@code "rule_2"}, {@code "rule_3"},
 *             {@code "rule_4"} (empty set when none).</li>
 *         <li>{@code double cpk()} — Cpk over the CURRENT rolling window
 *             (rolling μ/σ vs frozen USL/LSL). May be non-finite before the window
 *             fills / when window σ is 0; rule tests do not read it.</li>
 *         <li>{@code double ucl()} / {@code double lcl()} — the FROZEN limits the
 *             evaluator used (echoed straight from {@code baseline}, proving no
 *             recompute).</li>
 *       </ul></li>
 *   <li>{@code static double SpcEvaluator.cpk(double mu, double sigma, double usl,
 *       double lsl)} — pure Cpk = {@code min((usl-mu)/(3σ), (mu-lsl)/(3σ))}. Lets the
 *       anti-circularity guard call it with arbitrary (μ, σ): frozen stats → a
 *       data-independent constant (the bug); rolling stats → data-dependent.</li>
 * </ul>
 *
 * <h3>Western Electric rule definitions encoded (separate UP/DOWN sides)</h3>
 * Zone C = within ±1σ; Zone B = 1σ–2σ; Zone A = 2σ–3σ.
 * <ul>
 *   <li>Rule 1: one point beyond 3σ (&gt; ucl or &lt; lcl).</li>
 *   <li>Rule 2: 2 of 3 consecutive points beyond 2σ on the SAME side.</li>
 *   <li>Rule 3: 4 of 5 consecutive points beyond 1σ on the SAME side.</li>
 *   <li>Rule 4: 8 consecutive points on the same side of the center line (mu).</li>
 * </ul>
 */
class SpcEvaluatorTest {

    /** Rolling window large enough that the of-N rule lookbacks (last 3 / last 5) and
     *  the 8-point run all have history available. */
    private static final int RULE_WINDOW = 10;

    private static Path fixturePath() {
        try {
            return Path.of(SpcEvaluatorTest.class.getResource("/baseline.frozen.json").toURI());
        } catch (Exception e) {
            throw new IllegalStateException("test fixture baseline.frozen.json not found", e);
        }
    }

    private static FrozenBaseline baseline() {
        return new FrozenBaseline(fixturePath());
    }

    // ── Rule 1: a single point beyond 3σ ─────────────────────────────────────────

    @Test
    void rule1FiresOnSinglePointBeyondUcl() {
        FrozenBaseline b = baseline();
        SpcEvaluator spc = new SpcEvaluator(b, RULE_WINDOW);

        SpcResult result = spc.evaluate(b.ucl() + 0.001); // strictly beyond +3σ

        assertThat(result.firedRules()).contains("rule_1");
        // D-05: evaluator echoes the FROZEN limits, never recomputed.
        assertThat(result.ucl()).isEqualTo(b.ucl());
        assertThat(result.lcl()).isEqualTo(b.lcl());
    }

    @Test
    void rule1DoesNotFireForPointInsideLimits() {
        FrozenBaseline b = baseline();
        SpcEvaluator spc = new SpcEvaluator(b, RULE_WINDOW);

        SpcResult result = spc.evaluate(b.mu()); // dead center

        assertThat(result.firedRules()).doesNotContain("rule_1");
    }

    // ── Rule 2: 2 of 3 consecutive beyond 2σ on the same side ─────────────────────

    @Test
    void rule2FiresWhenTwoOfThreeBeyondTwoSigmaSameSide() {
        FrozenBaseline b = baseline();
        double beyond2Up = b.mu() + 2.5 * b.sigma(); // Zone A up, within +3σ (no rule_1)
        SpcEvaluator spc = new SpcEvaluator(b, RULE_WINDOW);

        spc.evaluate(beyond2Up);          // p1: 1 beyond up
        spc.evaluate(b.mu());             // p2: center (back inside)
        SpcResult p3 = spc.evaluate(beyond2Up); // p3: last 3 → 2 beyond up

        assertThat(p3.firedRules()).contains("rule_2");
    }

    @Test
    void rule2DoesNotFireForOppositeSides() {
        FrozenBaseline b = baseline();
        double beyond2Up = b.mu() + 2.5 * b.sigma();   // within +3σ
        double beyond2Down = b.mu() - 2.5 * b.sigma(); // within -3σ
        SpcEvaluator spc = new SpcEvaluator(b, RULE_WINDOW);

        spc.evaluate(beyond2Up);
        spc.evaluate(b.mu());
        SpcResult p3 = spc.evaluate(beyond2Down); // up + down → not same side

        assertThat(p3.firedRules()).doesNotContain("rule_2");
    }

    // ── Rule 3: 4 of 5 consecutive beyond 1σ on the same side ─────────────────────

    @Test
    void rule3FiresWhenFourOfFiveBeyondOneSigmaSameSide() {
        FrozenBaseline b = baseline();
        double beyond1Up = b.mu() + 1.5 * b.sigma(); // Zone B up, within +2σ (no rule_2)
        SpcEvaluator spc = new SpcEvaluator(b, RULE_WINDOW);

        spc.evaluate(beyond1Up); // p1
        spc.evaluate(beyond1Up); // p2
        spc.evaluate(b.mu());    // p3: center
        spc.evaluate(beyond1Up); // p4
        SpcResult p5 = spc.evaluate(beyond1Up); // p5: last 5 → 4 beyond up

        assertThat(p5.firedRules()).contains("rule_3");
    }

    // ── Rule 4: 8 consecutive on the same side of center ──────────────────────────

    @Test
    void rule4FiresOnEighthConsecutiveAboveCenterButNotSeventh() {
        FrozenBaseline b = baseline();
        double aboveCenter = b.mu() + 0.5 * b.sigma(); // Zone C up (no rule_1/2/3)
        SpcEvaluator spc = new SpcEvaluator(b, RULE_WINDOW);

        SpcResult seventh = null;
        for (int i = 0; i < 7; i++) {
            seventh = spc.evaluate(aboveCenter);
        }
        SpcResult eighth = spc.evaluate(aboveCenter);

        assertThat(seventh.firedRules()).doesNotContain("rule_4"); // 7 is not enough
        assertThat(eighth.firedRules()).contains("rule_4");        // 8 fires
    }

    // ── Cpk descent: rolling μ/σ over a degradation series ────────────────────────

    @Test
    void cpkDescendsAsRollingMeanDriftsTowardUsl() {
        FrozenBaseline b = baseline();
        double sigma = b.sigma();
        double u = 0.1 * sigma; // fixed jitter unit → constant window stddev across runs

        // Degradation: window center marches from mu up toward usl (= mu + 6σ).
        // Each window keeps the SAME deviation pattern, so only the mean moves →
        // the usl side (usl - mean)/(3σ) is binding and strictly shrinks.
        List<Double> cpks = new ArrayList<>();
        for (int step = 0; step <= 5; step++) {
            double center = b.mu() + step * sigma; // mu, mu+1σ, … mu+5σ (< usl)
            SpcEvaluator spc = new SpcEvaluator(b, 5);
            double[] deviations = {-2 * u, -u, 0, u, 2 * u};
            SpcResult last = null;
            for (double d : deviations) {
                last = spc.evaluate(center + d);
            }
            cpks.add(last.cpk());
        }

        // Healthy window Cpk > degraded window Cpk …
        assertThat(cpks.get(0)).isGreaterThan(cpks.get(cpks.size() - 1));
        // … and the whole series is strictly descending (monotone toward 0).
        for (int i = 0; i < cpks.size() - 1; i++) {
            assertThat(cpks.get(i)).isGreaterThan(cpks.get(i + 1));
        }
    }

    // ── Anti-circularity guard (03-RESEARCH Pitfall 2) ────────────────────────────

    @Test
    void cpkWithFrozenStatsIsDataIndependentConstantProvingRollingRequired() {
        FrozenBaseline b = baseline();
        double mu = b.mu();
        double sigma = b.sigma();
        double usl = b.usl();
        double lsl = b.lsl();

        // The expected constant is DERIVED FROM THE FIXTURE, not hardcoded. Because the
        // frozen asset uses k=6 (usl = mu + 6σ), frozen-on-frozen Cpk = 6σ/(3σ) ≈ 2.0,
        // NOT the textbook 1.0 (which assumes k=3). ≈ 2.000000929.
        double expectedConst = Math.min((usl - mu) / (3 * sigma), (mu - lsl) / (3 * sigma));

        // (1) Frozen μ/σ → exactly this constant.
        assertThat(SpcEvaluator.cpk(mu, sigma, usl, lsl)).isCloseTo(expectedConst, within(1e-9));

        // (2) Data independence: the BUGGY path ignores the observed window and always
        //     plugs frozen μ/σ → identical value for two DIFFERENT healthy datasets.
        double[] healthyA = {mu - 0.2 * sigma, mu + 0.2 * sigma, mu, mu - 0.1 * sigma, mu + 0.1 * sigma};
        double[] healthyB = {mu + 0.4 * sigma, mu + 0.6 * sigma, mu + 0.5 * sigma, mu + 0.45 * sigma, mu + 0.55 * sigma};
        double frozenA = SpcEvaluator.cpk(mu, sigma, usl, lsl); // ignores healthyA
        double frozenB = SpcEvaluator.cpk(mu, sigma, usl, lsl); // ignores healthyB
        assertThat(frozenB).isEqualTo(frozenA);
        assertThat(frozenA).isCloseTo(expectedConst, within(1e-9));

        // (3) The CORRECT (rolling) path DOES depend on the data → two different healthy
        //     windows yield different Cpk. This is exactly why rolling μ/σ is mandatory
        //     (frozen-on-frozen erases the signal: Pitfall 2).
        double rollA = SpcEvaluator.cpk(mean(healthyA), sampleStdDev(healthyA), usl, lsl);
        double rollB = SpcEvaluator.cpk(mean(healthyB), sampleStdDev(healthyB), usl, lsl);
        assertThat(Math.abs(rollA - rollB)).isGreaterThan(1e-6);
    }

    // ── test-local stats helpers (NOT the SUT) ───────────────────────────────────

    private static double mean(double[] xs) {
        double sum = 0;
        for (double x : xs) sum += x;
        return sum / xs.length;
    }

    private static double sampleStdDev(double[] xs) {
        double m = mean(xs);
        double ss = 0;
        for (double x : xs) ss += (x - m) * (x - m);
        return Math.sqrt(ss / (xs.length - 1));
    }
}
