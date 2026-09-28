import type { Trade } from "envio";

// The context slice the join needs, so the helper is reusable without naming
// the full handler context type.
type TradeLookup = {
  readonly Trade: {
    readonly getWhere: (filter: {
      readonly transactionHash?: { readonly _eq?: string };
    }) => Promise<readonly Trade[]>;
  };
};

// The Trade event of the same transaction that a TradeDetail or a FeeVault
// credit belongs to. The contracts emit Trade immediately before both, but a
// batch transaction can trade on two curves, so the rule is the nearest
// preceding Trade by logIndex, not just any Trade in the transaction. The
// creation-fee credit precedes every Trade in its transaction and so matches
// none, which is what leaves its curve unset.
export async function nearestPrecedingTrade(
  context: TradeLookup,
  transactionHash: string,
  logIndex: number,
): Promise<Trade | undefined> {
  const rows = await context.Trade.getWhere({ transactionHash: { _eq: transactionHash } });
  let nearest: Trade | undefined;
  for (const row of rows) {
    if (row.logIndex < logIndex && (nearest === undefined || row.logIndex > nearest.logIndex)) {
      nearest = row;
    }
  }
  return nearest;
}
