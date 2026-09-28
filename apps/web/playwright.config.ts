import { defineConfig, devices } from "@playwright/test";

// Author now, run later. The suite is excluded from the Next build and from the
// app's tsc --noEmit by e2e/tsconfig.json, so it can never break the zero-type-
// errors gate even though it imports devDeps the app does not ship.
//
// The web server is `next dev` rather than `next build && next start`: the token
// route reads the live indexer, and a production build prerenders against
// whatever NEXT_PUBLIC_INDEXER_URL the build saw, which is not what a run against
// a local anvil wants. dev re-renders per request, so the harness's RPC
// interception is what shapes the page, not a build-time variable.
//
// Two projects, both Chromium: one browser is enough to walk the flow, and every
// additional renderer multiplies the cost of suites whose value is the flow and
// the baseline they cover, not the browsers they sample. The projects are
// separated by testMatch rather than by a command-line filter because they need
// different environments — `chromium` runs the anvil-backed lifecycle and
// intercepts RPC, `visual` runs the baseline against the chain the app is
// configured for and never intercepts anything.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  // Committed, so a baseline taken in one session is the baseline a later one
  // diffs against. Failure artefacts (the -actual/-expected/-diff triples) land
  // in outputDir, which is ignored.
  snapshotDir: "./e2e/baseline",
  use: {
    baseURL: "http://localhost:3999",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      // Pinned, not defaulted: without a testMatch this project would also run
      // visual.spec.ts, which would make the anvil-backed lifecycle suite depend
      // on a chain it does not start.
      testMatch: /lifecycle.*\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      // The visual baseline project. Runs without anvil: the six routes it
      // captures are reads, and the two live ones go to the chain the app is
      // configured for. See e2e/visual.spec.ts for why the viewport and reduced
      // motion are what they are.
      name: "visual",
      testMatch: /visual.*\.spec\.ts/,
      // A cold route compile plus a chain read through the RPC fallback can
      // take a minute on the first route hit; the suite has six tests and no
      // retry, so a slow first request must not be able to fail a capture.
      timeout: 120_000,
      use: {
        ...devices["Desktop Chrome"],
        // DESIGN.md:235's desktop test size, and the size at which the token
        // route's lg three-column grid is the layout the redesign changes.
        viewport: { width: 1440, height: 900 },
        reducedMotion: "reduce",
      },
    },
    // DESIGN.md:236's two phone sizes. Both sizes get their own project because
    // a viewport is a use-field and not a per-test setting here, and the two are
    // testing different things: 360 is the narrowest the design names, where a
    // twenty-character price and a 44px control share one line, and 390 is the
    // width the layout's own breakpoints were built against.
    {
      name: "mobile-360",
      testMatch: /mobile.*\.spec\.ts/,
      timeout: 120_000,
      use: { ...devices["Desktop Chrome"], viewport: { width: 360, height: 640 } },
    },
    {
      name: "mobile-390",
      testMatch: /mobile.*\.spec\.ts/,
      timeout: 120_000,
      use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 } },
    },
  ],
  // Anvil binds 127.0.0.1:8545 and the harness proxies arc POSTs to it, so the
  // app's own chain object and its four-host list stay untouched: the page asks
  // for rpc.testnet.arc.io and the request never leaves the machine.
  webServer: {
    command: "next dev -p 3999",
    url: "http://localhost:3999",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
