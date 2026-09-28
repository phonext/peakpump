import { deriveParams, type DerivedParams } from "@peakpump/shared/curve";
import { PRESETS, type PresetKey } from "@peakpump/shared/presets";
import { descriptionSchema, nameSchema, symbolSchema } from "@peakpump/shared/validation";
import { parseAmount, TOKEN_DECIMALS, USDC_QUOTE_DECIMALS } from "@/lib/amount";

// The create flow's whole model in one pure module: state, reducer, per-field
// validation and the economics a submission needs. Phase 2 (a later release)
// builds Step 3 on the exported seam — { name, symbol, metadataURI,
// ...economics(state) } — without reshaping any of this, which is why the types
// are exported even where only one component consumes them today.
//
// No React and no reads live here: the reducer has to stay testable without a
// browser, and the live dev-buy cap is a factory view over RPC, which belongs
// to the component that renders it, never to the model.
//
// The forbidden-vocabulary and possessive rules govern this project's own
// copy only. They are deliberately never applied to a user's name or symbol.

export const CREATE_STEPS = ["identity", "economics", "review"] as const;
export type CreateStep = (typeof CREATE_STEPS)[number];

// AntiSnipeTooLong, PeakpumpFactory.create: the window is capped at 300 blocks.
export const ANTI_SNIPE_MAX_BLOCKS = 300n;

export interface CroppedImage {
  bytes: Uint8Array;
  sha256: string;
  // An object URL the browser owns, not a path anything fetches. The cropper
  // that creates it revokes it on replace and unmount; this module only swaps
  // the reference. No upload exists yet, so in phase 1 the
  // bytes never leave the tab.
  previewUrl: string;
}

export interface AntiSnipeFields {
  blocksText: string;
  maxBuyText: string;
}

// PeakpumpFactory._resolveTriple maps 1 to Basecamp, 2 to Ridge, 3 to Alpine,
// and reads the raw fields only on 0. PRESETS is ordered to match and the test
// pins the two together, so this table is never the only place the mapping
// lives.
const PRESET_ID: Record<PresetKey, number> = { basecamp: 1, ridge: 2, alpine: 3 };

export type EconomicsMode = { kind: "preset"; presetKey: PresetKey } | { kind: "custom" };

// The fields whose note can be held back until the user has moved past them.
// The three custom economics fields share one entry because deriveParams judges
// the triple rather than any field alone, and the two anti-snipe fields share
// one for the same reason: the pairing rule is what either of them can break.
export type BlurredField = "name" | "symbol" | "description" | "custom" | "devBuy" | "antiSnipe";

export interface CustomEconomics {
  sText: string;
  r6Text: string;
  multipleText: string;
}

export interface CreateState {
  step: CreateStep;
  identity: { name: string; symbol: string; description: string; image: CroppedImage | null };
  economics: {
    mode: EconomicsMode;
    custom: CustomEconomics;
    devBuyText: string;
    antiSnipeOn: boolean;
    antiSnipe: AntiSnipeFields;
  };
  // Which fields have been blurred. The values stay where the reducer can see
  // them rather than in local component state, so a trip back through an earlier
  // step finds the notes it already showed.
  blurred: Record<BlurredField, boolean>;
}

export type CreateAction =
  | { type: "set-name"; value: string }
  | { type: "set-symbol"; value: string }
  | { type: "set-description"; value: string }
  | { type: "set-image"; image: CroppedImage | null }
  | { type: "set-preset"; presetKey: PresetKey }
  | { type: "set-custom" }
  | { type: "set-custom-s"; value: string }
  | { type: "set-custom-r6"; value: string }
  | { type: "set-custom-multiple"; value: string }
  | { type: "set-dev-buy"; value: string }
  | { type: "set-anti-snipe"; on: boolean }
  | { type: "set-anti-snipe-blocks"; value: string }
  | { type: "set-anti-snipe-max-buy"; value: string }
  | { type: "blur"; field: BlurredField }
  | { type: "go-to-step"; step: CreateStep };

export function initialCreateState(): CreateState {
  return {
    // Basecamp is the default the placeholder form shipped with index 0
    // pre-checked, so the first card stays the starting choice.
    step: "identity",
    identity: { name: "", symbol: "", description: "", image: null },
    economics: {
      mode: { kind: "preset", presetKey: "basecamp" },
      custom: { sText: "", r6Text: "", multipleText: "" },
      devBuyText: "",
      antiSnipeOn: false,
      antiSnipe: { blocksText: "", maxBuyText: "" },
    },
    blurred: { name: false, symbol: false, description: false, custom: false, devBuy: false, antiSnipe: false },
  };
}

export function createReducer(state: CreateState, action: CreateAction): CreateState {
  switch (action.type) {
    case "set-name":
      return { ...state, identity: { ...state.identity, name: action.value } };
    case "set-symbol":
      return { ...state, identity: { ...state.identity, symbol: action.value } };
    case "set-description":
      return { ...state, identity: { ...state.identity, description: action.value } };
    case "set-image":
      return { ...state, identity: { ...state.identity, image: action.image } };
    case "set-preset":
      return {
        ...state,
        economics: { ...state.economics, mode: { kind: "preset", presetKey: action.presetKey } },
      };
    case "set-custom":
      return { ...state, economics: { ...state.economics, mode: { kind: "custom" } } };
    case "set-custom-s":
      return {
        ...state,
        economics: { ...state.economics, custom: { ...state.economics.custom, sText: action.value } },
      };
    case "set-custom-r6":
      return {
        ...state,
        economics: { ...state.economics, custom: { ...state.economics.custom, r6Text: action.value } },
      };
    case "set-custom-multiple":
      return {
        ...state,
        economics: {
          ...state.economics,
          custom: { ...state.economics.custom, multipleText: action.value },
        },
      };
    case "set-dev-buy":
      return { ...state, economics: { ...state.economics, devBuyText: action.value } };
    case "set-anti-snipe":
      // The texts survive a toggle-off on purpose: the contract sees zeros for
      // both fields whenever the window is off, and the user who flips the
      // toggle back on should not retype them.
      return { ...state, economics: { ...state.economics, antiSnipeOn: action.on } };
    case "set-anti-snipe-blocks":
      return {
        ...state,
        economics: {
          ...state.economics,
          antiSnipe: { ...state.economics.antiSnipe, blocksText: action.value },
        },
      };
    case "set-anti-snipe-max-buy":
      return {
        ...state,
        economics: {
          ...state.economics,
          antiSnipe: { ...state.economics.antiSnipe, maxBuyText: action.value },
        },
      };
    case "go-to-step":
      return { ...state, step: action.step };
    case "blur":
      // The same state reference comes back once the flag is already set, so a
      // second blur — the second of the three custom fields, or the blur that
      // fires on every later visit — re-renders nothing.
      return state.blurred[action.field]
        ? state
        : { ...state, blurred: { ...state.blurred, [action.field]: true } };
  }
}

// Structural rather than a zod import: apps/web consumes the schemas through
// @peakpump/shared/validation and never needs zod's own types on this side of
// the line.
interface StringSchema {
  safeParse(value: string): { success: true } | { success: false; error: { issues: readonly { message: string }[] } };
}

function firstIssue(schema: StringSchema, value: string): string | null {
  const result = schema.safeParse(value);
  // A parse that failed carries at least one issue, so the assertion records
  // that rather than branching on an empty array zod cannot hand back.
  return result.success ? null : result.error.issues[0]!.message;
}

// The client counts codepoints and the contract counts bytes: these show
// the codepoint rule the user can see, and the byte-count reverts stay phase
// 2's error-map sentences. Never a byte rejection here.

export function nameIssue(name: string): string | null {
  return firstIssue(nameSchema, name);
}

export function symbolIssue(symbol: string): string | null {
  return firstIssue(symbolSchema, symbol);
}

export function descriptionIssue(description: string): string | null {
  return firstIssue(descriptionSchema, description);
}

export function identityIssue(state: CreateState): string | null {
  const { name, symbol, description } = state.identity;
  return nameIssue(name) ?? symbolIssue(symbol) ?? descriptionIssue(description);
}

// The shared parsers live once so the issue functions and economics() can
// never disagree about what parses. Null is always "no value yet or malformed",
// and the empty dev-buy text is a legal 0 rather than a null.

function parsedCustom(custom: CustomEconomics): { S: bigint; R6: bigint; rX18: bigint } | null {
  // The multiple parses at 18 decimals because rX18 is itself 1e18-scaled: an
  // integer multiple and a fractional one land in the field without a
  // conversion step, and nothing the user types gets silently truncated.
  const S = parseAmount(custom.sText, TOKEN_DECIMALS);
  const R6 = parseAmount(custom.r6Text, USDC_QUOTE_DECIMALS);
  const rX18 = parseAmount(custom.multipleText, TOKEN_DECIMALS);
  if (S === null || R6 === null || rX18 === null) return null;
  return { S, R6, rX18 };
}

function parsedDevBuy(text: string): bigint | null {
  return text === "" ? 0n : parseAmount(text, USDC_QUOTE_DECIMALS);
}

function parsedBlocks(text: string): bigint | null {
  // Whole blocks only: a fractional window length would otherwise be truncated
  // into a different number than the one the user typed.
  return /^\d+$/.test(text) ? BigInt(text) : null;
}

function parsedCap(text: string): bigint | null {
  return parseAmount(text, USDC_QUOTE_DECIMALS);
}

export function economicsTriple(state: CreateState): { S: bigint; R6: bigint; rX18: bigint } | null {
  const { mode, custom } = state.economics;
  if (mode.kind === "preset") {
    const preset = PRESETS.find((candidate) => candidate.key === mode.presetKey);
    // presetKey is the closed PresetKey union and PRESETS carries one entry per
    // key, so the miss is impossible; the null is the type-level gate.
    return preset === undefined ? null : { S: preset.S, R6: preset.R6, rX18: preset.rX18 };
  }
  return parsedCustom(custom);
}

// deriveParams throws the contract's own named errors, and the sentence after
// each name is the plain-language half. The seven names are exhaustive and
// frozen in the shared module. The three range errors are the only ones a
// parsed custom triple can reach: the four asserts behind them are unreachable
// inside the bounds (the test file records why), so it drives the three and
// does not fabricate vectors for the other four.
const CUSTOM_SENTENCES: Record<string, string> = {
  SupplyOutOfRange: "the supply must be between 1 million and 1 trillion tokens",
  RaiseOutOfRange: "the raise must be between $1,000 and $10 million",
  MultipleOutOfRange: "the multiple must be between 2 and 20",
  SupplyNotAboveTs: "at these values the summit supply reaches the whole supply",
  Y0NotAboveTs: "at these values the ascent pool cannot cover the summit supply",
  Y1NotPositive: "at these values the ascent pool would be empty at the summit",
  X0NotPositive: "at these values the opening reserve rounds to zero",
};

export function customIssue(state: CreateState): string | null {
  const { mode, custom } = state.economics;
  if (mode.kind !== "custom") return null;
  const triple = parsedCustom(custom);
  if (triple === null) {
    return "Enter the supply, raise and multiple as plain numbers.";
  }
  try {
    deriveParams(triple.S, triple.R6, triple.rX18);
    return null;
  } catch (error) {
    // deriveParams throws `new Error("SupplyOutOfRange")`-style Errors, whose
    // String() form carries an "Error: " prefix that would miss the table.
    const name = error instanceof Error ? error.message : String(error);
    return `${name}: ${CUSTOM_SENTENCES[name]}`;
  }
}

export function antiSnipeIssue(state: CreateState): string | null {
  const { antiSnipeOn, antiSnipe } = state.economics;
  // Off sends zeros for both fields, which is the one pairing the contract
  // accepts without a window, so nothing left in the texts is a reason.
  if (!antiSnipeOn) return null;
  const blocks = parsedBlocks(antiSnipe.blocksText);
  if (blocks === null || blocks === 0n) {
    return "Enter the window length in whole blocks, from 1 to 300.";
  }
  if (blocks > ANTI_SNIPE_MAX_BLOCKS) {
    return "AntiSnipeTooLong: the window is capped at 300 blocks.";
  }
  const cap = parsedCap(antiSnipe.maxBuyText);
  if (cap === null || cap === 0n) {
    return "Enter the per-address cap in USDC. A zero cap with a live window bricks the market for the whole window.";
  }
  return null;
}

export function devBuyIssue(state: CreateState): string | null {
  return parsedDevBuy(state.economics.devBuyText) === null
    ? "Enter the dev-buy as a plain USDC amount."
    : null;
}

// Everything the model itself can see. The live dev-buy cap is deliberately
// absent: it is a factory view over RPC and the container joins it at the
// point of use, so this module stays read-free.
export function economicsReason(state: CreateState): string | null {
  return customIssue(state) ?? antiSnipeIssue(state) ?? devBuyIssue(state);
}

export interface EconomicsPreview {
  S: bigint;
  R6: bigint;
  rX18: bigint;
  derived: DerivedParams;
}

// The derived panel's basis. Null is the gate, never a half-valid struct
// (TradePanel's discipline): customIssue carries the sentence for why this is
// null, because the two read the same parsers.
export function derivedPreview(state: CreateState): EconomicsPreview | null {
  const triple = economicsTriple(state);
  if (triple === null) return null;
  try {
    return { ...triple, derived: deriveParams(triple.S, triple.R6, triple.rX18) };
  } catch {
    return null;
  }
}

export const REFF6_ROUNDING = "The raise is rounded up to the nearest amount the curve can represent.";

// Presets are exactly representable (Basecamp's x0 of 1e9 puts Reff6 at R6
// exactly), so the sentence fires only on the custom path; the condition, not
// the mode, decides it.
export function reff6Sentence(reff6: bigint, r6: bigint): string | null {
  return reff6 === r6 ? null : REFF6_ROUNDING;
}

// What create() receives. Null whenever economicsReason stands: the struct is
// either complete and valid or it does not exist, which is what phase 2's
// submission plugs into.
export interface EconomicsParams {
  presetId: number;
  S: bigint;
  R6: bigint;
  rX18: bigint;
  devBuy6: bigint;
  antiSnipeBlocks: bigint;
  maxBuyPerAddress6: bigint;
}

export function economics(state: CreateState): EconomicsParams | null {
  if (economicsReason(state) !== null) return null;
  const { mode, devBuyText, antiSnipeOn, antiSnipe } = state.economics;
  const triple = economicsTriple(state);
  const devBuy = parsedDevBuy(devBuyText);
  // Off means the contract receives zeros for both fields, so the texts are not
  // parsed at all — with the window off they can be anything, including empty,
  // and economicsReason has already cleared that state as valid.
  const blocks = antiSnipeOn ? parsedBlocks(antiSnipe.blocksText) : 0n;
  const cap = antiSnipeOn ? parsedCap(antiSnipe.maxBuyText) : 0n;
  // economicsReason has already rejected every input these parsers can fail on,
  // so the combined null check is type-level narrowing, not a second opinion.
  if (triple === null || devBuy === null || blocks === null || cap === null) return null;
  // antiSnipeIssue forces blocks into 1..300 and a non-zero cap while the
  // window is on, and zeros both while it is off, so this struct can never
  // trip AntiSnipePairingInvalid at the contract.
  return {
    presetId: mode.kind === "preset" ? PRESET_ID[mode.presetKey] : 0,
    S: triple.S,
    R6: triple.R6,
    rX18: triple.rX18,
    devBuy6: devBuy,
    antiSnipeBlocks: antiSnipeOn ? blocks : 0n,
    maxBuyPerAddress6: antiSnipeOn ? cap : 0n,
  };
}
