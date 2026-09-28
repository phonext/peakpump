"use client";

import type { ElementType, HTMLAttributes, KeyboardEvent, ReactNode } from "react";
import { cx } from "./cx";

// title is a rendered heading, not the HTML title attribute, so the DOM one is
// omitted rather than widened: a panel heading takes a node, and a tooltip on the
// panel box is not a thing this product has.
export interface PanelProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  as?: ElementType;
  title?: ReactNode;
  action?: ReactNode;
  // A panel that is itself clickable gets Press; a panel that only responds to
  // the pointer gets Lift. A static panel gets neither, so a page of panels does
  // not light up under a cursor that is only passing through.
  interactive?: boolean;
  children?: ReactNode;
}

export function Panel({
  as: Tag = "section",
  title,
  action,
  interactive = false,
  className,
  children,
  ...rest
}: PanelProps) {
  // A clickable panel is not a <button>, because a button cannot hold a heading
  // and the block body a panel is for. role="button" carries the same contract,
  // so it carries the keyboard half of it too: both activating keys on a real
  // button, forwarded to whatever onClick the caller passed through rest.
  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    event.currentTarget.click();
  }

  return (
    <Tag
      className={cx(
        "hairline rounded-pp bg-pp-surface",
        interactive &&
          "pp-press pp-lift outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pp-accent-bright",
        className,
      )}
      {...(interactive
        ? { role: "button", tabIndex: 0, onKeyDown }
        : null)}
      {...rest}
    >
      {title !== undefined || action !== undefined ? (
        <header className="flex items-center justify-between gap-3 border-b border-pp-hairline px-4 py-3">
          <h2 className="text-heading font-medium text-pp-text">{title}</h2>
          {action}
        </header>
      ) : null}
      <div className="p-4">{children}</div>
    </Tag>
  );
}
