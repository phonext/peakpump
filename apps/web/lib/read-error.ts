import { type RpcErrorKind, type RpcErrorReport, describeRpcError } from "@/lib/rpc-error";
import { BaseError } from "viem";

export type ReadErrorKind = RpcErrorKind | "insufficient-funds";

export interface ReadErrorReport {
  kind: ReadErrorKind;
  message: string;
  selector?: `0x${string}`;
}

// Measured against rpc.testnet.arc.io on 2026-09-04, after arc-node v0.8.0
// activated: a reverted eth_call or eth_estimateGas returns JSON-RPC code 3 with
// the 4-byte selector in data, and a shortfall on value plus the gas cap returns
// -32003. lib/rpc-error.ts predates that node and maps neither, so those two are
// classified here and every other shape is handed to it unchanged. No branch
// reads message text: Zero8 rewrote it, and
// contracts/test/fork/ArcFork.t.sol:90-91 records that Circle does not hold it
// stable.
const REVERTED = "The contract rejected the call.";
const NO_FUNDS = "Your balance does not cover the amount plus the gas cap.";

// viem wraps a node error in one or more of its own classes and keeps the coded
// one in the cause chain, so walking for the code beats reading the outermost
// object. A provider error that never reached viem is coded on itself.
function coded(error: unknown): { code: number; data?: unknown } | undefined {
  const isCoded = (node: unknown): boolean =>
    typeof (node as { code?: unknown }).code === "number";
  if (error instanceof BaseError) {
    const found = error.walk(isCoded);
    // walk types its answer as Error, and a coded provider error is exactly an
    // Error carrying those two extra fields.
    return found === null ? undefined : (found as Error & { code: number; data?: unknown });
  }
  if (error !== null && typeof error === "object" && isCoded(error)) {
    return error as { code: number; data?: unknown };
  }
  return undefined;
}

export function describeReadError(error: unknown): ReadErrorReport {
  const node = coded(error);
  if (node?.code === 3) {
    const { data } = node;
    if (typeof data === "string" && /^0x[0-9a-f]{8}/i.test(data)) {
      return { kind: "reverted", message: REVERTED, selector: data.slice(0, 10).toLowerCase() as `0x${string}` };
    }
    return { kind: "reverted", message: REVERTED };
  }
  if (node?.code === -32003) {
    return { kind: "insufficient-funds", message: NO_FUNDS };
  }
  const report: RpcErrorReport = describeRpcError(error);
  return report;
}
