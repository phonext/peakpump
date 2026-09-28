import { BaseError, HttpRequestError, TimeoutError, UserRejectedRequestError } from "viem";

export type RpcErrorKind =
  | "rejected"
  | "pending"
  | "unapproved"
  | "unsupported"
  | "disconnected"
  | "chain-missing"
  | "rate-limited"
  | "reverted"
  | "node"
  | "transport"
  | "unknown";

export interface RpcErrorReport {
  kind: RpcErrorKind;
  message: string;
  // The 4-byte selector, when the node returned revert data. Carried out rather than
  // decoded: naming a custom error needs the ABI, and apps/web takes no dependency on
  // @peakpump/contracts-abi in this module.
  selector?: `0x${string}`;
}

// One short declarative sentence each, because the only thing a reader can act on is
// what to do next.
const SENTENCE: Record<RpcErrorKind, string> = {
  rejected: "You rejected the request in your wallet.",
  pending: "Your wallet already has a request open. Finish it, then try again.",
  unapproved: "Your wallet has not approved this account for this site.",
  unsupported: "Your wallet does not support this request.",
  disconnected: "Your wallet is not connected to Arc Testnet.",
  "chain-missing": "Arc Testnet is not in your wallet yet. Add it, then try again.",
  "rate-limited": "The node is rate limiting this connection. Try again shortly.",
  reverted: "The contract rejected the call.",
  node: "The node refused the request.",
  transport: "The request did not reach the node.",
  unknown: "The request failed and the wallet gave no reason.",
};

// EIP-1193 provider codes, then EIP-1474 RPC codes. Numbers, because they are the part
// of an error that is specified.
const BY_CODE = new Map<number, RpcErrorKind>([
  [4001, "rejected"],
  [4100, "unapproved"],
  [4200, "unsupported"],
  [4900, "disconnected"],
  [4901, "disconnected"],
  // EIP-3085: the wallet holds no entry for this chain, which is the one failure the
  // Add Arc Testnet control exists to fix.
  [4902, "chain-missing"],
  // A reverted eth_call arrives as -32000 from every reth-based node, this one
  // included, with the revert data alongside it.
  [-32000, "reverted"],
  [-32002, "pending"],
  [-32003, "node"],
  [-32005, "rate-limited"],
  [-32601, "unsupported"],
  [-32603, "node"],
]);

// One walk, collecting both facts. Bounded, because a cause chain that points back at
// itself would otherwise spin.
function scan(error: unknown): { code?: number; selector?: `0x${string}` } {
  const found: { code?: number; selector?: `0x${string}` } = {};
  let current: unknown = error;
  for (let depth = 0; depth < 8 && current !== null && typeof current === "object"; depth += 1) {
    const node = current as { code?: unknown; data?: unknown; cause?: unknown };
    if (found.code === undefined && typeof node.code === "number") found.code = node.code;
    if (
      found.selector === undefined &&
      typeof node.data === "string" &&
      /^0x[0-9a-f]{8}/i.test(node.data)
    ) {
      found.selector = node.data.slice(0, 10).toLowerCase() as `0x${string}`;
    }
    current = node.cause;
  }
  return found;
}

// Nothing below reads message text. contracts/test/fork/ArcFork.t.sol:90-91 records
// why: "No test matches revert-reason or JSON-RPC error text: Foundry v0.8.0 (reth 2.2
// / revm 38) changed that text and Circle states it is not a stable contract." The same
// holds in a browser, where a wallet extension rewords whatever the node sent before
// the page ever sees it.
//
// There is deliberately no insufficient-funds class. viem identifies that one by
// matching node message text, and on this chain a funded account can hit it anyway
// from the stale eth_gasPrice reading the Arc documentation records. feeCeiling, called in
// lib/wagmi.ts, is where that is handled.
export function describeRpcError(error: unknown): RpcErrorReport {
  // The typed classes first: a rejection reaches us wrapped often enough that the
  // outermost object carries viem's own code rather than 4001.
  if (error instanceof BaseError) {
    if (error.walk((cause) => cause instanceof UserRejectedRequestError) !== null) {
      return { kind: "rejected", message: SENTENCE.rejected };
    }
  }

  const { code, selector } = scan(error);
  const byCode = code === undefined ? undefined : BY_CODE.get(code);
  if (byCode !== undefined) {
    return selector === undefined
      ? { kind: byCode, message: SENTENCE[byCode] }
      : { kind: byCode, message: SENTENCE[byCode], selector };
  }

  // Last, because a transport failure has no code of its own and would otherwise
  // swallow one carried further down the chain.
  if (error instanceof BaseError) {
    if (
      error.walk((cause) => cause instanceof TimeoutError || cause instanceof HttpRequestError) !==
      null
    ) {
      return { kind: "transport", message: SENTENCE.transport };
    }
  }

  return { kind: "unknown", message: SENTENCE.unknown };
}
