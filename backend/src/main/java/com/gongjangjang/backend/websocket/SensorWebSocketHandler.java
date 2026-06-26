package com.gongjangjang.backend.websocket;

import com.gongjangjang.backend.ingest.SensorReading;
import java.io.IOException;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.ObjectMapper;
import java.util.Set;
import java.util.concurrent.CopyOnWriteArraySet;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;

/**
 * Native WebSocket fan-out (D-07): one broadcast channel, no STOMP. Serializes
 * each reading once and pushes the JSON frame to every open session.
 *
 * <p>The frame is built from the in-memory {@link SensorReading} (NOT re-read from
 * the DB), so {@code publishedAtMs} reaches the client unchanged.
 *
 * <p>Session cleanup happens in BOTH {@code afterConnectionClosed} and
 * {@code handleTransportError} — missing either leaks sessions/threads under load
 * (documented pitfall in 01-RESEARCH).
 */
@Component
public class SensorWebSocketHandler extends TextWebSocketHandler {

    private static final Logger log = LoggerFactory.getLogger(SensorWebSocketHandler.class);

    private final Set<WebSocketSession> sessions = new CopyOnWriteArraySet<>();
    private final ObjectMapper objectMapper;

    public SensorWebSocketHandler(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession session) {
        sessions.add(session);
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        sessions.remove(session);
    }

    @Override
    public void handleTransportError(WebSocketSession session, Throwable exception) {
        sessions.remove(session); // must clean up here too, or sessions leak
    }

    public void broadcast(SensorReading reading) {
        final String json;
        try {
            json = objectMapper.writeValueAsString(reading); // Jackson 3: unchecked
        } catch (JacksonException e) {
            log.warn("failed to serialize reading for broadcast", e);
            return;
        }
        TextMessage frame = new TextMessage(json);
        for (WebSocketSession session : sessions) {
            if (session.isOpen()) {
                try {
                    session.sendMessage(frame);
                } catch (IOException e) {
                    sessions.remove(session);
                }
            }
        }
    }

    int openSessionCount() {
        return sessions.size();
    }
}
