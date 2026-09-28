import { CurveAbi, PeakTokenAbi } from "@peakpump/contracts-abi";
import { toFunctionSelector } from "viem";
import { type ReadErrorReport, describeReadError } from "@/lib/read-error";

// One sentence per error a trade can actually reach, keyed by name. The selectors
// are computed from the ABI below rather than written out, so a renamed error
// cannot leave a stale four-byte literal behind pointing at the wrong sentence;
// apps/web/test/curve-errors.test.ts asserts every name here still exists in the
// ABI and that every trade-reachable error has an entry.
//
// contracts/src/Curve.sol:233-336 is the order these fire in. Nothing below reads
// the node's message text: Zero8 rewrote it and contracts/test/fork/ArcFork.t.sol
// records that Circle does not hold it stable.
const SENTENCES: Record<string, string> = {
  // buy:235 / sell:308, the deadline.
  DeadlineExpired: "The deadline passed before the transaction landed. Try again.",
  // buy:236 needs usdcIn6 >= 1000; sell:309 needs at least one token wei.
  BelowMinimumTrade: "The amount is below this market's minimum trade.",
  // buy:287 and sell:325, the slippage bounds this panel sends.
  InsufficientTokensOut: "The price moved past your tolerance. Requote and try again.",
  InsufficientUsdcOut: "The price moved past your tolerance. Requote and try again.",
  // buy:279, inside the anti-snipe window only.
  RecipientNotSender: "While the anti-snipe window is open, tokens must go to your own address.",
  // buy:282, charged on the amount actually spent.
  WindowCapExceeded: "This buy passes your allowance for the anti-snipe window.",
  // sell:307.
  SelfTrade: "The market cannot trade with itself.",
  // sell:312.
  ExceedsSold: "That is more than the market has sold.",
  // buy:257-258 and sell:319. The quote returns these as a status instead of
  // reverting, so reaching one here means the state moved after the quote.
  ZeroNetAfterFee: "The fee takes the whole amount. Raise it and requote.",
  ZeroTokensOut: "The amount buys no tokens at this price. Raise it and requote.",
  ZeroUsdcOut: "The amount returns no USDC after the fee. Raise it and requote.",
  // withdrawDeferred:418.
  NothingDeferred: "There is nothing deferred to withdraw.",
  // PeakToken.pullFrom, reached at the end of sell:331 when the balance moved.
  ERC20InsufficientBalance: "Your token balance no longer covers this sell.",
};

function signature(name: string, inputs: readonly { type: string }[]): string {
  return `${name}(${inputs.map((input) => input.type).join(",")})`;
}

// Built once, at module load, from the two ABIs the trade path touches. An error
// declared in the ABI with no sentence above is absent from the map on purpose:
// unknown selectors fall through to describeReadError, which is what reports a
// revert this file has nothing better to say about.
const BY_SELECTOR: ReadonlyMap<string, string> = new Map(
  [...CurveAbi, ...PeakTokenAbi].flatMap((item) => {
    if (item.type !== "error") return [];
    const sentence = SENTENCES[item.name];
    if (sentence === undefined) return [];
    return [[toFunctionSelector(signature(item.name, item.inputs)), sentence] as const];
  }),
);

// Exported for the test, which asserts coverage against the ABI rather than
// against a second list of names.
export const ERROR_SENTENCE_NAMES: readonly string[] = Object.keys(SENTENCES);

export interface TradeErrorReport extends ReadErrorReport {
  // The name is display material for nothing — it is here so a toast can carry a
  // selector the map missed without inventing a sentence for it.
  known: boolean;
}

// The selector already arrives on describeReadError's report, so this adds one
// lookup rather than a second decode of the error.
export function describeTradeError(error: unknown): TradeErrorReport {
  const report = describeReadError(error);
  const sentence = report.selector === undefined ? undefined : BY_SELECTOR.get(report.selector);
  return sentence === undefined
    ? { ...report, known: false }
    : { ...report, message: sentence, known: true };
}