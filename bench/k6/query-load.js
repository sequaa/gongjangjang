// bench/k6/query-load.js
// HTTP /api/readings concurrency load — D-09 (Task 1)
// executor: constant-vus, 50 VUs, 2m duration
// thresholds: p(99)<500ms (D-02), http_req_failed rate<0.01
import http from 'k6/http';
import { check } from 'k6';

// In-network compose target via `environment: BASE_URL`; host-run default preserved.
const BASE_URL = __ENV.BASE_URL ?? 'http://localhost:18080';

export const options = {
  scenarios: {
    query_load: {
      executor: 'constant-vus',
      vus: 50,
      duration: '2m',
    },
  },
  thresholds: {
    http_req_duration: ['p(99)<500'],
    http_req_failed: ['rate<0.01'],
  },
};

export default function () {
  const res = http.get(`${BASE_URL}/api/readings?limit=50`);
  check(res, { 'status 200': (r) => r.status === 200 });
}
