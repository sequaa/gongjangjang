-- seed-query-data.sql
-- Inserts 5 000 000 rows into sensor_readings_part AND sensor_readings_flat
-- with identical data (D-04/Pitfall 5 fairness — same rows, same distribution).
--
-- Data characteristics:
--   • 10 devices: 'device-1' .. 'device-10'  (g % 10) + 1
--   • metric: 'temperature', value: 20.0 + random() * 15
--   • recorded_at: 2025-01-01 + g * 3s  →  ~173 days → spans Jan–Jun 2025
--     (covers partitions 2025_01..2025_06 — Pitfall 4: data distributed)
--
-- Expected seed time: ~30–90 seconds depending on disk speed.

-- ── Partitioned table ─────────────────────────────────────────────────────────
INSERT INTO sensor_readings_part (device_id, metric, value, recorded_at, received_at)
SELECT
    'device-' || ((g % 10) + 1),
    'temperature',
    20.0 + random() * 15,
    TIMESTAMP '2025-01-01 00:00:00' + (g * INTERVAL '3 seconds'),
    now()
FROM generate_series(1, 5000000) AS t(g);

-- ── Flat table (identical rows — partition toggle fairness) ───────────────────
INSERT INTO sensor_readings_flat (device_id, metric, value, recorded_at, received_at)
SELECT
    'device-' || ((g % 10) + 1),
    'temperature',
    20.0 + random() * 15,
    TIMESTAMP '2025-01-01 00:00:00' + (g * INTERVAL '3 seconds'),
    now()
FROM generate_series(1, 5000000) AS t(g);

-- ── Update planner statistics (EXPLAIN accuracy) ─────────────────────────────
ANALYZE sensor_readings_part;
ANALYZE sensor_readings_flat;
