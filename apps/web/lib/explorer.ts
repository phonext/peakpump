import { arcTestnet } from "@peakpump/shared/chain";

// The explorer comes off the frozen chain object, the way Onboarding.tsx reads
// arcTestnet.name: no URL literal is written in apps/web. viem types
// blockExplorers as optional on Chain, and Arc Testnet carries one, so the default
// below is what satisfies the type rather than a fallback for a missing value.
const EXPLORER = arcTestnet.blockExplorers?.default;

export const EXPLORER_NAME = EXPLORER?.name;

// /tx/<hash> and /address/<address> are the Blockscout route shapes the host uses.
// A link, never a number: if the path is wrong the reader sees the explorer's own
// not-found page, and nothing in the product depends on the answer.
export function txUrl(hash: `0x${string}`): string | undefined {
  return EXPLORER === undefined ? undefined : `${EXPLORER.url}/tx/${hash}`;
}

export function addressUrl(address: string): string | undefined {
  return EXPLORER === undefined ? undefined : `${EXPLORER.url}/address/${address}`;
}