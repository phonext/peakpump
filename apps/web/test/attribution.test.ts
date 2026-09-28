import { describe, expect, it } from "vitest";

import { splitAtYear } from "@/components/layout/attribution-year";
import { FOOTER_ATTRIBUTION, TRADINGVIEW_ATTRIBUTION_URL } from "@peakpump/shared/brand";

// The notice is the one string in the product that may not be reflowed, reworded or
// paraphrased, and the component cuts it into pieces so a single digit can change
// family. This is the guard that the cutting is lossless: every slice below is read
// back out of the real generated constant, and the assertion is on the join.

describe("the attribution year split is lossless", () => {
  it("rejoins the installed NOTICE character for character", () => {
    const [before = "", after = ""] = FOOTER_ATTRIBUTION.split(TRADINGVIEW_ATTRIBUTION_URL);
    const year = splitAtYear(before);

    expect(year).not.toBeNull();
    if (year === null) return;

    expect(year.head + year.year + year.tail).toBe(before);
    expect(before + TRADINGVIEW_ATTRIBUTION_URL + after).toBe(FOOTER_ATTRIBUTION);
  });

  it("selects the copyright year and leaves the rest in order", () => {
    const [before = ""] = FOOTER_ATTRIBUTION.split(TRADINGVIEW_ATTRIBUTION_URL);
    const year = splitAtYear(before);
    if (year === null) throw new Error("the installed NOTICE carries no year");

    expect(year.year).toBe("2025");
    expect(year.head.endsWith("(с) ")).toBe(true);
    expect(year.tail.startsWith(" TradingView")).toBe(true);
  });

  it("returns null rather than a partial split when there is no year", () => {
    expect(splitAtYear("No digits in this sentence.")).toBeNull();
  });

  it("keeps a NOTICE whose year differs intact", () => {
    // The installed NOTICE is generated at build time and its year moves with the
    // upstream version. A future year must round-trip the way 2025 does, or the span
    // above would silently corrupt a notice this product cannot reword.
    const future = FOOTER_ATTRIBUTION.replace("2025", "2099");
    const [before = ""] = future.split(TRADINGVIEW_ATTRIBUTION_URL);
    const year = splitAtYear(before);
    if (year === null) throw new Error("a substituted year was not found");

    expect(year.year).toBe("2099");
    expect(year.head + year.year + year.tail).toBe(before);
  });
});

