"use client";

import { formatUsdc6 } from "@peakpump/shared/format";
import { EmptyState } from "@peakpump/ui/EmptyState";
import { Skeleton } from "@peakpump/ui/Skeleton";
import type { Address } from "viem";
import { AddressLink } from "@/components/token/AddressLink";
import { ReadFailure } from "@/components/token/ReadFailure";
import { useCreatorEarnings } from "@/hooks/useCreatorEarnings";
import { useMarketParams } from "@/hooks/useMarketParams";
import { listState } from "@/lib/indexer-state";

// Two sources in one panel, and the split is the point: the claimable figure is
// money the creator can pull, so it is an RPC read at the live cadence, and the
// history beside it is the indexer's. With NEXT_PUBLIC_INDEXER_URL unset the figure
// is still exact and only the list falls back to a sentence.
//
// No claim control here. claim() is a write against the vault for the whole balance
// across every market, so it belongs on the account that owns it and not on one
// market's page; this panel states the balance and where it lives.
const LIMIT = 20;

const FIGURE = "mono text-heading text-pp-text break-all";
const FIGURE_FAINT = "mono text-body text-pp-text-faint break-all md:text-small";

export function CreatorEarnings({ curve }: { curve: Address }) {
  const params = useMarketParams(curve);
  const creator = params.data?.creator;
  const { claimable6, credits } = useCreatorEarnings(curve, creator, LIMIT);
  const state = listState(credits);

  if (params.error !== null) return <ReadFailure error={params.error} onRetry={params.refetch} />;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <p className="text-small text-pp-text-muted">Claimable in the fee vault</p>
        {claimable6 === null ? (
          <Skeleton width={140} height={26} />
        ) : (
          <p className={FIGURE}>{formatUsdc6(claimable6)} USDC</p>
        )}
        {/* Stated because the number is bigger than this market: FeeVault keeps one
            balance per address (SPEC 5.4), so labelling it as this market's earnings
            would be wrong by however much the account earned elsewhere. */}
        <p className="text-small text-pp-text-muted">
          One balance per address, across every market this account created. Fees are
          credited on each trade and pulled with claim, never pushed.
        </p>
      </div>

      {/* The address the balance belongs to, so a reader can check the claim above
          against the vault themselves. */}
      <AddressLink label="Creator" address={creator} />

      <div className="flex flex-col gap-2">
        <p className="text-small text-pp-text-muted">Credited on this market</p>

        {state.kind === "loading" ? (
          // Six rows at the height a resolved one takes, which fills the list's own
          // max-h-[240px]: a row is 8 of padding either side, a mono line box, and a
          // hairline. TradesList and HoldersList reserve their caps the same way, and
          // fewer credits arrive shorter than this rather than taller.
          <ul className="max-h-[240px] rounded-pp flex flex-col overflow-y-auto">
            {[0, 1, 2, 3, 4, 5].map((slot) => (
              <li
                key={slot}
                className="border-b border-pp-hairline flex h-[40px] items-baseline justify-between gap-2 py-2"
              >
                <Skeleton width="42%" height="100%" />
                <Skeleton width="28%" height="100%" />
              </li>
            ))}
          </ul>
        ) : null}

        {state.kind === "offline" ? (
          <EmptyState
            title="Fee history is not connected"
            detail="Credits come from the indexer. The claimable figure above is read from the vault and is unaffected."
          />
        ) : null}

        {state.kind === "empty" ? (
          <EmptyState
            title="No fees credited yet"
            detail="A credit lands on the creator's first trade in this market."
          />
        ) : null}

        {state.kind === "rows" ? (
          <ul
            tabIndex={0}
            className="max-h-[240px] rounded-pp flex flex-col overflow-y-auto outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pp-accent-bright"
          >
            {state.rows.map((row) => (
              <li
                key={row.id}
                className="border-b border-pp-hairline flex items-baseline justify-between gap-2 py-2"
              >
                <span className="mono text-body text-pp-text break-all md:text-small">
                  {formatUsdc6(row.amount6)} USDC
                </span>
                {/* The block, not a timestamp: Arc timestamps are non-decreasing and
                    these rows are ordered on (blockNumber, logIndex). */}
                <span className={FIGURE_FAINT}>block {row.blockNumber.toString()}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
