package com.gongjangjang.backend.signal;

/**
 * Alarm lifecycle state (D-10 state machine).
 *
 * <p>Legal transitions: CREATED -> ACKNOWLEDGED -> RESOLVED, plus the shortcut
 * CREATED -> RESOLVED. An alarm is "open" until it reaches {@link #RESOLVED}.
 */
public enum AlarmState {
    CREATED,
    ACKNOWLEDGED,
    RESOLVED;

    /** DB-stored lowercase token (matches schema-signals.sql DEFAULT 'created'). */
    public String token() {
        return name().toLowerCase();
    }

    /**
     * Parses the DB/request token to a state.
     *
     * @throws IllegalArgumentException for any unknown token (caller maps to 400)
     */
    public static AlarmState fromToken(String token) {
        if (token == null) {
            throw new IllegalArgumentException("alarm state is null");
        }
        return AlarmState.valueOf(token.trim().toUpperCase());
    }

    /** Whether {@code this -> target} is a legal transition. */
    public boolean canTransitionTo(AlarmState target) {
        return switch (this) {
            case CREATED -> target == ACKNOWLEDGED || target == RESOLVED;
            case ACKNOWLEDGED -> target == RESOLVED;
            case RESOLVED -> false;
        };
    }
}
