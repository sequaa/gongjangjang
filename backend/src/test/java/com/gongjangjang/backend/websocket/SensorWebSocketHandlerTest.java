package com.gongjangjang.backend.websocket;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.gongjangjang.backend.ingest.SensorReading;
import java.time.Instant;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.Mockito;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

class SensorWebSocketHandlerTest {

    // Jackson 3: java.time support is auto-discovered via findAndAddModules().
    private final ObjectMapper objectMapper = JsonMapper.builder().findAndAddModules().build();

    @Test
    void broadcastsFrameWithPublishedAtMsPreserved() throws Exception {
        SensorWebSocketHandler handler = new SensorWebSocketHandler(objectMapper);
        WebSocketSession session = Mockito.mock(WebSocketSession.class);
        when(session.isOpen()).thenReturn(true);
        handler.afterConnectionEstablished(session);

        long publishedAtMs = 1_781_000_000_123L;
        handler.broadcast(
                new SensorReading("device-001", "temperature", 42.5, Instant.now(), publishedAtMs));

        ArgumentCaptor<TextMessage> captor = ArgumentCaptor.forClass(TextMessage.class);
        verify(session).sendMessage(captor.capture());
        String json = captor.getValue().getPayload();
        // publishedAtMs must travel unchanged into the WS frame (01-03 premise).
        assertThat(json).contains("\"publishedAtMs\":" + publishedAtMs);
        assertThat(json).contains("\"deviceId\":\"device-001\"");
        assertThat(json).contains("\"value\":42.5");
    }

    @Test
    void removesSessionOnTransportError() throws Exception {
        SensorWebSocketHandler handler = new SensorWebSocketHandler(objectMapper);
        WebSocketSession session = Mockito.mock(WebSocketSession.class);
        when(session.isOpen()).thenReturn(true);

        handler.afterConnectionEstablished(session);
        assertThat(handler.openSessionCount()).isEqualTo(1);

        handler.handleTransportError(session, new RuntimeException("boom"));
        assertThat(handler.openSessionCount()).isEqualTo(0);

        // After removal a subsequent broadcast must not touch the dead session.
        handler.broadcast(new SensorReading("d", "m", 1.0, Instant.now(), 1L));
        verify(session, never()).sendMessage(Mockito.any());
    }

    @Test
    void removesSessionOnClose() {
        SensorWebSocketHandler handler = new SensorWebSocketHandler(objectMapper);
        WebSocketSession session = Mockito.mock(WebSocketSession.class);
        handler.afterConnectionEstablished(session);
        handler.afterConnectionClosed(session, CloseStatus.NORMAL);
        assertThat(handler.openSessionCount()).isEqualTo(0);
    }
}
