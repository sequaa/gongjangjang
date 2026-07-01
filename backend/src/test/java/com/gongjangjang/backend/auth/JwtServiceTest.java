package com.gongjangjang.backend.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import io.jsonwebtoken.ExpiredJwtException;
import io.jsonwebtoken.security.SignatureException;
import io.jsonwebtoken.security.WeakKeyException;
import org.junit.jupiter.api.Test;

/**
 * RED-phase unit tests for {@link JwtService} — HS256 issue/verify via JJWT 0.13
 * (Task 1, plan 04-03; D-08 gate, T-04-03-01/02/04).
 *
 * <p><b>No Spring context.</b> {@code JwtService} is constructed directly from a
 * base64 secret + expiration (ms), POJO-style — no bean, no {@code @SpringBootTest}.
 * Mirrors the existing pure-JUnit5 style of {@code ThresholdEvaluatorTest}.
 *
 * <p>API this RED test commits GREEN to:
 * <ul>
 *   <li>{@code new JwtService(String base64Secret, long expirationMs)} — builds the
 *       HS256 signing key eagerly from the base64-decoded secret (a too-short secret
 *       must fail in the CONSTRUCTOR with JJWT's {@link WeakKeyException}).</li>
 *   <li>{@code String generateToken(String subject)} — subject + issuedAt +
 *       expiration(now + expirationMs), signed HS256, compacted.</li>
 *   <li>{@code String extractSubject(String token)} — verifyWith(key) then returns
 *       the subject; expired / forged tokens propagate the JJWT verification failure.</li>
 * </ul>
 */
class JwtServiceTest {

    /** 32-byte (256-bit) base64 secret → valid HS256 key. */
    private static final String VALID_SECRET = "YJCoITq8DlBkIITVK/EUT1bGnIQWDNj+bOmiWvpogW0=";
    /** A DIFFERENT valid 256-bit (32-byte) base64 secret, for the forgery path. */
    private static final String OTHER_SECRET = "UEBn1fgUd7IJ0ubrRfwxM7knfbEA2RvJPLDTi1uERZg=";
    /** base64 of 16 bytes (128-bit) → too short, must trip WeakKeyException. */
    private static final String WEAK_SECRET = "MTIzNDU2Nzg5MDEyMzQ1Ng==";

    private static final long ONE_DAY_MS = 86_400_000L;

    /** generateToken(subject) → extractSubject(token) round-trips the same subject. */
    @Test
    void generateThenExtractRoundTripsSubject() {
        JwtService service = new JwtService(VALID_SECRET, ONE_DAY_MS);
        String token = service.generateToken("admin");
        assertThat(service.extractSubject(token)).isEqualTo("admin");
    }

    /** A token whose expiration is in the past is rejected on verify. */
    @Test
    void expiredTokenIsRejected() {
        // Negative expiration → expiration = now + (negative) = already in the past.
        JwtService expiring = new JwtService(VALID_SECRET, -10_000L);
        String expired = expiring.generateToken("admin");
        assertThatThrownBy(() -> expiring.extractSubject(expired))
                .isInstanceOf(ExpiredJwtException.class);
    }

    /** A token signed with a different key fails verify (forgery). */
    @Test
    void tokenSignedWithDifferentKeyIsRejected() {
        JwtService issuer = new JwtService(OTHER_SECRET, ONE_DAY_MS);
        JwtService verifier = new JwtService(VALID_SECRET, ONE_DAY_MS);
        String forged = issuer.generateToken("admin");
        assertThatThrownBy(() -> verifier.extractSubject(forged))
                .isInstanceOf(SignatureException.class);
    }

    /** Constructing from a too-short secret surfaces the JJWT weak-key failure. */
    @Test
    void tooShortSecretIsRejectedAtConstruction() {
        assertThatThrownBy(() -> new JwtService(WEAK_SECRET, ONE_DAY_MS))
                .isInstanceOf(WeakKeyException.class);
    }
}
