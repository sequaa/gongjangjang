-- Phase 3 signal/alarm persistence (D-10). Applied alongside schema.sql via
-- spring.sql.init.schema-locations. Does NOT touch sensor_readings.
--
-- alarms: state machine (created -> acknowledged -> resolved).
-- first_occurred_at is the lead-time anchor (D-04) — the timestamp of the FIRST
-- violation that opened the alarm (= reading.recorded_at), NOT insert time.
CREATE TABLE IF NOT EXISTS alarms (
    id                BIGSERIAL PRIMARY KEY,
    device_id         VARCHAR(64) NOT NULL,
    metric            VARCHAR(32) NOT NULL,
    detector          VARCHAR(16) NOT NULL,   -- 'threshold' | 'spc' | 'ml'  <- lead-time comparison key
    rule              VARCHAR(64),            -- 'max_violation' | 'min_violation' | ...
    severity          VARCHAR(16),
    value             DOUBLE PRECISION,
    state             VARCHAR(16) NOT NULL DEFAULT 'created', -- created|acknowledged|resolved
    first_occurred_at TIMESTAMPTZ NOT NULL,   -- lead-time anchor (D-10 required)
    acknowledged_at   TIMESTAMPTZ,
    resolved_at       TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_alarms_detector_first ON alarms (detector, first_occurred_at);

-- signal_events: raw signal overlay (control-limit/WE-rule/Cpk/anomaly-score),
-- kept separate from alarms for analysis flexibility.
CREATE TABLE IF NOT EXISTS signal_events (
    id          BIGSERIAL PRIMARY KEY,
    device_id   VARCHAR(64) NOT NULL,
    metric      VARCHAR(32) NOT NULL,
    detector    VARCHAR(16) NOT NULL,
    signal_type VARCHAR(32),                  -- 'control_limit'|'we_rule'|'cpk'|'anomaly_score'
    value       DOUBLE PRECISION,
    occurred_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_signal_detector_time ON signal_events (detector, occurred_at);
