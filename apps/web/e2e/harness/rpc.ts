// RPC interception. The page believes it is talking to the four hosts in
// packages/shared/src/chain.ts, because it is: every request leaves the browser
// addressed to one of them and never arrives. This route handler answers it from
// a local anvil instead, so the frozen chain object — its host list, its order,
// its chain id — is untouched by the suite. No URL is restated anywhere in e2e.
import { arcTestnet } from "@peakpump/shared/chain";
import type { Page, Request, Route } from "@playwright/test";

const ANVIL_ORIGIN = "http://127.0.0.1:8545";

// One fetch per request, no replay, no caching. A read that returned a stale
// block number would make the suite assert against a state the contracts moved
// past, and a POST body carried over between runs would be a request the page
// never made.
async function fulfill(route: Route): Promise<void> {
  const request = route.request();
  const response = await fetch(ANVIL_ORIGIN, {
    method: request.method(),
    headers: request.headers(),
    body: request.postData() ?? undefined,
  });
  const body = await response.text();
  await route.fulfill({
    status: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    body,
  });
}

// GET probes from the dev-server health check and the like are not RPC traffic;
// only JSON-RPC POSTs are proxied, and anything unmatched falls through to the
// network as normal.
function isRpcPost(request: Request): boolean {
  if (request.method() !== "POST") return false;
  const type = request.headers()["content-type"] ?? "";
  return type.includes("application/json");
}

export async function interceptRpc(page: Page): Promise<void> {
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    const isArcHost = arcTestnet.rpcUrls.default.http.some(
      (host) => new URL(host).host === url.host,
    );
    if (isArcHost && isRpcPost(route.request())) {
      void fulfill(route);
      return;
    }
    void route.continue();
  });
}

// The anti-snipe window is counted in blocks, and the per-address cap it carries
// is far below what a Summit-crossing buy costs, so the window has to be over
// before that buy is sent. Anvil mines a block per transaction and no read does,
// and the page's own polling cannot be relied on to have made enough requests:
// this talks to anvil directly, outside the page's interception, and the caller
// then waits for the panel's own notice to disappear before continuing.
export async function advanceBlocks(count: number): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    await fetch(ANVIL_ORIGIN, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: i, method: "evm_mine", params: [] }),
    });
  }
}
