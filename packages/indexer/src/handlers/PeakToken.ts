import { indexer, type Holder, type Token } from "envio";
import { FACTORY } from "../deployment";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

// The context slice the leg updater needs, so it can live outside the handler
// without naming the full handler context type.
type HolderContext = {
  readonly Holder: {
    readonly get: (id: string) => Promise<Holder | undefined>;
    readonly set: (row: Holder) => void;
  };
};

// Returns the holder-count change for this leg: +1 crossing up from nothing,
// -1 crossing down to nothing, 0 otherwise. A row at zero balance is kept, but
// only a positive balance counts.
async function applyLeg(
  context: HolderContext,
  token: string,
  address: string,
  delta: bigint,
): Promise<number> {
  const id = `${token}-${address}`;
  const row = await context.Holder.get(id);
  const before = row === undefined ? 0n : row.balance;
  const after = before + delta;
  context.Holder.set({ id, token, address, balance: after });
  if (before > 0n && after <= 0n) return -1;
  if (before <= 0n && after > 0n) return 1;
  return 0;
}

indexer.onEvent(
  { contract: "PeakToken", event: "Transfer" },
  async ({ event, context }) => {
    const p = event.params;
    // The zero-address legs are mints and burns, and the initial mint to the
    // curve lands here, so this rule is also what ignores it.
    if (p.from === ZERO_ADDRESS || p.to === ZERO_ADDRESS) return;
    // A self-transfer is a no-op on the balance and would be applied twice
    // below.
    if (p.from === p.to) return;

    // srcAddress is the emitting clone, which is what pins this handler to our
    // own tokens: the chain-wide native-USDC emitter and the ERC-20 USDC
    // contract never reach it.
    const markets = await context.Token.getWhere({ token: { _eq: event.srcAddress } });
    const market: Token | undefined = markets[0];
    if (market === undefined) return;
    const curve = market.id;

    // Per leg, not per event: the curve is not a holder (its balance is the
    // pool) and the factory never holds tokens, but every buy pays out FROM the
    // curve, so the buyer's leg of that transfer still counts.
    let holderCount = market.holderCount;
    if (p.from !== curve && p.from !== FACTORY) {
      holderCount += await applyLeg(context, market.token, p.from, -p.value);
    }
    if (p.to !== curve && p.to !== FACTORY) {
      holderCount += await applyLeg(context, market.token, p.to, p.value);
    }
    if (holderCount !== market.holderCount) {
      context.Token.set({ ...market, holderCount });
    }
  },
);
