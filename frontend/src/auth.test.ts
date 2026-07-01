import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
// ./auth does NOT exist yet — this import is the RED failure driver.
import { getToken, setToken, clearToken, authFetch } from "./auth";

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("auth token store", () => {
  it("round-trips setToken/getToken/clearToken through localStorage", () => {
    expect(getToken()).toBeNull();
    setToken("jwt-abc");
    expect(getToken()).toBe("jwt-abc");
    clearToken();
    expect(getToken()).toBeNull();
  });
});

describe("authFetch", () => {
  it("attaches Authorization: Bearer <token> to the request headers", async () => {
    const fetchMock = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) }),
    );
    vi.stubGlobal("fetch", fetchMock);
    setToken("jwt-xyz");

    await authFetch("http://localhost:18080/api/readings");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = new Headers(init?.headers);
    expect(headers.get("Authorization")).toBe("Bearer jwt-xyz");
  });

  it("clears the stored token when the response status is 401", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({}) }),
    );
    vi.stubGlobal("fetch", fetchMock);
    setToken("expired-jwt");

    const res = await authFetch("http://localhost:18080/api/alarms");

    expect(res.status).toBe(401);
    expect(getToken()).toBeNull();
  });
});
