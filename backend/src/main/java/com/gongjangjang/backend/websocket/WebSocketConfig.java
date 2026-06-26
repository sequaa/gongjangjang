package com.gongjangjang.backend.websocket;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;

@Configuration
@EnableWebSocket
public class WebSocketConfig implements WebSocketConfigurer {

    private final SensorWebSocketHandler handler;

    public WebSocketConfig(SensorWebSocketHandler handler) {
        this.handler = handler;
    }

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        // No auth / any origin is an accepted skeleton-stage tradeoff (Phase 4 adds JWT).
        registry.addHandler(handler, "/ws/sensors").setAllowedOrigins("*");
    }
}
