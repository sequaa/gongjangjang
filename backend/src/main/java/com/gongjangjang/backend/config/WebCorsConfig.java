package com.gongjangjang.backend.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * CORS for the REST API so the Vite dev server (a different origin, e.g.
 * http://localhost:5173) can call the dashboard endpoints. The WebSocket handler
 * already allows all origins ({@code WebSocketConfig}); browsers only enforce CORS
 * on the REST fetches (readings/alarms/signals/baseline/leadtime).
 *
 * <p>Phase 3 is a local-network demo (no auth, no credentials), so all origins are
 * permitted here; Phase 4 (WEB-01) tightens this alongside auth + the Dockerised
 * single-origin deployment.
 */
@Configuration
public class WebCorsConfig implements WebMvcConfigurer {

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/api/**")
                .allowedOriginPatterns("*")
                .allowedMethods("GET", "POST", "PATCH", "OPTIONS")
                .allowedHeaders("*");
    }
}
