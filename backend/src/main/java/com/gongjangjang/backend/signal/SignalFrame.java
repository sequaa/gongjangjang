package com.gongjangjang.backend.signal;

import java.time.Instant;

/**
 * WebSocket push frame for a live SPC signal point (distinct from
 * {@link AlarmFrame}). Carries {@code type = "signal"} so the frontend overlay
 * (03-02 Task 3) can branch on it and plot the Cpk / control-state trajectory
 * live — reading frames have no {@code type}, alarm frames carry
 * {@code type = "alarm"}.
 */
public record SignalFrame(
        String type,
        String detector,
        String signalType,
        double value,
        String deviceId,
        String metric,
        Instant occurredAt) {

    public static SignalFrame of(
            String detector,
            String signalType,
            double value,
            String deviceId,
            String metric,
            Instant occurredAt) {
        return new SignalFrame("signal", detector, signalType, value, deviceId, metric, occurredAt);
    }
}
