import type { Address } from "envio";
import deployment from "../deployments/arc-testnet.json";

// Addresses live in exactly one place, the deployment record the deploy script
// wrote. Read non-strictly: only the keys needed, and the
// advisory maxFeePerGas / maxPriorityFeePerGas keys are ignored.
export const CHAIN_ID: number = deployment.chainId;
export const START_BLOCK: number = deployment.startBlock;
export const FACTORY: Address = deployment.contracts.PeakpumpFactory as Address;
export const FEE_VAULT: Address = deployment.contracts.FeeVault as Address;
