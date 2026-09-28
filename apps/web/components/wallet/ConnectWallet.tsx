"use client";

import { arcTestnet } from "@peakpump/shared/chain";
import { Button } from "@peakpump/ui/Button";
import { Dialog } from "@peakpump/ui/Dialog";
import { Toast } from "@peakpump/ui/Toast";
import { useEffect, useState } from "react";
import { InlineAddressLink } from "@/components/layout/InlineAddressLink";
import { describeRpcError } from "@/lib/rpc-error";
import { requestWallet, useWalletState } from "@/lib/wallet-state";

// The server has no account to read, so it always renders the disconnected branch and
// hydration replaces it with the wider connected one. Inside the header's flex-wrap
// that difference is not 71px of horizontal drift but 56px of vertical: the row flips
// from 68px to 124px, and at 640x360 — a required test size — it flips on exactly this
// swap. So both branches occupy one box wide enough for the wider of them: 11
// monospace characters at the Small step measure 85.8px, the gap is 8 and the
// Disconnect button 97.6, which is 191.4px. 200 rather than 192 because that 85.8 is
// JetBrains Mono's own advance and the file arrives after the first paint: the
// monospaces that hold the line until it does run from Consolas at 78.7px to Menlo at
// 86.1px, so the row lands somewhere in 184.3 to 191.8 and the box has to cover the top
// of that range. justify-end spends the slack on the inward side, where the row already
// has empty space.
const RESERVED = "flex min-w-[200px] items-center justify-end gap-2";

export function ConnectWallet() {
  const {
    address,
    isConnected,
    connectors,
    connect,
    disconnect,
    isPending,
    pendingConnector,
    connectError: error,
    resetConnect: reset,
  } = useWalletState();
  const [pickerOpen, setPickerOpen] = useState(false);

  // The account cannot be read on the server and does not arrive in the first client
  // render either: the wallet store starts disconnected and only the lazy layer
  // populates it, which is always after hydration. The document's own first render
  // therefore agrees with the server by construction — but a subtree inside a
  // Suspense boundary hydrates after the store has already landed the account, and
  // there this branch would flip mid-hydration and React would discard the tree.
  // app/token/[curve]/loading.tsx makes the token page exactly such a subtree, and
  // the trade panel mounts a second copy of this component inside it. Deferring the
  // swap by one commit costs no paint: the layer's reconnect crosses the extension
  // before an address exists, which is later than this.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setHydrated(true);
  }, []);

  function openPicker() {
    // On a cold session the wallet chunk does not exist yet. Asking for it and
    // opening the picker is one press either way: the list below fills in when
    // the layer publishes its connectors.
    requestWallet();
    setPickerOpen(true);
  }

  function closePicker() {
    setPickerOpen(false);
  }

  if (hydrated && isConnected && address !== undefined) {
    return (
      <span className={RESERVED}>
        <InlineAddressLink
          address={address}
          className="mono text-small text-pp-text-muted"
        />
        <Button size="sm" onClick={() => disconnect()}>
          Disconnect
        </Button>
      </span>
    );
  }

  return (
    <>
      <span className={RESERVED}>
        <Button variant="primary" size="sm" onClick={openPicker}>
          Connect wallet
        </Button>
      </span>

      <Dialog
        open={pickerOpen}
        onClose={closePicker}
        title="Connect a wallet"
        description={`${arcTestnet.name}, chain id ${arcTestnet.id}.`}
      >
        {connectors.length === 0 ? (
          // Only on a cold session, between the press that asked for the wallet
          // chunk and the layer's first publish. There is no wallet to offer yet,
          // so the dialog says what it is doing rather than listing nothing.
          <p className="text-small text-pp-text-muted">Loading wallets.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {connectors.map((connector) => {
              const attempting = isPending && pendingConnector === connector;
              return (
                <li key={connector.uid}>
                  <Button
                    className="w-full justify-between"
                    disabled={attempting}
                    // Closing here rather than leaving it to the unmount: the
                    // connected branch below replaces this whole subtree, so
                    // pickerOpen would otherwise still be true when the account is
                    // later disconnected and the picker would reopen by itself.
                    onClick={() => connect(connector, { onSuccess: closePicker })}
                  >
                    {connector.name}
                    {attempting ? <span className="text-pp-text-muted">Waiting</span> : null}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </Dialog>

      {error === null ? null : (
        <Toast open onClose={reset} message={describeRpcError(error).message} tone="down" />
      )}
    </>
  );
}
