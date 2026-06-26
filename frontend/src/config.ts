// Backend is reached from the BROWSER, so these are host-side URLs.
// Host 18080 maps to the backend container's 8080 (see infra/docker-compose.yml).
const httpBase =
  import.meta.env.VITE_BACKEND_HTTP ?? "http://localhost:18080";

export const BACKEND_HTTP = httpBase;
export const WS_URL =
  import.meta.env.VITE_WS_URL ?? httpBase.replace(/^http/, "ws") + "/ws/sensors";
