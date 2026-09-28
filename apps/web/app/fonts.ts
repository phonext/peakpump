import localFont from "next/font/local";

// Self-hosted rather than fetched from a CDN: DESIGN.md requires the two families
// to be the ones on screen with no third-party request at runtime. Both files are
// the fontsource Latin subset, so a glyph outside Latin falls back per glyph
// rather than blocking the paint.
//
// Each src is the single variable file with its whole wght axis, and the range
// given here is the axis the fontsource metadata declares for that family, not a
// guess: any weight outside it would be synthesised by the browser.
export const spaceGrotesk = localFont({
  src: "../public/fonts/space-grotesk-latin-wght-normal.woff2",
  weight: "300 700",
  style: "normal",
  display: "swap",
  variable: "--pp-font-sans",
  // Keeps the generated metric fallback, unlike the mono below. DESIGN.md:16 ends the
  // Text stack with Arial, so the substitute here is one the table already allows, and
  // its size-adjust is what holds a paragraph's wrap points still until the file
  // swaps in. Turning it off would move them and shift every block below.
});

export const jetbrainsMono = localFont({
  src: "../public/fonts/jetbrains-mono-latin-wght-normal.woff2",
  weight: "100 800",
  style: "normal",
  display: "swap",
  variable: "--pp-font-mono",
  // Off, because the default is 'Arial' and DESIGN.md:17 admits no Arial to the
  // Numbers stack — :23 says a number never appears in the grotesk, and the
  // generated fallback would have put a metric-override Arial second in the stack,
  // ahead of every monospace the table names. It also renders wider, not merely
  // wrong: size-adjust came out at 131.49%, which takes Arial's 0.556em digit to
  // 0.731em against JetBrains Mono's 0.6em, so an 11-character address measured
  // 112.13px before the swap and 85.77px after it. The monospaces that now catch the
  // fallback are all within a pixel of the real thing at that length. Nothing is
  // given up on the vertical axis, which is what the override otherwise buys: every
  // step of the type scale in globals.css declares a unitless line-height, so a line
  // box is sized by that ratio and not by the fallback's ascent and descent.
  adjustFontFallback: false,
});
