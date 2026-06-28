// bench/k6/ws-load.js
// WebSocket concurrency load — D-09 (Task 1)
// executor: constant-vus, 20 VUs, 2m duration
// connects to ws://localhost:18080/ws/sensors, checks status 101
import ws from 'k6/ws';
import { check } from 'k6';

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
  const res = ws.connect('ws://localhost:18080/ws/sensors', {}, function (socket) {
    socket.on('open', () => socket.setTimeout(() => socket.close(), 90000));
    socket.on('message', () => { /* count received — k6 tracks via ws_msgs_received */ });
    socket.on('error', (e) => { /* surface in summary */ });
  });
  check(res, { 'WS connected (101)': (r) => r && r.status === 101 });
}
