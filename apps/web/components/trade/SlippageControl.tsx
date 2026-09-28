"use client";

import { Button } from "@peakpump/ui/Button";
import { useState } from "react";
import {
  SLIPPAGE_PRESETS_BPS,
  formatSlippagePercent,
  isHighSlippage,
  parseSlippagePercent,
} from "@/lib/slippage";

// Narrower than the amount field and otherwise the same box. text-body for the same
// two reasons: it is a number, and 16px is the step below which a phone browser zooms
// the page when the field takes focus.
const FIELD =
  "hairline rounded-pp bg-pp-surface-2 text-pp-text mono min-h-[44px] w-[88px] px-3 py-2 text-body outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pp-accent-bright";

export interface SlippageControlProps {
  bps: bigint;
  onChange: (bps: bigint) => void;
  accepted: boolean;
  onAccept: (next: boolean) => void;
}

// Three presets, a custom field, and above five percent a warning with a second
// action that has to be pressed before the trade can be. The acceptance is the panel's
// state rather than this component's: it gates a submit control in another file, and it
// has to fall away the moment the tolerance changes.
export function SlippageControl({ bps, onChange, accepted, onAccept }: SlippageControlProps) {
  const [custom, setCustom] = useState("");
  const percent = formatSlippagePercent(bps);

  return (
    <div className="flex flex-col gap-2">
      <p className="text-small font-medium text-pp-text">Slippage tolerance</p>

      <div role="group" aria-label="Slippage tolerance" className="flex flex-wrap items-center gap-2">
        {SLIPPAGE_PRESETS_BPS.map((preset) => {
          // A preset stops reading as chosen the moment a custom value is typed, even
          // when the two happen to agree: what is in the field is what is in effect.
          const selected = custom === "" && bps === preset;
          return (
            <Button
              key={preset.toString()}
              size="sm"
              variant={selected ? "primary" : "secondary"}
              aria-pressed={selected}
              onClick={() => {
                setCustom("");
                onChange(preset);
              }}
            >
              <span className="mono">{formatSlippagePercent(preset)}</span>%
            </Button>
          );
        })}

        <label className="flex items-center gap-2">
          <span className="sr-only">Custom slippage tolerance, percent</span>
          <input
            className={FIELD}
            value={custom}
            onChange={(event) => {
              const text = event.target.value;
              setCustom(text);
              // Only a usable value moves the tolerance. A half-typed one leaves the
              // last good number in effect rather than dropping the bound to zero.
              const parsed = parseSlippagePercent(text);
              if (parsed !== null) onChange(parsed);
            }}
            inputMode="decimal"
            autoComplete="off"
            spellCheck={false}
            placeholder="Custom"
            aria-invalid={custom !== "" && parseSlippagePercent(custom) === null}
          />
          <span className="text-small text-pp-text-muted">%</span>
        </label>
      </div>

      {isHighSlippage(bps) ? (
        <div className="flex flex-col gap-2">
          <p className="text-small text-pp-down">
            At {percent}% this trade can fill {percent}% worse than the quote and still go
            through.
          </p>
          <Button
            size="sm"
            variant={accepted ? "destructive" : "secondary"}
            aria-pressed={accepted}
            onClick={() => onAccept(!accepted)}
          >
            {accepted ? "Accepting " : "Accept "}
            <span className="mono">{percent}</span>%
          </Button>
        </div>
      ) : null}
    </div>
  );
}
