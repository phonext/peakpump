// DESIGN.md:236's two phone sizes, at the layout the RESPONSIVE section is a
// contract for. This is not a capture suite — the visual baseline holds the
// desktop shapes, and a phone's layout is better pinned by what a reader can
// reach than by pixels — so what is asserted here is the three things that make
// a small-viewport rendering usable at all:
//
//   - nothing overflows horizontally. The wide columns drop at md and the rail
//     becomes a scroll strip, so the document's own scroll width is the width
//     of the viewport. A regression here is the one a desktop capture cannot
//     see, because the desktop viewport is wide enough to hold everything.
//   - the trade surface is reachable above the chart. At sm the trade panel is
//     replaced by the sticky bar at the foot of the page, so the control is on
//     the first viewport rather than below the charts.
//   - the stacking order the token page's PLACE map fixes is the document order
//     too, so a reader and a pointer meet the same sequence.
//
// The chain and the indexer may both be unreachable from where this runs; every
// assertion below holds in that state, because an offline read renders a
// sentence and a skeleton and both are inside the layout being measured. What
// the suite does not do is assert anything about a figure those reads supply.
import { test, expect } from "@playwright/test";

// The market the visual baseline uses; the route is what matters here, not its
// state, and this one is the one the committed baseline pins.
const TOKEN_ROUTE = "/token/0xE8eAc808D04a8698Fb33b2c4CE6Fadd4ae93f7d2";

// A document that grew sideways, measured the way a reader would see it: the
// widest thing in flow, against the viewport. Both the root element and the
// body, because a fixed-width child of body scrolls without moving documentElement.
async function expectNoOverflow(page: import("@playwright/test").Page): Promise<void> {
  const widths = await page.evaluate(() => ({
    root: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
    viewport: window.innerWidth,
  }));
  expect(widths.root, "documentElement is wider than the viewport").toBeLessThanOrEqual(
    widths.viewport,
  );
  expect(widths.body, "body is wider than the viewport").toBeLessThanOrEqual(widths.viewport);
}

test.describe("mobile layout", () => {
  test("home — the rail scrolls and the table does not", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("region", { name: "Markets" })).toBeVisible({ timeout: 60_000 });
    await expectNoOverflow(page);
  });

  test("create — the three step panels stay in the viewport's width", async ({ page }) => {
    await page.goto("/create");
    await expect(page.getByRole("heading", { name: "Create a token" })).toBeVisible();
    await expectNoOverflow(page);
  });

  test("token — the trade surface is above the chart", async ({ page }) => {
    await page.goto(TOKEN_ROUTE);
    // The identity panel is the first thing the PLACE map puts down, and it is
    // server-rendered, so its heading is the route having rendered rather than a
    // chain read having landed. Panel puts its title in an h2 and no accessible
    // name on the section itself, so the anchor is the heading.
    await expect(page.getByRole("heading", { name: "Token", exact: true })).toBeVisible({ timeout: 60_000 });
    await expectNoOverflow(page);

    // The panel the bar replaces is display:none below md, so its heading is out
    // of the tree as well as out of paint: a panel that came back without the bar
    // would leave a reader with two trade surfaces.
    await expect(page.getByRole("heading", { name: "Trade", exact: true })).toBeHidden();

    const bar = page.getByRole("button", { name: "Trade", exact: true });
    await expect(bar).toBeVisible();
    const box = await bar.boundingBox();
    // Sticky bottom-0 holds the viewport's bottom edge, so the control is inside
    // the first viewport whatever the page's height is — which is the point of
    // the bar and the thing a trade panel placed under the charts would lose.
    expect(box).not.toBeNull();
    expect(box!.y).toBeLessThan(page.viewportSize()!.height);
    expect(box!.y + box!.height).toBeLessThanOrEqual(page.viewportSize()!.height + 1);

    // The stacking order DESIGN.md fixes, as document order: identity, trade
    // surface, chart. A reordering in the PLACE map that kept the grid right and
    // the reading order wrong fails here.
    const chartAfterIdentity = await page.evaluate(() => {
      const headings = Array.from(document.querySelectorAll("h2"));
      const at = (name: string) => headings.findIndex((heading) => heading.textContent === name);
      return at("Token") !== -1 && at("Chart") !== -1 && at("Token") < at("Chart");
    });
    expect(chartAfterIdentity, "the chart follows the identity panel in the document").toBe(true);
  });
});
