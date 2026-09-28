"use client";

import { PRODUCT_NAME } from "@peakpump/shared/brand";
import { arcTestnet } from "@peakpump/shared/chain";
import { useWalletState } from "@/lib/wallet-state";

// A wallet can be connected and still be on another chain, and every write this
// product offers is an Arc Testnet transaction: the wrong chain is a wall, not
// a degraded mode, so the header says so beside the wallet it belongs to. The
// switch itself is left to the wallet app, which is the one surface that can
// do it reliably. Absent entirely when no account is connected or the chain is
// already right, so the header's reserved row never carries it.
export function WrongChain() {
  const { isConnected, chainId } = useWalletState();

  // Undefined while the account is still arriving, which is not a wrong chain.
  if (!isConnected || chainId === undefined || chainId === arcTestnet.id) return null;

  return (
    <p className="text-small text-pp-down">
      This wallet is on another network. {PRODUCT_NAME} trades on {arcTestnet.name}.
    </p>
  );
}
