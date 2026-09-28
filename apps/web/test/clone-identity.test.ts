import { CURVE_IMPL, PEAK_TOKEN_IMPL } from "@peakpump/shared/addresses";
import { getAddress, isAddressEqual, size } from "viem";
import { describe, expect, it } from "vitest";
import { eip1167Implementation } from "@/lib/clone-identity";

// The runtime OpenZeppelin's Clones.clone writes, assembled the way the chain returns
// it. Two safety badges rest on this function: a token with no mint and no owner, and a
// curve whose liquidity has no withdrawal path. Both are claims about which code an
// address runs, so a shape this recognises loosely would be a badge that lies.
const PREFIX = "363d3d373d3d3d363d73";
const SUFFIX = "5af43d82803e903d91602b57fd5bf3";

function clone(implementation: string): `0x${string}` {
  return `0x${PREFIX}${implementation.slice(2).toLowerCase()}${SUFFIX}`;
}

describe("the 45-byte clone runtime", () => {
  it("is 45 bytes", () => {
    // Asserted rather than assumed: every negative case below turns on the length, so
    // a fixture of a different size would make them pass for the wrong reason.
    expect(size(clone(CURVE_IMPL))).toBe(45);
  });

  it("extracts the implementation the deployment names", () => {
    expect(eip1167Implementation(clone(CURVE_IMPL))).toBe(getAddress(CURVE_IMPL));
    expect(eip1167Implementation(clone(PEAK_TOKEN_IMPL))).toBe(getAddress(PEAK_TOKEN_IMPL));
  });

  it("answers a checksummed address whatever case the node used", () => {
    const shouty = clone(CURVE_IMPL).toUpperCase().replace("0X", "0x") as `0x${string}`;
    const found = eip1167Implementation(shouty);
    expect(found).toBeDefined();
    // isAddressEqual, not a string compare, because the point is that the answer is
    // usable against CURVE_IMPL however the code arrived.
    expect(found !== undefined && isAddressEqual(found, CURVE_IMPL)).toBe(true);
    expect(found).toBe(getAddress(CURVE_IMPL));
  });

  it("tells one implementation from another", () => {
    // The two implementations are different contracts, and a curve proven to be a
    // clone of the token implementation would be a market this app did not deploy.
    expect(eip1167Implementation(clone(PEAK_TOKEN_IMPL))).not.toBe(getAddress(CURVE_IMPL));
  });
});

describe("everything that is not that runtime", () => {
  it("has no answer for an account with no code", () => {
    // An EOA and a self-destructed clone both answer 0x, and "not provably a clone of
    // anything" is the honest verdict for both.
    expect(eip1167Implementation("0x")).toBeUndefined();
    expect(eip1167Implementation(undefined)).toBeUndefined();
  });

  it("refuses a runtime of the right length that starts differently", () => {
    // 0x74 rather than 0x73: PUSH21 instead of the PUSH20 that makes the next twenty
    // bytes the implementation. Same length, and it does not name what this names.
    const swapped = clone(CURVE_IMPL).replace(PREFIX, "363d3d373d3d3d363d74") as `0x${string}`;
    expect(size(swapped)).toBe(45);
    expect(eip1167Implementation(swapped)).toBeUndefined();
  });

  it("refuses a runtime of the right length that ends differently", () => {
    const withoutSuffix = clone(CURVE_IMPL).slice(0, -SUFFIX.length);
    const altered = `${withoutSuffix}5af43d82803e903d91602b57fd5bf2` as `0x${string}`;
    expect(size(altered)).toBe(45);
    // One byte different at the tail: a proxy that ends in REVERT rather than RETURN
    // delegates the same call and returns nothing, and it is not this runtime.
    expect(eip1167Implementation(altered)).toBeUndefined();
  });

  it("refuses a longer proxy that merely contains the shape", () => {
    // A proxy with an admin slot reads its target from storage rather than carrying it
    // as an immediate, so its runtime is longer. Matching a prefix inside it would
    // report an implementation the proxy can change, under a badge saying it cannot.
    const padded = `${clone(CURVE_IMPL)}60806040` as `0x${string}`;
    expect(eip1167Implementation(padded)).toBeUndefined();
  });

  it("refuses the shape with the implementation truncated", () => {
    const short = `0x${PREFIX}${CURVE_IMPL.slice(2, -2).toLowerCase()}${SUFFIX}` as `0x${string}`;
    expect(eip1167Implementation(short)).toBeUndefined();
  });
});
