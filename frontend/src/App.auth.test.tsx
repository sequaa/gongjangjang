import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { setToken, clearToken } from "./auth";

// Mirror App.integration.test.tsx's transport doubles so the live-mode hook
// (useSensorSocket) has a WebSocket + fetch to talk to while we assert the GATE.
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

const DASH_HEADING = "설비 센서 실시간 모니터링";
const loginVisible = () => document.querySelector('input[name="password"]') !== null;

/** Import App fresh so the module-level `DEMO` const re-reads the stubbed env. */
async function loadApp() {
  vi.resetModules();
  const mod = await import("./App");
  return mod.default;
}

beforeEach(() => {
  localStorage.clear();
  MockWebSocket.instances = [];
  vi.stubGlobal("WebSocket", MockWebSocket);
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve({ ok: false, status: 200, json: () => Promise.resolve([]) })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  localStorage.clear();
});

describe("App auth gate (live mode)", () => {
  it("renders LoginPage and not the dashboard when there is no token", async () => {
    vi.stubEnv("VITE_DEMO_MODE", "");
    const App = await loadApp();

    await act(async () => {
      render(<App />);
    });

    expect(loginVisible()).toBe(true);
    expect(screen.queryByText(DASH_HEADING)).not.toBeInTheDocument();
  });

  it("renders the dashboard (no re-login) when a token is already in localStorage", async () => {
    vi.stubEnv("VITE_DEMO_MODE", "");
    setToken("persisted-jwt"); // simulates a refresh: token survived in localStorage
    const App = await loadApp();

    await act(async () => {
      render(<App />);
    });

    expect(screen.getByText(DASH_HEADING)).toBeInTheDocument();
    expect(loginVisible()).toBe(false);
  });

  it("logout clears the token and returns to LoginPage", async () => {
    vi.stubEnv("VITE_DEMO_MODE", "");
    setToken("persisted-jwt");
    const App = await loadApp();

    await act(async () => {
      render(<App />);
    });
    expect(screen.getByText(DASH_HEADING)).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /로그아웃|logout/i }));
    });

    expect(localStorage.length).toBe(0);
    expect(loginVisible()).toBe(true);
    expect(screen.queryByText(DASH_HEADING)).not.toBeInTheDocument();
  });
});

describe("App demo mode (D-09: no gate)", () => {
  it("renders the dashboard with NO token and never shows LoginPage", async () => {
    vi.stubEnv("VITE_DEMO_MODE", "true");
    clearToken();
    const App = await loadApp();

    await act(async () => {
      render(<App />);
    });

    expect(screen.getByText(DASH_HEADING)).toBeInTheDocument();
    expect(loginVisible()).toBe(false);
  });
});
