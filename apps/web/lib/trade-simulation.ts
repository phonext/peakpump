"use client";

import { useSyncExternalStore } from "react";

// What the trade panel is pricing right now, in the quote struct's own field names.
// The route chart turns it into one marker on a line; nothing here is a figure
// anyone reads a number off, because the panel prints every one of these fields
// itself, next to the control that sends them.
export type Simulation =
  | { side: "buy"; tokensOut: bigint; net6: bigint }
  | { side: "sell"; tokensIn: bigint; gross6: bigint };

// A module store rather than a React context: the panel and the chart sit in
// different columns of a grid that stays a server component, and a provider around
// both of them would pull the whole page into a client boundary to carry one dot.
//
// owner is what stops the two mounted panels from clearing each other. At sm the
// in-flow panel is display:none with an empty field while the sheet's copy is the
// one being typed into (components/trade/StickyTradeBar.tsx), and both publish on
// every poll; a panel with an empty field publishes null, and null only lands if it
// comes from the panel whose value is currently on the line.
let current: Simulation | null = null;
let owner: object | null = null;
const listeners = new Set<() => void>();

function same(a: Simulation | null, b: Simulation | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.side === "buy") {
    return b.side === "buy" && a.tokensOut === b.tokensOut && a.net6 === b.net6;
  }
  return b.side === "sell" && a.tokensIn === b.tokensIn && a.gross6 === b.gross6;
}

// key identifies the publisher, not the value: one stable object per mounted panel.
export function publishSimulation(key: object, next: Simulation | null): void {
  if (next === null && owner !== key) return;
  owner = next === null ? null : key;
  // Every live read runs on a two-second cadence and re-renders the panel with the
  // same struct, so without this the chart would repaint a marker that has not
  // moved.
  if (same(current, next)) return;
  current = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// Null on the server: this value only exists once someone has typed an amount.
export function useSimulation(): Simulation | null {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );
}
