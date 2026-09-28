"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { createQueryClient } from "@/lib/query";
import { armWalletLoader, walletCookiePresent } from "@/lib/wallet-state";
import { installWalletNoiseGuard } from "@/lib/wallet-noise";

// The wallet layer — wagmi, ox and their share of viem — is one lazy chunk that
// first-load JavaScript never carries, which is what keeps the token route inside
// DESIGN.md's 250 kB gzipped budget. It mounts when a Connect press asks for it,
// or at once when wagmi's session cookie says a connection is waiting to be
// restored. Every wallet-reading component gets its state from lib/wallet-state
// instead of wagmi's context, so nothing on the page needs this layer to exist.
const WalletLayer = lazy(() => import("@/components/wallet/WalletLayer"));

// One eager provider and the deferred wallet layer; no wallet-modal library ships
// a provider into this tree, so no third-party theme variable exists to set.
export function Providers({ children }: { children: ReactNode }) {
  // The factory is handed to useState rather than called, so the client is built once
  // per mount instead of on every render, and never at module scope where the server
  // would share one cache across requests.
  const [queryClient] = useState(createQueryClient);
  const [walletOn, setWalletOn] = useState(false);

  useEffect(() => {
    armWalletLoader(() => setWalletOn(true));
    // The cookie is wagmi's own persistence (a session cookie named wagmi.store),
    // so its presence is exactly the case where reconnect can succeed and the
    // layer is fetched without a press. Everyone else downloads no wallet code
    // until they press Connect.
    if (walletCookiePresent()) setWalletOn(true);
  }, []);

  // The wallet chunk arrives after hydration, so this listener is armed before
  // the layer's reconnect can produce the first unhandled rejection — strictly
  // earlier than the child-first ordering an eager provider could rely on.
  useEffect(installWalletNoiseGuard, []);

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      {walletOn ? (
        <Suspense fallback={null}>
          <WalletLayer />
        </Suspense>
      ) : null}
    </QueryClientProvider>
  );
}
