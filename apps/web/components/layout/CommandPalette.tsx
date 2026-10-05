"use client";

import { Button } from "@peakpump/ui/Button";
import { Dialog } from "@peakpump/ui/Dialog";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useWalletState } from "@/lib/wallet-state";

// The four pages a reader can reach by name. The other two routes take a parameter, so
// the token route is not listed: there is nothing to navigate to without a curve. A
// profile takes one too, but a connected wallet is itself an address — the one the
// reader can name without having to paste it — so it is the fifth entry when there is
// one, and absent when there is not. No search index and no fuzzy matching — the page
// set is closed at six, and a list of five is shorter than the query that would
// narrow it.
const ROUTES = [
  { href: "/", label: "Markets", detail: "Every token on the curve" },
  { href: "/create", label: "Create", detail: "Launch a token" },
  { href: "/brand", label: "Brand", detail: "Trademark and attribution" },
  { href: "/styleguide", label: "Styleguide", detail: "Components and motion" },
] as const;

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const { address, isConnected } = useWalletState();

  // The store starts disconnected and the lazy wallet layer is what populates it, so
  // this reads undefined on the server and on a cold session and the entry appears
  // when the layer publishes the account — the same moment the header's address does.
  const routes =
    isConnected && address !== undefined
      ? [
          ...ROUTES,
          {
            href: `/profile/${address}`,
            label: "Your profile",
            detail: "What you created, hold and earned",
          },
        ]
      : ROUTES;

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      // Either modifier, because the same shortcut is Cmd on a Mac and Ctrl
      // elsewhere. Escape belongs to Dialog, which already owns it.
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((previous) => !previous);
        return;
      }
      // The unmodified slash, for the hand already on the letters. Ignored while
      // typing in a field, where a slash is the reader's own character: input,
      // textarea and select cover everything editable, and contenteditable is
      // none of this product's controls.
      const target = event.target;
      const editing =
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);
      if (!event.metaKey && !event.ctrlKey && !event.altKey && event.key === "/" && !editing) {
        event.preventDefault();
        setOpen(true);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        Go to
      </Button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Go to"
        description="A token page opens from a row, and a profile from an address."
        footer={
          <p className="text-small text-pp-text-faint">
            Press Ctrl K, or Cmd K on a Mac. The slash key opens this too.
          </p>
        }
      >
        <ul className="flex flex-col gap-2">
          {routes.map((route) => (
            <li key={route.href}>
              <Link
                href={route.href}
                onClick={() => setOpen(false)}
                className="pp-press pp-lift hairline flex min-h-[44px] flex-col justify-center rounded-pp px-3 py-2 outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pp-accent-bright"
              >
                <span className="text-body text-pp-text">{route.label}</span>
                <span className="text-small text-pp-text-muted">{route.detail}</span>
              </Link>
            </li>
          ))}
        </ul>
      </Dialog>
    </>
  );
}
