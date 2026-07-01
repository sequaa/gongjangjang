package com.gongjangjang.backend.auth;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Authentication endpoint. Accepts JSON {@code {username, password}} and returns
 * a signed JWT on success, or 401 on failure.
 */
@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private final String adminUsername;
    private final String adminPassword;
    private final JwtService jwtService;

    public AuthController(
            @Value("${auth.admin.username}") String adminUsername,
            @Value("${auth.admin.password}") String adminPassword,
            JwtService jwtService) {
        this.adminUsername = adminUsername;
        this.adminPassword = adminPassword;
        this.jwtService = jwtService;
    }

    @PostMapping("/login")
    public ResponseEntity<?> login(@RequestBody LoginRequest body) {
        boolean usernameMatch = MessageDigest.isEqual(
                adminUsername.getBytes(StandardCharsets.UTF_8),
                body.username().getBytes(StandardCharsets.UTF_8));
        boolean passwordMatch = MessageDigest.isEqual(
                adminPassword.getBytes(StandardCharsets.UTF_8),
                body.password().getBytes(StandardCharsets.UTF_8));

        if (!usernameMatch || !passwordMatch) {
            return ResponseEntity.status(401).build();
        }

        String token = jwtService.generateToken(body.username());
        return ResponseEntity.ok(Map.of("token", token, "subject", body.username()));
    }

    record LoginRequest(String username, String password) {}
}
