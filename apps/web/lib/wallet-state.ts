"use client";

import { useSyncExternalStore } from "react";
import type { arcTestnet } from "@peakpump/shared/chain";
// Type-only, from wagmi and viem both: the compiler erases them, so this module
// carries none of the ~79 kB gzipped the wallet layer defers out of first-load
// JavaScript, and every component below the provider can import it eagerly.
import type { Connector, CreateConnectorFn } from "wagmi";
import type { Account, Transport, WalletClient } from "viem";

// The client the layer's useWalletClient hands back for the one chain the
// config registers. Written from the frozen chain object rather than wagmi's
// hook generics, because extracting those without calling the hook resolves to
// unknown; the shape is the same one wagmi's config produces.
type ArcWalletClient = WalletClient<Transport, typeof arcTestnet, Account>;

// The eager mirror of the lazy wallet layer. Wagmi's hooks answer only inside a
// WagmiProvider, and the provider reaches the page as a lazy chunk
// (components/wallet/WalletLayer.tsx, mounted by app/providers.tsx), so the
// components a route renders at paint time read the wallet through this store
// instead. The layer publishes a new snapshot on every change; until it loads,
// the snapshot is disconnected and every consumer renders its disconnected
// branch — the same branches the server rendered.
export interface WalletState {
  address: `0x${string}` | undefined;
  chainId: number | undefined;
  isConnected: boolean;
  // The layer's own useConnect list. The picker renders from it, so it is empty
  // until the chunk has loaded, and the connector objects carry their emitters,
  // which is how the pairing-code listener keeps working without importing wagmi.
  connectors: readonly Connector[];
  walletClient: ArcWalletClient | undefined;
  connect: (connector: Connector, options?: { onSuccess?: () => void }) => void;
  disconnect: () => void;
  isPending: boolean;
  // useConnect's variables name a connector-or-factory, because wagmi's connect
  // accepts either; this store's connect wrapper only ever passes the instances
  // the picker lists, but the field carries the hook's own union rather than a
  // narrowed guess at it.
  pendingConnector: Connector | CreateConnectorFn | undefined;
  connectError: unknown;
  resetConnect: () => void;
}

// The only snapshot before the layer exists. connect asks for the layer rather
// than being a silent no-op, though no picker can offer a connector to click
// before the layer has published one; disconnect and resetConnect have nothing
// to act on while the snapshot says disconnected.
const DISCONNECTED: WalletState = {
  address: undefined,
  chainId: undefined,
  isConnected: false,
  connectors: [],
  walletClient: undefined,
  connect: () => requestWallet(),
  disconnect: () => {},
  isPending: false,
  pendingConnector: undefined,
  connectError: null,
  resetConnect: () => {},
};

let state: WalletState = DISCONNECTED;
const listeners = new Set<() => void>();

// The layer's single publish entry point. Merging is not wanted: the layer owns
// the whole snapshot, and a partial publish would let a stale walletClient ride
// beside a fresh address.
export function publishWalletState(next: WalletState): void {
  state = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useWalletState(): WalletState {
  // The server snapshot is the same disconnected object the client starts from,
  // so hydration compares like against like.
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => DISCONNECTED,
  );
}

// Loading the layer is providers' decision, but the ask can come from anywhere
// (a Connect press). A click faster than providers' own effect is remembered
// rather than dropped, so the first press on a cold session still loads it.
let loader: (() => void) | null = null;
let wanted = false;

export function armWalletLoader(load: () => void): void {
  loader = load;
  if (wanted) load();
}

export function requestWallet(): void {
  wanted = true;
  loader?.();
}

// wagmi persists to the cookie named `${storage.key}.store`, and lib/wagmi.ts
// leaves the key at its default, so this is the name cookieStorage writes. It is
// a session cookie: present exactly while wagmi has a connection worth
// reconnecting, which is the one case where the layer is fetched without a
// press. Called from an effect, never during render, so document is always there.
export function walletCookiePresent(): boolean {
  return document.cookie.split("; ").some((entry) => entry.startsWith("wagmi.store="));
}
