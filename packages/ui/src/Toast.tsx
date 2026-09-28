"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { cx } from "./cx";

export type ToastTone = "neutral" | "up" | "down";

export interface ToastProps {
  open: boolean;
  onClose: () => void;
  message: string;
  tone?: ToastTone;
  // Milliseconds before the toast dismisses itself. A toast that reports a failed
  // transaction stays until dismissed, so this is optional rather than defaulted.
  autoCloseMs?: number;
}

const TONE: Record<ToastTone, string> = {
  neutral: "bg-pp-surface-2 text-pp-text",
  up: "bg-pp-up-soft text-pp-up",
  down: "bg-pp-down-soft text-pp-down",
};

// role="status" with aria-live="polite" rather than an alert: nothing this product
// reports is urgent enough to interrupt a screen reader mid-sentence.
export function Toast({ open, onClose, message, tone = "neutral", autoCloseMs }: ToastProps) {
  useEffect(() => {
    if (!open || autoCloseMs === undefined) return;
    const timer = window.setTimeout(onClose, autoCloseMs);
    return () => window.clearTimeout(timer);
  }, [open, autoCloseMs, onClose]);

  if (typeof document === "undefined" || !open) return null;

  return createPortal(
    <div
      data-pp-portal="toast"
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 bottom-0 z-50 flex justify-center p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
    >
      <div
        className={cx(
          "pp-rise hairline rounded-pp flex items-center gap-3 px-4 py-3 text-small",
          TONE[tone],
        )}
      >
        <span>{message}</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Dismiss"
          className="pp-press min-h-[44px] min-w-[44px] rounded-pp outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pp-accent-bright"
        >
          <span aria-hidden="true">&#215;</span>
        </button>
      </div>
    </div>,
    document.body,
  );
}
