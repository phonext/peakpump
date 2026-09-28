"use client";

import { Button } from "@peakpump/ui/Button";
import { toAmountText } from "@/lib/amount";

// Fractions of the balance rather than round dollar figures: a row of 1 / 10 / 100
// USDC would be this file inventing amounts no document names, while a fraction of
// what the wallet holds is a number the chain already answered for. There is no 100
// percent here — that is Max, which has a gas reserve to take out first.
const FRACTIONS = [25n, 50n, 75n] as const;

// A fragment, not a row: the Max button sits with these and one gap between all four
// keeps the 8px DESIGN.md's Responsive section requires between neighbouring targets.
export function QuickAmounts({
  balance,
  decimals,
  onPick,
}: {
  balance: bigint | null;
  decimals: number;
  onPick: (text: string) => void;
}) {
  // Computed before the render rather than in the handler, so no branch has to test a
  // balance the disabled state has already excluded.
  const picks =
    balance === null || balance === 0n
      ? null
      : FRACTIONS.map((percent) => ({
          percent,
          text: toAmountText((balance * percent) / 100n, decimals),
        }));

  if (picks === null) {
    return (
      <>
        {FRACTIONS.map((percent) => (
          <Button key={percent.toString()} size="sm" disabled>
            {/* The digit is the figure and goes through .mono; the percent sign is
                punctuation and stays in the grotesk (DESIGN.md:14-15). */}
            <span className="mono">{percent.toString()}</span>%
          </Button>
        ))}
      </>
    );
  }

  return (
    <>
      {picks.map((pick) => (
        <Button key={pick.percent.toString()} size="sm" onClick={() => onPick(pick.text)}>
          <span className="mono">{pick.percent.toString()}</span>%
        </Button>
      ))}
    </>
  );
}
