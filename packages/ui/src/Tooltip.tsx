"use client";

import type { ReactNode } from "react";
import { useId, useState } from "react";
import { cx } from "./cx";

export interface TooltipProps {
  // Plain text, because it is announced through aria-describedby and a screen
  // reader reads a string, not markup.
  content: string;
  children: ReactNode;
  className?: string;
}

// Hover, focus and tap all open it. DESIGN.md's Responsive section forbids an
// affordance reachable only by hover, so the trigger is a real button that toggles.
export function Tooltip({ content, children, className }: TooltipProps) {
  const id = useId();
  const [open, setOpen] = useState(false);

  return (
    <span className={cx("relative inline-flex", className)}>
      <button
        type="button"
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        onPointerEnter={() => setOpen(true)}
        onPointerLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen((previous) => !previous)}
        className="pp-press inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-pp outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pp-accent-bright"
      >
        {children}
      </button>
      {/* No transform on the bubble: it is positioned by inset alone so that the
          Rise primitive, which owns transform, is never fighting a centring
          translate. */}
      <span
        id={id}
        role="tooltip"
        hidden={!open}
        className="hairline rounded-pp bg-pp-surface-2 text-pp-text absolute bottom-full left-0 z-50 mb-1 w-max max-w-[280px] px-3 py-2 text-small"
      >
        {content}
      </span>
    </span>
  );
}
