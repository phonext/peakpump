import { afterEach, describe, expect, it, vi } from "vitest";

// Each dependency is replaced at its own module boundary, because what has to be shown
// here is that four probes are reported independently: a route that awaited them in
// sequence, or let one throw out of the handler, would pass a test that only ever fails
// one of them.
const deps = vi.hoisted(() => ({
  blockNumber: async (): Promise<bigint> => 60_437_363n,
  indexer: async (): Promise<unknown> => ({ __typename: "query_root" }),
  r2: null as { bucket: string } | null,
  reachable: async (): Promise<void> => {},
  // The prisma client the database probe reaches through, or null for an
  // unconfigured machine. The probe's own deadline and silence are the route's
  // to own, so the client here is nothing but $queryRaw.
  database: null as { $queryRaw: () => Promise<unknown> } | null,
}));

vi.mock("@/lib/viem", () => ({
  publicClient: { getBlockNumber: () => deps.blockNumber() },
}));

vi.mock("@/lib/graphql", () => ({
  indexerQuery: () => deps.indexer(),
}));

vi.mock("@/lib/r2", () => ({
  r2Config: () => deps.r2,
  bucketReachable: () => deps.reachable(),
}));

vi.mock("@/lib/db", () => ({
  db: () => deps.database,
}));

const INDEXER_VAR = "NEXT_PUBLIC_INDEXER_URL";
const UPSTASH_VARS = ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"];
const ENDPOINT = "https://indexer.invalid/v1/graphql";

type Check = { status: string; ms?: number };
type Body = { status: string; checks: Record<string, Check> };

function set(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

// The route reads NEXT_PUBLIC_INDEXER_URL at module scope, so a case that changes it
// loads the module again. The two Upstash variables are cleared with it: a limiter
// configured in the shell would put this file on the network.
async function loadHealth(indexerUrl?: string) {
  vi.resetModules();
  set(INDEXER_VAR, indexerUrl);
  for (const name of UPSTASH_VARS) set(name, undefined);
  return (await import("@/app/api/health/route")).GET;
}

async function ask(indexerUrl?: string) {
  const GET = await loadHealth(indexerUrl);
  const response = await GET(new Request("https://peakpump.invalid/api/health"));
  return { response, body: (await response.json()) as Body };
}

const original = new Map([INDEXER_VAR, ...UPSTASH_VARS].map((name) => [name, process.env[name]]));

afterEach(() => {
  deps.blockNumber = async () => 60_437_363n;
  deps.indexer = async () => ({ __typename: "query_root" });
  deps.r2 = null;
  deps.reachable = async () => {};
  deps.database = null;
  for (const [name, value] of original) set(name, value);
});

describe("what a fresh checkout reports", () => {
  it("names all four dependencies and does not fail for the three that are absent", async () => {
    const { response, body } = await ask();

    expect(response.status).toBe(200);
    expect(body.status).toBe("ok");
    // The field list is fixed at four and in this order, so a caller watching the
    // endpoint sees the database appear rather than a key it never knew to expect.
    expect(Object.keys(body.checks)).toEqual(["rpc", "indexer", "database", "r2"]);
    expect(body.checks.rpc?.status).toBe("ok");
    expect(body.checks.indexer?.status).toBe("unconfigured");
    expect(body.checks.database?.status).toBe("unconfigured");
    expect(body.checks.r2?.status).toBe("unconfigured");
  });

  it("reports no counters when no limiter is configured", async () => {
    const { response } = await ask();
    expect(response.headers.get("cache-control")).toBe("no-store");
    // The route asks the limiter first, and an unconfigured one answers unlimited: a
    // header claiming a limit here would be claiming a limit nobody is enforcing.
    expect(response.headers.get("x-ratelimit-limit")).toBeNull();
  });

  it("answers with a latency and never with a chain value", async () => {
    deps.blockNumber = async () => 60_437_363n;
    const { body } = await ask();

    // No /api route forwards an RPC call, and SPEC 6.1 keeps chain numbers
    // out of anything a trade could be priced from. A boolean and a duration is all
    // this probe is allowed to carry.
    expect(JSON.stringify(body)).not.toContain("60437363");
    expect(Object.keys(body.checks.rpc ?? {})).toEqual(["status", "ms"]);
    expect(body.checks.rpc?.ms).toBeTypeOf("number");
  });
});

describe("what a failure reports", () => {
  it("reports three failures at once rather than the first one", async () => {
    deps.blockNumber = async () => {
      throw new Error("connect ECONNREFUSED");
    };
    // null is what lib/graphql.ts answers for an indexer that did not answer, which is
    // why the probe reads it as down rather than as an empty result.
    deps.indexer = async () => null;
    deps.r2 = { bucket: "peakpump" };
    deps.reachable = async () => {
      throw new Error("NoSuchBucket");
    };

    const { response, body } = await ask(ENDPOINT);
    expect(response.status).toBe(503);
    expect(body.status).toBe("degraded");
    expect(body.checks.rpc?.status).toBe("down");
    expect(body.checks.indexer?.status).toBe("down");
    expect(body.checks.r2?.status).toBe("down");
    // Still reported beside three failures, and still not a failure itself.
    expect(body.checks.database?.status).toBe("unconfigured");
  });

  it("keeps the healthy probes healthy beside a failing one", async () => {
    deps.r2 = { bucket: "peakpump" };
    deps.reachable = async () => {
      throw new Error("SignatureDoesNotMatch");
    };

    const { response, body } = await ask(ENDPOINT);
    // A configured dependency that is down is what makes this 503; the ones beside it
    // are unaffected, which is the difference between four probes and one.
    expect(response.status).toBe(503);
    expect(body.checks.rpc?.status).toBe("ok");
    expect(body.checks.indexer?.status).toBe("ok");
    expect(body.checks.r2?.status).toBe("down");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("is 200 with R2 configured and reachable", async () => {
    deps.r2 = { bucket: "peakpump" };
    const { response, body } = await ask(ENDPOINT);
    // The counterpart the 503 cases need: without it they would hold against a route
    // that answered 503 whenever anything was configured at all.
    expect(response.status).toBe(200);
    expect(body.checks.r2?.status).toBe("ok");
    expect(body.checks.indexer?.status).toBe("ok");
  });

  it("gives a hung probe its own deadline and reports the rest", async () => {
    vi.useFakeTimers();
    try {
      // A socket that is accepted and then goes quiet: the one case a try/catch alone
      // does not cover, and the reason each probe carries a deadline.
      deps.blockNumber = () => new Promise<bigint>(() => {});
      const GET = await loadHealth(ENDPOINT);
      const pending = GET(new Request("https://peakpump.invalid/api/health"));
      await vi.advanceTimersByTimeAsync(3_100);

      const body = (await (await pending).json()) as Body;
      expect(body.checks.rpc?.status).toBe("down");
      expect(body.checks.indexer?.status).toBe("ok");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("the database probe", () => {
  it("is ok when the database is configured and answers", async () => {
    deps.database = { $queryRaw: async () => [] };
    const { response, body } = await ask(ENDPOINT);

    expect(response.status).toBe(200);
    expect(body.checks.database?.status).toBe("ok");
    expect(body.checks.database?.ms).toBeTypeOf("number");
  });

  it("is down when the database is configured and does not answer", async () => {
    deps.database = {
      $queryRaw: async () => {
        throw new Error("Connection terminated unexpectedly");
      },
    };
    const { response, body } = await ask(ENDPOINT);

    expect(response.status).toBe(503);
    expect(body.checks.database?.status).toBe("down");
    // The failure is the database's alone, and the reason is not reported: the
    // same silence the other three probes keep over their error strings.
    expect(body.checks.indexer?.status).toBe("ok");
    expect(JSON.stringify(body)).not.toContain("Connection terminated");
  });
});
