import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DELETE as deleteComment } from "@/app/api/comments/[id]/route";
import { GET as listComments, POST as postComment } from "@/app/api/markets/[curve]/comments/route";

// The route's own laws, on an in-memory table: the 30-second throttle, the
// 500-codepoint cap through the shared schema, the tombstone, the author-only
// delete, and the keyset order. The session is replaced at the lib/session
// boundary; the database at the lib/db boundary; the pipeline never runs.
const state = vi.hoisted(() => ({
  session: "signed-in" as "signed-in" | "signed-out",
  comments: [] as {
    id: string;
    walletId: string;
    market: string;
    body: string | null;
    createdAt: Date;
    deletedAt: Date | null;
  }[],
  seq: 0,
}));

const ME = "wallet-1";
const OTHER = "wallet-2";
const MY_ADDRESS = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266";
const OTHER_ADDRESS = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8";

vi.mock("@/lib/session", () => ({
  requireSession: async () =>
    state.session === "signed-in"
      ? { kind: "ok", session: { user: { id: ME, address: MY_ADDRESS } } }
      : {
          kind: "denied",
          response: Response.json({ error: "Sign in to do that." }, { status: 401, headers: { "cache-control": "no-store" } }),
        },
}));

type Where = {
  market?: string;
  walletId?: string;
  id?: string | { lt: string };
  createdAt?: Date | { lt: Date };
  OR?: Where[];
};

vi.mock("@/lib/db", () => {
  function matches(row: (typeof state.comments)[number], where: Where): boolean {
    if (where.market !== undefined && row.market !== where.market) return false;
    if (where.walletId !== undefined && row.walletId !== where.walletId) return false;
    if (where.id !== undefined && typeof where.id !== "string" && !(row.id < where.id.lt)) return false;
    if (where.createdAt !== undefined) {
      const bound = where.createdAt instanceof Date ? where.createdAt.getTime() : where.createdAt.lt.getTime();
      if (where.createdAt instanceof Date ? row.createdAt.getTime() !== bound : !(row.createdAt.getTime() < bound)) {
        return false;
      }
    }
    if (where.OR !== undefined && !where.OR.some((clause) => matches(row, clause))) return false;
    return true;
  }

  return {
    db: () => ({
      comment: {
        findUnique: async ({ where }: { where: { id: string } }) =>
          state.comments.find((row) => row.id === where.id) ?? null,
        findFirst: async ({ where }: { where: Where }) =>
          [...state.comments].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).find((row) => matches(row, where)) ?? null,
        findMany: async ({ where, take }: { where: Where; take: number }) =>
          [...state.comments]
            .filter((row) => matches(row, where))
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1))
            .slice(0, take)
            .map((row) => ({ ...row, wallet: { address: row.walletId === ME ? MY_ADDRESS : OTHER_ADDRESS } })),
        create: async ({ data }: { data: { walletId: string; market: string; body: string } }) => {
          state.seq += 1;
          const row = { id: `c${state.seq}`, createdAt: new Date(), deletedAt: null, ...data };
          state.comments.push(row);
          return { ...row, wallet: { address: row.walletId === ME ? MY_ADDRESS : OTHER_ADDRESS } };
        },
        update: async ({ where, data }: { where: { id: string }; data: { body: null; deletedAt: Date } }) => {
          const row = state.comments.find((entry) => entry.id === where.id)!;
          row.body = data.body;
          row.deletedAt = data.deletedAt;
          return row;
        },
      },
    }),
  };
});

const UPSTASH_VARS = ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"];
const original = new Map(UPSTASH_VARS.map((name) => [name, process.env[name]]));
for (const name of UPSTASH_VARS) delete process.env[name];

const CURVE = "0x" + "ab".repeat(20);
const NOW = new Date("2026-09-15T12:00:00Z");

async function post(body: unknown, curve = CURVE) {
  return await postComment(
    new Request(`https://peakpump.invalid/api/markets/${curve}/comments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({ curve }) },
  );
}

async function list(curve = CURVE, query = "") {
  return await listComments(
    new Request(`https://peakpump.invalid/api/markets/${curve}/comments${query}`),
    { params: Promise.resolve({ curve }) },
  );
}

async function remove(id: string) {
  return await deleteComment(new Request(`https://peakpump.invalid/api/comments/${id}`, { method: "DELETE" }), {
    params: Promise.resolve({ id }),
  });
}

function seedComment(overrides: Partial<(typeof state.comments)[number]> = {}) {
  state.seq += 1;
  const row = {
    id: `c${state.seq}`,
    walletId: ME,
    market: CURVE,
    body: "A comment.",
    createdAt: new Date(),
    deletedAt: null,
    ...overrides,
  };
  state.comments.push(row);
  return row;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  state.session = "signed-in";
  state.comments = [];
});

afterAll(() => {
  for (const [name, value] of original) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("posting a comment", () => {
  it("requires a session", async () => {
    state.session = "signed-out";
    expect((await post({ body: "A comment." })).status).toBe(401);
    expect(state.comments).toHaveLength(0);
  });

  it("accepts one and answers it serialized", async () => {
    const response = await post({ body: "A comment." });
    const body = (await response.json()) as { comment: { id: string; address: string; body: string; deleted: boolean } };

    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body.comment).toEqual({
      id: "c1",
      address: MY_ADDRESS,
      body: "A comment.",
      deleted: false,
      createdAt: NOW.toISOString(),
    });
  });

  it("holds the shared 500-codepoint cap", async () => {
    const response = await post({ body: "p".repeat(501) });
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    // The sentence is packages/shared's, the same one the create form shows:
    // one length rule across every surface that accepts prose.
    expect(body.error).toBe("Description must be at most 500 characters");
    expect(state.comments).toHaveLength(0);
  });

  it("throttles the second comment on the same market for 30 seconds", async () => {
    await post({ body: "First." });

    const response = await post({ body: "Second." });
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(429);
    expect(body.error).toBe("Wait 30 seconds before commenting again.");
    expect(response.headers.get("retry-after")).toBe("30");

    await vi.advanceTimersByTimeAsync(31_000);
    expect((await post({ body: "Second." })).status).toBe(201);
    expect(state.comments).toHaveLength(2);
  });

  it("counts a tombstoned comment against the throttle", async () => {
    // Deleting a comment must not reset the clock, or delete-and-repost
    // becomes the bypass the throttle exists to close.
    seedComment({ createdAt: new Date(NOW.getTime() - 5_000), deletedAt: new Date(NOW.getTime() - 1_000), body: null });

    const response = await post({ body: "Again." });
    const body = (await response.json()) as { error: string };
    expect(response.status).toBe(429);
    expect(body.error).toBe("Wait 25 seconds before commenting again.");
  });

  it("does not throttle a different market", async () => {
    await post({ body: "First." });
    const other = "0x" + "cd".repeat(20);
    expect((await post({ body: "Elsewhere." }, other)).status).toBe(201);
  });
});

describe("listing comments", () => {
  it("is public, cached for a minute at the CDN, newest first", async () => {
    const first = seedComment({ createdAt: new Date(NOW.getTime() - 60_000), body: "First." });
    const second = seedComment({ createdAt: new Date(NOW.getTime() - 30_000), body: "Second." });

    const response = await list();
    const body = (await response.json()) as { comments: { id: string; body: string }[] };

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=30, s-maxage=60");
    expect(body.comments.map((comment) => comment.id)).toEqual([second.id, first.id]);
  });

  it("serves a tombstone without the body", async () => {
    seedComment({ body: "Removed by its author.", deletedAt: new Date(NOW.getTime() - 1000) });

    const response = await list();
    const body = (await response.json()) as { comments: { id: string; body?: string; deleted: boolean }[] };

    expect(body.comments).toHaveLength(1);
    expect(body.comments[0]?.deleted).toBe(true);
    expect(body.comments[0]?.body).toBeUndefined();
  });

  it("pages by cursor and not by offset", async () => {
    const oldest = seedComment({ createdAt: new Date(NOW.getTime() - 60_000), body: "Oldest." });
    const middle = seedComment({ createdAt: new Date(NOW.getTime() - 30_000), body: "Middle." });
    const newest = seedComment({ body: "Newest." });

    const firstPage = (await (await list()).json()) as { comments: { id: string }[] };
    expect(firstPage.comments.map((comment) => comment.id)).toEqual([newest.id, middle.id, oldest.id]);

    const secondPage = (await (await list(CURVE, `?before=${middle.id}`)).json()) as { comments: { id: string }[] };
    expect(secondPage.comments.map((comment) => comment.id)).toEqual([oldest.id]);
  });

  it("answers 404 for a curve that is not an address, without reading", async () => {
    const response = await list("not-a-curve");
    expect(response.status).toBe(404);
  });
});

describe("deleting a comment", () => {
  it("soft-deletes the author's own comment into a tombstone", async () => {
    const mine = seedComment();

    const response = await remove(mine.id);
    expect(response.status).toBe(200);

    const row = state.comments.find((entry) => entry.id === mine.id);
    // The row is kept and the body is gone: that is the tombstone.
    expect(row).toBeDefined();
    expect(row?.body).toBeNull();
    expect(row?.deletedAt).not.toBeNull();
  });

  it("refuses a comment that is not the caller's", async () => {
    const theirs = seedComment({ walletId: OTHER });
    expect((await remove(theirs.id)).status).toBe(403);

    const row = state.comments.find((entry) => entry.id === theirs.id);
    expect(row?.body).not.toBeNull();
  });

  it("answers 404 for a comment that does not exist", async () => {
    expect((await remove("c999")).status).toBe(404);
  });

  it("requires a session", async () => {
    state.session = "signed-out";
    expect((await remove("c1")).status).toBe(401);
  });
});
