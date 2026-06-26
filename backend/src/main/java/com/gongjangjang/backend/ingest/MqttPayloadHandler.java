package com.gongjangjang.backend.ingest;

import java.nio.charset.StandardCharsets;
import tools.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.integration.annotation.ServiceActivator;
import org.springframework.messaging.Message;
import org.springframework.stereotype.Component;

/**
 * Parses each MQTT payload and hands it to the {@link SensorIngestPort}.
 *
 * <p>Defensive by design (V5 input validation): a malformed/oversized payload is
 * logged and dropped rather than propagated into Paho's callback thread, which
 * would otherwise silently stop all ingestion.
 */
@Component
public class MqttPayloadHandler {

    private static final Logger log = LoggerFactory.getLogger(MqttPayloadHandler.class);

    private final SensorIngestPort port;
    private final ObjectMapper objectMapper;

    public MqttPayloadHandler(SensorIngestPort port, ObjectMapper objectMapper) {
        this.port = port;
        this.objectMapper = objectMapper;
    }

    @ServiceActivator(inputChannel = "mqttInboundChannel")
    public void handle(Message<?> message) {
        try {
            Object payload = message.getPayload();
            String json =
                    payload instanceof byte[] bytes
                            ? new String(bytes, StandardCharsets.UTF_8)
                            : payload.toString();
            SensorReading reading = objectMapper.readValue(json, SensorReading.class);
            port.onReading(reading);
        } catch (Exception e) {
            log.warn("dropping malformed MQTT payload: {}", e.getMessage());
        }
    }
}
