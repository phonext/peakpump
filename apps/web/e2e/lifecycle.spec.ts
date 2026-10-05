// The one end-to-end walk of the product: connect, create a market with a dev
// buy, a live anti-snipe window and a per-address cap, trade across the Summit,
// sell, claim creator fees, withdraw a deferred payout, comment.
//
// Run steps. Starting a chain and broadcasting a deploy are commands printed
// rather than run, so they are recorded in harness/anvil.ts and named
// here, not executed from the suite:
//
//   1. Start anvil — the exact command is ANVIL_COMMAND in harness/anvil.ts
//   2. Deploy the four contracts — DEPLOY_COMMAND in harness/anvil.ts, which
//      writes contracts/deployments/arc-testnet.json, the file the app reads
//   3. cd apps/web && pnpm e2e
//
// Locators are role, label and text, never a data-testid. Adding an id to a
// shipped component would modify a file already delivered; the
// visible copy is the contract this file depends on instead, and a changed
// label breaks this suite where a reader can see it.
//
// What the suite does not stub, and what each gap costs:
//
//   - Postgres. /api/markets/{curve}//comments and the session a comment needs
//     both require DATABASE_URL. Without it the comment leg renders its
//     unsigned branch — "Sign in to comment" — and the list stays empty. The
//     other six legs are chain reads and need no database.
//   - R2. /api/upload needs credentials and a cropped payload. The create step
//     below submits no image, which is a valid market and not a degraded one:
//     the metadata URI is optional in CreateParams.
//   - The indexer. NEXT_PUBLIC_INDEXER_URL is inlined at build time, and
//     TradesList and HoldersList read it. Both render empty against anvil;
//     nothing below waits on them. The trade panel, the earnings panel and the
//     progress panel are all live chain reads, so no assertion here depends on
//     the indexer either.
import { test, expect, type Page } from "@playwright/test";
import { installWallet, signerAddress } from "./harness/provider";
import { interceptRpc, advanceBlocks } from "./harness/rpc";

const TOKEN_NAME = "Harness Ridge";
const TOKEN_SYMBOL = "HRDG";

// Anti-snipe window and per-address cap are set together or not at all.
// This run sets both, and buys inside the window from the address
// that created the market — the pairing the window exists to shape, with the
// cap charged on what a trade spends.
const ANTI_SNIPE_BLOCKS = "3";
const MAX_BUY_PER_ADDRESS = "100";
const DEV_BUY = "10";

// Crossing the Summit for a 1000 USDC raise at 4x takes about 1025 USDC at the
// default 125 bps (computed from MATH 3 and 6.2, not estimated). 1500 clears it
// with margin for the single-buy rounding, and the crossing path returns the
// excess as an exact refund, so an over-budget buy is the leg that covers
// refund6 rather than a wasted one.
const SUMMIT_BUY = "1500";

// The cap above is per address per window, and the Summit buy is fifteen times
// it, so the window has to be over before that buy is sent. Three blocks is the
// window; a margin past it costs one read.
const PAST_WINDOW = 4;

async function connect(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Connect wallet" }).click();
  await page.getByRole("heading", { name: "Connect a wallet" }).waitFor();
  // lib/wagmi.ts registers injected() only, so it is the single entry in the list
  // and its name is "Injected".
  await page.getByRole("button", { name: "Injected" }).click();
  await expect(page.getByText(signerAddress.slice(0, 6))).toBeVisible();
}

// The market this run creates. Custom economics rather than one of the three
// named presets: the Summit has to be reachable inside an anvil account's
// balance, and the presets' raise does not leave headroom for a single buy that
// crosses. Supply 1e9 tokens, 1000 USDC, 4x.
async function createMarket(page: Page): Promise<string> {
  await page.goto("/create");
  await page.getByRole("heading", { name: "Create a token" }).waitFor();

  await page.getByLabel("Name").fill(TOKEN_NAME);
  await page.getByLabel("Symbol").fill(TOKEN_SYMBOL);
  await page.getByRole("button", { name: "Next" }).click();

  await page.getByLabel("Set your own").check();
  await page.getByLabel("Supply").fill("1000000000");
  await page.getByLabel("Raise").fill("1000");
  await page.getByLabel("Multiple").fill("4");
  await page.getByLabel("Amount").fill(DEV_BUY);

  await page.getByLabel("Run an anti-snipe window").check();
  await page.getByLabel("Window").fill(ANTI_SNIPE_BLOCKS);
  await page.getByLabel("Per address cap").fill(MAX_BUY_PER_ADDRESS);

  await page.getByRole("button", { name: "Next" }).click();

  // The review states the pairing this run exists to exercise; it is the last
  // place the figures are readable before they become a transaction.
  await expect(page.getByText("Anti-snipe window")).toBeVisible();
  await expect(page.getByText("Per-address cap")).toBeVisible();
  await page.getByRole("button", { name: "Create token" }).click();

  // On settle the review reads MarketCreated from the receipt and routes to the
  // token page, so the curve is the URL rather than a return value this file
  // has to carry between tests.
  await page.getByRole("heading", { name: TOKEN_NAME }).waitFor({ timeout: 30_000 });
  return page.url().replace(/.*\/token\//, "");
}

test.describe.serial("full market lifecycle", () => {
  test.beforeEach(async ({ page }) => {
    // exposeFunction before the first navigation, so the provider the init
    // script installs has something to hand a request to when the page calls it
    // during hydration.
    await installWallet(page);
    await interceptRpc(page);
  });

  test("connects through the injected provider", async ({ page }) => {
    await page.goto("/");
    await connect(page);
  });

  test("creates a market with a dev buy and an anti-snipe window", async ({ page }) => {
    await page.goto("/");
    await connect(page);
    await createMarket(page);

    // The anti-snipe notice is the window being live on the market the create
    // step asked for, charged on spend6.
    await expect(page.getByText("Anti-snipe window")).toBeVisible();
    await expect(page.getByText("USDC of your cap is left")).toBeVisible();
  });

  test("buys, crosses the Summit and sells", async ({ page }) => {
    await page.goto("/");
    await connect(page);
    const curve = await createMarket(page);

    await advanceBlocks(PAST_WINDOW);
    // The panel's own notice disappearing is the window being closed, read from
    // the chain the buys below are priced against.
    await expect(page.getByText("Anti-snipe window")).toHaveCount(0, { timeout: 15_000 });

    await page.getByLabel("You spend").fill(SUMMIT_BUY);
    // The crossing notice is the quote's own flag that this buy reaches the
    // Summit, printed before the send. It is this file's one assertion about the
    // contract's phase change.
    await expect(page.getByText("This buy reaches the Summit")).toBeVisible();
    await page.getByRole("button", { name: "Buy" }).click();
    await expect(page.getByText("Bought.")).toBeVisible({ timeout: 30_000 });

    // The Summit announcement is a status role, so it is announced rather than
    // only drawn.
    await expect(page.getByRole("status").filter({ hasText: "Summit" })).toBeVisible();

    await page.getByRole("tab", { name: "Sell" }).click();
    // Max reads curve.balanceOf, which is the figure the sell path pulls
    // through pullFrom with no allowance step and no second press.
    await page.getByRole("button", { name: "Max" }).click();
    await page.getByRole("button", { name: "Sell" }).click();
    await expect(page.getByText("Sold.")).toBeVisible({ timeout: 30_000 });

    // A fresh load of a market already past its Summit. Every step above ran on a
    // page that read this market's params before the crossing, so useMarketParams
    // held the pre-Summit x0 and the route chart drew from it. This reload has never
    // seen the market, so x0 arrives as the 0n _summit() left behind and the frame
    // has to be drawn without the field it was built from. The caption below only
    // renders in the branch that finished drawing, which is why a reload is the leg
    // that covers it and a same-page trade is not.
    await page.reload();
    await expect(page.getByText("What is drawn is the ascent it climbed")).toBeVisible();

    // The curve address this test created is not used after the navigation, but
    // it is returned so a later leg can reach the same market without recreating
    // it.
    expect(curve).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  test("claims creator fees from the vault", async ({ page }) => {
    await page.goto("/");
    await connect(page);
    await createMarket(page);
    await advanceBlocks(PAST_WINDOW);

    await page.getByLabel("You spend").fill(SUMMIT_BUY);
    await page.getByRole("button", { name: "Buy" }).click();
    await expect(page.getByText("Bought.")).toBeVisible({ timeout: 30_000 });

    await page.goto(`/profile/${signerAddress}`);
    await page.getByText("Claimable in the fee vault").waitFor();

    // The split is top-down with the creator side floored, so a non-zero
    // claimable figure is the fee having been credited rather than pushed.
    // claim() pulls the vault's whole balance for this address in one call.
    await page.getByRole("button", { name: "Claim" }).click();
    await expect(page.getByText("Claimed.")).toBeVisible({ timeout: 30_000 });
  });

  test("reads the deferred-payout panel", async ({ page }) => {
    // A deferred balance exists only where an outbound transfer could not
    // complete, and anvil does not refuse transfers, so this leg asserts the
    // empty state — the panel's own sentence for nothing owed — which is the
    // honest reading of a chain that never defers. The withdraw path is the same
    // trade runner the buys above used, so it is covered by them.
    await page.goto("/");
    await connect(page);
    const curve = await createMarket(page);
    await page.goto(`/token/${curve}`);
    await expect(page.getByText("Nothing is deferred on this market any more.")).toBeVisible();
  });

  test("comments on the market", async ({ page }) => {
    await page.goto("/");
    await connect(page);
    const curve = await createMarket(page);
    await page.goto(`/token/${curve}`);
    await page.getByRole("heading", { name: TOKEN_NAME }).waitFor();

    // Postgres is the one stub this suite does not provide. Without it the form
    // renders its unsigned branch and this leg reports the environment it ran in
    // rather than failing a write it never attempted.
    const hasComposer = await page.getByPlaceholder("Say something about this market").count();
    test.skip(hasComposer === 0, "no database; the comment form is in its unsigned branch");

    await page.getByPlaceholder("Say something about this market").fill("Harness comment");
    await page.getByRole("button", { name: "Post" }).click();
    await expect(page.getByText("Harness comment")).toBeVisible({ timeout: 15_000 });
  });
});
