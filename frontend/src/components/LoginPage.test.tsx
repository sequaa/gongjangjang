import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
// ./LoginPage does NOT exist yet — this import is the RED failure driver.
import { LoginPage } from "./LoginPage";
import { getToken } from "../auth";

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

/** Fill the controlled username/password fields and submit the form. */
function submitCreds(user: string, pass: string) {
  const username = document.querySelector('input[name="username"]') as HTMLInputElement;
  const password = document.querySelector('input[name="password"]') as HTMLInputElement;
  expect(username).toBeTruthy();
  expect(password).toBeTruthy();
  fireEvent.change(username, { target: { value: user } });
  fireEvent.change(password, { target: { value: pass } });
  fireEvent.click(screen.getByRole("button"));
}

describe("LoginPage", () => {
  it("stores the token and calls onLogin when the POST returns 200 + token", async () => {
    const fetchMock = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ token: "jwt-good" }),
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const onLogin = vi.fn();

    render(<LoginPage onLogin={onLogin} />);
    await act(async () => {
      submitCreds("admin", "changeme");
    });

    // posts to the login endpoint
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/api/auth/login");
    // token stored + success signalled
    expect(getToken()).toBe("jwt-good");
    expect(onLogin).toHaveBeenCalled();
  });

  it("shows an error and stores nothing when the POST returns 401", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: false,
        status: 401,
        json: () => Promise.resolve({}),
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const onLogin = vi.fn();

    render(<LoginPage onLogin={onLogin} />);
    await act(async () => {
      submitCreds("admin", "wrong");
    });

    expect(onLogin).not.toHaveBeenCalled();
    expect(getToken()).toBeNull();
    // an inline error is surfaced to the user
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});
