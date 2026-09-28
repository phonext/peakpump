import type { ReactNode } from "react";
import { cx } from "./cx";

// A chip states a fact. tone maps only to the semantics DESIGN.md defines: green
// is up, red is down, and the accent orange never signals either. The label reads
// at 600, the weight --font-weight-medium resolves to: 13px on a tinted ground
// inside a border of the same hue reads as one block of colour at a lighter face.
// That token rose from 500 in the legibility pass for the same reason this label
// wants it, so the chip gained weight without changing a class here.
//
// No handlers come through rest on purpose. A chip is a 24px-tall span with no
// role, no keyboard path and no focus ring, and the 44px target rule applies to
// a box a press lands on; an onClick here would build one that none of those
// things cover. A chip that needs to be pressed is a Button.
export type ChipTone = "neutral" | "up" | "down" | "accent";

export interface ChipProps {
  tone?: ChipTone;
  className?: string;
  children?: ReactNode;
}

const TONE: Record<ChipTone, string> = {
  neutral: "bg-pp-surface-2 text-pp-text-muted border-pp-hairline",
  up: "bg-pp-up-soft text-pp-up border-pp-up",
  down: "bg-pp-down-soft text-pp-down border-pp-down",
  accent: "bg-pp-surface-2 text-pp-accent border-pp-accent",
};

export function Chip({ tone = "neutral", className, children }: ChipProps) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-pp border px-2 py-1 text-small font-sans font-medium",
        TONE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
