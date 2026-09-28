import { TRADINGVIEW_NOTICE, TRADINGVIEW_ATTRIBUTION_URL } from "./tradingview-notice.generated";

// The single source of every user-facing brand string. No other file hardcodes a
// product name or a footer line; UI reads from here so the footer wording
// lives in exactly one place. The product is peakpump and has no relation
// to any earlier project; the word Arc appears only as a bare proper noun,
// never possessive or plural.

export const PRODUCT_NAME = "peakpump";

// The footer is three blocks, always visible in this order on every page. Blocks 1
// and 2 are fixed wording, transcribed verbatim. Block 3 is the lightweight-charts
// attribution, read at build time from the installed NOTICE by gen:notice and
// never from a document — that wording must not be paraphrased or copied from
// any doc, this file included. TRADINGVIEW_ATTRIBUTION_URL is the link that
// NOTICE requires and is rendered alongside the attribution text.
export const FOOTER_TRADEMARK =
  "Arc is a trademark of Circle Internet Group, Inc. peakpump is an " +
  "independent project, not affiliated with, endorsed by, or sponsored by Circle.";

export const FOOTER_TESTNET =
  "Testnet only. Tokens and balances shown here have no monetary value. " +
  "Nothing here is an offer, a solicitation, or financial advice.";

export const FOOTER_ATTRIBUTION = TRADINGVIEW_NOTICE;

export const FOOTER_BLOCKS = [FOOTER_TRADEMARK, FOOTER_TESTNET, FOOTER_ATTRIBUTION] as const;

export { TRADINGVIEW_ATTRIBUTION_URL };
