package com.gongjangjang.backend.ingest;

import java.nio.charset.StandardCharsets;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.integration.StaticMessageHeaderAccessor;
import org.springframework.integration.acks.SimpleAcknowledgment;
import org.springframework.integration.annotation.ServiceActivator;
import org.springframework.messaging.Message;
import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;

/**
 * Parses each MQTT payload and routes it to the active ingestion path.
 *
 * <p>Exactly one of {@link BatchIngestService} (batch mode) or {@link SensorIngestPort}
 * (naive mode) is present in the Spring context depending on {@code ingest.mode}.
 * Both collaborators are injected as {@link ObjectProvider} so this component starts
 * regardless of which mode is active.
 *
 * <p>Defensive by design (V5 input validation): a malformed/oversized payload is
 * logged and dropped rather than propagated into Paho's callback thread, which
 * would otherwise silently stop all ingestion.
 *
 * <p>Parse and dispatch are guarded separately to protect the zero-loss invariant
 * (D-01/D-08). On <em>parse</em> failure (dead-letter guard, T-02-03) the message is
 * immediately ack+drop+logged to prevent infinite re-delivery of permanently-malformed
 * payloads — in batch/manualAcks mode the ack header is non-null and acknowledge() is
 * called, in naive/auto-ack mode it is null (already acked by Paho) and is a no-op.
 * On <em>dispatch</em> failure (after a successful parse) the message is left un-acked
 * and the exception is swallowed: the broker re-delivers the valid reading (no data
 * loss) and Paho's callback thread is never disturbed. Never ack a successfully-parsed
 * reading until it has been safely handed off.
 */
@Component
public class MqttPayloadHandler {

    private static final Logger log = LoggerFactory.getLogger(MqttPayloadHandler.class);

    // Resolved once at construction; exactly one will be non-null per mode.
    private final BatchIngestService batchService;
    private final SensorIngestPort naivePort;
    private final ObjectMapper objectMapper;

    public MqttPayloadHandler(
            ObjectProvider<BatchIngestService> batchProvider,
            ObjectProvider<SensorIngestPort> portProvider,
            ObjectMapper objectMapper) {
        this.batchService = batchProvider.getIfAvailable();
        this.naivePort = portProvider.getIfAvailable();
        this.objectMapper = objectMapper;
    }

    @ServiceActivator(inputChannel = "mqttInboundChannel")
    public void handle(Message<?> message) {
        // Capture MQTT acknowledgment callback before parsing — non-null only in batch/manualAcks mode.
        // In naive mode Paho auto-acks on delivery so the acknowledgment header is absent (null).
        SimpleAcknowledgment ack = StaticMessageHeaderAccessor.getAcknowledgment(message);

        // PARSE — guarded separately. A parse failure means a permanently-malformed
        // payload, so we ack+drop (dead-letter guard) to avoid an infinite re-delivery loop.
        SensorReading reading;
        try {
            Object payload = message.getPayload();
            String json =
                    payload instanceof byte[] bytes
                            ? new String(bytes, StandardCharsets.UTF_8)
                            : payload.toString();
            reading = objectMapper.readValue(json, SensorReading.class);
        } catch (Exception e) {
            // Dead-letter guard (T-02-03): ack + drop + log immediately on parse failure.
            // Chosen approach: immediate ack+drop (simplest — no retry counter state).
            // Rationale: a permanently-malformed payload will never parse correctly; retrying
            // wastes throughput. Precise dead-letter queuing is deferred to Phase 4.
            log.warn("dropping malformed MQTT payload (ack+drop guard): {}", e.getMessage());
            if (ack != null) {
                try {
                    ack.acknowledge();
                } catch (Exception ignored) {
                    // Best-effort; failure here means broker re-delivers once more.
                }
            }
            return;
        }

        // DISPATCH — only after a successful parse, guarded separately. A dispatch failure
        // here must NOT ack: the reading is valid, so we leave the message un-acked and let
        // the broker re-deliver it (zero-loss invariant D-01/D-08). The exception is swallowed
        // so it never propagates into Paho's callback thread, which would silently stop ingestion.
        try {
            if (batchService != null) {
                // Batch mode: pass ack callback so BatchFlushWorker calls it after DB commit.
                // Guard for null ack (e.g. local test without manualAcks): use no-op.
                batchService.accept(reading, ack != null ? ack::acknowledge : () -> {});
            } else {
                // Naive mode: auto-ack already handled by Paho; just forward the reading.
                naivePort.onReading(reading);
            }
        } catch (Exception e) {
            log.warn("ingest dispatch failed, leaving message un-acked for re-delivery: {}", e.getMessage());
        }
    }
}
