"use client";

import { formatFeeBps } from "@peakpump/shared/fees";
import { formatTokenAmount, formatUsdc6 } from "@peakpump/shared/format";
import type { ReactNode } from "react";
import type { BuyQuote, SellQuote } from "@/lib/curve-quote";

// Every line below is a field of the struct quoteBuy or quoteSell returned, printed
// through a shared formatter and multiplied by nothing. That is the whole point of the
// file: a fee, a share of it, an output amount or a refund shown next to a submit
// control is the contract's own answer, so the preview and the receipt cannot disagree
// by a unit. The only number here the contract did not return is the minimum, and it
// arrives already computed as the user's own tolerance applied to one of these fields.
const HEADLINE = "mono text-heading text-pp-text break-all";
const FIGURE = "mono text-body text-pp-text break-all md:text-small";

function Row({
  label,
  strong = false,
  children,
}: {
  label: string;
  strong?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-small text-pp-text-muted">{label}</span>
      <span className={strong ? HEADLINE : FIGURE}>{children}</span>
    </div>
  );
}

export type FeeBreakdownProps = ({ side: "buy"; quote: BuyQuote } | { side: "sell"; quote: SellQuote }) & {
  // This market's own snapshot, not the factory's current default: they differ
  // on purpose, and the deployed testnet already shows them diverging. Undefined
  // while the read that carries it has not answered, which costs the percentage
  // in one label and nothing else — every figure below comes from the quote.
  feeBps: number | undefined;
  symbol: string | undefined;
  minimum: bigint;
  tolerance: string;
};

// SPEC 8.5:703: when the fee is zero no fee line is shown at all, rather than three
// lines of zeroes. The split rows follow the same test, because a zero fee has no
// halves to name.
function FeeRows({
  fee6,
  creatorFee6,
  protocolFee6,
  feeBps,
}: {
  fee6: bigint;
  creatorFee6: bigint;
  protocolFee6: bigint;
  feeBps: number | undefined;
}) {
  if (fee6 === 0n) return null;
  return (
    <>
      <Row label={feeBps === undefined ? "Fee" : `Fee, ${formatFeeBps(BigInt(feeBps))} of the trade`}>
        {formatUsdc6(fee6)} USDC
      </Row>
      <Row label="To the creator">{formatUsdc6(creatorFee6)} USDC</Row>
      <Row label="To the protocol">{formatUsdc6(protocolFee6)} USDC</Row>
    </>
  );
}

export function FeeBreakdown(props: FeeBreakdownProps) {
  const { feeBps, symbol, minimum, tolerance } = props;
  const unit = symbol === undefined ? "" : ` ${symbol}`;

  if (props.side === "buy") {
    const quote = props.quote;
    return (
      <div className="flex flex-col gap-2">
        <Row label="You receive" strong>
          {formatTokenAmount(quote.tokensOut)}
          {unit}
        </Row>
        <Row label={`Minimum received at ${tolerance}%`}>
          {formatTokenAmount(minimum)}
          {unit}
        </Row>
        {/* A refund exists only on the crossing path, where spend6 is less than the
            amount offered. Off that path the two are the same number and printing it
            twice would say nothing. */}
        {quote.refund6 > 0n ? (
          <>
            <Row label="Spent">{formatUsdc6(quote.spend6)} USDC</Row>
            <Row label="Refunded">{formatUsdc6(quote.refund6)} USDC</Row>
          </>
        ) : null}
        <FeeRows
          fee6={quote.fee6}
          creatorFee6={quote.creatorFee6}
          protocolFee6={quote.protocolFee6}
          feeBps={feeBps}
        />
        <Row label="Into the pool">{formatUsdc6(quote.net6)} USDC</Row>
      </div>
    );
  }

  const quote = props.quote;
  return (
    <div className="flex flex-col gap-2">
      <Row label="You receive" strong>
        {formatUsdc6(quote.usdcOut6)} USDC
      </Row>
      <Row label={`Minimum received at ${tolerance}%`}>{formatUsdc6(minimum)} USDC</Row>
      <FeeRows
        fee6={quote.fee6}
        creatorFee6={quote.creatorFee6}
        protocolFee6={quote.protocolFee6}
        feeBps={feeBps}
      />
      {/* The pool loses gross6 and the seller receives usdcOut6; the difference is the
          fee above, credited to the vault and never pushed. */}
      <Row label="Out of the pool">{formatUsdc6(quote.gross6)} USDC</Row>
    </div>
  );
}
