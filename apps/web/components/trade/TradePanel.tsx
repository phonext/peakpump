"use client";

import { formatTokenAmount, formatUsdc6, formatUsdcWei, toMicroFloor } from "@peakpump/shared/format";
import { Tabs } from "@peakpump/ui/Tabs";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Address } from "viem";
import { DeferredPayout } from "@/components/token/DeferredPayout";
import { ReadFailure } from "@/components/token/ReadFailure";
import { AmountField } from "@/components/trade/AmountField";
import { DeadlineControl } from "@/components/trade/DeadlineControl";
import { FeeBreakdown } from "@/components/trade/FeeBreakdown";
import { MaxButton } from "@/components/trade/MaxButton";
import { PriceImpact } from "@/components/trade/PriceImpact";
import { QuickAmounts } from "@/components/trade/QuickAmounts";
import { SlippageControl } from "@/components/trade/SlippageControl";
import { SubmitTrade } from "@/components/trade/SubmitTrade";
import { useBalances } from "@/hooks/useBalances";
import { type GasCall, useGasEstimate } from "@/hooks/useGasEstimate";
import { useMarketParams } from "@/hooks/useMarketParams";
import { useBuyQuote, useSellQuote } from "@/hooks/useQuote";
import { useTokenLive } from "@/hooks/useTokenLive";
import { PRICING_DEADLINE, type TradeCallBuilder, useTrade } from "@/hooks/useTrade";
import { TOKEN_DECIMALS, USDC_QUOTE_DECIMALS, parseAmount, sanitizeAmountText } from "@/lib/amount";
import type { BuyQuoteRead, SellQuoteRead } from "@/lib/curve-quote";
import type { TokenLive } from "@/lib/curve-reads";
import { buyCall, sellCall } from "@/lib/curve-write";
import { DEFAULT_DEADLINE_MINUTES, deadlineFrom, readChainSeconds } from "@/lib/deadline";
import { applyTolerance, formatSlippagePercent, isHighSlippage, useSlippage } from "@/lib/slippage";
import type { TokenBalances } from "@/lib/token-balances";
import { type Simulation, publishSimulation } from "@/lib/trade-simulation";
import { publicClient } from "@/lib/viem";
import { useWalletState } from "@/lib/wallet-state";

// The struct the cache holds for exactly this amount, or undefined while the field is
// ahead of the answer. hooks/useQuote.ts debounces by 250ms and defers its paint, so
// for a moment after every keystroke its value is the previous amount's answer —
// and a minimum sent with an amount the quote did not answer for is precisely the
// preview-versus-receipt divergence this guard exists to prevent. The key is that
// file's; LIVE_READ_QUERY_OPTIONS holds gcTime at zero, so an entry exists here only
// while it is the live query's own, which is what makes the lookup a proof of pairing
// rather than a cache hit.
function exactQuote<T>(
  client: QueryClient,
  name: string,
  curve: Address,
  amount: bigint | null,
): T | undefined {
  if (amount === null || amount === 0n) return undefined;
  return client.getQueryData<T>([name, curve, amount.toString()]);
}

// The sentence for an amount larger than the funds behind it, or null. On a buy those
// funds are the native balance in the 6-decimal view, because that is the view the
// field holds; toMicroFloor is the only conversion between the two, and the
// two are never added. This catches an amount over the balance and nothing finer: the
// gas bound comes out of the same funds, and reserving for it is the Max button's job.
function shortfallSentence(
  side: "buy" | "sell",
  amount: bigint | null,
  balances: TokenBalances | null,
  unit: string,
): string | null {
  if (amount === null || balances === null) return null;
  if (side === "buy") {
    const held = balances.nativeWei;
    if (held === null || amount <= toMicroFloor(held)) return null;
    return `You hold ${formatUsdcWei(held)} USDC.`;
  }
  const held = balances.tokenWei;
  if (held === null || amount <= held) return null;
  return `You hold ${formatTokenAmount(held)}${unit}.`;
}

// What this address may still spend inside the anti-snipe window. Null outside the
// window and null with no wallet, which are the two states in which there is no
// allowance to state rather than an allowance of zero.
//
// The boundary is the contract's, not a rounded version of it: Curve.sol:278 gates on
// block.number < antiSnipeEndBlock, so the block equal to antiSnipeEndBlock is already
// outside. A > here would print a restriction on that one block that the curve has
// stopped enforcing.
function windowRemaining6(live: TokenLive | undefined): bigint | null {
  if (live === undefined || live.boughtInWindow6 === null) return null;
  if (live.blockNumber >= live.antiSnipeEndBlock) return null;
  const remaining = live.maxBuyPerAddress6 - live.boughtInWindow6;
  return remaining > 0n ? remaining : 0n;
}

// The whole trade surface for one market, without a Panel around it: the page wraps
// it in one and components/trade/StickyTradeBar.tsx puts the same component inside a
// sheet at sm. Two mounted copies cost no extra requests — every read below is a
// react-query key shared with the rest of the page — and the one behind md:block
// carries no amount, so it asks for no quote and no estimate.
export function TradePanel({ curve }: { curve: Address }) {
  const client = useQueryClient();
  const address = useWalletState().address;
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [text, setText] = useState("");
  const [minutes, setMinutes] = useState(DEFAULT_DEADLINE_MINUTES);
  // Acceptance of a tolerance over five percent lives here rather than in the
  // control, because it gates the submit control below and has to fall away the
  // moment the tolerance itself changes.
  const [accepted, setAccepted] = useState(false);
  const { bps, setBps } = useSlippage();
  // One stable object for as long as this copy is mounted, and the identity the
  // simulation store keys its owner on: at sm two copies of this panel exist and only the
  // one being typed into may clear the marker (lib/trade-simulation.ts).
  const panel = useRef({}).current;

  const live = useTokenLive(curve);
  const params = useMarketParams(curve);
  const balances = useBalances(params.data?.token, params.data?.creator);
  const run = useTrade(() => setText(""));

  const decimals = side === "buy" ? USDC_QUOTE_DECIMALS : TOKEN_DECIMALS;
  const amount = parseAmount(text, decimals);
  const buy = useBuyQuote(curve, side === "buy" ? (amount ?? undefined) : undefined);
  const sell = useSellQuote(curve, side === "sell" ? (amount ?? undefined) : undefined);

  // exact is the pairing proof; shown is what the figures are printed from. They are
  // the same object whenever exact exists, so a reader can take every number in the
  // breakdown as the answer to the amount in the field the moment submit is live, and
  // as the answer to the previous amount while it is not.
  const exactBuy =
    side === "buy" ? exactQuote<BuyQuoteRead>(client, "quote-buy", curve, amount) : undefined;
  const exactSell =
    side === "sell" ? exactQuote<SellQuoteRead>(client, "quote-sell", curve, amount) : undefined;
  // Side-gated on the hook's value as well as on the cache lookup: hooks/useQuote.ts
  // debounces the amount it is handed and holds the previous one for 250ms, so without
  // this the quarter second after a tab change would print the other side's struct.
  const shownBuy = side === "buy" ? (exactBuy ?? buy.quote) : undefined;
  const shownSell = side === "sell" ? (exactSell ?? sell.quote) : undefined;
  const paired = side === "buy" ? exactBuy !== undefined : exactSell !== undefined;

  // Ok is the only status whose fields mean anything: every other one returns a struct
  // of zeroes and a sentence to print instead (lib/curve-quote.ts). Narrowing here is
  // what keeps a breakdown of zeroes off the screen and a minimum of zero out of a
  // transaction.
  const okBuy = shownBuy?.status === "Ok" ? shownBuy.quote : undefined;
  const okSell = shownSell?.status === "Ok" ? shownSell.quote : undefined;

  // The base is the struct's own field, verbatim; the only thing applied locally is the
  // tolerance the user chose, in BigInt and floored.
  const quoted = side === "buy" ? okBuy?.tokensOut : okSell?.usdcOut6;
  const minimum = quoted === undefined ? undefined : applyTolerance(quoted, bps);

  // The marker components/chart/RouteChart.tsx draws on the route, published rather than
  // passed down: the panel and the chart sit in two columns of a grid that stays a server
  // component. Three answers and not two — null clears the marker, and undefined leaves
  // it where the last paired quote put it, which is what stops it blinking off and back
  // through the 250ms between a keystroke and its answer.
  const simulation = useMemo<Simulation | null | undefined>(() => {
    if (amount === null || amount === 0n) return null;
    if (!paired) return undefined;
    if (side === "buy") {
      return okBuy === undefined ? null : { side, tokensOut: okBuy.tokensOut, net6: okBuy.net6 };
    }
    // A sell struct carries no echo of its own input (lib/curve-quote.ts), so the token
    // amount is the field's own value — and this struct's own input, because that is what
    // the pairing above proves.
    return okSell === undefined ? null : { side, tokensIn: amount, gross6: okSell.gross6 };
  }, [side, amount, paired, okBuy, okSell]);

  useEffect(() => {
    if (simulation !== undefined) publishSimulation(panel, simulation);
  }, [panel, simulation]);

  // The sheet's copy unmounts when it closes, and a marker left owned by a panel that no
  // longer exists is one nothing else can clear: a null from a non-owner is ignored.
  useEffect(() => () => publishSimulation(panel, null), [panel]);

  const symbol = params.data?.symbol;
  // This market's own snapshot and never the factory's current default. Undefined only
  // while the live read has not answered or has failed, which costs the percentage in the
  // fee label and nothing else: every absolute figure is the quote's.
  const feeBps = live.data?.feeBps;
  const unit = symbol === undefined ? "" : ` ${symbol}`;
  const percent = formatSlippagePercent(bps);
  const quoteError = side === "buy" ? buy.error : sell.error;
  const quoteRefetch = side === "buy" ? buy.refetch : sell.refetch;
  const remaining6 = windowRemaining6(live.data);

  // First non-null wins, in the order a reader can act in it: what the contract says
  // about this amount, then what the wallet holds, then whether the figures on screen
  // are this amount's own, then the two consents.
  const statusReason = (side === "buy" ? shownBuy?.sentence : shownSell?.sentence) ?? null;
  const shortfallReason = shortfallSentence(side, amount, balances, unit);
  // The window between a keystroke and its answer. A quote that failed instead of
  // arriving is not this sentence's business: ReadFailure prints the why below, and
  // submit is off anyway because there is no struct to take a minimum from.
  const pairingReason =
    amount === null || amount === 0n || paired || quoteError !== null
      ? null
      : "Pricing this amount.";
  const toleranceReason =
    isHighSlippage(bps) && !accepted ? `Accept the ${percent}% tolerance to trade.` : null;
  // okBuy is undefined on the sell tab, so this needs no side of its own: the cap is a
  // buy-side rule and the fee is charged on what a trade spends, which is spend6.
  const windowReason =
    remaining6 === null || okBuy === undefined || okBuy.spend6 <= remaining6
      ? null
      : `The window leaves you ${formatUsdc6(remaining6)} USDC on this market.`;
  const reason =
    statusReason ?? shortfallReason ?? pairingReason ?? toleranceReason ?? windowReason;

  // The three values a transaction is made of, or null when it cannot be made. Both the
  // thunk the wallet signs and the call the node prices are built from this one object,
  // so they cannot differ in anything but the deadline, and minimum is taken from here
  // rather than recomputed at either site: the figure printed in the breakdown is by
  // construction the figure the chain enforces.
  const basis =
    amount === null || address === undefined || minimum === undefined || !paired || reason !== null
      ? null
      : { amount, address, minimum };

  // Priced with a deadline that cannot expire (hooks/useTrade.ts says why) and with the
  // real minimum, because eth_estimateGas executes the function: a floor of zero would
  // price a branch this trade will not take.
  const gasCall: GasCall | undefined =
    basis === null
      ? undefined
      : side === "buy"
        ? buyCall({
            curve,
            usdcIn6: basis.amount,
            minTokensOut: basis.minimum,
            deadline: PRICING_DEADLINE,
            to: basis.address,
          })
        : sellCall({
            curve,
            tokensIn: basis.amount,
            minUsdcOut6: basis.minimum,
            deadline: PRICING_DEADLINE,
          });
  const estimate = useGasEstimate(gasCall);

  const build: TradeCallBuilder | null =
    basis === null
      ? null
      : async () => {
          // The fixed deadline, read off the chain at the moment of signing.
          const deadline = deadlineFrom(await readChainSeconds(publicClient), minutes);
          return side === "buy"
            ? buyCall({
                curve,
                usdcIn6: basis.amount,
                minTokensOut: basis.minimum,
                deadline,
                to: basis.address,
              })
            : sellCall({ curve, tokensIn: basis.amount, minUsdcOut6: basis.minimum, deadline });
        };

  const nativeWei = balances?.nativeWei ?? null;
  const tokenWei = balances?.tokenWei ?? null;
  // The buy field holds 6-decimal USDC, so the balance its fractions are taken of is the
  // native balance in that view. The line above the field prints the native figure
  // itself, because that is the balance a wallet shows.
  const fieldBalance =
    side === "buy" ? (nativeWei === null ? null : toMicroFloor(nativeWei)) : tokenWei;
  const balanceText =
    side === "buy"
      ? nativeWei === null
        ? null
        : formatUsdcWei(nativeWei)
      : tokenWei === null
        ? null
        : formatTokenAmount(tokenWei);

  const verb = side === "buy" ? "Buy" : "Sell";
  const settledMessage = `${side === "buy" ? "Bought" : "Sold"}. The balances and the price above come from the next read.`;

  // One body for both sides. They differ in a unit, a quote and a call, and in nothing
  // about the arrangement, so a second copy of this tree would be two places to keep one
  // layout in step.
  const body = (
    <div className="flex flex-col gap-4">
      <AmountField
        label={side === "buy" ? "You spend" : "You sell"}
        unit={side === "buy" ? "USDC" : (symbol ?? "tokens")}
        value={text}
        onChange={(next) => setText(sanitizeAmountText(next))}
        invalid={text !== "" && amount === null}
        balanceLabel="Balance"
        balanceText={balanceText}
      >
        {/* One gap for all four controls, so the 8px DESIGN.md requires between
            neighbouring targets holds across the whole row. */}
        <div className="flex flex-wrap items-center gap-2">
          <QuickAmounts balance={fieldBalance} decimals={decimals} onPick={setText} />
          <MaxButton
            side={side}
            curve={curve}
            nativeWei={nativeWei}
            tokenWei={tokenWei}
            onPick={setText}
          />
        </div>
      </AmountField>

      {/* A note about the field rather than about a trade: lib/amount.ts
          truncates at the sixth decimal and lib/curve-write.ts sends a whole
          number of those units as an exact multiple of 1e12, so nothing this
          panel builds leaves a remainder for the contract's dust accumulator to
          take. */}
      {side === "buy" ? (
        <p className="text-small text-pp-text-muted">
          Amounts are sent in whole units of 0.000001 USDC. A remainder below that stays
          with the market as dust instead of coming back in a refund, so the field drops
          those digits before the trade is priced.
        </p>
      ) : null}

      <SlippageControl
        bps={bps}
        onChange={(next) => {
          setBps(next);
          // The consent falls away with the number it was given for.
          setAccepted(false);
        }}
        accepted={accepted}
        onAccept={setAccepted}
      />

      <DeadlineControl minutes={minutes} onChange={setMinutes} />

      {/* Two reads, two sentences. The quote's failure takes submit off by leaving no
          struct to price; the live read's failure only costs the fee percentage and the
          window figures, so it says so and the breakdown below still renders from the
          quote's own fields. */}
      {quoteError === null ? null : <ReadFailure error={quoteError} onRetry={quoteRefetch} />}
      {live.isError ? <ReadFailure error={live.error} onRetry={live.refetch} /> : null}

      {okBuy === undefined || minimum === undefined ? null : (
        <FeeBreakdown
          side="buy"
          quote={okBuy}
          feeBps={feeBps}
          symbol={symbol}
          minimum={minimum}
          tolerance={percent}
        />
      )}

      {okSell === undefined || minimum === undefined ? null : (
        <FeeBreakdown
          side="sell"
          quote={okSell}
          feeBps={feeBps}
          symbol={symbol}
          minimum={minimum}
          tolerance={percent}
        />
      )}

      {/* Only with the pairing proof in hand. On a buy both halves are the struct's own
          fields; on a sell the token amount is the field's value, and pairing is what
          makes it this struct's own input rather than a number beside it. */}
      {paired && okBuy !== undefined ? (
        <PriceImpact
          side="buy"
          usdc6={okBuy.net6}
          tokens={okBuy.tokensOut}
          priceX18={live.data?.priceX18}
        />
      ) : null}
      {paired && okSell !== undefined && amount !== null ? (
        <PriceImpact
          side="sell"
          usdc6={okSell.gross6}
          tokens={amount}
          priceX18={live.data?.priceX18}
        />
      ) : null}

      {/* Both figures are struct fields, and the fee above is already the fee
          on spend6, which is what makes "never a fee on the full input" a fact
          about the contract rather than a claim by this file. The contract
          credits exactly refund6 * 1e12, so the refund has no remainder term to
          warn about. */}
      {okBuy?.crossed === true ? (
        <p className="text-small text-pp-text-muted">
          This buy reaches the Summit. It spends{" "}
          <span className="mono text-body text-pp-text md:text-small">
            {formatUsdc6(okBuy.spend6)}
          </span>{" "}
          USDC, returns{" "}
          <span className="mono text-body text-pp-text md:text-small">
            {formatUsdc6(okBuy.refund6)}
          </span>{" "}
          USDC exactly, and the fee is charged on the amount spent.
        </p>
      ) : null}

      {remaining6 === null || side === "sell" ? null : (
        <p className="text-small text-pp-text-muted">
          Anti-snipe window. Tokens go to your own address, and{" "}
          <span className="mono text-body text-pp-text md:text-small">
            {formatUsdc6(remaining6)}
          </span>{" "}
          USDC of your cap is left, charged on what a trade spends rather than on what it
          offers.
        </p>
      )}

      <SubmitTrade
        label={verb}
        run={run}
        build={build}
        estimate={estimate}
        reason={reason}
        settledMessage={settledMessage}
      />
    </div>
  );

  // The recovery path sits above the strip rather than inside a side, because money the
  // curve owes this address is owed on both of them. It renders nothing when nothing is
  // deferred.
  //
  // Both items carry the same body node, so the field, the tolerance and a trade in
  // flight all survive a change of side; what does not survive is the amount, which
  // means a different thing in each unit, and the tolerance consent, which is given for
  // one trade.
  return (
    <div className="flex flex-col gap-4">
      <DeferredPayout curve={curve} />
      <Tabs
        label="Trade side"
        value={side}
        onValueChange={(next) => {
          setSide(next === "sell" ? "sell" : "buy");
          setText("");
          setAccepted(false);
        }}
        items={[
          { id: "buy", label: "Buy", content: body },
          { id: "sell", label: "Sell", content: body },
        ]}
      />
    </div>
  );
}
