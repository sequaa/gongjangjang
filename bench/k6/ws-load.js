// bench/k6/ws-load.js
// WebSocket concurrency load — D-09 (Task 1)
// executor: constant-vus, 20 VUs, 2m duration
// connects to ws://localhost:18080/ws/sensors, checks status 101
import ws from 'k6/ws';
import { check } from 'k6';

// In-network compose target via `environment: WS_URL`; host-run default preserved
// (Phase 2/3 host bench). k6 reads system env into __ENV for `k6 run`.
const WS_URL = __ENV.WS_URL ?? 'ws://localhost:18080/ws/sensors';

export const options = {
  scenarios: {
    ws_concurrency: {
      executor: 'constant-vus',
      vus: 20,
      duration: '2m',
    },
  },
};

export default function () {
  const res = ws.connect(WS_URL, {}, function (socket) {
    socket.on('open', () => socket.setTimeout(() => socket.close(), 90000));
    socket.on('message', () => { /* count received — k6 tracks via ws_msgs_received */ });
    socket.on('error', (e) => { /* surface in summary */ });
  });
  check(res, { 'WS connected (101)': (r) => r && r.status === 101 });
}
