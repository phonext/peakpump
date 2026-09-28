import { ImageResponse } from "@vercel/og";
import { readFile } from "node:fs/promises";
import { createElement, type ReactElement } from "react";
import path from "node:path";
import { getAddress } from "viem";
import { checkLimit, clientIdentifier, limitHeaders, tooManyRequests } from "@/lib/ratelimit";
import { isAddress } from "@/lib/address";
import { fetchMarketsByIds, type MarketRow } from "@/lib/markets";

// One token, one image, immutable (SPEC 6.7:589). The card is
// identity only — name, symbol, address, phase — because a price or a progress
// figure would be frozen into a year-long cache the moment it was rendered and
// would lie for the rest of it. An unknown market and an unreachable indexer
// both render the same generic card rather than a 500: the URL is still a
// valid, cacheable answer.
//
// createElement rather than JSX: the app's tsconfig keeps jsx at preserve for
// Next to compile, and a .ts route leaves the vitest transform nothing to
// interpret — the unit test imports this file directly.

// The colour literals are globals.css's own values, restated because satori
// reads style objects in this route handler and not the document's custom
// properties. If a token changes in globals.css, this set changes with it.
const GROUND = "#0A0A0B";
const INK = "#e3ecf6";
const INK_MUTED = "#92989e";
const ACCENT = "#ff8101";
const HAIRLINE = "#393b3e";

export const OG_CACHE_CONTROL = "public, max-age=31536000, s-maxage=31536000, immutable";

// Read once per process: the file is committed artwork, so a second request
// re-reading it from disk would be the only nondeterminism on this route.
let logoPromise: Promise<string> | null = null;
function logoDataUri(): Promise<string> {
  logoPromise ??= readFile(path.join(process.cwd(), "public/brand/logo.png")).then(
    (buffer) => `data:image/png;base64,${buffer.toString("base64")}`,
  );
  return logoPromise;
}

// The typefaces are woff2 (next/font's own subsetting), and satori's font
// loader does not read woff2 — so the card renders in the font @vercel/og
// bundles. An OG image is seen in a social feed, never in the product, and a
// fallback face there is the honest outcome; converting the brand files to a
// second format just for this route would leave two copies of one typeface to
// keep in step.

function paragraph(text: string, style: Record<string, unknown>): ReactElement {
  return createElement("p", { style: { margin: 0, ...style } }, text);
}

function Card({ market, logo }: { market: MarketRow | null; logo: string }): ReactElement {
  const body =
    market === null
      ? [
          paragraph("Create a token or trade one on the curve.", { fontSize: 64, color: INK }),
          paragraph("Testnet only.", { fontSize: 30, color: INK_MUTED }),
        ]
      : [
          paragraph(market.name ?? market.symbol ?? market.id, { fontSize: 64, color: INK }),
          paragraph(
            market.symbol !== null ? `${market.symbol} — ${market.id}` : market.id,
            { fontSize: 30, color: INK_MUTED },
          ),
          paragraph(market.phase === 1 ? "PEAK" : "ASCENT", {
            fontSize: 30,
            color: ACCENT,
            border: `2px solid ${HAIRLINE}`,
            borderRadius: 10,
            padding: "8px 24px",
            alignSelf: "flex-start",
          }),
        ];

  return createElement(
    "div",
    {
      style: {
        width: "100%",
        height: "100%",
        backgroundColor: GROUND,
        display: "flex",
        alignItems: "center",
        padding: 80,
        gap: 64,
      },
    },
    createElement("img", { src: logo, width: 200, height: 200, alt: "" }),
    createElement("div", { style: { display: "flex", flexDirection: "column", gap: 20, maxWidth: 760 } }, [
      paragraph("peakpump", { fontSize: 30, color: ACCENT }),
      ...body,
    ]),
  );
}

export async function GET(request: Request, context: { params: Promise<{ address: string }> }) {
  const verdict = await checkLimit("read", clientIdentifier(request));
  if (verdict.kind === "limited") return tooManyRequests(verdict);
  const rate = limitHeaders(verdict);

  const { address } = await context.params;
  if (!isAddress(address)) {
    return new Response("Not an address.", {
      status: 404,
      headers: { "cache-control": "no-store", ...rate },
    });
  }

  // Null is the indexer not answering; both it and an unknown curve render the
  // generic card, which is why the two are not separated here.
  const markets = await fetchMarketsByIds([getAddress(address)]);
  const market = markets === null ? null : (markets[0] ?? null);
  const logo = await logoDataUri();

  // The headers ride on a wrapped Response rather than ImageResponse's own
  // options, so the cache law lives in one string this route exports.
  const image = new ImageResponse(Card({ market, logo }), {
    width: 1200,
    height: 630,
  });
  return new Response(image.body, {
    status: 200,
    headers: { "cache-control": OG_CACHE_CONTROL, ...rate },
  });
}
