package com.gongjangjang.backend.ingest;

/**
 * Ingestion boundary (D-05). The rest of the app depends only on this port; the
 * MQTT inbound adapter is one implementation that feeds it. A future real-equipment
 * adapter (OPC-UA, Modbus, NASA dataset replay, ...) implements the same call
 * without touching persistence or broadcast logic.
 */
public interface SensorIngestPort {
    void onReading(SensorReading reading);
}
