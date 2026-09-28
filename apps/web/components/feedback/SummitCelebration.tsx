"use client";

import { useEffect, useRef, useState } from "react";
import type { Address } from "viem";
import { useMarketParams } from "@/hooks/useMarketParams";
import { useTokenLive } from "@/hooks/useTokenLive";

// The one signature animation (DESIGN.md). It belongs to the Summit, so it
// fires on the phase read's own ASCENT-to-PEAK edge — never on a timer and
// never on a page load that starts in PEAK, because a market already over the
// Summit is history, not news. Rise carries the entrance and Sheen the sweep;
// those two compose every animation in the product and this adds no third.
// Under reduced motion the overlay does not exist at all: the sentence stays
// in the aria-live region only for a screen reader, and no — the overlay is
// not rendered, so nothing announces either; the phase change on the page
// itself is the whole event.

const SHOW_MS = 6_000;

export function SummitCelebration({ curve }: { curve: Address }) {
  const live = useTokenLive(curve);
  const params = useMarketParams(curve);

  // The last phase the poll delivered. The first delivery only arms the edge
  // detector: a market seen in ASCENT and then in PEAK is a witnessed crossing,
  // which is the only thing worth celebrating.
  const previousPhase = useRef<"ASCENT" | "PEAK" | null>(null);
  const [showing, setShowing] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  // Read at mount and followed, so a reader who turns the OS setting on mid-page
  // never has the overlay appear animated anyway.
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReducedMotion(query.matches);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);

  const phase = live.data?.phase;
  useEffect(() => {
    if (phase === undefined) return;
    const before = previousPhase.current;
    previousPhase.current = phase;
    if (before === "ASCENT" && phase === "PEAK") setShowing(true);
  }, [phase]);

  // The overlay leaves on its own and on a click. The phase edge happens once —
  // _summit() is one-way — so "plays once" needs no counter beyond the edge
  // itself: a second rising edge would require the contract to leave PEAK.
  useEffect(() => {
    if (!showing) return;
    const timer = window.setTimeout(() => setShowing(false), SHOW_MS);
    return () => window.clearTimeout(timer);
  }, [showing]);

  if (!showing || reducedMotion) return null;

  // The token page passes the curve; the name comes from the market's own
  // immutable parameters, the same source the page header prints.
  const name = params.data?.name;

  return (
    // The backdrop passes clicks through and the panel keeps them, so six
    // seconds of celebration never blocks a trade button underneath.
    <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        role="status"
        aria-live="polite"
        onClick={() => setShowing(false)}
        className="pp-rise hairline rounded-pp bg-pp-surface pointer-events-auto relative w-full max-w-md p-6 text-center"
      >
        <span className="pp-sheen-once" aria-hidden="true" />
        <p className="mono text-title text-pp-accent-bright">Summit</p>
        <p className="text-body mt-3 text-pp-text">
          {name === undefined ? "This market" : name} reached the Summit. Trading continues in PEAK.
        </p>
      </div>
    </div>
  );
}
