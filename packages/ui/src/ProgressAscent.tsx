import { cx } from "./cx";

export interface ProgressAscentProps {
  // Basis points of supply sold, 0..10000. Basis points rather than a float
  // because every other progress figure in this product is a bps integer and a
  // float would introduce a second representation of the same number.
  bps: number;
  // The already-formatted percentage, e.g. "42.1%". packages/ui takes no
  // dependency on @peakpump/shared, so the caller formats and passes the string
  // rather than this component inventing a second formatter.
  valueText: string;
  className?: string;
}

export function ProgressAscent({ bps, valueText, className }: ProgressAscentProps) {
  const clamped = bps < 0 ? 0 : bps > 10_000 ? 10_000 : bps;
  return (
    <div className={cx("flex items-center gap-3", className)}>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={10_000}
        aria-valuenow={clamped}
        aria-valuetext={valueText}
        aria-label="Progress to the Summit"
        className="hairline rounded-pp bg-pp-surface-2 h-2 flex-1 overflow-hidden"
      >
        {/* width is set, never transitioned. DESIGN.md's Motion section bars any
            animation of width, so the bar snaps to the value it was given. */}
        <div className="bg-pp-up h-full" style={{ width: `${clamped / 100}%` }} />
      </div>
      {/* Body on mobile and Small from md up: the percentage is a number, and
          DESIGN.md floors numbers at the scale's third step on mobile. */}
      <span className="mono text-body text-pp-text md:text-small">{valueText}</span>
    </div>
  );
}
