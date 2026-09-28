import { CurveAbi } from "@peakpump/contracts-abi";
import { formatTokenAmount, formatUsdc6 } from "@peakpump/shared/format";
import type { Address, ReadContractReturnType } from "viem";
import type { ReadClient } from "@/lib/viem";

// The seven members in the order contracts/src/Curve.sol declares them, which is
// the order the uint8 the ABI returns counts in.
export const QUOTE_STATUS = [
  "Ok",
  "BelowMinimum",
  "ZeroNetAfterFee",
  "ZeroTokensOut",
  "ZeroUsdcOut",
  "ExceedsSold",
  "Closed",
] as const;

export type QuoteStatusName = (typeof QUOTE_STATUS)[number];

// Derived from the ABI, so BuyQuote and SellQuote are the structs the contract declares
// rather than a second description of them.
export type BuyQuote = ReadContractReturnType<typeof CurveAbi, "quoteBuy">;
export type SellQuote = ReadContractReturnType<typeof CurveAbi, "quoteSell">;

// docs/MATH.md:338 and contracts/src/Curve.sol:474. A buy under this returns
// BelowMinimum instead of reverting, which is what lets a sentence replace a
// raw error.
export const MIN_BUY_6 = 1000n;

export interface QuoteContext {
  side: "buy" | "sell";
  // Read in the same batch as the quote, so the number in the sentence is the
  // one the same block answered with.
  sold?: bigint;
}

// Null for Ok, where the numbers themselves are the answer. Closed is
// unreachable and keeps a neutral line rather than being
// dropped from the enum.
export function quoteSentence(status: QuoteStatusName, ctx: QuoteContext): string | null {
  switch (status) {
    case "Ok":
      return null;
    case "BelowMinimum":
      return ctx.side === "buy"
        ? `Enter at least ${formatUsdc6(MIN_BUY_6)} USDC.`
        : "Enter an amount above zero.";
    case "ZeroNetAfterFee":
      return "Raise the amount: the fee takes all of it.";
    case "ZeroTokensOut":
      return "Raise the amount: it buys no tokens at this price.";
    case "ZeroUsdcOut":
      return "Raise the amount: it returns no USDC after the fee.";
    case "ExceedsSold":
      return ctx.sold === undefined
        ? "Lower the amount: it is more than the market has sold."
        : `Sell at most ${formatTokenAmount(ctx.sold)} tokens.`;
    case "Closed":
      return "This market is not quoting.";
  }
}

// The ABI types status as uint8 and the contract can only return an ordinal of
// its own enum, so the index is total over what arrives. This is that fact, not
// a fallback for an impossible value.
function statusName(status: number): QuoteStatusName {
  return QUOTE_STATUS[status] as QuoteStatusName;
}

export interface BuyQuoteRead {
  quote: BuyQuote;
  status: QuoteStatusName;
  sentence: string | null;
}

export interface SellQuoteRead {
  quote: SellQuote;
  status: QuoteStatusName;
  sentence: string | null;
  sold: bigint;
}

export async function readBuyQuote(
  client: ReadClient,
  curve: Address,
  usdcIn6: bigint,
): Promise<BuyQuoteRead> {
  const quote = await client.readContract({
    address: curve,
    abi: CurveAbi,
    functionName: "quoteBuy",
    args: [usdcIn6],
  });
  const status = statusName(quote.status);
  return { quote, status, sentence: quoteSentence(status, { side: "buy" }) };
}

// sold rides along because ExceedsSold's sentence names it, and a number read a
// block later than the status that needs it would be a different number.
export async function readSellQuote(
  client: ReadClient,
  curve: Address,
  tokensIn: bigint,
): Promise<SellQuoteRead> {
  const [quote, sold] = await client.multicall({
    contracts: [
      { address: curve, abi: CurveAbi, functionName: "quoteSell", args: [tokensIn] },
      { address: curve, abi: CurveAbi, functionName: "sold" },
    ] as const,
    allowFailure: false,
  });
  const status = statusName(quote.status);
  return { quote, status, sentence: quoteSentence(status, { side: "sell", sold }), sold };
}
