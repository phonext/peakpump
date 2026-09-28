"use client";

import { useCallback, useEffect, useState } from "react";

// The slippage rule, with the deadline as a separate parameter: presets 0.5, 1 and 3
// percent, a custom field, default 1 percent, stored per browser. Basis points
// throughout, so nothing here ever holds a fraction.
export const SLIPPAGE_PRESETS_BPS = [50n, 100n, 300n] as const;
export const DEFAULT_SLIPPAGE_BPS = 100n;

// The threshold for the inline warning and the second confirming action.
export const HIGH_SLIPPAGE_BPS = 500n;

// A tolerance of the whole amount leaves no floor at all, which is the absence of
// a bound rather than a bound; it is still permitted, because refusing it would be
// this file inventing a rule the spec does not state.
export const MAX_SLIPPAGE_BPS = 10_000n;

const STORAGE_KEY = "peakpump.slippage.bps";

export function isHighSlippage(bps: bigint): boolean {
  return bps > HIGH_SLIPPAGE_BPS;
}

// The floor the panel prints and the transaction carries. The base number is the
// quote struct's own tokensOut or usdcOut6, taken verbatim; the only thing applied
// locally is the user's own tolerance, in BigInt, floored so a rounding step can
// never raise the minimum above what the quote promised. The two halves are
// settled: the base is never re-derived, and the tolerance is the one thing this
// file is allowed to apply to it.
export function applyTolerance(quoted: bigint, bps: bigint): bigint {
  return (quoted * (10_000n - bps)) / 10_000n;
}

// Digits only, so "1e3" and "-5" never become a tolerance. Null for anything that
// is not a usable value, which is what keeps a half-typed field from moving the
// number the submit control carries.
export function parseSlippagePercent(text: string): bigint | null {
  const trimmed = text.trim();
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(trimmed)) return null;
  const [whole = "0", fraction = ""] = trimmed.split(".");
  const bps = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  return bps > MAX_SLIPPAGE_BPS ? null : bps;
}

export function formatSlippagePercent(bps: bigint): string {
  const whole = bps / 100n;
  const fraction = bps % 100n;
  if (fraction === 0n) return whole.toString();
  return `${whole}.${fraction.toString().padStart(2, "0").replace(/0$/, "")}`;
}

export interface SlippageState {
  bps: bigint;
  setBps: (next: bigint) => void;
}

export function useSlippage(): SlippageState {
  const [bps, setBps] = useState(DEFAULT_SLIPPAGE_BPS);

  // Read after mount rather than during render: the server has no localStorage, so
  // a stored tolerance consulted while rendering would make the first client paint
  // disagree with the markup it is hydrating.
  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === null) return;
    const parsed = parseSlippagePercent(stored);
    if (parsed !== null) setBps(parsed);
  }, []);

  // State first, then the write, so a storage write the browser refuses still
  // leaves the tolerance the user chose in effect for this session.
  const persist = useCallback((next: bigint) => {
    setBps(next);
    window.localStorage.setItem(STORAGE_KEY, formatSlippagePercent(next));
  }, []);

  return { bps, setBps: persist };
}