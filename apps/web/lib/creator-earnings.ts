import { FeeVaultAbi } from "@peakpump/contracts-abi";
import { FEE_VAULT } from "@peakpump/shared/addresses";
import type { Address } from "viem";
import { indexerQuery } from "@/lib/graphql";
import type { ReadClient } from "@/lib/viem";

// The claimable figure comes from the vault itself, never from the indexer: fees
// are credited and pulled, so this is a balance the creator acts on and
// the golden data rule puts it on an RPC read at read time. It is the vault's whole
// ledger entry for that address, across every market it created — FeeVault is one
// pull ledger keyed by address (SPEC 5.4), not one per curve — and the panel says
// so rather than labelling it as this market's earnings. 6-decimal, like every
// other USDC figure the ledger holds (contracts/src/FeeVault.sol:20-21).
export async function readVaultBalance6(client: ReadClient, creator: Address): Promise<bigint> {
  const [balance6] = await client.multicall({
    contracts: [
      { address: FEE_VAULT, abi: FeeVaultAbi, functionName: "balances", args: [creator] },
    ] as const,
    allowFailure: false,
  });
  return balance6;
}

// SPEC 6.3 fixes FeeCredit as the fee ledger and claim history and fixes no field
// names for it. So this document is a proposal, and a
// mismatch costs exactly the history list: indexerQuery answers null on a GraphQL
// errors array, which is the same outcome as an unreachable host and renders the
// same written empty state.
export interface FeeCreditRow {
  id: string;
  amount6: bigint;
  blockNumber: bigint;
  logIndex: number;
}

const FEE_CREDITS_QUERY = `query FeeCredits($curve: String!, $recipient: String!, $limit: Int!) {
  FeeCredit(
    where: {curve: {_eq: $curve}, recipient: {_eq: $recipient}}
    order_by: [{blockNumber: desc}, {logIndex: desc}]
    limit: $limit
  ) { id amount6 blockNumber logIndex }
}`;

interface RawFeeCredit {
  id: string;
  amount6: string;
  blockNumber: string;
  logIndex: number;
}

// Ordered on (blockNumber, logIndex) like every other list in this app: Arc
// timestamps are non-decreasing and sub-second blocks share one, so a timestamp
// cannot order these rows.
export async function fetchFeeCredits(
  curve: Address,
  recipient: Address,
  limit: number,
): Promise<FeeCreditRow[] | null> {
  const data = await indexerQuery<{ FeeCredit: RawFeeCredit[] }>(FEE_CREDITS_QUERY, {
    curve,
    recipient,
    limit,
  });
  return data === null
    ? null
    : data.FeeCredit.map((raw) => ({
        id: raw.id,
        amount6: BigInt(raw.amount6),
        blockNumber: BigInt(raw.blockNumber),
        logIndex: raw.logIndex,
      }));
}