"use client";

import type { ReactNode } from "react";
import { useId } from "react";

// text-body is the 16px step, which is what stops a phone browser zooming the page on
// focus (app/create/page.tsx records the same reason), and it is also the floor
// DESIGN.md's Responsive section puts under a number on a phone. The height is stated
// because 44px is a rule about every interactive box and a field is one.
const FIELD =
  "hairline rounded-pp bg-pp-surface-2 text-pp-text mono min-h-[44px] w-full px-3 py-2 text-body outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pp-accent-bright";

export interface AmountFieldProps {
  label: string;
  // The side's own unit: USDC on a buy, the market's symbol on a sell. It sits
  // outside the field so no parser has to read past it.
  unit: string;
  value: string;
  onChange: (next: string) => void;
  invalid: boolean;
  balanceLabel: string;
  // Null with no wallet connected, which is a different thing from zero and is why
  // the line disappears rather than printing 0.
  balanceText: string | null;
  children?: ReactNode;
}

// type="text" with inputMode decimal rather than type="number": a number input
// carries a spinner nobody wants beside a trade amount, silently accepts an exponent,
// and reports its value through the browser's locale, which would put a formatter
// this product does not control between the digits and the parser.
export function AmountField({
  label,
  unit,
  value,
  onChange,
  invalid,
  balanceLabel,
  balanceText,
  children,
}: AmountFieldProps) {
  const id = useId();
  const noteId = `${id}-note`;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-small font-medium text-pp-text">
          {label}
        </label>
        {balanceText === null ? null : (
          <span className="text-small text-pp-text-muted">
            {balanceLabel}{" "}
            <span className="mono text-body text-pp-text md:text-small">{balanceText}</span>
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        <input
          id={id}
          className={FIELD}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          placeholder="0.0…"
          aria-invalid={invalid}
          aria-describedby={invalid ? noteId : undefined}
        />
        <span className="text-small text-pp-text-muted shrink-0">{unit}</span>
      </div>

      {invalid ? (
        <p id={noteId} className="text-small text-pp-down">
          Enter digits with one decimal point at most.
        </p>
      ) : null}

      {children}
    </div>
  );
}
