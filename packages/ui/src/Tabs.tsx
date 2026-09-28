"use client";

import type { KeyboardEvent, ReactNode } from "react";
import { useId, useRef, useState } from "react";
import { cx } from "./cx";

export interface TabItem {
  id: string;
  label: ReactNode;
  content?: ReactNode;
}

export interface TabsProps {
  items: readonly TabItem[];
  // Controlled when value is given, uncontrolled otherwise. Both are needed: the
  // trade panel drives its buy/sell tabs from state a quote depends on, while a
  // styleguide tab strip has no owner.
  value?: string;
  defaultValue?: string;
  onValueChange?: (id: string) => void;
  label: string;
  className?: string;
}

export function Tabs({ items, value, defaultValue, onValueChange, label, className }: TabsProps) {
  const base = useId();
  const first = items[0];
  const [internal, setInternal] = useState(defaultValue ?? first?.id ?? "");
  const active = value ?? internal;
  const strip = useRef<HTMLDivElement | null>(null);

  function select(id: string) {
    if (value === undefined) setInternal(id);
    onValueChange?.(id);
  }

  // Automatic activation: the panel follows focus, which is the ARIA pattern for
  // a tab strip whose panels are already in the document.
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const index = items.findIndex((item) => item.id === active);
    if (index < 0) return;
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % items.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + items.length) % items.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = items.length - 1;
    else return;
    event.preventDefault();
    const target = items[next];
    if (target === undefined) return;
    select(target.id);
    strip.current?.querySelector<HTMLButtonElement>(`#${CSS.escape(`${base}-tab-${target.id}`)}`)?.focus();
  }

  const panel = items.find((item) => item.id === active);

  return (
    <div className={className}>
      <div
        ref={strip}
        role="tablist"
        aria-label={label}
        onKeyDown={onKeyDown}
        className="hairline rounded-pp bg-pp-surface flex gap-2 p-1"
      >
        {items.map((item) => {
          const selected = item.id === active;
          return (
            <button
              key={item.id}
              id={`${base}-tab-${item.id}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`${base}-panel-${item.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => select(item.id)}
              className={cx(
                // flex-1 divides the strip, but a two-character label in a narrow strip
                // would still resolve to under 44px, so the minimum is stated on both
                // axes the way Button states it.
                "pp-press pp-lift relative min-h-[44px] min-w-[44px] flex-1 rounded-pp px-3 text-small font-sans",
                "outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pp-accent-bright",
                selected ? "bg-pp-surface-2 text-pp-text" : "text-pp-text-muted",
              )}
            >
              {item.label}
            </button>
          );
        })}
      </div>
      {panel?.content !== undefined ? (
        <div
          id={`${base}-panel-${panel.id}`}
          role="tabpanel"
          aria-labelledby={`${base}-tab-${panel.id}`}
          tabIndex={0}
          // The panel is a tab stop by design, so the outline it suppresses has
          // to be replaced rather than removed: the tab buttons' own ring, on
          // the element keyboard focus lands in when a tab arrow moves into it.
          className="pt-3 outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pp-accent-bright"
        >
          {panel.content}
        </div>
      ) : null}
    </div>
  );
}
