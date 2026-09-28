// Text in a field to a fixed-point bigint, and back. viem's parseUnits is not used
// for either direction: it rounds the last digit, and a rounded-up amount is one the
// user does not have, which turns "sell everything" into a revert. Everything here
// truncates, which is the direction the contract itself floors in.

// The two scales a field on this page can hold. The buy field is USDC in the
// 6-decimal quote view because usdcIn6 is what quoteBuy takes, and the sell field is
// token wei. The 18-decimal native view never reaches a field: lib/curve-write.ts
// multiplies by 1e12 on the way out.
export const USDC_QUOTE_DECIMALS = 6;
export const TOKEN_DECIMALS = 18;

// Everything that is not a digit or a point, dropped. This is what makes a pasted
// "$1,234.50" become 1234.50 rather than nothing, and it is the only editing this
// file does to what the user typed: the count of points is left alone, so "1.2.3" is
// still refused below instead of being silently reinterpreted.
export function sanitizeAmountText(text: string): string {
  return text.replace(/[^\d.]/g, "");
}

// Null for anything that is not a usable amount, including an empty field and a lone
// point, which is what keeps a half-typed number from being quoted or submitted.
// Fractional digits beyond the scale are dropped, not rounded.
export function parseAmount(text: string, decimals: number): bigint | null {
  const parts = text.split(".");
  if (parts.length > 2) return null;
  const [whole = "", fraction = ""] = parts;
  if (whole === "" && fraction === "") return null;
  if (!/^\d*$/.test(whole) || !/^\d*$/.test(fraction)) return null;
  const truncated = fraction.slice(0, decimals);
  const scaled = truncated === "" ? 0n : BigInt(truncated) * 10n ** BigInt(decimals - truncated.length);
  return (whole === "" ? 0n : BigInt(whole)) * 10n ** BigInt(decimals) + scaled;
}

// The exact inverse, for filling the field from a balance. Ungrouped on purpose:
// grouping belongs to @peakpump/shared/format and never to a value being edited,
// because a caret in a grouped field jumps every time a separator appears. Exact
// rather than capped at four digits like formatTokenAmount, because Max on a sell has
// to leave a zero balance and a truncated one leaves a remainder behind.
export function toAmountText(value: bigint, decimals: number): string {
  const scale = 10n ** BigInt(decimals);
  const fraction = (value % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  const whole = (value / scale).toString();
  return fraction === "" ? whole : `${whole}.${fraction}`;
}
