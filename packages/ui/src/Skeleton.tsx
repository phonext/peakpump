import type { HTMLAttributes } from "react";
import { cx } from "./cx";

export interface SkeletonProps extends Omit<HTMLAttributes<HTMLSpanElement>, "children"> {
  // Not optional. DESIGN.md requires a skeleton to declare its final width and
  // height so nothing shifts when content arrives; a default here would let a
  // caller ship a zero-height box and a layout shift with it.
  width: number | string;
  height: number | string;
  // A skeleton standing in for a chart, a table or a full-bleed image reserves a
  // square-cornered box, because the real element that replaces it carries the
  // radius itself and two nested radii read as a seam.
  radius?: boolean;
}

export function Skeleton({
  width,
  height,
  radius = true,
  className,
  style,
  ...rest
}: SkeletonProps) {
  return (
    <span
      aria-hidden="true"
      className={cx("pp-shimmer block", radius && "rounded-pp", className)}
      style={{ width, height, ...style }}
      {...rest}
    />
  );
}
