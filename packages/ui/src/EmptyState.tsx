import type { ReactNode } from "react";
import { cx } from "./cx";

export interface EmptyStateProps {
  title: string;
  // One short declarative sentence stating the real condition, per the Copy
  // section. Not a reassurance and not an instruction with an exclamation mark.
  detail?: string;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ title, detail, action, className }: EmptyStateProps) {
  return (
    <div
      className={cx(
        "hairline rounded-pp bg-pp-surface flex flex-col items-center gap-3 px-5 py-6 text-center",
        className,
      )}
    >
      <p className="text-body text-pp-text">{title}</p>
      {detail !== undefined ? <p className="text-small text-pp-text-muted">{detail}</p> : null}
      {action}
    </div>
  );
}
