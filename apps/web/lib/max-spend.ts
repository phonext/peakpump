import { toMicroFloor } from "@peakpump/shared/format";
import { MIN_BUY_6 } from "@/lib/curve-quote";

// What Max may spend on a buy, which is not the balance: msg.value and the gas bound
// come out of the same funds, so a Max that sent the whole balance would
// leave nothing to pay for the transaction carrying it.
//
// Two passes, because the gas a buy costs depends on which branch it takes and the
// branch depends on the amount: the largest buy a wallet can make is exactly the one
// that reaches the Summit and runs the crossing path. Pricing a small buy and
// spending the rest would under-reserve on that trade. So the reserve is priced
// twice, once at a floor amount that any funded wallet can afford and once at the
// candidate that reserve produces, and the larger of the two is kept.
export interface GasBound {
  gasUnits: bigint;
  maxFeePerGas: bigint;
}

// Null rather than a throw for an estimate that did not answer. The second pass can
// legitimately not answer: a candidate that fits at the first branch's price does not
// fit at a dearer one, and eth_estimateGas refuses a value plus a bound the balance
// cannot cover. That refusal is information, not an error to report.
export type SpendProbe = (usdcIn6: bigint) => Promise<GasBound | null>;

export async function maxSpend6(nativeWei: bigint, probe: SpendProbe): Promise<bigint> {
  if (nativeWei <= 0n) return 0n;

  const first = await probe(MIN_BUY_6);
  if (first === null) return 0n;
  const reserve = first.gasUnits * first.maxFeePerGas;

  const trial = toMicroFloor(nativeWei - reserve);
  if (trial <= 0n) return 0n;

  const second = await probe(trial);
  const raised = second === null ? reserve : second.gasUnits * second.maxFeePerGas;
  const kept = raised > reserve ? raised : reserve;

  // Floored after the reserve is taken out, so the whole 6-decimal amount the field
  // shows and the wei msg.value carries both sit under the balance by construction.
  const spend = toMicroFloor(nativeWei - kept);
  return spend > 0n ? spend : 0n;
}
