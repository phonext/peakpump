import { describe, expect, it } from "vitest";

import { defaultInterval } from "@/components/chart/interval-default";

// The thresholds the module grades on, restated so a test that drifts with them is
// visible as a change to the rule rather than a silent literal.
const DAY = 86_400n;
const WEEK = 7n * DAY;

describe("the interval a market opens on", () => {
  it("grades a market in its first day to five minutes", () => {
    expect(defaultInterval(0n)).toBe("5m");
    expect(defaultInterval(60n)).toBe("5m");
    expect(defaultInterval(DAY - 60n)).toBe("5m");
  });

  it("grades a market past its first day and inside its first week to an hour", () => {
    expect(defaultInterval(DAY)).toBe("1h");
    expect(defaultInterval(DAY + 60n)).toBe("1h");
    expect(defaultInterval(WEEK - 60n)).toBe("1h");
  });

  it("grades a market past its first week to a day", () => {
    expect(defaultInterval(WEEK)).toBe("1d");
    expect(defaultInterval(WEEK + DAY)).toBe("1d");
    expect(defaultInterval(365n * DAY)).toBe("1d");
  });

  it("never answers outside the four intervals the chart offers", () => {
    for (const age of [0n, 60n, DAY, WEEK, 30n * WEEK]) {
      expect(defaultInterval(age)).toMatch(/^(1m|5m|1h|1d)$/);
    }
  });

  it("crosses each threshold exactly once and in order", () => {
    // The boundaries themselves, ascending: the first bucket past a threshold is
    // the one that changes, and nothing before the day or before the week moves
    // twice.
    expect(defaultInterval(DAY - 1n)).toBe("5m");
    expect(defaultInterval(DAY)).toBe("1h");
    expect(defaultInterval(WEEK - 1n)).toBe("1h");
    expect(defaultInterval(WEEK)).toBe("1d");
  });
});
