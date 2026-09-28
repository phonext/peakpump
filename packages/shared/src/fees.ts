// Display-side single source of truth for fee LABELS and STATIC PREVIEWS only.
// The trade fee is flat in both phases (MATH 6). This is the only
// file in the repository that names the literal fee bps; nothing else hardcodes
// a fee. splitFee is not reimplemented here: it is the frozen reference from
// ./curve, so the top-down rounding is identical to the contract by construction.
import { splitFee } from "./curve";

export { splitFee };

export const TRADE_FEE_BPS = 125n;
export const CREATOR_BPS = 30n;
export const PROTOCOL_BPS = 95n;
export const LP_BPS = 0n;

// Compile-time-intent invariant: the creator and protocol shares must sum to the
// total. TypeScript cannot evaluate bigint arithmetic in the type system, so
// this is enforced at module load (it throws before any consumer runs) and is
// covered by a test. FEE_SPLIT_SUMS is exported so a consumer can assert it too.
export const FEE_SPLIT_SUMS = CREATOR_BPS + PROTOCOL_BPS === TRADE_FEE_BPS;
if (!FEE_SPLIT_SUMS) {
  throw new Error("fee split does not sum to TRADE_FEE_BPS");
}

// Renders a fee in basis points as a percentage string, e.g. 125n -> "1.25%".
export function formatFeeBps(bps: bigint): string {
  const whole = bps / 100n;
  const frac = bps % 100n;
  let out = whole.toString();
  if (frac !== 0n) {
    const trimmed = frac.toString().padStart(2, "0").replace(/0+$/, "");
    out += `.${trimmed}`;
  }
  return `${out}%`;
}

// SPEC 4.2 fixes the testnet deployed creationFee6 at 0. The create
// page MUST read the live value from the factory; this constant is for static
// copy only and is never used to compute a charge.
export const CREATION_FEE_6 = 0n;
