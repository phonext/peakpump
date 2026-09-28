// Public surface of @peakpump/shared. Consumers may also import the individual
// modules by subpath (see package.json exports); this barrel re-exports the
// stable API in one place.

export * from "./chain";
export * from "./curve";
// fees re-exports splitFee from ./curve; naming the fee members explicitly here
// keeps splitFee coming from a single origin so the barrel has no ambiguous name.
export {
  TRADE_FEE_BPS,
  CREATOR_BPS,
  PROTOCOL_BPS,
  LP_BPS,
  FEE_SPLIT_SUMS,
  CREATION_FEE_6,
  formatFeeBps,
} from "./fees";
export * from "./presets";
export * from "./format";
export * from "./validation";
export * from "./addresses";
export * from "./brand";
