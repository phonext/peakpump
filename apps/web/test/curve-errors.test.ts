import { CurveAbi, PeakTokenAbi } from "@peakpump/contracts-abi";
import { toFunctionSelector } from "viem";
import { describe, expect, it } from "vitest";
import { ERROR_SENTENCE_NAMES, describeTradeError } from "@/lib/curve-errors";
import { describeReadError } from "@/lib/read-error";

// The two ABIs are the authority on what an error is called and what it carries, so
// every selector below is computed from them. A test that wrote the four bytes out
// would pass against a renamed error and a stale sentence, which is the one failure
// lib/curve-errors.ts builds its map from the ABI to avoid.
const ABI_ERRORS = [...CurveAbi, ...PeakTokenAbi].flatMap((item) =>
  item.type === "error" ? [item] : [],
);

function selectorOf(name: string, inputs: readonly { type: string }[]): `0x${string}` {
  return toFunctionSelector(`${name}(${inputs.map((input) => input.type).join(",")})`);
}

// A node error as arc-node v0.8.0 returns a reverted eth_estimateGas: JSON-RPC code 3
// with the four-byte selector in data. lib/read-error.ts reads the code off a plain
// object as readily as off the viem wrapper, so nothing here builds the wrapper.
function revert(selector: string) {
  return { code: 3, data: selector };
}

// Errors a buy, a sell or a withdrawal can reach, from contracts/src/Curve.sol:233-336
// and 418 and from PeakToken.pullFrom. Everything else the two ABIs declare is listed
// as unreachable below, and the partition is asserted rather than either list being
// trusted: an error added to a contract lands in neither and fails this file until
// someone decides which it is.
const REACHABLE = [
  "DeadlineExpired",
  "BelowMinimumTrade",
  "InsufficientTokensOut",
  "InsufficientUsdcOut",
  "RecipientNotSender",
  "WindowCapExceeded",
  "SelfTrade",
  "ExceedsSold",
  "ZeroNetAfterFee",
  "ZeroTokensOut",
  "ZeroUsdcOut",
  "NothingDeferred",
  "ERC20InsufficientBalance",
];

// Three groups, and the reason each cannot arrive at a trade. The initialize and
// parameter errors fire once, inside factory.create, before a market has an address a
// panel could route to. The invariant and downcast errors are asserts over state the
// contract has already made impossible. The allowance errors belong to the ERC-20
// path PeakToken does not use: selling calls pullFrom, guarded by msg.sender == curve.
const UNREACHABLE = [
  "AntiSnipeMisconfigured",
  "BadSupply",
  "BadX0",
  "BadY0",
  "BadY1",
  "FeeConfigInvalid",
  "InvalidInitialization",
  "MultipleOutOfRange",
  "NotFactory",
  "NotInitializing",
  "RaiseOutOfRange",
  "SupplyNotAboveTs",
  "SupplyOutOfRange",
  "X0NotPositive",
  "Y0NotAboveTs",
  "Y1NotPositive",
  "InvariantBroken",
  "SafeCastOverflowedUintDowncast",
  "ReentrancyGuardReentrantCall",
  "NothingToSweep",
  "ERC20InsufficientAllowance",
  "ERC20InvalidApprover",
  "ERC20InvalidReceiver",
  "ERC20InvalidSender",
  "ERC20InvalidSpender",
  "NotCurve",
];

describe("the trade error map", () => {
  it("classifies every error the two ABIs declare", () => {
    // Both ABIs carry Initializable's errors, so the declared set is deduplicated
    // while the two lists are not: a name in both of them is still one decision.
    const declared = [...new Set(ABI_ERRORS.map((item) => item.name))].sort();
    expect([...REACHABLE, ...UNREACHABLE].sort()).toEqual(declared);
    expect(REACHABLE.filter((name) => UNREACHABLE.includes(name))).toEqual([]);
  });

  it("writes a sentence for every reachable error and none for the rest", () => {
    expect([...ERROR_SENTENCE_NAMES].sort()).toEqual([...REACHABLE].sort());
  });

  it("resolves every sentence through a selector the ABI produces", () => {
    for (const item of ABI_ERRORS) {
      if (!ERROR_SENTENCE_NAMES.includes(item.name)) continue;
      const report = describeTradeError(revert(selectorOf(item.name, item.inputs)));
      expect(report.known).toBe(true);
      expect(report.kind).toBe("reverted");
      // Copy rules, applied where the copy actually lives: a revert sentence reaches
      // the reader in a toast and an exclamation mark is banned in product copy.
      expect(report.message.endsWith(".")).toBe(true);
      expect(report.message).not.toContain("!");
    }
  });

  it("keeps the selector on the report it rewrites", () => {
    const selector = toFunctionSelector("DeadlineExpired()");
    const report = describeTradeError(revert(selector));
    // The selector survives, so a toast can name the four bytes when the map misses
    // and the sentence it carries is still the one this error means.
    expect(report.selector).toBe(selector);
    expect(report.message).toBe("The deadline passed before the transaction landed. Try again.");
  });

  it("tells the two slippage bounds apart while saying one thing to the reader", () => {
    const buy = describeTradeError(revert(toFunctionSelector("InsufficientTokensOut()")));
    const sell = describeTradeError(revert(toFunctionSelector("InsufficientUsdcOut()")));
    expect(buy.selector).not.toBe(sell.selector);
    // A buy and a sell fail their bound with different errors and the same remedy,
    // which is why one sentence is correct for both.
    expect(buy.message).toBe(sell.message);
    expect(buy.known && sell.known).toBe(true);
  });

  it("keys the ERC-20 error on its arguments and not its name", () => {
    const real = "ERC20InsufficientBalance(address,uint256,uint256)";
    expect(describeTradeError(revert(toFunctionSelector(real))).known).toBe(true);
    // The no-argument shape is a different four bytes and a different error. If the
    // map were built from names it would answer for this one too.
    expect(describeTradeError(revert(toFunctionSelector("ERC20InsufficientBalance()"))).known).toBe(
      false,
    );
  });
});

describe("an error the map has no sentence for", () => {
  it("falls through to describeReadError for a declared but unreachable error", () => {
    const node = revert(toFunctionSelector("InvariantBroken()"));
    const fallback = describeReadError(node);
    const report = describeTradeError(node);
    expect(report.known).toBe(false);
    expect(report.message).toBe(fallback.message);
    expect(report.kind).toBe(fallback.kind);
    expect(report.selector).toBe(fallback.selector);
  });

  it("falls through for four bytes no contract in this repository declares", () => {
    const report = describeTradeError(revert("0xdeadbeef"));
    expect(report.known).toBe(false);
    expect(report.message).toBe(describeReadError(revert("0xdeadbeef")).message);
  });

  it("falls through for a revert that carries no data", () => {
    const report = describeTradeError({ code: 3 });
    expect(report.known).toBe(false);
    expect(report.selector).toBeUndefined();
    expect(report.kind).toBe("reverted");
  });

  it("leaves a shortfall classified as a shortfall", () => {
    // -32003 is not a revert at all: the balance does not cover the value plus the
    // gas cap. A selector lookup must not turn that into "the contract rejected it".
    const report = describeTradeError({ code: -32003 });
    expect(report.known).toBe(false);
    expect(report.kind).toBe("insufficient-funds");
    expect(report.message).toBe(describeReadError({ code: -32003 }).message);
  });
});
