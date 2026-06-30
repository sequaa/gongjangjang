package com.gongjangjang.backend.signal;

import java.time.Instant;

/**
 * WebSocket push frame for a newly-created alarm. Carries the distinguishing
 * {@code type = "alarm"} field so the frontend can branch on it; reading frames
 * have no {@code type}. Built from a persisted {@link Alarm}.
 */
public record AlarmFrame(
        String type,
        long id,
        String deviceId,
        String metric,
        String detector,
        String rule,
        String severity,
        double value,
        String state,
        Instant firstOccurredAt) {

    public static AlarmFrame of(Alarm a) {
        return new AlarmFrame(
                "alarm",
                a.id(),
                a.deviceId(),
                a.metric(),
                a.detector(),
                a.rule(),
                a.severity(),
                a.value(),
                a.state().token(),
                a.firstOccurredAt());
    }
}
