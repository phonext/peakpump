import { describe, expect, it } from "vitest";

import {
  PRODUCT_NAME,
  FOOTER_TRADEMARK,
  FOOTER_TESTNET,
  FOOTER_ATTRIBUTION,
  FOOTER_BLOCKS,
  TRADINGVIEW_ATTRIBUTION_URL,
} from "../src/brand";
import { TRADINGVIEW_NOTICE } from "../src/tradingview-notice.generated";

// Guards the footer wording. Blocks 1 and 2 are transcribed verbatim; block 3
// must be exactly the generated attribution (never paraphrased or doc-sourced).

describe("brand footer", () => {
  it("names the product peakpump", () => {
    expect(PRODUCT_NAME).toBe("peakpump");
  });

  it("carries block 1 (Circle trademark) verbatim", () => {
    expect(FOOTER_TRADEMARK).toBe(
      "Arc is a trademark of Circle Internet Group, Inc. peakpump is an independent project, not affiliated with, endorsed by, or sponsored by Circle.",
    );
  });

  it("carries block 2 (testnet disclaimer) verbatim", () => {
    expect(FOOTER_TESTNET).toBe(
      "Testnet only. Tokens and balances shown here have no monetary value. Nothing here is an offer, a solicitation, or financial advice.",
    );
  });

  it("carries block 3 as the generated lightweight-charts attribution, unmodified", () => {
    expect(FOOTER_ATTRIBUTION).toBe(TRADINGVIEW_NOTICE);
    expect(TRADINGVIEW_ATTRIBUTION_URL).toBe("https://www.tradingview.com/");
  });

  it("orders the three blocks trademark, testnet, attribution", () => {
    expect(FOOTER_BLOCKS).toEqual([FOOTER_TRADEMARK, FOOTER_TESTNET, FOOTER_ATTRIBUTION]);
  });

  it("uses no possessive or plural form of Arc (Circle brand policy)", () => {
    for (const block of FOOTER_BLOCKS) {
      expect(/Arc's|Arcs/.test(block)).toBe(false);
    }
  });
});
