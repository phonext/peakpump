"use client";

import { useState } from "react";

export type FlashDirection = "up" | "down";

export interface Flash {
  dir: FlashDirection;
  // Parity picks between the two identical keyframes in motion.css, so a change
  // arriving mid-decay restarts the animation with no forced reflow.
  seq: number;
}

// The only motion JavaScript in the product: it reports that a value changed and
// in which direction. The tint, the duration and the easing all live in CSS.
export function useFlashOnChange(value: bigint | number | undefined): Flash | null {
  const [previous, setPrevious] = useState(value);
  const [flash, setFlash] = useState<Flash | null>(null);
  if (value !== previous) {
    setPrevious(value);
    // A first appearance has nothing to compare against, so it does not flash. The
    // comparisons are numeric, not strict, so 5 replacing 5n is no direction.
    if (value !== undefined && previous !== undefined) {
      const dir = value > previous ? "up" : value < previous ? "down" : null;
      if (dir !== null) setFlash((last) => ({ dir, seq: (last?.seq ?? 0) + 1 }));
    }
  }
  return flash;
}
