package com.gongjangjang.backend.auth;

import io.jsonwebtoken.JwtException;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.Collections;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Reads the {@code Authorization: Bearer <token>} header, verifies via {@link JwtService},
 * and sets an authenticated principal into {@link SecurityContextHolder}.
 *
 * <p>Registered as a Spring bean ({@code @Component}) so {@link SecurityConfig} can
 * inject it and place it in the security filter chain via {@code addFilterBefore}.
 * {@code SecurityConfig.jwtAuthFilterRegistration()} ({@code setEnabled(false)})
 * suppresses Boot's automatic servlet-level registration, so it runs ONLY inside
 * the security filter chain (never double-registered).
 */
@Component
public class JwtAuthFilter extends OncePerRequestFilter {

    private final JwtService jwtService;

    public JwtAuthFilter(JwtService jwtService) {
        this.jwtService = jwtService;
    }

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain filterChain) throws ServletException, IOException {

        String header = request.getHeader("Authorization");
        if (header != null && header.startsWith("Bearer ")) {
            String token = header.substring(7);
            try {
                String subject = jwtService.extractSubject(token);
                if (subject != null && SecurityContextHolder.getContext().getAuthentication() == null) {
                    UsernamePasswordAuthenticationToken auth =
                            new UsernamePasswordAuthenticationToken(subject, null, Collections.emptyList());
                    SecurityContextHolder.getContext().setAuthentication(auth);
                }
            } catch (JwtException | IllegalArgumentException ignored) {
                // Invalid/expired token — do not authenticate; let the security chain handle it.
            }
        }

        filterChain.doFilter(request, response);
    }
}
