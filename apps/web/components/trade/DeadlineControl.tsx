"use client";

import { Button } from "@peakpump/ui/Button";
import { DEADLINE_PRESETS_MINUTES } from "@/lib/deadline";

// Presets and nothing else. The deadline parameter and its comparison are fixed
// and say nothing about the control, so a free-form field here would need a
// bound of its own invention; three windows is a control, and the widest of
// them is twenty minutes on a chain with sub-second blocks.
export function DeadlineControl({
  minutes,
  onChange,
}: {
  minutes: number;
  onChange: (next: number) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-small font-medium text-pp-text">Deadline</p>

      <div role="group" aria-label="Deadline in minutes" className="flex flex-wrap items-center gap-2">
        {DEADLINE_PRESETS_MINUTES.map((preset) => (
          <Button
            key={preset}
            size="sm"
            variant={preset === minutes ? "primary" : "secondary"}
            aria-pressed={preset === minutes}
            onClick={() => onChange(preset)}
          >
            <span className="mono">{preset}</span> min
          </Button>
        ))}
      </div>

      <p className="text-small text-pp-text-muted">
        The curve refuses the trade after this. The second it is measured against is read
        from the chain when you sign, never from this browser's clock.
      </p>
    </div>
  );
}
