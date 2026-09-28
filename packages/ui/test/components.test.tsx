import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Button } from "../src/Button";
import { Chip } from "../src/Chip";
import { Dialog } from "../src/Dialog";
import { EmptyState } from "../src/EmptyState";
import { Panel } from "../src/Panel";
import { ProgressAscent } from "../src/ProgressAscent";
import { Skeleton } from "../src/Skeleton";
import { Tabs } from "../src/Tabs";
import { Toast } from "../src/Toast";
import { Tooltip } from "../src/Tooltip";

// React refuses to run act() outside a test environment it can recognise, and
// there is no testing-library here to set the flag on our behalf.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(node: ReactNode) {
  act(() => root.render(node));
}

// Portalled layers land in document.body, not in container, so every query that
// has to see a Dialog or a Toast starts from the document.
function classTokens(): string[] {
  const tokens: string[] = [];
  for (const element of Array.from(document.querySelectorAll("[class]"))) {
    tokens.push(...element.className.split(/\s+/).filter(Boolean));
  }
  return tokens;
}

function press(target: Element, key: string, shiftKey = false) {
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, shiftKey, bubbles: true }));
  });
}

const TAB_ITEMS = [
  { id: "buy", label: "Buy", content: "buy panel" },
  { id: "sell", label: "Sell", content: "sell panel" },
  { id: "history", label: "History", content: "history panel" },
] as const;

describe("motion primitives are attached, not implied", () => {
  it("gives Press to every clickable surface the package renders", () => {
    render(
      <div>
        <Button variant="primary">Buy</Button>
        <Button variant="secondary">Cancel</Button>
        <Button variant="destructive">Sell</Button>
        <Button variant="ghost">More</Button>
        <Tabs label="Side" items={TAB_ITEMS} />
        <Tooltip content="The fee is 125 basis points of the trade.">Fee</Tooltip>
        <Panel title="Row" interactive>
          row body
        </Panel>
      </div>,
    );

    const buttons = Array.from(container.querySelectorAll("button"));
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) {
      expect(button.className.split(/\s+/)).toContain("pp-press");
    }
  });

  it("gives Lift to hoverable surfaces and withholds it from a static panel", () => {
    render(
      <div>
        <Button>Cancel</Button>
        <Panel title="Static">static body</Panel>
        <Panel title="Row" interactive>
          row body
        </Panel>
      </div>,
    );

    const [button] = Array.from(container.querySelectorAll("button"));
    const [staticPanel, interactivePanel] = Array.from(container.querySelectorAll("section"));
    expect(button?.className.split(/\s+/)).toContain("pp-lift");
    expect(interactivePanel?.className.split(/\s+/)).toContain("pp-lift");
    expect(staticPanel?.className.split(/\s+/)).not.toContain("pp-lift");
    expect(staticPanel?.className.split(/\s+/)).not.toContain("pp-press");
  });

  it("renders the Sheen band on a primary action and on nothing else", () => {
    render(<Button variant="primary">Buy</Button>);
    expect(container.querySelectorAll(".pp-sheen")).toHaveLength(1);

    for (const variant of ["secondary", "destructive", "ghost"] as const) {
      render(<Button variant={variant}>Act</Button>);
      expect(container.querySelectorAll(".pp-sheen")).toHaveLength(0);
    }
  });
});

describe("Tabs keyboard contract", () => {
  it("moves selection and the roving tabIndex together", () => {
    render(<Tabs label="Side" items={TAB_ITEMS} />);
    const strip = container.querySelector('[role="tablist"]');
    const tabs = () => Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]'));

    const selected = () => tabs().findIndex((tab) => tab.getAttribute("aria-selected") === "true");
    const focusable = () => tabs().findIndex((tab) => tab.tabIndex === 0);

    expect(selected()).toBe(0);
    expect(focusable()).toBe(0);

    press(strip as Element, "ArrowRight");
    expect(selected()).toBe(1);
    expect(focusable()).toBe(1);

    press(strip as Element, "End");
    expect(selected()).toBe(2);
    expect(focusable()).toBe(2);

    // Wrapping is the ARIA pattern, so End then ArrowRight lands back on the first
    // tab rather than stopping.
    press(strip as Element, "ArrowRight");
    expect(selected()).toBe(0);

    press(strip as Element, "ArrowLeft");
    expect(selected()).toBe(2);

    press(strip as Element, "Home");
    expect(selected()).toBe(0);
    expect(focusable()).toBe(0);
  });

  it("shows one panel, labelled by its own tab", () => {
    render(<Tabs label="Side" items={TAB_ITEMS} />);
    const panels = container.querySelectorAll('[role="tabpanel"]');
    expect(panels).toHaveLength(1);
    const panel = panels[0];
    const tab = container.querySelector('[role="tab"][aria-selected="true"]');
    expect(panel?.getAttribute("aria-labelledby")).toBe(tab?.id);
    expect(tab?.getAttribute("aria-controls")).toBe(panel?.id);
  });
});

describe("ProgressAscent reports basis points, clamped", () => {
  it("clamps below zero and above full supply", () => {
    render(<ProgressAscent bps={-5} valueText="0.0%" />);
    expect(container.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow")).toBe("0");

    render(<ProgressAscent bps={20_000} valueText="100.0%" />);
    const bar = container.querySelector('[role="progressbar"]');
    expect(bar?.getAttribute("aria-valuenow")).toBe("10000");
    expect(bar?.getAttribute("aria-valuemax")).toBe("10000");
  });

  it("announces the caller's formatted string rather than inventing one", () => {
    render(<ProgressAscent bps={4210} valueText="42.1%" />);
    expect(container.querySelector('[role="progressbar"]')?.getAttribute("aria-valuetext")).toBe(
      "42.1%",
    );
  });
});

describe("Skeleton reserves its box", () => {
  it("writes both width and height inline so nothing shifts on arrival", () => {
    render(<Skeleton width={120} height={16} />);
    const box = container.querySelector<HTMLElement>(".pp-shimmer");
    expect(box?.style.width).toBe("120px");
    expect(box?.style.height).toBe("16px");
  });
});

describe("Dialog", () => {
  function Fixture({ open }: { open: boolean }) {
    return (
      <div>
        <button type="button" id="outside">
          Outside
        </button>
        <Dialog open={open} onClose={() => {}} title="Confirm the buy" description="Test tokens only.">
          <button type="button" id="first-child">
            First
          </button>
          <button type="button" id="last-child">
            Last
          </button>
        </Dialog>
      </div>
    );
  }

  it("portals to document.body with the modal roles wired to its own heading", () => {
    render(<Fixture open />);
    const portal = document.body.querySelector('[data-pp-portal="dialog"]');
    expect(portal?.parentElement).toBe(document.body);
    expect(portal?.contains(container)).toBe(false);

    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog?.getAttribute("aria-modal")).toBe("true");
    const labelledBy = dialog?.getAttribute("aria-labelledby");
    expect(labelledBy).toBeTruthy();
    expect(document.getElementById(labelledBy as string)?.textContent).toBe("Confirm the buy");
  });

  it("calls onClose on Escape", () => {
    let closes = 0;
    render(
      <Dialog open onClose={() => (closes += 1)} title="Confirm the buy">
        body
      </Dialog>,
    );
    press(document.body.querySelector('[role="dialog"]') as Element, "Escape");
    expect(closes).toBe(1);
  });

  it("wraps Tab at both ends of its own focusables", () => {
    render(<Fixture open />);
    const dialog = document.body.querySelector('[role="dialog"]') as HTMLElement;
    const focusables = Array.from(dialog.querySelectorAll<HTMLElement>("button"));
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    expect(first).toBeDefined();
    expect(last).toBeDefined();

    act(() => (last as HTMLElement).focus());
    press(dialog, "Tab");
    expect(document.activeElement).toBe(first);

    act(() => (first as HTMLElement).focus());
    press(dialog, "Tab", true);
    expect(document.activeElement).toBe(last);
  });

  it("restores focus to whatever was focused before it opened", () => {
    render(<Fixture open={false} />);
    const outside = container.querySelector<HTMLElement>("#outside");
    act(() => outside?.focus());
    expect(document.activeElement).toBe(outside);

    render(<Fixture open />);
    expect(document.activeElement).not.toBe(outside);

    render(<Fixture open={false} />);
    expect(document.activeElement).toBe(outside);
  });
});

describe("Toast", () => {
  it("announces politely rather than interrupting", () => {
    render(<Toast open onClose={() => {}} message="Transaction rejected in the wallet." />);
    const toast = document.body.querySelector('[data-pp-portal="toast"]');
    expect(toast?.parentElement).toBe(document.body);
    expect(toast?.getAttribute("role")).toBe("status");
    expect(toast?.getAttribute("aria-live")).toBe("polite");
  });
});

// DESIGN.md gives the product one radius token and no shadow or blur at all.
// Those are the rules a later edit breaks silently, because a stray Tailwind
// utility compiles and renders and looks almost right.
describe("document enforcement across every component at once", () => {
  function Everything() {
    return (
      <div>
        <Button variant="primary">Buy</Button>
        <Button variant="secondary">Cancel</Button>
        <Button variant="destructive">Sell</Button>
        <Button variant="ghost">More</Button>
        <Chip tone="up">Ascent</Chip>
        <Chip tone="down">Down</Chip>
        <Chip tone="accent">Arc Testnet</Chip>
        <Chip>Neutral</Chip>
        <EmptyState
          title="No tokens yet"
          detail="Nothing has been created from this address."
          action={<Button>Create</Button>}
        />
        <Panel title="Reserve">panel body</Panel>
        <Panel title="Row" interactive>
          row body
        </Panel>
        <ProgressAscent bps={4210} valueText="42.1%" />
        <Skeleton width={120} height={16} />
        <Tabs label="Side" items={TAB_ITEMS} />
        <Toast open onClose={() => {}} message="Transaction rejected in the wallet." />
        <Tooltip content="The fee is 125 basis points of the trade.">Fee</Tooltip>
        <Dialog open onClose={() => {}} title="Confirm the buy">
          dialog body
        </Dialog>
      </div>
    );
  }

  it("renders no radius token other than rounded-pp", () => {
    render(<Everything />);
    const offenders = classTokens().filter(
      (token) => token.startsWith("rounded") && token !== "rounded-pp",
    );
    expect(offenders).toEqual([]);
  });

  it("renders no shadow or blur utility", () => {
    render(<Everything />);
    const offenders = classTokens().filter((token) =>
      /^(shadow|drop-shadow|blur|backdrop-)/.test(token),
    );
    expect(offenders).toEqual([]);
  });

  it("keeps every clickable surface at or above the 44px target", () => {
    render(<Everything />);
    for (const button of Array.from(document.querySelectorAll("button"))) {
      const tokens = button.className.split(/\s+/);
      expect(tokens).toContain("min-h-[44px]");
      expect(tokens).toContain("min-w-[44px]");
    }
    // A real button carries its size in tokens; a panel promoted to role="button"
    // gets its height from its padding instead, so what is asserted here is the
    // other half of the contract — that the role came with a tab stop, or the
    // keyboard user cannot reach the press a pointer user gets.
    for (const panel of Array.from(document.querySelectorAll('[role="button"]'))) {
      expect(panel.getAttribute("tabindex")).not.toBe("-1");
    }
  });
});
