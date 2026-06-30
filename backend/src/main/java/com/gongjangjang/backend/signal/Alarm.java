package com.gongjangjang.backend.signal;

import java.time.Instant;

/**
 * Persisted alarm row (D-10). {@code firstOccurredAt} is the lead-time anchor
 * (D-04): the timestamp of the first violation that opened this alarm, i.e. the
 * reading's {@code recordedAt} — NOT the insert time.
 *
 * <p>Serialized to the alarm WebSocket frame and the REST list response.
 */
public record Alarm(
        long id,
        String deviceId,
        String metric,
        String detector,
        String rule,
        String severity,
        double value,
        AlarmState state,
        Instant firstOccurredAt,
        Instant acknowledgedAt,
        Instant resolvedAt,
        Instant createdAt) {
}
