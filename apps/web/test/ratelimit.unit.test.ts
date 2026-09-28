import { afterEach, describe, expect, it, vi } from "vitest";

// The two Upstash packages are the seam. Nothing here re-implements their sliding
// window: what needs proving is our own wiring — which number reaches which tier, and
// what each of the answers the library can give turns into.
const upstash = vi.hoisted(() => ({
  clients: [] as { url: string; token: string }[],
  built: [] as { prefix: string; limit: number; window: string; timeout: number }[],
  limit: vi.fn(),
}));

vi.mock("@upstash/redis", () => ({
  Redis: class {
    constructor(config: { url: string; token: string }) {
      upstash.clients.push(config);
    }
  },
}));

vi.mock("@upstash/ratelimit", () => {
  class Ratelimit {
    constructor(config: { prefix: string; timeout: number; limiter: { limit: number; window: string } }) {
      upstash.built.push({
        prefix: config.prefix,
        limit: config.limiter.limit,
        window: config.limiter.window,
        timeout: config.timeout,
      });
    }
    limit(identifier: string) {
      return upstash.limit(identifier);
    }
  }
  return {
    Ratelimit: Object.assign(Ratelimit, {
      slidingWindow: (limit: number, window: string) => ({ limit, window }),
    }),
  };
});

const URL_VAR = "UPSTASH_REDIS_REST_URL";
const TOKEN_VAR = "UPSTASH_REDIS_REST_TOKEN";
const IP = "203.0.113.7";

function set(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

// lib/ratelimit.ts builds its three limiters once and keeps them, so a case that
// changes the environment loads the module again, as test/indexer.unit.test.ts does.
// An absent key means the variable is absent, which is what the default spells out.
type LimiterEnv = { url?: string; token?: string };

async function loadLimiter(env: LimiterEnv = { url: "https://upstash.invalid", token: "token" }) {
  vi.resetModules();
  set(URL_VAR, env.url);
  set(TOKEN_VAR, env.token);
  return await import("@/lib/ratelimit");
}

function granted(overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    limit: 60,
    remaining: 59,
    reset: Date.now() + 30_000,
    pending: Promise.resolve(),
    ...overrides,
  };
}

const configured = { url: process.env[URL_VAR], token: process.env[TOKEN_VAR] };

afterEach(() => {
  upstash.clients.length = 0;
  upstash.built.length = 0;
  upstash.limit.mockReset();
  set(URL_VAR, configured.url);
  set(TOKEN_VAR, configured.token);
});

describe("the three tiers", () => {
  it("gives each tier its number, its own prefix and one shared client", async () => {
    upstash.limit.mockResolvedValue(granted());
    const { LIMITS, checkLimit } = await loadLimiter();
    expect(LIMITS).toEqual({ read: 60, write: 10, upload: 5 });

    await checkLimit("read", IP);
    expect(upstash.built).toEqual([
      { prefix: "peakpump:read", limit: 60, window: "1 m", timeout: 1_000 },
      { prefix: "peakpump:write", limit: 10, window: "1 m", timeout: 1_000 },
      { prefix: "peakpump:upload", limit: 5, window: "1 m", timeout: 1_000 },
    ]);
    // Distinct prefixes are what stop a read from spending a write's allowance, and
    // one client is what keeps the three of them on a single connection.
    expect(upstash.clients).toHaveLength(1);
  });

  it("counts against the identifier it was handed", async () => {
    upstash.limit.mockResolvedValue(granted());
    const { checkLimit } = await loadLimiter();
    await checkLimit("upload", IP);
    expect(upstash.limit).toHaveBeenCalledWith(IP);
  });
});

describe("what the limiter's answers become", () => {
  it("reports an allowance with the counters the limiter returned", async () => {
    const reset = Date.now() + 30_000;
    upstash.limit.mockResolvedValue(granted({ limit: 10, remaining: 9, reset }));
    const { checkLimit, limitHeaders } = await loadLimiter();

    const verdict = await checkLimit("write", IP);
    expect(verdict).toEqual({ kind: "allowed", tier: "write", limit: 10, remaining: 9, resetAt: reset });
    expect(limitHeaders(verdict)).toEqual({
      "x-ratelimit-limit": "10",
      "x-ratelimit-remaining": "9",
      // Epoch seconds, which is what a client can hold its own clock against. The
      // library counts in milliseconds.
      "x-ratelimit-reset": String(Math.ceil(reset / 1000)),
    });
  });

  it("refuses with a 429 and a retry that is never immediate", async () => {
    // A window that closed a moment ago, so the seconds left are negative: a
    // Retry-After of 0 invites the retry that would be refused again.
    upstash.limit.mockResolvedValue(granted({ success: false, remaining: 0, reset: Date.now() - 5_000 }));
    const { checkLimit, tooManyRequests } = await loadLimiter();

    const verdict = await checkLimit("write", IP);
    expect(verdict.kind).toBe("limited");
    if (verdict.kind !== "limited") throw new Error("unreachable, narrowed above");

    const response = tooManyRequests(verdict);
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("1");
    expect(response.headers.get("x-ratelimit-remaining")).toBe("0");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: verdict.message });
  });

  it("does not report counters for a pass the library timed out into", async () => {
    // reason: "timeout" is the library's own fail-open. Nothing was counted, so a
    // header claiming a remaining allowance would be reporting a number nobody wrote.
    upstash.limit.mockResolvedValue(granted({ reason: "timeout" }));
    const { checkLimit, limitHeaders } = await loadLimiter();

    const verdict = await checkLimit("read", IP);
    expect(verdict.kind).toBe("unlimited");
    expect(limitHeaders(verdict)).toEqual({});
  });

  it("fails open when the limiter throws", async () => {
    upstash.limit.mockRejectedValue(new Error("ECONNRESET"));
    const { checkLimit } = await loadLimiter();

    const verdict = await checkLimit("read", IP);
    // Failing closed would refuse every request on a machine whose Upstash is down.
    expect(verdict.kind).toBe("unlimited");
    if (verdict.kind !== "unlimited") throw new Error("unreachable, narrowed above");
    expect(verdict.reason).not.toBe("");
  });
});

describe("nothing configured", () => {
  it("fails open, says so, and builds no client at all", async () => {
    upstash.limit.mockResolvedValue(granted());
    const { checkLimit } = await loadLimiter({});

    expect(await checkLimit("write", IP)).toEqual({
      kind: "unlimited",
      tier: "write",
      reason: expect.stringContaining("configured"),
    });
    // The stub would have granted a pass, so a limiter that was built and consulted
    // would come back allowed and fail the assertion above as well.
    expect(upstash.clients).toHaveLength(0);
    expect(upstash.limit).not.toHaveBeenCalled();
  });

  it("treats the empty value .env.example ships as unset", async () => {
    const { checkLimit } = await loadLimiter({ url: "", token: "" });
    expect((await checkLimit("read", IP)).kind).toBe("unlimited");
    expect(upstash.clients).toHaveLength(0);
  });

  it("builds nothing when only one of the two is set", async () => {
    // Half a configuration is a deployment mistake, and a Redis client with no token
    // would fail on every call rather than at construction.
    const { checkLimit } = await loadLimiter({ url: "https://upstash.invalid" });
    expect((await checkLimit("read", IP)).kind).toBe("unlimited");
    expect(upstash.clients).toHaveLength(0);
  });
});

describe("who is being counted", () => {
  function request(headers: Record<string, string>) {
    return new Request("https://peakpump.invalid/api/metadata", { headers });
  }

  it("takes the first hop of x-forwarded-for over x-real-ip", async () => {
    const { clientIdentifier } = await loadLimiter();
    // Later hops are whatever an upstream appended; the first is the client as the
    // nearest proxy saw it.
    const forwarded = request({ "x-forwarded-for": ` ${IP} , 10.0.0.1`, "x-real-ip": "10.0.0.2" });
    expect(clientIdentifier(forwarded)).toBe(IP);
  });

  it("falls through to x-real-ip and then to one shared bucket", async () => {
    const { clientIdentifier } = await loadLimiter();
    expect(clientIdentifier(request({ "x-forwarded-for": "", "x-real-ip": IP }))).toBe(IP);
    // Blunt on purpose: a bucket nobody can leave by sending a header.
    expect(clientIdentifier(request({}))).toBe("no-forwarded-ip");
  });
});
