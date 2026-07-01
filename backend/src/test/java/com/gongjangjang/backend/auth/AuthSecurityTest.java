package com.gongjangjang.backend.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.gongjangjang.backend.config.SecurityConfig;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;

/**
 * Controller-scoped security slice (D-08 / D-10). Pins AuthController so the slice
 * does not load every @RestController (each needs a repository bean this slice lacks).
 * The explicit @Import({SecurityConfig, JwtAuthFilter, JwtService}) guards against
 * falling back to Boot's default security (which would 200 everything = false green).
 */
@WebMvcTest(AuthController.class)
@Import({SecurityConfig.class, JwtAuthFilter.class, JwtService.class})
@TestPropertySource(
        properties = {
            "auth.admin.username=admin",
            "auth.admin.password=s3cretPw",
            "auth.jwt.secret=UEBn1fgUd7IJ0ubrRfwxM7knfbEA2RvJPLDTi1uERZg=",
            "auth.jwt.expiration-ms=86400000",
            "auth.cors.allowed-origins=http://localhost:5173"
        })
class AuthSecurityTest {

    private static final String ORIGIN = "http://localhost:5173";

    @Autowired private MockMvc mvc;
    @Autowired private JwtService jwtService;
    @Autowired private CorsConfigurationSource corsConfigurationSource;

    // --- Behavior 1: login ---------------------------------------------------

    @Test
    void loginWithValidAdminCredentialsReturns200AndNonEmptyToken() throws Exception {
        mvc.perform(
                        post("/api/auth/login")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"username\":\"admin\",\"password\":\"s3cretPw\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.token").isNotEmpty());
    }

    @Test
    void loginWithWrongPasswordReturns401() throws Exception {
        mvc.perform(
                        post("/api/auth/login")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"username\":\"admin\",\"password\":\"wrong\"}"))
                .andExpect(status().isUnauthorized());
    }

    // --- Behavior 2: protected REST gate ------------------------------------

    @Test
    void protectedEndpointWithoutAuthorizationReturns401() throws Exception {
        // anyRequest().authenticated() runs before routing → 401 precedes 404.
        mvc.perform(get("/api/alarms")).andExpect(status().isUnauthorized());
    }

    @Test
    void protectedEndpointWithValidBearerIsNotUnauthorized() throws Exception {
        String token = jwtService.generateToken("admin");
        mvc.perform(get("/api/alarms").header("Authorization", "Bearer " + token))
                .andExpect(status().is(not401()));
    }

    // --- Behavior 3: single-origin CORS, no wildcard ------------------------

    @Test
    void corsConfigurationSourceAllowsOnlyConfiguredOriginNoWildcard() {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/alarms");
        request.addHeader("Origin", ORIGIN);
        CorsConfiguration cfg = corsConfigurationSource.getCorsConfiguration(request);

        assertThat(cfg).isNotNull();
        assertThat(cfg.getAllowedOrigins()).containsExactly(ORIGIN);
        assertThat(cfg.getAllowedOrigins()).doesNotContain("*");
    }

    // --- Behavior 4: permit list vs. gate everything else -------------------

    @Test
    void chainPermitsLoginWsAndHealthButGatesEverythingElse() throws Exception {
        // Permitted paths: no auth → never 401 (404 in this slice is fine).
        mvc.perform(get("/ws/sensors")).andExpect(status().is(not401()));
        mvc.perform(get("/actuator/health")).andExpect(status().is(not401()));
        // POST /api/auth/login is reachable without auth (exercised above with 200/401).
        // Any other path with no token → gated.
        mvc.perform(get("/api/readings")).andExpect(status().isUnauthorized());
    }

    private static org.hamcrest.Matcher<Integer> not401() {
        return org.hamcrest.Matchers.not(401);
    }
}
