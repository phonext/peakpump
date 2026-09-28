"use client";

import { arcTestnet } from "@peakpump/shared/chain";
import { formatUsdc6 } from "@peakpump/shared/format";
import { Button } from "@peakpump/ui/Button";
import { Chip } from "@peakpump/ui/Chip";
import { Dialog } from "@peakpump/ui/Dialog";
import { Panel } from "@peakpump/ui/Panel";
import { Tabs } from "@peakpump/ui/Tabs";
import type { ToastTone } from "@peakpump/ui/Toast";
import { Toast } from "@peakpump/ui/Toast";
import { Tooltip } from "@peakpump/ui/Tooltip";
import { useState } from "react";
import { useFlashOnChange } from "@/lib/useFlashOnChange";

// The interactive half of the styleguide. One module, several exports: the page
// itself stays a server component and each island below is placed beside the
// static specimens it belongs with, rather than the whole page turning into a
// client tree to show four components that need state.

const PANEL_TEXT = "text-small text-pp-text-muted";

const TAB_ITEMS = [
  { id: "buy", label: "Buy", content: <p className={PANEL_TEXT}>The buy panel.</p> },
  { id: "sell", label: "Sell", content: <p className={PANEL_TEXT}>The sell panel.</p> },
] as const;

export function TabsDemo() {
  const [active, setActive] = useState("sell");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <p className={PANEL_TEXT}>Uncontrolled, defaulting to the first item.</p>
        <Tabs items={TAB_ITEMS} label="Trade side, uncontrolled" />
      </div>
      <div className="flex flex-col gap-2">
        <p className={PANEL_TEXT}>Controlled. The owner holds the value.</p>
        <Tabs items={TAB_ITEMS} value={active} onValueChange={setActive} label="Trade side" />
        <p className="mono text-small text-pp-text-faint">{active}</p>
      </div>
    </div>
  );
}
export function DialogDemo() {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex flex-col gap-2">
      <Button variant="primary" onClick={() => setOpen(true)}>
        Open the dialog
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Add Arc Testnet"
        description="One surface, one radius, one flat scrim."
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={() => setOpen(false)}>
              Add
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-2">
          <p className={PANEL_TEXT}>
            The scrim is flat, the surface rises once, and focus is trapped until it closes.
          </p>
          {/* description takes a string, so the chain id goes in the body where it can
              be set in the monospace face. */}
          <p className="mono text-body text-pp-text md:text-small">
            {arcTestnet.name} · chain id {arcTestnet.id}
          </p>
        </div>
      </Dialog>
    </div>
  );
}

interface ToastRequest {
  tone: ToastTone;
  autoCloseMs?: number;
}

const TOAST_MESSAGE: Record<ToastTone, string> = {
  neutral: "Nothing changed.",
  up: "The buy filled.",
  down: "The transaction was rejected.",
};

// One at a time: two open toasts would be two fixed containers over the same
// strip of screen, and the component is not a stack.
export function ToastDemo() {
  const [request, setRequest] = useState<ToastRequest | null>(null);

  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" onClick={() => setRequest({ tone: "neutral" })}>
        Neutral
      </Button>
      <Button size="sm" onClick={() => setRequest({ tone: "up" })}>
        Up
      </Button>
      <Button size="sm" onClick={() => setRequest({ tone: "down" })}>
        Down
      </Button>
      <Button size="sm" onClick={() => setRequest({ tone: "up", autoCloseMs: 2400 })}>
        Auto-dismiss <span className="mono">2400ms</span>
      </Button>
      {request === null ? null : (
        <Toast
          open
          onClose={() => setRequest(null)}
          message={TOAST_MESSAGE[request.tone]}
          tone={request.tone}
          autoCloseMs={request.autoCloseMs}
        />
      )}
    </div>
  );
}
export function TooltipDemo() {
  return (
    <div className="flex items-center gap-3">
      <Tooltip content="The total fee splits top-down between the creator and the protocol.">
        <Chip>Fees</Chip>
      </Tooltip>
      <p className={PANEL_TEXT}>Hover, focus and tap all open it.</p>
    </div>
  );
}

// Rise runs on mount, so the only way to show it twice is to mount the panels
// twice: the key below replaces them. The stagger is nth-child in motion.css,
// which is why these three are direct siblings.
export function RiseDemo() {
  const [round, setRound] = useState(0);

  return (
    <div className="flex flex-col gap-3">
      <Button size="sm" onClick={() => setRound((previous) => previous + 1)}>
        Replay
      </Button>
      <div key={round} className="flex flex-col gap-2 md:grid md:grid-cols-3">
        <Panel className="pp-rise">
          <p className={PANEL_TEXT}>No delay.</p>
        </Panel>
        <Panel className="pp-rise">
          <p className={PANEL_TEXT}>Second child.</p>
        </Panel>
        <Panel className="pp-rise">
          <p className={PANEL_TEXT}>Third child.</p>
        </Panel>
      </div>
    </div>
  );
}

// A step of a quarter of a USDC, in 6-decimal units. A button press rather than a
// timer, because a decorative animation that loops on its own is not allowed and a
// number that changes without a cause would be one.
const STEP6 = 250_000n;

export function FlashDemo() {
  const [amount6, setAmount6] = useState(1_000_000n);
  const flash = useFlashOnChange(amount6);

  return (
    <div className="flex items-center gap-3">
      <span
        className="pp-flash mono text-heading text-pp-text"
        data-pp-flash={flash?.dir}
        data-pp-flash-parity={flash === null ? undefined : flash.seq % 2}
      >
        {formatUsdc6(amount6)}
      </span>
      <Button size="sm" onClick={() => setAmount6((previous) => previous + STEP6)}>
        Up
      </Button>
      <Button
        size="sm"
        onClick={() => setAmount6((previous) => (previous < STEP6 ? 0n : previous - STEP6))}
      >
        Down
      </Button>
    </div>
  );
}
