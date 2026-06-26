import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusGrid } from "./StatusGrid";
import { ValueTiles } from "./ValueTiles";
import type { DeviceSnapshot } from "../deviceState";

function snap(deviceId: string, value: number): DeviceSnapshot {
  return {
    deviceId,
    metric: "temperature",
    value,
    recordedAt: new Date(1000).toISOString(),
    publishedAtMs: 1000,
    lastUpdateMs: Date.now(),
  };
}

describe("StatusGrid (RT-02)", () => {
  it("renders one card per device", () => {
    const devices = [snap("device-001", 10), snap("device-002", 20)];
    render(<StatusGrid devices={devices} />);
    expect(screen.getByText("device-001")).toBeInTheDocument();
    expect(screen.getByText("device-002")).toBeInTheDocument();
  });

  it("reflects the latest value per device on re-render", () => {
    const { rerender } = render(<StatusGrid devices={[snap("device-001", 10)]} />);
    expect(screen.getByText("10.00")).toBeInTheDocument();
    rerender(<StatusGrid devices={[snap("device-001", 42.5)]} />);
    expect(screen.getByText("42.50")).toBeInTheDocument();
    expect(screen.queryByText("10.00")).not.toBeInTheDocument();
  });
});

describe("ValueTiles (RT-02)", () => {
  it("shows a current-value tile per device", () => {
    render(<ValueTiles devices={[snap("device-001", 7.25), snap("device-002", 99.9)]} />);
    expect(screen.getByText("7.25")).toBeInTheDocument();
    expect(screen.getByText("99.90")).toBeInTheDocument();
  });
});
