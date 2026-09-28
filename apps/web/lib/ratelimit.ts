import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

import { configuredEnv } from "@/lib/env";

// Three tiers over one Redis client, sliding window of a minute each.
//
// Unconfigured or erroring Upstash fails open, with the reason travelling in the
// verdict. Failing closed would brick every route on a machine with no Upstash, and
// this project already treats an absent optional service as a supported state
// (lib/graphql.ts). The consequence is worth stating plainly: with the two UPSTASH_
// variables unset there is no limit at all, so setting them is a deployment
// requirement and not an optimisation.

export const LIMITS = { read: 60, write: 10, upload: 5 } as const;

export type LimitTier = keyof typeof LIMITS;

const WINDOW = "1 m";

// The library's own fail-open, at a fifth of its 5 s default. A limiter that cannot
// answer within a second costs the request more than the absent limit does.
const LIMITER_TIMEOUT_MS = 1_000;

const UNCONFIGURED = "No limiter is configured.";
const UNREACHABLE = "The limiter could not be reached.";
const TIMED_OUT = "The limiter did not answer in time.";

const TOO_MANY = "Too many requests. Wait a moment and try again.";

export type LimitVerdict =
  | { kind: "allowed"; tier: LimitTier; limit: number; remaining: number; resetAt: number }
  | { kind: "limited"; tier: LimitTier; limit: number; resetAt: number; message: string }
  | { kind: "unlimited"; tier: LimitTier; reason: string };

let limiters: Record<LimitTier, Ratelimit> | null = null;

function build(redis: Redis, tier: LimitTier): Ratelimit {
  return new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(LIMITS[tier], WINDOW),
    // Distinct prefixes, so a read does not spend a write's allowance and the three
    // windows can be reasoned about one at a time in the Upstash console.
    prefix: `peakpump:${tier}`,
    timeout: LIMITER_TIMEOUT_MS,
  });
}

// Built on first use and kept: the three limiters share one HTTP client, and the
// environment cannot change under a running process. A test that changes it
// re-imports the module, the pattern test/indexer.unit.test.ts uses.
function tiers(): Record<LimitTier, Ratelimit> | null {
  if (limiters !== null) return limiters;
  const url = configuredEnv("UPSTASH_REDIS_REST_URL");
  const token = configuredEnv("UPSTASH_REDIS_REST_TOKEN");
  if (url === null || token === null) return null;
  const redis = new Redis({ url, token });
  limiters = { read: build(redis, "read"), write: build(redis, "write"), upload: build(redis, "upload") };
  return limiters;
}

export async function checkLimit(tier: LimitTier, identifier: string): Promise<LimitVerdict> {
  const limiter = tiers()?.[tier];
  if (limiter === undefined) return { kind: "unlimited", tier, reason: UNCONFIGURED };

  try {
    const verdict = await limiter.limit(identifier);
    // A pass the library granted because Redis did not answer within the timeout. The
    // command still lands, so the request is counted; only the counters are lost, and a
    // header cannot report a number that never arrived.
    if (verdict.reason === "timeout") return { kind: "unlimited", tier, reason: TIMED_OUT };
    return verdict.success
      ? {
          kind: "allowed",
          tier,
          limit: verdict.limit,
          remaining: verdict.remaining,
          resetAt: verdict.reset,
        }
      : { kind: "limited", tier, limit: verdict.limit, resetAt: verdict.reset, message: TOO_MANY };
  } catch {
    return { kind: "unlimited", tier, reason: UNREACHABLE };
  }
}

// Nothing to report when there is no limit: a header claiming a limit of 0 remaining
// 0 would be read by a client as a block.
export function limitHeaders(verdict: LimitVerdict): Record<string, string> {
  if (verdict.kind === "unlimited") return {};
  const resetSeconds = Math.ceil(verdict.resetAt / 1000);
  if (verdict.kind === "allowed") {
    return {
      "x-ratelimit-limit": String(verdict.limit),
      "x-ratelimit-remaining": String(verdict.remaining),
      "x-ratelimit-reset": String(resetSeconds),
    };
  }
  return {
    "x-ratelimit-limit": String(verdict.limit),
    "x-ratelimit-remaining": "0",
    "x-ratelimit-reset": String(resetSeconds),
    // Whole seconds, and never zero: a Retry-After of 0 invites an immediate retry
    // that would be refused again.
    "retry-after": String(Math.max(1, Math.ceil((verdict.resetAt - Date.now()) / 1000))),
  };
}

// The limiter's own answer, so all three routes refuse in the same words.
export function tooManyRequests(verdict: Extract<LimitVerdict, { kind: "limited" }>): Response {
  return Response.json(
    { error: verdict.message },
    { status: 429, headers: { ...limitHeaders(verdict), "cache-control": "no-store" } },
  );
}

const SHARED_BUCKET = "no-forwarded-ip";

// The first hop is the client as the nearest proxy saw it; later hops are whatever an
// upstream appended and can be forged. Behind a proxy that sets neither header every
// caller shares one bucket, which is blunt but cannot be bypassed by sending a header.
export function clientIdentifier(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  if (first !== undefined && first !== "") return first;
  const real = request.headers.get("x-real-ip")?.trim();
  return real !== undefined && real !== "" ? real : SHARED_BUCKET;
}
