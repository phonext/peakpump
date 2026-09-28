"use client";

import { CURVE_IMPL, PEAK_TOKEN_IMPL } from "@peakpump/shared/addresses";
import { formatFeeBps } from "@peakpump/shared/fees";
import { formatAddress, formatPercent } from "@peakpump/shared/format";
import { Chip } from "@peakpump/ui/Chip";
import { Skeleton } from "@peakpump/ui/Skeleton";
import { Tooltip } from "@peakpump/ui/Tooltip";
import { skipToken, useQuery } from "@tanstack/react-query";
import type { Address } from "viem";
import { ReadFailure } from "@/components/token/ReadFailure";
import { useBalances } from "@/hooks/useBalances";
import { useMarketParams } from "@/hooks/useMarketParams";
import { useTokenLive } from "@/hooks/useTokenLive";
import { readCloneIdentity } from "@/lib/clone-identity";
import { holdingBps } from "@/lib/token-balances";
import { publicClient } from "@/lib/viem";

// Nothing here is asserted from metadata. Each of the four claims is a comparison
// between two chain reads, and a claim whose read has not landed is not shown at
// all: an unproven badge in a neutral tone would be the assertion this panel
// exists to replace.
//
// The two figures below the badges are figures and not badges, because a Chip
// renders at the fifth type step and DESIGN.md's Responsive section floors a
// number at the third on a phone. They are also the only local arithmetic in this
// file — holdingBps on two chain reads, which is not a fee, a quote, an output
// amount or a refund, and does not sit beside a submit control.
const FIGURE = "mono text-body text-pp-text break-all md:text-small";

// A figure's line box belongs to the type step it draws in, and FIGURE is the one class
// on this page that changes step at a breakpoint: text-body at 16px carries a 1.5 line
// height (24) and text-small at 13px a 1.4 one (18.2). A skeleton holding one number for
// both widths is four pixels short on a phone and two tall on a desktop, so the wrapper
// carries the height and the span fills it — a length cannot answer two viewports alone.
// The small step's line box is fractional, and a wrapper that rounds it down by .2px is
// the difference between a box that rounds to its replacement and one that does not.
const FIGURE_LINE = "h-[24px] md:h-[18.2px]";
// The fee sentence is two figures joined by words, and in this column it always breaks
// to a second line, so its box is two line boxes and not one.
const FIGURE_TWO_LINES = "h-[48px] md:h-[36.4px]";

function FigureSkeleton({ width, lines }: { width: number; lines: "one" | "two" }) {
  return (
    <div className={lines === "two" ? FIGURE_TWO_LINES : FIGURE_LINE}>
      <Skeleton width={width} height="100%" />
    </div>
  );
}

interface Badge {
  label: string;
  proof: string;
  proven: boolean;
}

export function SafetyBadges({ curve }: { curve: Address }) {
  const params = useMarketParams(curve);
  const live = useTokenLive(curve);
  const balances = useBalances(params.data?.token, params.data?.creator);
  const token = params.data?.token;

  // A clone's runtime is written by CREATE and never changes, so this is the second
  // read on the page that may be held forever. Both codes come back in one
  // queryFn: they are one verdict to the reader and two halves of it arriving in
  // different frames would flicker a badge in and out.
  const clones = useQuery({
    queryKey: ["clone-identity", curve, token ?? null],
    queryFn:
      token === undefined
        ? skipToken
        : () =>
            Promise.all([
              readCloneIdentity(publicClient, token, PEAK_TOKEN_IMPL),
              readCloneIdentity(publicClient, curve, CURVE_IMPL),
            ]),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
  });

  if (params.error !== null) return <ReadFailure error={params.error} onRetry={params.refetch} />;
  if (clones.error !== null) return <ReadFailure error={clones.error} onRetry={clones.refetch} />;

  const marketParams = params.data;
  const codes = clones.data;
  if (marketParams === undefined || codes === undefined) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          {/* Chip-shaped, at the height a Chip renders inside the Tooltip's 44px
              trigger, so the group occupies its final box before the reads land.
              The widths are the proven labels' own rather than approximations,
              because a wrap that lands a row short or a row over moves this whole
              column, and a group that wraps like its replacement is the difference
              between a 200px box and a 148px one at the desktop width. */}
          {[98, 124, 102, 194].map((width) => (
            <span key={width} className="inline-flex min-h-[44px] items-center">
              <Skeleton width={width} height={30} />
            </span>
          ))}
        </div>
        {/* The sentence and the two labels below are static, so they are printed and
          only the figures shimmer: this column is the one below with its reads still
          pending, and reserving the chips alone left the panel 119px short of the box
          it resolved into, which pushed the whole left rail down once the reads landed. */}
        <p className="text-small text-pp-text-muted">
          Each badge is a read on this token and this curve. Tap one for the proof.
        </p>
        <div className="flex flex-col gap-1">
          <p className="text-small text-pp-text-muted">Creator holds</p>
          <FigureSkeleton width={64} lines="one" />
        </div>
        <div className="flex flex-col gap-1">
          <p className="text-small text-pp-text-muted">Fee on every trade</p>
          <FigureSkeleton width={140} lines="two" />
        </div>
      </div>
    );
  }

  const [tokenClone, curveClone] = codes;
  const badges: readonly Badge[] = [
    {
      label: "Fixed supply",
      // Equality of two immutable values, not of a balance: S is written at
      // initialize and PeakToken has no mint, so this pair can never drift.
      proven: marketParams.totalSupply === marketParams.S,
      proof:
        "The token's total supply is the curve's S. Both were written once, at initialize, and neither has a setter.",
    },
    {
      label: "No mint function",
      proven: tokenClone.matches,
      proof: `The token is an EIP-1167 clone of the PeakToken implementation at ${formatAddress(PEAK_TOKEN_IMPL)}. That implementation's ABI declares no mint and no burn, so no supply can be added.`,
    },
    {
      label: "No admin key",
      proven: tokenClone.matches,
      proof:
        "The same clone: PeakToken has no owner, no admin and no pause. A clone runtime is 45 bytes and holds no storage slot for one.",
    },
    {
      label: "Liquidity stays on the curve",
      proven: curveClone.matches,
      proof: `The curve is an EIP-1167 clone of the Curve implementation at ${formatAddress(CURVE_IMPL)}. Its only outbound paths are sell, withdrawDeferred and sweepDust, which moves exactly the accumulated dust. There is no LP token to withdraw.`,
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {badges.map((badge) => (
          <Tooltip key={badge.label} content={badge.proof}>
            <Chip tone={badge.proven ? "up" : "down"}>
              {badge.proven ? badge.label : `Not proven: ${badge.label}`}
            </Chip>
          </Tooltip>
        ))}
      </div>
      <p className="text-small text-pp-text-muted">
        Each badge is a read on this token and this curve. Tap one for the proof.
      </p>

      <div className="flex flex-col gap-1">
        <p className="text-small text-pp-text-muted">Creator holds</p>
        {balances === null ? (
          <FigureSkeleton width={64} lines="one" />
        ) : (
          <p className={FIGURE}>
            {formatPercent(holdingBps(balances.creatorTokenWei, marketParams.totalSupply))} of supply
          </p>
        )}
      </div>

      {/* This market's own snapshot, taken at create and carried in its storage.
          The factory's current defaults can differ and already do, so the factory
          is not read here. */}
      <div className="flex flex-col gap-1">
        <p className="text-small text-pp-text-muted">Fee on every trade</p>
        {live.data === undefined ? (
          <FigureSkeleton width={140} lines="two" />
        ) : (
          <p className={FIGURE}>
            {formatFeeBps(BigInt(live.data.feeBps))}, of which{" "}
            {formatFeeBps(BigInt(live.data.creatorBps))} to the creator
          </p>
        )}
      </div>
    </div>
  );
}
