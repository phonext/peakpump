"use client";

import { Button } from "@peakpump/ui/Button";
import { useState } from "react";
import type { Address } from "viem";
import { PRICING_DEADLINE } from "@/hooks/useTrade";
import { TOKEN_DECIMALS, USDC_QUOTE_DECIMALS, toAmountText } from "@/lib/amount";
import { buyCall } from "@/lib/curve-write";
import { estimateGasCostUsdc } from "@/lib/gas";
import { type GasBound, maxSpend6 } from "@/lib/max-spend";
import { publicClient } from "@/lib/viem";
import { useWalletState } from "@/lib/wallet-state";

// A floor of zero and a deadline that cannot expire: this call is never signed, it is
// only priced, and both arguments are there because eth_estimateGas executes the
// function and would revert on a real tolerance the moment another trade landed
// between the two passes.
async function probe(
  curve: Address,
  account: Address,
  usdcIn6: bigint,
): Promise<GasBound | null> {
  const call = buyCall({ curve, usdcIn6, minTokensOut: 0n, deadline: PRICING_DEADLINE, to: account });
  try {
    return await estimateGasCostUsdc(publicClient, { ...call, account });
  } catch {
    // The refusal lib/max-spend.ts expects: a candidate that fits at one branch's gas
    // price does not fit at a dearer one, and the node answers that by refusing to
    // estimate rather than by returning a number.
    return null;
  }
}

export function MaxButton({
  side,
  curve,
  nativeWei,
  tokenWei,
  onPick,
}: {
  side: "buy" | "sell";
  curve: Address;
  nativeWei: bigint | null;
  tokenWei: bigint | null;
  onPick: (text: string) => void;
}) {
  const address = useWalletState().address;
  const [busy, setBusy] = useState(false);

  // Nothing is reserved on a sell: the gas comes out of the native balance and the
  // tokens out of a different one, so Max is the balance exactly. It carries its whole
  // 18-digit fraction into the field for that reason — a figure trimmed for reading
  // would leave a remainder behind and Max would not mean all of it.
  const sellText =
    tokenWei === null || tokenWei === 0n ? null : toAmountText(tokenWei, TOKEN_DECIMALS);

  const run =
    side === "sell"
      ? sellText === null
        ? null
        : () => onPick(sellText)
      : address === undefined || nativeWei === null || nativeWei === 0n
        ? null
        : async () => {
            setBusy(true);
            const spend6 = await maxSpend6(nativeWei, (usdcIn6) => probe(curve, address, usdcIn6));
            setBusy(false);
            // Zero when the balance cannot cover a trade and its gas at all. Leaving
            // the field alone says that better than writing a zero into it.
            if (spend6 > 0n) onPick(toAmountText(spend6, USDC_QUOTE_DECIMALS));
          };

  return (
    <Button size="sm" disabled={run === null || busy} aria-busy={busy} onClick={() => void run?.()}>
      Max
    </Button>
  );
}
