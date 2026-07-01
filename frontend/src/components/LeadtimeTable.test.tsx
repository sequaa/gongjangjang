import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { LeadtimeTable } from "./LeadtimeTable";

// D-05: after simplification LeadtimeTable renders the bundled offline leadtime
// numbers directly (no /api/leadtime fetch) and drops the amber "예시용
// (first-touch)" caveat block. RED: the current component fetches on mount and
// shows "로딩 중…", so the number/fetch assertions below fail.

beforeEach(() => {
  // Any fetch on this component is a bug once simplified — spy so we can assert 0.
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: false, json: () => Promise.resolve([]) })));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// Substring regexes: match "74.17" whether rendered bare or with a unit ("74.17h"),
// but reject a toFixed(1) impl that would round 74.17 → 74.2 (enforces D-05
// verbatim). Values chosen to avoid trailing-zero floats (61.0/71.0 render as
// "61"/"71"), one per detector: spc, threshold, ml.
describe("LeadtimeTable (D-05 bundled offline numbers)", () => {
  it("renders the bundled leadtime.json numbers without a fetch or first-touch caveat", () => {
    const fetchSpy = fetch as unknown as ReturnType<typeof vi.fn>;

    render(<LeadtimeTable />);

    // Verbatim lead_time_hours from demo/leadtime.json (spc K1, threshold K1, ml K5).
    expect(screen.getByText(/96\.67/)).toBeInTheDocument();
    expect(screen.getByText(/74\.17/)).toBeInTheDocument();
    expect(screen.getByText(/58\.33/)).toBeInTheDocument();

    // primary_finding is a fixed string that cannot be reformatted.
    expect(screen.getByText(/most defensible detector/)).toBeInTheDocument();

    // The amber first-touch warning block is gone.
    expect(screen.queryByText(/first-touch/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/예시용/)).not.toBeInTheDocument();

    // No backend dependency (D-04 / D-05).
    expect(fetchSpy).toHaveBeenCalledTimes(0);
  });
});
