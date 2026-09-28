import { db } from "@/lib/db";
import { indexerQuery } from "@/lib/graphql";
import { bucketReachable, r2Config } from "@/lib/r2";
import { checkLimit, clientIdentifier, limitHeaders, tooManyRequests } from "@/lib/ratelimit";
import { publicClient } from "@/lib/viem";

// Four dependencies, probed in parallel, each with its own deadline and its own catch,
// so no failure can mask another and a slow one cannot decide the answer for the rest.
//
// An unconfigured dependency is reported as unconfigured and does not fail the route.
// Three of the four are unconfigured on a fresh checkout, and health that answered 503
// until every optional service was wired up would report nothing worth reading.

const PROBE_TIMEOUT_MS = 3_000;

// Read statically at module scope, the one place a NEXT_PUBLIC_ variable should be:
// Next inlines it at build time, and indexerQuery collapses "no URL" and "no answer"
// into the same null, so telling them apart has to happen here.
const INDEXER_URL = process.env.NEXT_PUBLIC_INDEXER_URL;

type Probe = { status: "ok"; ms: number } | { status: "down"; ms: number } | { status: "unconfigured" };

async function withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("probe timed out")), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function probe(work: () => Promise<unknown>): Promise<Probe> {
  const started = performance.now();
  try {
    await withDeadline(work(), PROBE_TIMEOUT_MS);
    return { status: "ok", ms: Math.round(performance.now() - started) };
  } catch {
    // The reason is deliberately not reported. A health endpoint is public, and an RPC
    // or S3 error string names hosts, buckets and sometimes credentials.
    return { status: "down", ms: Math.round(performance.now() - started) };
  }
}

// A fixed call with nothing from the request in it, answering with a boolean and a
// latency and never with a chain value. That is the line this codebase draws: no /api route
// forwards an RPC call, and no number a trade could be priced from leaves this route.
// cacheTime 0 because a cached answer would report the health of viem's cache.
function rpcProbe(): Promise<Probe> {
  return probe(() => publicClient.getBlockNumber({ cacheTime: 0 }));
}

function indexerProbe(): Promise<Probe> {
  if (INDEXER_URL === undefined || INDEXER_URL === "") return Promise.resolve({ status: "unconfigured" });
  return probe(async () => {
    const data = await indexerQuery<{ __typename: string }>("query Health { __typename }", {});
    if (data === null) throw new Error("the indexer did not answer");
  });
}

// The last probe to be wired up. Now it reaches Postgres with the same deadline
// and the same silence about reasons as the other three, and an unconfigured
// database still does not fail the route: three of four probes can be down and
// health's job is to say so, not to judge.
function databaseProbe(): Promise<Probe> {
  const prisma = db();
  if (prisma === null) return Promise.resolve({ status: "unconfigured" });
  return probe(() => prisma.$queryRaw`SELECT 1`);
}

function r2Probe(): Promise<Probe> {
  const config = r2Config();
  if (config === null) return Promise.resolve({ status: "unconfigured" });
  return probe(() => bucketReachable(config));
}

export async function GET(request: Request): Promise<Response> {
  const verdict = await checkLimit("read", clientIdentifier(request));
  if (verdict.kind === "limited") return tooManyRequests(verdict);

  const [rpc, indexer, database, r2] = await Promise.all([
    rpcProbe(),
    indexerProbe(),
    databaseProbe(),
    r2Probe(),
  ]);
  const checks = { rpc, indexer, database, r2 };

  const healthy = Object.values(checks).every((check) => check.status !== "down");
  return Response.json(
    { status: healthy ? "ok" : "degraded", checks },
    {
      status: healthy ? 200 : 503,
      headers: { "cache-control": "no-store", ...limitHeaders(verdict) },
    },
  );
}
