"use client";

import { Button } from "@peakpump/ui/Button";
import { Dialog } from "@peakpump/ui/Dialog";
import { useEffect, useState } from "react";
import { useSession } from "@/hooks/useSession";
import { buildSiweMessage } from "@/lib/siwe-client";
import { useWalletState } from "@/lib/wallet-state";

// The SIWE sign-in modal: nonce, signature, credentials callback. Reading and
// trading never pass through here — a session buys commenting, the watchlist,
// the follow button and the report action, and nothing else.

type Stage = "idle" | "asking" | "signing" | "checking" | "signed-in" | "failed";

const BUSY: Record<Exclude<Stage, "idle" | "failed">, string> = {
  asking: "Requesting a challenge",
  signing: "Waiting for the signature",
  checking: "Verifying the signature",
  "signed-in": "Signed in",
};

export interface SignInDialogProps {
  open: boolean;
  onClose: () => void;
}

export function SignInDialog({ open, onClose }: SignInDialogProps) {
  const { address, isConnected, walletClient } = useWalletState();
  const { refresh } = useSession();
  const [stage, setStage] = useState<Stage>("idle");
  const [failure, setFailure] = useState<string | null>(null);

  // A reopened dialog starts clean: the previous attempt's outcome is history
  // the caller has already shown, not a state this one inherits.
  useEffect(() => {
    if (open) {
      setStage("idle");
      setFailure(null);
    }
  }, [open]);

  async function signIn() {
    if (address === undefined || walletClient === undefined) return;
    setFailure(null);
    setStage("asking");
    try {
      const nonceResponse = await fetch("/api/auth/nonce", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address }),
      });
      if (!nonceResponse.ok) {
        const body = (await nonceResponse.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "The sign-in service did not answer.");
      }
      const { nonce } = (await nonceResponse.json()) as { nonce: string };

      const message = buildSiweMessage({
        address,
        nonce,
        // The host with no scheme, which is the form the server compares against
        // NEXTAUTH_URL. A deployment where the two disagree fails sign-in here,
        // and that is the honest outcome rather than a silent fallback.
        domain: window.location.host,
        uri: window.location.origin,
      });

      setStage("signing");
      const signature = await walletClient.signMessage({ message });

      setStage("checking");
      // Auth.js's own handshake: the CSRF token first, then the credentials
      // callback as form data, which is the shape its v4 route reads.
      const { csrfToken } = (await (await fetch("/api/auth/csrf")).json()) as {
        csrfToken: string;
      };
      const callback = await fetch("/api/auth/callback/credentials", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          csrfToken,
          message,
          signature,
          callbackUrl: window.location.origin,
          json: "true",
        }),
      });
      if (!callback.ok) {
        throw new Error("The signature did not verify. Check the wallet is on Arc Testnet.");
      }

      setStage("signed-in");
      refresh();
    } catch (thrown) {
      setStage("failed");
      // A declined signature is the wallet's own sentence and the user knows
      // why; everything else keeps the server's words when it sent any.
      const message = thrown instanceof Error ? thrown.message : "Sign-in did not complete.";
      setFailure(
        thrown instanceof Error && thrown.name === "UserRejectedRequestError"
          ? "The signature was declined. Nothing was signed."
          : message,
      );
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Sign in"
      description="One signature, no transaction and no fee. A session lets you comment, save markets, follow and report."
      footer={
        <p className="text-small text-pp-text-faint">
          The session lasts 7 days in this browser. Signing out ends it at once.
        </p>
      }
    >
      <div className="flex flex-col gap-4">
        {!isConnected || address === undefined ? (
          <p className="text-body text-pp-text-muted">
            Connect a wallet first. The sign-in control appears once one is connected.
          </p>
        ) : (
          <>
            {stage === "idle" || stage === "failed" ? (
              <Button onClick={() => void signIn()}>Sign in with {address.slice(0, 6)}…</Button>
            ) : null}
            {stage !== "idle" && stage !== "failed" ? (
              <p className="mono text-body text-pp-text" aria-live="polite">
                {BUSY[stage]}
              </p>
            ) : null}
            {stage === "signed-in" ? <p className="text-body text-pp-up">Signed in.</p> : null}
            {failure !== null ? <p className="text-body text-pp-down">{failure}</p> : null}
          </>
        )}
      </div>
    </Dialog>
  );
}
