import type { Address } from "viem";
import deployment from "../../../contracts/deployments/arc-testnet.json";

// The addresses live in exactly one place, contracts/deployments/arc-testnet.json,
// and are never duplicated elsewhere. This module parses
// that file non-strictly: it reads only the keys it needs and ignores the
// advisory top-level maxFeePerGas / maxPriorityFeePerGas keys.
export const PEAKPUMP_FACTORY = deployment.contracts.PeakpumpFactory as Address;
export const FEE_VAULT = deployment.contracts.FeeVault as Address;
export const CURVE_IMPL = deployment.contracts.CurveImpl as Address;
export const PEAK_TOKEN_IMPL = deployment.contracts.PeakTokenImpl as Address;

export const START_BLOCK = BigInt(deployment.startBlock);
export const CHAIN_ID = deployment.chainId;
