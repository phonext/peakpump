import type { Chain } from "viem";
import { arcTestnet as viemArcTestnet } from "viem/chains";

// This is the only file in the repository permitted to import from viem/chains.
//
// 2026-09-01. viem ships Arc Testnet with rpcUrls.default.http pointing at the
// .arc.network domain (rpc.testnet.arc.network and its QuickNode/Blockdaemon
// siblings). The official Arc documentation (connect-to-arc) instead gives the
// .arc.io domain. These are different hosts, not aliases. Both the .arc.io and
// the .arc.network hosts were verified by hand to return chain id 5042002 on
// 26 August 2026 (the Arc chain facts). We follow the documentation and override
// rpcUrls.default.http with the four .arc.io hosts, in the order ARC.md records.
//
// WebSocket: the official documentation DOES list wss://rpc.testnet.arc.io as
// the primary WebSocket endpoint, but that host has never been hand
// connection-tested — only confirmed as documented (the Arc documentation, 28 Aug 2026).
// viem and Circle's use-arc skill carry the different .arc.network wss domain.
// We do not override webSocket and open no WebSocket transport anywhere in this
// repository; the inherited .arc.network value is left untouched until ARC.md
// records a hand-verified wss.arc.io host. The multicall3 address and the
// USDC/18 native currency are inherited from viem unchanged.
// 2026-09-26. viem ships Arc Testnet with blockExplorers.default pointing at
// testnet.arcscan.app. That host no longer serves the explorer: it answers every
// request with a 301 to https://explorer.testnet.arc.io, which is a live Blockscout
// instance (the Arc chain facts). We override both fields to the canonical host, which a
// hand check confirmed serves /address/<address> pages and answers the legacy
// ?module=… API at /api with status "1". The inherited name is left alone: it is the
// explorer's own product name and lib/explorer.ts carries it into link titles.
//
// Nothing in this repository consumes apiUrl today; it is corrected alongside url so
// that the first caller does not inherit a host that only redirects.
export const arcTestnet: Chain = {
  ...viemArcTestnet,
  rpcUrls: {
    ...viemArcTestnet.rpcUrls,
    default: {
      ...viemArcTestnet.rpcUrls.default,
      http: [
        "https://rpc.testnet.arc.io",
        "https://rpc.drpc.testnet.arc.io",
        "https://rpc.blockdaemon.testnet.arc.io",
        "https://rpc.quicknode.testnet.arc.io",
      ],
    },
  },
  blockExplorers: {
    ...viemArcTestnet.blockExplorers,
    default: {
      ...viemArcTestnet.blockExplorers.default,
      url: "https://explorer.testnet.arc.io",
      apiUrl: "https://explorer.testnet.arc.io/api",
    },
  },
};

// The Circle testnet faucet, recorded as an Arc chain fact. Sits here for
// the same reason every other host does: no URL literal is written in apps/web, and
// the onboarding slide that offers it stays a pointer to a single source.
export const FAUCET_URL = "https://faucet.circle.com";

// Gas price bounds (docs/MATH.md 12). The Arc testnet base-fee floor
// is 20 Gwei and the documented hard ceiling is 20,000 Gwei; MAX_FEE_WEI adds
// the 1 Gwei priority tip to that ceiling.
export const MIN_FEE_WEI = 20n * 10n ** 9n;
export const MAX_FEE_WEI = 20_001n * 10n ** 9n;
export const PRIORITY_FEE_WEI = 1n * 10n ** 9n;

// Clamping the upper side is not optional: a known arc-node issue reports
// eth_gasPrice returning stale values, and one bad reading fed into suggested*2
// would produce an absurd cap and an "insufficient funds" error for a funded
// user. The documented protocol ceiling is the only honest upper bound.
export function feeCeiling(suggested: bigint): bigint {
  const doubled = suggested * 2n;
  const floored = doubled > MIN_FEE_WEI ? doubled : MIN_FEE_WEI;
  return floored < MAX_FEE_WEI ? floored : MAX_FEE_WEI;
}
