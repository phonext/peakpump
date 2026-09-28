import { deriveParams } from "@peakpump/shared/curve";
import { PRESETS } from "@peakpump/shared/presets";
import { describe, expect, it } from "vitest";
import {
  ANTI_SNIPE_MAX_BLOCKS,
  CREATE_STEPS,
  REFF6_ROUNDING,
  createReducer,
  customIssue,
  economics,
  identityIssue,
  initialCreateState,
  nameIssue,
  reff6Sentence,
  symbolIssue,
  derivedPreview,
  descriptionIssue,
  type CreateAction,
  type CreateState,
} from "@/lib/create-state";

// The model's whole surface, driven through the reducer rather than through
// literals: a literal that drifted from what dispatching can produce would test
// a state the flow cannot reach.

function state(actions: readonly CreateAction[]): CreateState {
  return actions.reduce(createReducer, initialCreateState());
}

const IDENTITY: readonly CreateAction[] = [
  { type: "set-name", value: "Harbor" },
  { type: "set-symbol", value: "HARB" },
];

// In bounds and derivable, unlike every preset only by its numbers.
const CUSTOM: readonly CreateAction[] = [
  { type: "set-custom" },
  { type: "set-custom-s", value: "5000000" },
  { type: "set-custom-r6", value: "5000" },
  { type: "set-custom-multiple", value: "5" },
];

const IMAGE = { bytes: new Uint8Array([1]), sha256: "a".repeat(64), previewUrl: "blob:x" };

describe("the reducer", () => {
  it("moves through the three steps the stepper renders", () => {
    expect(CREATE_STEPS).toEqual(["identity", "economics", "review"]);
  });

  it("updates one slice and leaves the rest by reference", () => {
    const before = initialCreateState();
    const after = createReducer(before, { type: "set-name", value: "Harbor" });
    expect(after.identity.name).toBe("Harbor");
    // By reference and not only by value: a copied slice would re-render every
    // field inside it on each keystroke.
    expect(after.economics).toBe(before.economics);
    expect(after.step).toBe(before.step);

    const devBuy = createReducer(after, { type: "set-dev-buy", value: "25" });
    expect(devBuy.economics.devBuyText).toBe("25");
    expect(devBuy.identity).toBe(after.identity);
  });

  it("carries the image as the cropper left it and clears it only on demand", () => {
    const withImage = createReducer(initialCreateState(), { type: "set-image", image: IMAGE });
    expect(withImage.identity.image).toBe(IMAGE);
    const cleared = createReducer(withImage, { type: "set-image", image: null });
    expect(cleared.identity.image).toBeNull();
  });

  it("switches presets and custom without touching the raw fields", () => {
    const custom = state([...IDENTITY, ...CUSTOM]);
    const ridge = createReducer(custom, { type: "set-preset", presetKey: "ridge" });
    expect(ridge.economics.mode).toEqual({ kind: "preset", presetKey: "ridge" });
    // The custom texts survive the switch back, like the anti-snipe texts below.
    const customAgain = createReducer(ridge, { type: "set-custom" });
    expect(customAgain.economics.mode).toEqual({ kind: "custom" });
    expect(customAgain.economics.custom.sText).toBe("5000000");
  });

  it("keeps the anti-snipe texts through a toggle-off", () => {
    const on = state([
      ...IDENTITY,
      { type: "set-anti-snipe", on: true },
      { type: "set-anti-snipe-blocks", value: "10" },
      { type: "set-anti-snipe-max-buy", value: "50" },
    ]);
    const off = createReducer(on, { type: "set-anti-snipe", on: false });
    expect(off.economics.antiSnipeOn).toBe(false);
    // The contract sees zeros whenever the window is off; the user who flips the
    // toggle back on should not retype them.
    expect(off.economics.antiSnipe.blocksText).toBe("10");
    expect(off.economics.antiSnipe.maxBuyText).toBe("50");
  });

  it("moves the step on demand and nothing else", () => {
    const before = state(IDENTITY);
    const after = createReducer(before, { type: "go-to-step", step: "economics" });
    expect(after.step).toBe("economics");
    expect(after.identity).toBe(before.identity);
    expect(after.economics).toBe(before.economics);
  });

  it("raises a blur flag and holds it, without touching either slice", () => {
    const before = state(IDENTITY);
    const blurred = createReducer(before, { type: "blur", field: "name" });
    expect(blurred.blurred.name).toBe(true);
    // A field never blurred is still false, and the typed values are untouched:
    // the flag is display state only, and the Next gate reads the reasons.
    expect(blurred.blurred.symbol).toBe(false);
    expect(blurred.identity).toBe(before.identity);
    expect(blurred.economics).toBe(before.economics);
    // A second blur of the same field returns the same reference, which is what
    // keeps the blur of the second custom field from re-rendering the first.
    expect(createReducer(blurred, { type: "blur", field: "name" })).toBe(blurred);
    // The flag survives a step change, so a trip back finds the notes it showed.
    const back = createReducer(blurred, { type: "go-to-step", step: "economics" });
    expect(back.blurred.name).toBe(true);
  });
});

describe("the shared schemas' own sentences", () => {
  it("shows the name rules the user can see, in the schema's order", () => {
    // The codepoint rule, not the contract's byte count: the client can
    // only show what it counts.
    expect(nameIssue("")).toBe("Name must be 1 to 32 characters");
    expect(nameIssue("x".repeat(33))).toBe("Name must be 1 to 32 characters");
    expect(nameIssue("A\u0001B")).toBe("Name must not contain control characters");
    expect(nameIssue("A\u200bB")).toBe("Name must not contain zero-width, bidi, or BOM characters");
    // A Cyrillic A beside Latin letters, written as an escape so the source
    // carries no lookalike a reader cannot tell from the Latin one.
    expect(nameIssue("\u0410BC")).toBe("Name must not mix character scripts");
    expect(nameIssue("Harbor")).toBeNull();
  });

  it("shows the symbol rules in the order the schema checks them", () => {
    expect(symbolIssue("harb")).toBe("Symbol must use only A-Z and 0-9");
    // An empty symbol fails the character rule first, not the length rule.
    expect(symbolIssue("")).toBe("Symbol must use only A-Z and 0-9");
    expect(symbolIssue("A1234567890")).toBe("Symbol must be 1 to 10 characters");
    expect(symbolIssue("USDC")).toBe("Symbol is reserved");
    // The ARC-prefix ban's accepted collateral damage: the innocent ARC-prefixed symbol is
    // rejected, and with its own sentence.
    expect(symbolIssue("ARCX")).toBe("Symbol must not begin with ARC");
    expect(symbolIssue("HARB")).toBeNull();
  });

  it("caps the description and leaves an empty one valid", () => {
    expect(descriptionIssue("x".repeat(501))).toBe("Description must be at most 500 characters");
    expect(descriptionIssue("x".repeat(500))).toBeNull();
    expect(descriptionIssue("")).toBeNull();
  });
});

describe("the preset id create() receives", () => {
  it("maps each preset to the position the factory resolves it by", () => {
    // PeakpumpFactory._resolveTriple reads presetId 1..3 as PRESETS[0..2] and
    // the raw fields only on 0, so the mapping is pinned against the array's
    // own order: a reordered PRESETS would otherwise ship markets on the wrong
    // curve with no failing test anywhere.
    expect(PRESETS.length).toBe(3);
    for (const [index, preset] of PRESETS.entries()) {
      const withPreset = state([...IDENTITY, { type: "set-preset", presetKey: preset.key }]);
      const params = economics(withPreset);
      expect(params?.presetId).toBe(index + 1);
      expect(params?.S).toBe(preset.S);
      expect(params?.R6).toBe(preset.R6);
      expect(params?.rX18).toBe(preset.rX18);
    }
  });

  it("carries id 0 on the custom path, whose raw fields create() reads", () => {
    expect(economics(state([...IDENTITY, ...CUSTOM]))?.presetId).toBe(0);
  });
});

describe("custom bounds, in the contract's own words", () => {
  it("answers an unparseable triple with the entry sentence", () => {
    expect(customIssue(state([...IDENTITY, { type: "set-custom" }]))).toBe(
      "Enter the supply, raise and multiple as plain numbers.",
    );
  });

  it("names the range error for a value one step outside each bound", () => {
    // The other two fields stay in bounds in each case, because any unparseable
    // field answers with the entry sentence before the range checks run.
    const customWith = (field: "s" | "r6" | "multiple", value: string) =>
      state([
        ...IDENTITY,
        { type: "set-custom" },
        { type: "set-custom-s", value: field === "s" ? value : "5000000" },
        { type: "set-custom-r6", value: field === "r6" ? value : "5000" },
        { type: "set-custom-multiple", value: field === "multiple" ? value : "5" },
      ]);
    // 999,999 tokens, one under the 1 million floor of MATH 3.
    expect(customIssue(customWith("s", "999999"))).toBe(
      "SupplyOutOfRange: the supply must be between 1 million and 1 trillion tokens",
    );
    // $999, one dollar under the raise floor.
    expect(customIssue(customWith("r6", "999"))).toBe(
      "RaiseOutOfRange: the raise must be between $1,000 and $10 million",
    );
    expect(customIssue(customWith("multiple", "1.5"))).toBe(
      "MultipleOutOfRange: the multiple must be between 2 and 20",
    );
  });

  it("accepts the boundary values themselves", () => {
    expect(
      customIssue(
        state([
          ...IDENTITY,
          { type: "set-custom" },
          { type: "set-custom-s", value: "1000000000000" },
          { type: "set-custom-r6", value: "10000000" },
          { type: "set-custom-multiple", value: "20" },
        ]),
      )
    ).toBeNull();
  });

  // The four remaining names — SupplyNotAboveTs, Y0NotAboveTs, Y1NotPositive,
  // X0NotPositive — are not driven here because no parsed triple can reach
  // them. The three range checks run first and admit only triples for which Ts
  // is strictly under S, y0 clears Ts by more than its floor can remove (y0
  // lands on Ts only when Ts is under the multiple, and the smallest in-bounds
  // Ts is two thirds of 1e24 against a multiple capped at 20e18), and x0 ceils
  // to zero only when the raise is below a billionth of the divisor — a raise
  // the R6 floor already excludes. Corner-and-random sweeps over the whole
  // in-bounds box produce none of the four. Fabricating a vector would assert a
  // state the contract has already made impossible.
});

describe("economics", () => {
  it("returns the full struct when no reason stands", () => {
    const custom = state([
      ...IDENTITY,
      ...CUSTOM,
      { type: "set-dev-buy", value: "25" },
      { type: "set-anti-snipe", on: true },
      { type: "set-anti-snipe-blocks", value: "30" },
      { type: "set-anti-snipe-max-buy", value: "100.5" },
    ]);
    expect(economics(custom)).toEqual({
      presetId: 0,
      S: 5_000_000n * 10n ** 18n,
      R6: 5_000n * 10n ** 6n,
      rX18: 5n * 10n ** 18n,
      devBuy6: 25n * 10n ** 6n,
      antiSnipeBlocks: 30n,
      maxBuyPerAddress6: 100_500_000n,
    });
  });

  it("is null whenever any reason stands, one case per reason", () => {
    // A malformed custom triple.
    expect(economics(state([...IDENTITY, { type: "set-custom" }]))).toBeNull();
    // An out-of-bounds one: the other two fields in bounds, so the range check
    // is the reason and not the entry sentence.
    expect(
      economics(
        state([
          ...IDENTITY,
          { type: "set-custom" },
          { type: "set-custom-s", value: "999999" },
          { type: "set-custom-r6", value: "5000" },
          { type: "set-custom-multiple", value: "5" },
        ]),
      )
    ).toBeNull();
    // A live window with no length.
    expect(economics(state([...IDENTITY, { type: "set-anti-snipe", on: true }]))).toBeNull();
    // A live window with no cap: the pairing that bricks a market.
    expect(
      economics(
        state([
          ...IDENTITY,
          { type: "set-anti-snipe", on: true },
          { type: "set-anti-snipe-blocks", value: "10" },
        ]),
      )
    ).toBeNull();
    // A window over the contract's cap.
    expect(
      economics(
        state([
          ...IDENTITY,
          { type: "set-anti-snipe", on: true },
          { type: "set-anti-snipe-blocks", value: "301" },
          { type: "set-anti-snipe-max-buy", value: "50" },
        ]),
      )
    ).toBeNull();
    // A dev-buy the field cannot parse.
    expect(
      economics(state([...IDENTITY, { type: "set-dev-buy", value: "1.2.3" }]))
    ).toBeNull();
  });

  it("does not gate on identity, which the step's own Next button owns", () => {
    // economicsReason covers the economics slice only, so a half-finished name
    // leaves the struct intact: the review step sits behind both gates, and the
    // model does not hold a second copy of the first one.
    const unnamed = state([...CUSTOM, { type: "set-preset", presetKey: "alpine" }]);
    expect(identityIssue(unnamed)).not.toBeNull();
    expect(economics(unnamed)?.presetId).toBe(3);
  });

  it("zeros both anti-snipe fields when the window is off, whatever the texts hold", () => {
    // Texts left over from a live window are not parsed at all once the toggle
    // is off, so nothing in them can trip AntiSnipePairingInvalid at the
    // contract.
    const off = state([
      ...IDENTITY,
      { type: "set-anti-snipe-blocks", value: "10" },
      { type: "set-anti-snipe-max-buy", value: "50" },
    ]);
    expect(off.economics.antiSnipeOn).toBe(false);
    expect(economics(off)?.antiSnipeBlocks).toBe(0n);
    expect(economics(off)?.maxBuyPerAddress6).toBe(0n);
  });

  it("carries the window the contract caps, at its cap", () => {
    // PeakpumpFactory.create:150 reverts AntiSnipeTooLong above 300, so the
    // model's own ceiling is pinned to the contract's.
    expect(ANTI_SNIPE_MAX_BLOCKS).toBe(300n);
    const atCap = state([
      ...IDENTITY,
      { type: "set-anti-snipe", on: true },
      { type: "set-anti-snipe-blocks", value: "300" },
      { type: "set-anti-snipe-max-buy", value: "50" },
    ]);
    expect(economics(atCap)?.antiSnipeBlocks).toBe(300n);
  });
});

describe("the derived panel's preset figures", () => {
  it("carries the fixture's y0 on Ridge, and on every preset for the same reason", () => {
    // The panel renders derivedPreview and does no arithmetic of its own, so
    // this is the whole path from a preset card to the number on screen. The
    // literal is the contract-generated fixture's own value for Ridge
    // (contracts/test/fixtures/curve-vectors.json, row 1). y0 depends only on S
    // and the multiple, which all three presets share, so one literal bounds
    // all three — asserted per preset because a future preset that broke the
    // sharing should fail here, not on a user's screen.
    for (const preset of PRESETS) {
      const withPreset = state([...IDENTITY, { type: "set-preset", presetKey: preset.key }]);
      expect(derivedPreview(withPreset)?.derived.y0, preset.key).toBe(
        1_066_666_666_666_666_666_666_666_666n,
      );
    }
  });
});

describe("the Reff6 rounding sentence", () => {
  it("fires on the condition, not the mode", () => {
    expect(reff6Sentence(5n, 5n)).toBeNull();
    expect(reff6Sentence(6n, 5n)).toBe(REFF6_ROUNDING);
  });

  it("stays silent for every preset, whose raises are exactly representable", () => {
    for (const preset of PRESETS) {
      const d = deriveParams(preset.S, preset.R6, preset.rX18);
      expect(d.Reff6).toBe(preset.R6);
      expect(reff6Sentence(d.Reff6, preset.R6)).toBeNull();
    }
  });

  it("fires for a custom raise the curve can only round up", () => {
    // r = 5 puts x0 at a quarter of the raise, and a raise that is not a whole
    // multiple of four micro-units ceils x0 up, so the raise this market really
    // needs is more than the one asked for. deriveParams is the authority for
    // both numbers; the test never recomputes them.
    const d = deriveParams(5_000_000n * 10n ** 18n, 5_000_000_001n, 5n * 10n ** 18n);
    expect(d.Reff6).not.toBe(5_000_000_001n);
    expect(reff6Sentence(d.Reff6, 5_000_000_001n)).toBe(REFF6_ROUNDING);
  });
});
