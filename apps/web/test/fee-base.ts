// MATH 6.1 line 151 written out longhand. Deliberately not
// @peakpump/shared/curve's arithmetic: both tests assert that the deployed
// contract agrees with the document, and a helper that called the same library
// the contract mirrors would only prove the library agrees with itself.
export function feeCeil(amount6: bigint, feeBps: bigint): bigint {
  const product = amount6 * feeBps;
  const quotient = product / 10_000n;
  return product % 10_000n === 0n ? quotient : quotient + 1n;
}
