import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { DELETE as unfollow } from "@/app/api/follows/[address]/route";
import { GET as listFollows, POST as postFollow } from "@/app/api/follows/route";
import { POST as postReport } from "@/app/api/reports/route";
import { DELETE as unwatch } from "@/app/api/watchlist/[market]/route";
import { GET as listWatchlist, POST as postWatch } from "@/app/api/watchlist/route";

// The idempotence laws of the social writes and the fixed set of a report, on
// in-memory tables. What is being tested is the route's behaviour around the
// unique constraints — a second identical write is a 200, not an error — and
// not the constraints themselves, which the schema already states.
const state = vi.hoisted(() => ({
  session: "signed-in" as "signed-in" | "signed-out",
  wallets: [
    { id: "wallet-1", address: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266", userId: "user-1" },
    { id: "wallet-2", address: "0x70997970c51812dc3a010c7d01b50e0d17dc79c8", userId: "user-2" },
  ],
  watchlist: [] as { id: string; userId: string; market: string }[],
  follows: [] as { id: string; userId: string; targetAddress: string }[],
  reports: [] as { reporterWalletId: string; targetType: string; targetId: string; reason: string }[],
  seq: 0,
}));

const ME = "wallet-1";
const MY_ADDRESS = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266";
const OTHER_ADDRESS = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8";
const TARGET = "0x90f79bf6eb2c4f8443659d30ef47b1e64cbf0b1c";

vi.mock("@/lib/session", () => ({
  requireSession: async () =>
    state.session === "signed-in"
      ? { kind: "ok", session: { user: { id: ME, address: MY_ADDRESS } } }
      : {
          kind: "denied",
          response: Response.json({ error: "Sign in to do that." }, { status: 401, headers: { "cache-control": "no-store" } }),
        },
}));

vi.mock("@/lib/db", () => ({
  db: () => ({
    wallet: {
      // Two where shapes: the GET routes look a wallet up by address for its
      // user's lists, and the write routes resolve the session's wallet id to
      // the user a Follow or WatchlistItem row keys on.
      findUnique: async ({ where }: { where: { address?: string; id?: string } }) => {
        const wallet = state.wallets.find(
          (entry) =>
            (where.address !== undefined && entry.address === where.address) ||
            (where.id !== undefined && entry.id === where.id),
        );
        if (wallet === undefined) return null;
        return {
          ...wallet,
          user: {
            watchlistItems: state.watchlist.filter((item) => item.userId === wallet.userId),
            follows: state.follows.filter((follow) => follow.userId === wallet.userId),
          },
        };
      },
    },
    watchlistItem: {
      findUnique: async ({ where }: { where: { userId_market: { userId: string; market: string } } }) =>
        state.watchlist.find(
          (item) => item.userId === where.userId_market.userId && item.market === where.userId_market.market,
        ) ?? null,
      create: async ({ data }: { data: { userId: string; market: string } }) => {
        state.seq += 1;
        const row = { id: `w${state.seq}`, ...data };
        state.watchlist.push(row);
        return row;
      },
      deleteMany: async ({ where }: { where: { userId: string; market: string } }) => {
        const matching = state.watchlist.filter(
          (item) => item.userId === where.userId && item.market === where.market,
        );
        state.watchlist = state.watchlist.filter((item) => !matching.includes(item));
        return { count: matching.length };
      },
    },
    follow: {
      findMany: async ({ where }: { where: { targetAddress: string } }) =>
        state.follows
          .filter((follow) => follow.targetAddress === where.targetAddress)
          .map((follow) => ({
            ...follow,
            user: { wallets: state.wallets.filter((wallet) => wallet.userId === follow.userId) },
          })),
      findUnique: async ({ where }: { where: { userId_targetAddress: { userId: string; targetAddress: string } } }) =>
        state.follows.find(
          (follow) =>
            follow.userId === where.userId_targetAddress.userId &&
            follow.targetAddress === where.userId_targetAddress.targetAddress,
        ) ?? null,
      create: async ({ data }: { data: { userId: string; targetAddress: string } }) => {
        state.seq += 1;
        const row = { id: `f${state.seq}`, ...data };
        state.follows.push(row);
        return row;
      },
      deleteMany: async ({ where }: { where: { userId: string; targetAddress: string } }) => {
        const matching = state.follows.filter(
          (follow) => follow.userId === where.userId && follow.targetAddress === where.targetAddress,
        );
        state.follows = state.follows.filter((follow) => !matching.includes(follow));
        return { count: matching.length };
      },
    },
    report: {
      findUnique: async ({ where }: { where: { reporterWalletId_targetType_targetId: { reporterWalletId: string; targetType: string; targetId: string } } }) =>
        state.reports.find(
          (report) =>
            report.reporterWalletId === where.reporterWalletId_targetType_targetId.reporterWalletId &&
            report.targetType === where.reporterWalletId_targetType_targetId.targetType &&
            report.targetId === where.reporterWalletId_targetType_targetId.targetId,
        ) ?? null,
      create: async ({ data }: { data: { reporterWalletId: string; targetType: string; targetId: string; reason: string } }) => {
        state.reports.push(data);
        return data;
      },
    },
  }),
}));

const UPSTASH_VARS = ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"];
const original = new Map(UPSTASH_VARS.map((name) => [name, process.env[name]]));
for (const name of UPSTASH_VARS) delete process.env[name];

const MARKET = "0x" + "ab".repeat(20);

// Route handlers are called directly, matching the house test style; this thin
// wrapper keeps every case below reading as one line. The context carries the
// resolved dynamic segment the way Next 16 hands it over: as a promise.
async function call<C>(
  handler: (request: Request, context: C) => Promise<Response>,
  url: string,
  method: string,
  body?: unknown,
  params: Record<string, string> = {},
) {
  return await handler(
    new Request(url, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    { params: Promise.resolve(params) } as C,
  );
}

afterEach(() => {
  state.session = "signed-in";
  state.watchlist = [];
  state.follows = [];
  state.reports = [];
  state.seq = 0;
});

afterAll(() => {
  for (const [name, value] of original) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("the watchlist", () => {
  it("lists a known address's markets publicly, cached for five minutes", async () => {
    state.watchlist = [
      { id: "w1", userId: "user-1", market: MARKET },
      { id: "w2", userId: "user-2", market: "0x" + "cd".repeat(20) },
    ];

    const response = await call(listWatchlist, `https://peakpump.invalid/api/watchlist?address=${MY_ADDRESS}`, "GET");
    const body = (await response.json()) as { markets: string[] };

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=60, s-maxage=300");
    // user-2's row belongs to user-2's list.
    expect(body.markets).toEqual([MARKET]);
  });

  it("answers an empty list for an address that never signed in", async () => {
    const response = await call(listWatchlist, `https://peakpump.invalid/api/watchlist?address=${TARGET}`, "GET");
    const body = (await response.json()) as { markets: string[] };
    expect(response.status).toBe(200);
    expect(body.markets).toEqual([]);
  });

  it("refuses a query without a wallet address", async () => {
    expect((await call(listWatchlist, "https://peakpump.invalid/api/watchlist", "GET")).status).toBe(400);
    expect((await call(listWatchlist, "https://peakpump.invalid/api/watchlist?address=peak", "GET")).status).toBe(400);
  });

  it("watches once and answers 200 the second time", async () => {
    const first = await call(postWatch, "https://peakpump.invalid/api/watchlist", "POST", { market: MARKET });
    const second = await call(postWatch, "https://peakpump.invalid/api/watchlist", "POST", { market: MARKET });

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(state.watchlist).toHaveLength(1);
    // The session names the signed-in wallet; the row keys on the user behind
    // it, so a wallet id here would be the foreign-key violation the route
    // once produced in production.
    expect(state.watchlist[0]?.userId).toBe("user-1");
  });

  it("unwatches idempotently", async () => {
    // The user behind the signed-in wallet (wallet-1), not the wallet itself.
    state.watchlist = [{ id: "w1", userId: "user-1", market: MARKET }];

    const first = await call(unwatch, `https://peakpump.invalid/api/watchlist/${MARKET}`, "DELETE", undefined, { market: MARKET });
    const second = await call(unwatch, `https://peakpump.invalid/api/watchlist/${MARKET}`, "DELETE", undefined, { market: MARKET });

    // A second click of unwatch is the same intent, not an error.
    expect(first.status).toBe(200);
    expect((await first.json()).removed).toBe(true);
    expect(second.status).toBe(200);
    expect((await second.json()).removed).toBe(false);
    expect(state.watchlist).toHaveLength(0);
  });

  it("requires a session to write", async () => {
    state.session = "signed-out";
    expect((await call(postWatch, "https://peakpump.invalid/api/watchlist", "POST", { market: MARKET })).status).toBe(401);
    expect((await call(unwatch, `https://peakpump.invalid/api/watchlist/${MARKET}`, "DELETE", undefined, { market: MARKET })).status).toBe(401);
  });
});

describe("follows", () => {
  it("answers who an address follows, and who follows an address", async () => {
    state.follows = [
      { id: "f1", userId: "user-1", targetAddress: TARGET },
      { id: "f2", userId: "user-2", targetAddress: MY_ADDRESS },
    ];

    const following = await call(listFollows, `https://peakpump.invalid/api/follows?address=${MY_ADDRESS}`, "GET");
    const followers = await call(listFollows, `https://peakpump.invalid/api/follows?target=${MY_ADDRESS}`, "GET");

    expect((await following.json()).following).toEqual([TARGET]);
    // user-2's wallet address is how the follower is named in public.
    expect((await followers.json()).followers).toEqual([OTHER_ADDRESS]);
    expect(followers.headers.get("cache-control")).toBe("public, max-age=60, s-maxage=300");
  });

  it("refuses both parameters at once, and neither", async () => {
    const both = `https://peakpump.invalid/api/follows?address=${MY_ADDRESS}&target=${TARGET}`;
    expect((await call(listFollows, both, "GET")).status).toBe(400);
    expect((await call(listFollows, "https://peakpump.invalid/api/follows", "GET")).status).toBe(400);
  });

  it("follows once and answers 200 the second time, unfollows idempotently", async () => {
    const first = await call(postFollow, "https://peakpump.invalid/api/follows", "POST", { address: TARGET });
    const second = await call(postFollow, "https://peakpump.invalid/api/follows", "POST", { address: TARGET });
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(state.follows).toHaveLength(1);
    // Same law as the watchlist row: the Follow keys on the user, never on
    // the wallet the session names.
    expect(state.follows[0]?.userId).toBe("user-1");

    const gone = await call(unfollow, `https://peakpump.invalid/api/follows/${TARGET}`, "DELETE", undefined, { address: TARGET });
    const again = await call(unfollow, `https://peakpump.invalid/api/follows/${TARGET}`, "DELETE", undefined, { address: TARGET });
    expect(gone.status).toBe(200);
    expect(again.status).toBe(200);
    expect(state.follows).toHaveLength(0);
  });

  it("requires a session to write", async () => {
    state.session = "signed-out";
    expect((await call(postFollow, "https://peakpump.invalid/api/follows", "POST", { address: TARGET })).status).toBe(401);
    expect((await call(unfollow, `https://peakpump.invalid/api/follows/${TARGET}`, "DELETE", undefined, { address: TARGET })).status).toBe(401);
  });
});

describe("reporting", () => {
  it("writes one row per target and answers 200 for the same report again", async () => {
    const report = { targetType: "MARKET", targetId: MARKET, reason: "SPAM" };

    const first = await call(postReport, "https://peakpump.invalid/api/reports", "POST", report);
    const second = await call(postReport, "https://peakpump.invalid/api/reports", "POST", report);

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(state.reports).toEqual([{ reporterWalletId: ME, ...report }]);
  });

  it("accepts every reason from the fixed set and no other", async () => {
    // A different target each time: one report per address per target is the
    // law, so a second report against the same target would be the duplicate
    // case below, whatever its reason.
    const targets = ["0x" + "11".repeat(20), "0x" + "22".repeat(20), "0x" + "33".repeat(20), "0x" + "44".repeat(20)];
    for (const [index, reason] of ["SPAM", "IMPERSONATION", "ABUSE", "OTHER"].entries()) {
      const response = await call(postReport, "https://peakpump.invalid/api/reports", "POST", {
        targetType: "ACCOUNT",
        targetId: targets[index],
        reason,
      });
      expect(response.status).toBe(201);
    }

    const refused = await call(postReport, "https://peakpump.invalid/api/reports", "POST", {
      targetType: "ACCOUNT",
      targetId: TARGET,
      reason: "ILLEGAL",
    });
    const body = (await refused.json()) as { error: string };
    expect(refused.status).toBe(400);
    expect(body.error).toBe("Reason must be one of spam, impersonation, abuse and other.");
  });

  it("refuses a target type outside the three, and a market target that is not an address", async () => {
    const type = await call(postReport, "https://peakpump.invalid/api/reports", "POST", {
      targetType: "TOKEN",
      targetId: MARKET,
      reason: "SPAM",
    });
    expect(type.status).toBe(400);
    expect((await type.json()).error).toBe("Target type must be market, comment or account.");

    const market = await call(postReport, "https://peakpump.invalid/api/reports", "POST", {
      targetType: "MARKET",
      targetId: "not-a-market",
      reason: "SPAM",
    });
    expect(market.status).toBe(400);

    // A comment target is an id and not an address, so it is accepted as one.
    const comment = await call(postReport, "https://peakpump.invalid/api/reports", "POST", {
      targetType: "COMMENT",
      targetId: "c1",
      reason: "ABUSE",
    });
    expect(comment.status).toBe(201);
  });

  it("requires a session", async () => {
    state.session = "signed-out";
    expect(
      (await call(postReport, "https://peakpump.invalid/api/reports", "POST", {
        targetType: "MARKET",
        targetId: MARKET,
        reason: "SPAM",
      })).status,
    ).toBe(401);
  });
});
