"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";

export type ButtonVariant = "primary" | "secondary" | "destructive" | "ghost";
export type ButtonSize = "sm" | "md";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children?: ReactNode;
}

// Every variant is one radius, one hairline, no shadow. Colour is the only thing
// that separates them, because DESIGN.md gives depth to the hairline and the two
// surface steps and to nothing else.
//
// Colour separates the variants and never the states. DESIGN.md:146-147 makes Press
// the only press treatment in the product and :154-155 makes Lift the only hover
// treatment, so a variant that also shifted its own ground under the pointer would
// be a second one of each; :129-131 bars animating that shift, which leaves an
// instant repaint as the only way to express it. Lift, Press and Sheen carry the
// primary action instead, and none of them touches a colour.
const VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-pp-accent text-pp-accent-contrast border-pp-accent-bright",
  secondary: "bg-pp-surface-2 text-pp-text border-pp-hairline",
  destructive: "bg-pp-down-soft text-pp-down border-pp-down",
  ghost: "bg-transparent text-pp-text-muted border-transparent",
};

// Both sizes clear the 44x44 minimum target DESIGN.md's Responsive section
// requires; they differ in padding and type step, never in hit area, because a
// smaller hit area is not a size the document permits.
const SIZE: Record<ButtonSize, string> = {
  sm: "min-h-[44px] min-w-[44px] px-3 text-small",
  md: "min-h-[44px] min-w-[44px] px-4 text-body",
};

export function Button({
  variant = "secondary",
  size = "md",
  className,
  children,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        "pp-press pp-lift relative inline-flex items-center justify-center gap-2",
        "rounded-pp border font-sans",
        "outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pp-accent-bright",
        "disabled:text-pp-text-faint disabled:pointer-events-none",
        VARIANT[variant],
        SIZE[size],
        className,
      )}
      {...rest}
    >
      {/* Sheen fires on hover-enter of a primary action only (DESIGN.md 3). The
          span owns the clipping so the button keeps its focus indicator outside it. */}
      {variant === "primary" ? <span className="pp-sheen" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}
