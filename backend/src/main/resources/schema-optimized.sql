-- schema-optimized.sql
-- Measurement-only DDL for the query spike (PERF-04 / D-04).
-- NOT auto-run at startup — applied manually by bench/query_benchmark.sh.
-- Do NOT reference in spring.sql.init or application.properties.
--
-- Creates:
--   sensor_readings_part   — RANGE-partitioned table (after state)
--   sensor_readings_flat   — flat comparison table (before state, partition toggle)
--
-- Index CREATE statements are defined here for reference;
-- the benchmark script applies them via toggle (DROP → before → CREATE → after).

-- ── Dedicated sequence (independent of backend startup) ───────────────────────
CREATE SEQUENCE IF NOT EXISTS sensor_readings_part_id_seq;

-- ── Drop existing measurement tables (re-runnable) ───────────────────────────
DROP TABLE IF EXISTS sensor_readings_part CASCADE;
DROP TABLE IF EXISTS sensor_readings_flat  CASCADE;

-- ── Partitioned table (after state) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sensor_readings_part (
    id          BIGINT           NOT NULL DEFAULT nextval('sensor_readings_part_id_seq'),
    device_id   VARCHAR(64)      NOT NULL,
    metric      VARCHAR(32)      NOT NULL,
    value       DOUBLE PRECISION NOT NULL,
    recorded_at TIMESTAMPTZ      NOT NULL,
    received_at TIMESTAMPTZ      NOT NULL DEFAULT now(),
    -- Pitfall 3: partition key (recorded_at) MUST be included in the PRIMARY KEY.
    PRIMARY KEY (id, recorded_at)
) PARTITION BY RANGE (recorded_at);

-- Monthly partitions Jan–Jul 2025 (Pitfall 4: pre-created so data distributes).
-- 3s × 5 000 000 ≈ 173 days ≈ Jan 01 → Jun 23 2025 → spans Jan–Jun partitions.
CREATE TABLE IF NOT EXISTS sensor_readings_2025_01 PARTITION OF sensor_readings_part
    FOR VALUES FROM ('2025-01-01') TO ('2025-02-01');
CREATE TABLE IF NOT EXISTS sensor_readings_2025_02 PARTITION OF sensor_readings_part
    FOR VALUES FROM ('2025-02-01') TO ('2025-03-01');
CREATE TABLE IF NOT EXISTS sensor_readings_2025_03 PARTITION OF sensor_readings_part
    FOR VALUES FROM ('2025-03-01') TO ('2025-04-01');
CREATE TABLE IF NOT EXISTS sensor_readings_2025_04 PARTITION OF sensor_readings_part
    FOR VALUES FROM ('2025-04-01') TO ('2025-05-01');
CREATE TABLE IF NOT EXISTS sensor_readings_2025_05 PARTITION OF sensor_readings_part
    FOR VALUES FROM ('2025-05-01') TO ('2025-06-01');
CREATE TABLE IF NOT EXISTS sensor_readings_2025_06 PARTITION OF sensor_readings_part
    FOR VALUES FROM ('2025-06-01') TO ('2025-07-01');
CREATE TABLE IF NOT EXISTS sensor_readings_2025_07 PARTITION OF sensor_readings_part
    FOR VALUES FROM ('2025-07-01') TO ('2025-08-01');
-- DEFAULT partition catches any out-of-range rows (Pitfall 4).
CREATE TABLE IF NOT EXISTS sensor_readings_part_default PARTITION OF sensor_readings_part
    DEFAULT;

-- ── Index definitions (toggle targets) ───────────────────────────────────────
-- Applied/dropped by bench/query_benchmark.sh — NOT applied here.
-- B-tree: (device_id, recorded_at DESC) — covers Pattern 1 (time-range + device)
--         and Pattern 2 (DISTINCT ON device_id ORDER BY device_id, recorded_at DESC).
--   CREATE INDEX idx_sr_device_time ON sensor_readings_part (device_id, recorded_at DESC);
--
-- BRIN: (recorded_at) — covers Pattern 3 (aggregation over time range).
--   Effective because data is inserted in time order → strong physical correlation.
--   CREATE INDEX idx_sr_brin_time ON sensor_readings_part USING BRIN (recorded_at);

-- ── Flat comparison table (before state for partition toggle) ─────────────────
-- Same column model as schema.sql / sensor_readings — no partitioning.
CREATE TABLE IF NOT EXISTS sensor_readings_flat (
    id          BIGSERIAL        PRIMARY KEY,
    device_id   VARCHAR(64)      NOT NULL,
    metric      VARCHAR(32)      NOT NULL,
    value       DOUBLE PRECISION NOT NULL,
    recorded_at TIMESTAMPTZ      NOT NULL,
    received_at TIMESTAMPTZ      NOT NULL DEFAULT now()
);
