import { arcTestnet } from "@peakpump/shared/chain";
import { cookieStorage, createConfig, createStorage, http, injected } from "wagmi";

// A tuple, because createConfig's chains is readonly [Chain, ...Chain[]] and a plain
// array widens to Chain[].
const chains = [arcTestnet] as const;

// One connector, by design. A relay-paired wallet would need wss://relay.walletconnect.org
// in connect-src, and the deployed policy grants no origin outside the four RPC hosts, the
// indexer, R2 and Upstash. Injected wallets cover the desktop browser the app is built for,
// and keeping the list to a single entry is what keeps the policy honest about it.
const connectors = [injected()];

export const wagmiConfig = createConfig({
  chains,
  connectors,
  // http with no URL reads the four .arc.io hosts off the frozen chain object, so no
  // RPC literal is written in apps/web. Batching, because a page of rows is a page of
  // eth_calls the node would otherwise answer one round trip at a time.
  transports: { [arcTestnet.id]: http(undefined, { batch: true }) },
  batch: { multicall: true },
  ssr: true,
  // Cookies rather than localStorage, so the last connector is known before the
  // first client paint. layout.tsx deliberately does not call cookieToInitialState:
  // reading headers() there would opt every route out of static rendering, and the
  // reconnect on mount restores the account anyway.
  storage: createStorage({ storage: cookieStorage }),
});

// So the hooks in the wallet layer resolve against this config rather than
// wagmi's default generic one.
declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
