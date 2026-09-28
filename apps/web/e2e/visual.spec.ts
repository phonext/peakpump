// The visual regression baseline. Six routes, one full-page
// toHaveScreenshot() each, taken at the desktop canvas DESIGN.md:235 names so a
// later redesign can be diffed against the shapes this file pinned.
//
// What the baseline is, and is not:
//
//   - It is a layout and styling contract. The six pages are captured whole,
//     below the fold included, so a redesign that moves a panel or changes a
//     radius fails a test and shows a diff.
//   - It is not a data contract. The token and profile routes read live chain
//     state and the home page reads the indexer, so a trade on the market below
//     between this run and a later one moves pixels for data reasons. See DATA
//     PAGES below for how to read that.
//
// Determinism. Every lever the suite pulls is one DESIGN.md already sanctions:
//
//   - 1440 by 900, the desktop size in the RESPONSIVE section's test list. The
//     token route's three-column 280 / fluid / 360 grid engages at lg, so a
//     narrower canvas would capture the collapsed layout rather than the one
//     the redesign is actually changing.
//   - prefers-reduced-motion, which the MOTION section defines an exact still
//     rendering for: a skeleton becomes a flat block and Shimmer, Sheen, Rise
//     and Flash do not run. Animations are the main source of pixel noise
//     between two otherwise identical runs, and reduced motion removes them by
//     the design's own rule rather than by a test-only override.
//   - The indexer is unset for this run, so / and the lists on the token and
//     profile routes render their documented offline state. That state is
//     stable across runs, which is what a baseline needs; it is also the honest
//     rendering of a deployment without an indexer.
//   - next dev's toolbar and issues overlay are suppressed. The portal that
//     holds them is position: static, so it sits in the document flow and would
//     both appear in every capture and add roughly a hundred pixels to the
//     captured height. It is dev-only chrome, absent from a production build.
//
// DATA PAGES. The two routes below carry live reads. The market was picked for
// being the most-traded of the ten on the chain: 2.06% of the way to the Summit
// in ASCENT, so the progress bar, the price and the route chart all carry real
// non-zero figures rather than a freshly-created market's opening constants. If
// a later run diffs that page and the only changed region is a number, re-read
// the market on chain before calling it a design change; re-baselining is
// `pnpm e2e:visual --update-snapshots` and is the correct response to a trade,
// not to a redesign.
import { test, expect, type Locator, type Page } from "@playwright/test";

// The most-traded market on the chain, recovered from the factory's CREATE
// nonces rather than from the indexer (which is offline for this run). Its
// creator is the profile address, chosen so the claim panel shows credited
// creator fees rather than a market nobody has bought from.
const TOKEN_ROUTE = "/token/0xE8eAc808D04a8698Fb33b2c4CE6Fadd4ae93f7d2";
const PROFILE_ROUTE = "/profile/0x463BB5e0111D33de198191e1A419AAD5FB203cbD";

// Fixed-position dev chrome, and the one element that costs the capture its
// height. nextjs-portal is position: static, so it sits in the document flow at
// the end of <body> and its buttons add roughly a hundred pixels to the page's
// scrollHeight — which is what a fullPage screenshot captures. The portal is a
// Next internal that never holds app content, and it is absent from a
// production build, so suppressing it cannot hide anything the redesign owns.
const DEV_CHROME_CSS = `nextjs-portal, nextjs-build-watcher { display: none !important; }`;

// Served through route interception rather than injected as an inline <style>:
// the app's own CSP pins style-src to 'self' (next.config.ts), which an
// addStyleTag violates, while a stylesheet the browser fetches from its own
// origin is exactly what the policy permits. A rule and not an imperative
// display:none, because the portal arrives on the dev server's own schedule and
// a mutation made before it exists does nothing; a rule applies whenever it
// lands. The route is installed before the link so the fetch cannot race.
async function suppressDevChrome(page: Page): Promise<void> {
  await page.route("**/_dev-chrome-suppress.css", (route) =>
    route.fulfill({ contentType: "text/css", body: DEV_CHROME_CSS }),
  );
  // Created in the page rather than with addLinkTag, which this Playwright does
  // not have. Resolved on the link's load event so the rule is applied before
  // anything below reads visibility.
  await page.evaluate((href) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    document.head.appendChild(link);
    return new Promise<void>((resolve) => {
      link.addEventListener("load", () => resolve());
      link.addEventListener("error", () => resolve());
    });
  }, "/_dev-chrome-suppress.css");
  // A capture assertion, not a styling one: the buttons must be off-screen in
  // the PNG, and this is what catches a Next version whose portal is no longer
  // covered by the rule above. Checked in the page rather than with toBeHidden,
  // which a multi-element locator rejects under strict mode.
  const chrome = page.getByRole("button", { name: /Next\.js Dev Tools|issues overlay/ });
  if ((await chrome.count()) === 0) return;
  const stillVisible = await chrome.evaluateAll((els) =>
    els.some((el) => (el as HTMLElement).offsetParent !== null),
  );
  expect(stillVisible).toBe(false);
}

// A page is only captured once something specific to it is on screen, so a
// route that silently rendered an error or a not-found shell cannot pass by
// looking plausibly empty. The anchor is a Locator rather than a role/name pair
// because the six pages anchor on different things: three on their own heading,
// the markets region on the home page, the progress bar on the token page, and
// the profile page on the fee-vault line, which is the one live read on an
// otherwise indexer-fed page.
// The token, profile and home routes carry client query islands: the Comments
// list, the watchlist and follows lists, the watchlist tab. Each renders
// Skeleton bars while its query is pending and an EmptyState once it settles,
// and the two states are not the same height. The query is issued on mount,
// after load, so a capture taken the moment the server-rendered anchor appears
// can catch either state, and the page's height flips between two runs of the
// same code. Waiting for every skeleton to be gone is waiting for those islands
// to settle, which is the state the redesign is actually changing.
//
// Per route, not globally: /styleguide keeps static skeleton specimens on the
// page by design — it is the reference page for the motion system — so a route
// whose skeletons never clear must not be gated on clearing them.
async function settle(page: Page): Promise<void> {
  await expect(page.locator(".pp-shimmer")).toHaveCount(0, { timeout: 90_000 });
}

async function capture(
  page: Page,
  name: string,
  anchor: Locator,
  gated: boolean = false,
): Promise<void> {
  // Next dev compiles a route on first request. On that cold compile the
  // devtools overlay and the islands hydrate after the first paint, and the
  // document grows between two captures taken milliseconds apart — which is
  // exactly what toHaveScreenshot's own stability check compares, so a cold
  // server fails the capture on frame timing rather than on layout. A warm
  // reload puts every route on its compiled path before the one that is
  // captured. Measured: zero elements change position on the warm pass.
  await page.goto(page.url());
  await expect(anchor).toBeVisible({ timeout: 60_000 });
  await suppressDevChrome(page);
  await page.waitForLoadState("networkidle");
  if (gated) await settle(page);
  // maxDiffPixelRatio 0.02: a redesign that moves anything real on a page moves
  // far more than 2% of its pixels, while a ticked price or a block number on a
  // live-data page moves far less. The threshold separates those two cases
  // without a per-page exception.
  await expect(page).toHaveScreenshot(name, { fullPage: true, maxDiffPixelRatio: 0.02 });
}

test.describe("visual baseline", () => {
  test("home — markets list", async ({ page }) => {
    await page.goto("/");
    // The tab strip's region is this page's primary navigation, and its offline
    // state is the stable rendering the baseline pins.
    await capture(page, "home.png", page.getByRole("region", { name: "Markets" }));
  });

  test("token — market in ASCENT", async ({ page }) => {
    await page.goto(TOKEN_ROUTE);
    // The progress bar is a live read off the curve, so its presence is the page
    // having reached the chain, not just having rendered a shell.
    await capture(
      page,
      "token.png",
      page.getByRole("progressbar", { name: "Progress to the Summit" }),
      true,
    );
  });

  test("create — new market form", async ({ page }) => {
    await page.goto("/create");
    await capture(page, "create.png", page.getByRole("heading", { name: "Create a token" }));
  });

  test("profile — market creator", async ({ page }) => {
    await page.goto(PROFILE_ROUTE);
    // The claim line is the vault read landing. The page's only heading is the
    // address itself, which proves nothing about the chain.
    await capture(page, "profile.png", page.getByText("Claimable in the fee vault"), true);
  });

  test("brand — identity assets", async ({ page }) => {
    await page.goto("/brand");
    await capture(page, "brand.png", page.getByRole("heading", { name: "Brand and attribution" }));
  });

  test("styleguide — component specimens", async ({ page }) => {
    await page.goto("/styleguide");
    await capture(page, "styleguide.png", page.getByRole("heading", { name: "Styleguide" }));
  });
});
