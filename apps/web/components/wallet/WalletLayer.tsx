"use client";

import { useEffect } from "react";
import { useAccount, useConnect, useDisconnect, useWalletClient, WagmiProvider } from "wagmi";
import { publishWalletState } from "@/lib/wallet-state";
import { wagmiConfig } from "@/lib/wagmi";

// The whole wallet stack — wagmi, ox and their share of viem — lives in this
// chunk. It is never part of first-load JavaScript: app/providers.tsx reaches it
// through React.lazy, either because a Connect press asked for it or because
// wagmi's session cookie says there is a connection to restore. One provider
// instance for the app, mounted here rather than above the page, is deliberate:
// every WagmiProvider runs the persist rehydrate and reconnect on mount, so one
// per consumer would repeat the reconnect round trip on every navigation.

// The bridge between the provider and lib/wallet-state.ts. It renders nothing;
// its job is to hold wagmi's hooks and publish each answer into the store the
// eager components read, so no component outside this chunk needs wagmi's
// context to exist.
function WalletSync() {
  const { address, chainId, isConnected } = useAccount();
  const { connectors, connect, isPending, variables, error, reset } = useConnect();
  const { disconnect } = useDisconnect();
  const { data: walletClient } = useWalletClient();

  // After every render, so each hook answer that moved this component reaches
  // the store in the same commit's wake. Publishing does not re-render this
  // component, so there is no loop; the wrapper closures are rebuilt each time,
  // which costs nothing because consumers always read the latest snapshot.
  useEffect(() => {
    publishWalletState({
      address,
      chainId,
      isConnected,
      connectors,
      walletClient,
      connect: (connector, options) => connect({ connector }, { onSuccess: options?.onSuccess }),
      disconnect: () => disconnect(),
      isPending,
      pendingConnector: variables?.connector,
      connectError: error,
      resetConnect: reset,
    });
  });

  return null;
}

export default function WalletLayer() {
  return (
    <WagmiProvider config={wagmiConfig}>
      <WalletSync />
    </WagmiProvider>
  );
}
