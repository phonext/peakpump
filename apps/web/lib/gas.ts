import { estimateGasUsdc } from "@peakpump/shared/format";
import { feeCeiling, PRIORITY_FEE_WEI } from "@peakpump/shared/chain";
import type { Abi, Address } from "viem";
import type { ReadClient } from "@/lib/viem";

export interface FeeOverrides {
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
}

// One method, not a viem client generic: lib/viem's public client satisfies it,
// and so does any test double, without this file pinning a chain or transport.
interface BaseFeeReader {
  getFeeHistory(parameters: {
    blockCount: number;
    rewardPercentiles: number[];
  }): Promise<{ baseFeePerGas: readonly bigint[] }>;
}

// It lived beside the wagmi config once, but that module is now imported only
// by the lazy wallet layer, and an eager gas path reaching for it would drag the
// whole wallet stack back into first-load JavaScript. This file is the policy's
// only caller, so the policy lives here.
export async function feeOverrides(client: BaseFeeReader): Promise<FeeOverrides> {
  // getFeeHistory answers with blockCount + 1 base fees: the requested block's, then
  // the next block's. A transaction sent now pays the second.
  const history = await client.getFeeHistory({ blockCount: 1, rewardPercentiles: [] });
  // feeCeiling floors at MIN_FEE_WEI, so 0n from an empty answer yields the
  // documented floor rather than an unsendable transaction. It also caps the upper
  // side, which is what keeps a stale eth_gasPrice reading from producing a ceiling
  // the wallet then reports as insufficient funds.
  const next = history.baseFeePerGas.at(-1) ?? 0n;
  return { maxFeePerGas: feeCeiling(next), maxPriorityFeePerGas: PRIORITY_FEE_WEI };
}

// account is required, not optional: eth_estimateGas is executed against a
// balance, so an estimate taken for nobody is an estimate of a different
// transaction. Callers with no wallet connected do not call this.
export interface GasRequest {
  address: Address;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
  value?: bigint;
  account: Address;
}

// usdc is what the UI shows. Gwei is a unit this product never puts on screen:
// the chain's gas is paid in the same asset the trade is denominated in, so the
// cost belongs in USDC. The two fee fields ride along because the write path
// that follows an estimate must send the same cap the estimate was priced at.
export interface GasEstimate extends FeeOverrides {
  gasUnits: bigint;
  usdc: string;
}

// The two requests are independent, so they go out together. feeCeiling inside
// feeOverrides stays the only place a fee bound is computed; nothing here
// multiplies or clamps a fee.
export async function estimateGasCostUsdc(
  client: ReadClient,
  request: GasRequest,
): Promise<GasEstimate> {
  const [gasUnits, fees] = await Promise.all([
    client.estimateContractGas(request),
    feeOverrides(client),
  ]);
  return { gasUnits, ...fees, usdc: estimateGasUsdc(gasUnits, fees.maxFeePerGas) };
}
