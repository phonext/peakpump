import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as postNonce } from "@/app/api/auth/nonce/route";
import { SIWE_CHAIN_ID, SIWE_STATEMENT, verifySiwe } from "@/lib/auth";

// The chain is never reached and no prisma engine starts: the database and the
// signature verification are replaced at their module boundaries, and what is
// tested is the route's own logic — the nonce's shape, TTL and binding, the
// field pinning verifySiweMessage cannot do, and the single-use law.
const state = vi.hoisted(() => ({
  configured: true,
  verify: true,
  // A concurrent verify consumed the nonce between the read and the delete.
  lostRace: false,
  nonces: [] as { nonce: string; address: string; expiresAt: Date }[],
  deleted: [] as { nonce: string; address: string }[],
  wallets: [] as { id: string; address: string; userId: string }[],
  users: 0,
}));

vi.mock("@/lib/db", () => ({
  db: () =>
    state.configured
      ? {
          siweNonce: {
            findFirst: async ({ where }: { where: { nonce: string; address: string; expiresAt: { gt: Date } } }) =>
              state.nonces.find(
                (row) =>
                  row.nonce === where.nonce &&
                  row.address === where.address &&
                  row.expiresAt > where.expiresAt.gt,
              ) ?? null,
            deleteMany: async ({ where }: { where: { nonce?: string; address?: string; expiresAt?: { lte: Date } } }) => {
              if (state.lostRace) return { count: 0 };
              // Three where shapes arrive here: the verify's (nonce, address),
              // and the route's lazy sweep (address, expired-at-or-before).
              const matching = state.nonces.filter((row) => {
                if (where.nonce !== undefined && row.nonce !== where.nonce) return false;
                if (where.address !== undefined && row.address !== where.address) return false;
                if (where.expiresAt?.lte !== undefined && !(row.expiresAt <= where.expiresAt.lte)) return false;
                return true;
              });
              state.nonces = state.nonces.filter((row) => !matching.includes(row));
              state.deleted.push({ nonce: where.nonce ?? "", address: where.address ?? "" });
              return { count: matching.length };
            },
            create: async ({ data }: { data: { nonce: string; address: string; expiresAt: Date } }) => {
              state.nonces.push(data);
              return data;
            },
          },
          wallet: {
            findUnique: async ({ where }: { where: { address: string } }) =>
              state.wallets.find((wallet) => wallet.address === where.address) ?? null,
          },
          user: {
            create: async ({ data }: { data: { wallets: { create: { address: string } } } }) => {
              state.users += 1;
              const wallet = {
                id: `wallet-${state.users}`,
                address: data.wallets.create.address,
                userId: `user-${state.users}`,
              };
              state.wallets.push(wallet);
              return { wallets: [wallet] };
            },
          },
        }
      : null,
}));

vi.mock("@/lib/siwe", () => ({
  verifySiweSignature: async () => state.verify,
}));

const UPSTASH_VARS = ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"];
const original = new Map(
  [...UPSTASH_VARS, "NEXTAUTH_URL"].map((name) => [name, process.env[name]]),
);
for (const name of UPSTASH_VARS) delete process.env[name];
// The domain check reads NEXTAUTH_URL per call, so a plain assignment before the
// first case is enough and no module reload is needed.
process.env.NEXTAUTH_URL = "https://peakpump.invalid";

const ADDRESS = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266";
const CHECKSUMMED = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

const NOW = new Date("2026-09-15T12:00:00Z");

function siweMessage(overrides: {
  address?: string;
  domain?: string;
  statement?: string;
  chainId?: number;
  version?: string;
  nonce?: string;
} = {}): string {
  return [
    `${overrides.domain ?? "peakpump.invalid"} wants you to sign in with your Ethereum account:`,
    overrides.address ?? CHECKSUMMED,
    "",
    overrides.statement ?? SIWE_STATEMENT,
    "",
    "URI: https://peakpump.invalid",
    `Version: ${overrides.version ?? "1"}`,
    `Chain ID: ${overrides.chainId ?? SIWE_CHAIN_ID}`,
    `Nonce: ${overrides.nonce ?? "a".repeat(64)}`,
    "Issued At: 2026-09-15T11:59:30.000Z",
  ].join("\n");
}

async function postNonceRoute(payload: unknown) {
  return await postNonce(
    new Request("https://peakpump.invalid/api/auth/nonce", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof payload === "string" ? payload : JSON.stringify(payload),
    }),
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  state.configured = true;
  state.verify = true;
  state.lostRace = false;
  state.nonces = [];
  state.deleted = [];
  state.wallets = [];
  state.users = 0;
});

afterAll(() => {
  for (const [name, value] of original) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("minting a nonce", () => {
  it("answers 64 hex characters bound to the address, dead in five minutes", async () => {
    const response = await postNonceRoute({ address: CHECKSUMMED });
    const body = (await response.json()) as { nonce: string };

    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body.nonce).toMatch(/^[0-9a-f]{64}$/);

    const row = state.nonces.find((nonce) => nonce.nonce === body.nonce);
    // 32 bytes of CSPRNG hex, not viem's uid(96); the stored address is
    // lowercased whatever case the request carried.
    expect(row?.address).toBe(ADDRESS);
    expect(row?.expiresAt.getTime()).toBe(NOW.getTime() + 5 * 60 * 1000);
  });

  it("deletes only that address's expired rows on the way in", async () => {
    const mine = { nonce: "e".repeat(64), address: ADDRESS, expiresAt: new Date(NOW.getTime() - 1000) };
    const mineLive = { nonce: "f".repeat(64), address: ADDRESS, expiresAt: new Date(NOW.getTime() + 60_000) };
    const other = { nonce: "0".repeat(64), address: "0x" + "1".repeat(40), expiresAt: new Date(NOW.getTime() - 1000) };
    state.nonces = [mine, mineLive, other];

    await postNonceRoute({ address: ADDRESS });

    // The lazy sweep is scoped: another address's expired row is not this
    // request's to delete, and the address's own live rows are not either.
    expect(state.nonces).toContain(mineLive);
    expect(state.nonces).toContain(other);
    expect(state.nonces).not.toContain(mine);
    // One row in, the new nonce.
    expect(state.nonces).toHaveLength(3);
  });

  it("refuses an address that is not one, and a body that is not JSON", async () => {
    expect((await postNonceRoute({ address: "peak" })).status).toBe(400);
    expect((await postNonceRoute("not json")).status).toBe(400);
    expect(state.nonces).toHaveLength(0);
  });

  it("answers 503 before writing when there is no database", async () => {
    state.configured = false;
    expect((await postNonceRoute({ address: ADDRESS })).status).toBe(503);
  });
});

describe("verifying a sign-in", () => {
  const NONCE = "a".repeat(64);

  beforeEach(() => {
    state.nonces = [{ nonce: NONCE, address: ADDRESS, expiresAt: new Date(NOW.getTime() + 60_000) }];
  });

  it("returns the wallet for a first sign-in and consumes the nonce", async () => {
    const wallet = await verifySiwe(siweMessage(), "0x" + "b".repeat(130));

    expect(wallet).toEqual({ id: "wallet-1", address: ADDRESS });
    expect(state.users).toBe(1);
    expect(state.nonces).toHaveLength(0);
  });

  it("finds the existing wallet and creates no second user", async () => {
    state.wallets = [{ id: "known", address: ADDRESS, userId: "user-1" }];

    const wallet = await verifySiwe(siweMessage(), "0x" + "b".repeat(130));

    expect(wallet).toEqual({ id: "known", address: ADDRESS });
    expect(state.users).toBe(0);
  });

  it("keeps the nonce when the signature does not verify", async () => {
    state.verify = false;

    expect(await verifySiwe(siweMessage(), "0x" + "b".repeat(130))).toBeNull();
    // Single-use means single-use on success: a failed attempt has not spent
    // the challenge, so the same nonce can be presented again.
    expect(state.nonces).toHaveLength(1);
  });

  // The four fields below are the ones verifySiweMessage cannot pin. A message
  // carrying any of them verifies against the chain and still must not sign in.
  it("rejects a different statement", async () => {
    const altered = await verifySiwe(
      siweMessage({ statement: "Sign in to peakpump. This request will cost a fee." }),
      "0x" + "b".repeat(130),
    );
    expect(altered).toBeNull();
    expect(state.nonces).toHaveLength(1);
  });

  it("rejects another chain", async () => {
    expect(await verifySiwe(siweMessage({ chainId: 1 }), "0x" + "b".repeat(130))).toBeNull();
    expect(state.nonces).toHaveLength(1);
  });

  it("rejects another version", async () => {
    expect(await verifySiwe(siweMessage({ version: "2" }), "0x" + "b".repeat(130))).toBeNull();
    expect(state.nonces).toHaveLength(1);
  });

  it("rejects another domain", async () => {
    expect(await verifySiwe(siweMessage({ domain: "evil.invalid" }), "0x" + "b".repeat(130))).toBeNull();
    expect(state.nonces).toHaveLength(1);
  });

  it("rejects a nonce that is unknown, expired, or bound to another address", async () => {
    expect(await verifySiwe(siweMessage({ nonce: "c".repeat(64) }), "0x" + "b".repeat(130))).toBeNull();

    state.nonces = [{ nonce: NONCE, address: ADDRESS, expiresAt: new Date(NOW.getTime() - 1000) }];
    expect(await verifySiwe(siweMessage(), "0x" + "b".repeat(130))).toBeNull();

    state.nonces = [{ nonce: NONCE, address: "0x" + "1".repeat(40), expiresAt: new Date(NOW.getTime() + 60_000) }];
    expect(await verifySiwe(siweMessage(), "0x" + "b".repeat(130))).toBeNull();
  });

  it("loses the race on a nonce two verifies consumed", async () => {
    state.lostRace = true;

    expect(await verifySiwe(siweMessage(), "0x" + "b".repeat(130))).toBeNull();
    // The delete count is what refused this attempt, and no wallet was written.
    expect(state.users).toBe(0);
  });
});
