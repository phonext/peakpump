"use client";

import { type RefObject, useEffect, useRef, useState } from "react";

// Hand-rolled, because the whole job is arithmetic on a fixed row height and a
// scrollTop: a windowing library would cost more in the bundle than the entire
// trades panel weighs. Fixed height is a requirement rather than a simplification
// — DESIGN.md gives the trades table one row height, so nothing here measures.
export interface VirtualRows {
  ref: RefObject<HTMLDivElement | null>;
  // Half-open, so end is safe to pass straight to slice.
  start: number;
  end: number;
  padTop: number;
  padBottom: number;
}

// Enough rows above and below the viewport that a fast flick paints filled rows
// rather than the spacer.
const OVERSCAN = 6;

export function useVirtualRows(count: number, rowHeight: number, height: number): VirtualRows {
  const ref = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);

  // count is in the dependencies because the scroller does not exist while the list
  // is empty: a panel showing an empty state has no node to listen to, and the
  // listener has to attach on the render that first produces one.
  useEffect(() => {
    const node = ref.current;
    if (node === null) return;
    const onScroll = () => setScrollTop(node.scrollTop);
    node.addEventListener("scroll", onScroll, { passive: true });
    return () => node.removeEventListener("scroll", onScroll);
  }, [count]);

  const visible = Math.ceil(height / rowHeight);
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - OVERSCAN);
  const end = Math.min(count, start + visible + OVERSCAN * 2);
  return {
    ref,
    start,
    end,
    padTop: start * rowHeight,
    padBottom: Math.max(0, (count - end) * rowHeight),
  };
}
