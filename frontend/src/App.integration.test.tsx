import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import App from "./App";

// The plan's RT-02 automated criterion: a mock WebSocket message must update the
// grid/tiles per device. This exercises the wire useSensorSocket -> upsertDevice
// -> deviceList -> StatusGrid/ValueTiles that the split unit tests skip.
class MockWebSocket {
  static instances: MockWebSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  constructor(public url: string) {
    MockWebSocket.instances.push(this);
  }
  send() {}
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
}

function frame(deviceId: string, value: number, ms: number): string {
  return JSON.stringify({
    deviceId,
    metric: "temperature",
    value,
    recordedAt: new Date(ms).toISOString(),
    publishedAtMs: ms,
  });
}

beforeEach(() => {
  MockWebSocket.instances = [];
  vi.stubGlobal("WebSocket", MockWebSocket);
  // initial-load fetch: resolve empty so the live socket is the only source
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve({ ok: false, json: () => Promise.resolve([]) })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("App live wiring (RT-02 mock-WebSocket → grid/tiles)", () => {
  it("renders a card+tile per device and updates the value on a new frame", async () => {
    render(<App />);
    const ws = MockWebSocket.instances[0];
    expect(ws).toBeTruthy();

    await act(async () => {
      ws.onopen?.();
      ws.onmessage?.({ data: frame("device-001", 10, 1000) });
      ws.onmessage?.({ data: frame("device-002", 20, 1000) });
    });

    // both devices appear (each id shows in the grid card AND the tile)
    expect(screen.getAllByText("device-001").length).toBeGreaterThan(0);
    expect(screen.getAllByText("device-002").length).toBeGreaterThan(0);
    expect(screen.getAllByText("10.00").length).toBeGreaterThan(0);
    expect(screen.getAllByText("20.00").length).toBeGreaterThan(0);

    // a newer frame for device-001 replaces its value; device-002 is untouched
    await act(async () => {
      ws.onmessage?.({ data: frame("device-001", 42.5, 2000) });
    });

    expect(screen.getAllByText("42.50").length).toBeGreaterThan(0);
    expect(screen.queryAllByText("10.00")).toHaveLength(0);
    expect(screen.getAllByText("20.00").length).toBeGreaterThan(0);
  });
});
