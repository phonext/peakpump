"use client";

import type { KeyboardEvent, ReactNode } from "react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cx } from "./cx";

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
}

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

// Written against the platform rather than a headless library, so there is no
// vendor preset class chain to strip and no second radius arriving with it. The
// portal target is document.body: DESIGN.md forbids a transform on an ancestor of
// a portalled layer, and body has none.
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  className,
}: DialogProps) {
  const base = useId();
  const surface = useRef<HTMLDivElement | null>(null);
  const restoreTo = useRef<HTMLElement | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    restoreTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    const target = surface.current?.querySelector<HTMLElement>(FOCUSABLE);
    if (target !== null && target !== undefined) target.focus();
    else surface.current?.focus();
    return () => {
      document.documentElement.style.overflow = previousOverflow;
      restoreTo.current?.focus();
    };
  }, [open]);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const nodes = surface.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (nodes === undefined || nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (first === undefined || last === undefined) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  if (!mounted || !open) return null;

  return createPortal(
    <div
      data-pp-portal="dialog"
      // The bottom inset matches Toast: at sm this box is anchored to the bottom edge,
      // so with viewportFit cover the home indicator would otherwise sit on top of the
      // sheet's own controls.
      className="fixed inset-0 z-50 flex items-end justify-center p-4 pb-[max(1rem,env(safe-area-inset-bottom))] md:items-center"
    >
      {/* A flat tint, never a blur: DESIGN.md forbids blurring whatever sits behind
          a dialog. */}
      <div className="absolute inset-0 bg-pp-bg/80" onClick={onClose} aria-hidden="true" />
      <div
        ref={surface}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${base}-title`}
        aria-describedby={description === undefined ? undefined : `${base}-description`}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className={cx(
          // 100% resolves against the portal's content box, which already has the page
          // padding and the safe area taken out of it, so the surface can never be
          // taller than the space it is centred in. It has to be a column with the
          // header and footer held at their own height: the effect above locks the root
          // scroller, so this body is the only thing left that can scroll and a panel
          // taller than the viewport would otherwise have no way to reach its own
          // controls. 640x360 is a required test size and the pairing key alone exceeds
          // it there.
          "pp-rise hairline rounded-pp bg-pp-surface relative flex max-h-full w-full max-w-[560px] flex-col outline-none",
          className,
        )}
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-pp-hairline px-4 py-3">
          <div>
            <h2 id={`${base}-title`} className="text-heading font-medium text-pp-text">
              {title}
            </h2>
            {description !== undefined ? (
              <p id={`${base}-description`} className="text-small text-pp-text-muted">
                {description}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="pp-press pp-lift min-h-[44px] min-w-[44px] rounded-pp text-pp-text-muted outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pp-accent-bright"
          >
            <span aria-hidden="true">&#215;</span>
          </button>
        </header>
        {/* min-h-0 is what lets this shrink at all: a column flex item floors at its own
            min-content height otherwise, which would push the surface past the max above
            instead of scrolling inside it. */}
        <div className="min-h-0 overflow-y-auto p-4">{children}</div>
        {footer !== undefined ? (
          <footer className="flex shrink-0 justify-end gap-2 border-t border-pp-hairline px-4 py-3">
            {footer}
          </footer>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
