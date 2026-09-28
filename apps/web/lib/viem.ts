import { arcTestnet } from "@peakpump/shared/chain";
import { type Address, createPublicClient, fallback, http } from "viem";

// The four hosts come off the frozen chain object in the order the Arc documentation
// records them; no URL literal is written here, because only
// packages/shared/src/chain.ts may declare one. fallback walks them in that
// order, so a host that stops answering costs one retry rather than the page.
const transports = arcTestnet.rpcUrls.default.http.map((url) => http(url, { batch: true }));

// Not wagmi's config client: a read must work before a wallet is connected, and
// this one carries no connector state. Transport batching folds the calls a page
// makes concurrently into one HTTP request; client multicall batching catches any
// read that escapes an explicit batch below.
export const publicClient = createPublicClient({
  chain: arcTestnet,
  transport: fallback(transports),
  batch: { multicall: true },
});

export type ReadClient = typeof publicClient;

// arcTestnet inherits viem's multicall3 declaration, and the Arc chain facts record
// the same address with blockCreated 0. packages/shared annotates the chain as
// Chain, which widens contracts to an optional record, so this reads that one
// declared field rather than restating an address the chain object already holds.
export const MULTICALL3 = (arcTestnet.contracts as { multicall3: { address: Address } })
  .multicall3.address;

// viem's exported multicall3Abi carries aggregate3, getEthBalance and
// getCurrentBlockTimestamp, but not getBlockNumber. A batch that reads it as one
// of its own calls learns the block the node executed the whole batch against,
// which is what a quote's freshness depends on. Asking
// separately would let the block advance between the two requests and report a
// stale quote as fresh.
export const blockNumberAbi = [
  {
    type: "function",
    name: "getBlockNumber",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "blockNumber", type: "uint256" }],
  },
] as const;
