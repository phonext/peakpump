"use client";

import {
  BPS_DENOM,
  WAD,
  buyQuote,
  marketCap6,
  priceX18,
  type DerivedParams,
} from "@peakpump/shared/curve";
import { CREATOR_BPS, TRADE_FEE_BPS, formatFeeBps } from "@peakpump/shared/fees";
import {
  formatMarketCap,
  formatPercent,
  formatPriceX18,
  formatTokenAmount,
  formatUsdc6,
} from "@peakpump/shared/format";
import { PRESETS, type Preset } from "@peakpump/shared/presets";
import { Panel } from "@peakpump/ui/Panel";
import type { UseQueryResult } from "@tanstack/react-query";
import { type Dispatch, type ReactNode, useId, useMemo, useState } from "react";
import { CHART_HEIGHT } from "@/components/chart/ChartFrame";
import { ReadFailure } from "@/components/token/ReadFailure";
import { USDC_QUOTE_DECIMALS, parseAmount, sanitizeAmountText } from "@/lib/amount";
import {
  ANTI_SNIPE_MAX_BLOCKS,
  antiSnipeIssue,
  customIssue,
  derivedPreview,
  devBuyIssue,
  reff6Sentence,
  type CreateAction,
  type CreateState,
  type EconomicsPreview,
} from "@/lib/create-state";

// Step 2: the curve this market is created with, what it derives, and the two
// optional arguments create() takes beside it. Every verdict on screen belongs
// to lib/create-state.ts. What this file owns is the one value the model
// deliberately cannot see — the dev-buy cap, which is a factory view over RPC —
// joined to the typed amount at the point where the sentence is read.

// The placeholder form's own control styles, unchanged: text-body is the 16px
// step, which is what stops a phone browser zooming the page on focus.
const FIELD =
  "hairline rounded-pp bg-pp-surface-2 text-pp-text w-full px-3 py-2 text-body outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pp-accent-bright";

const LABEL = "text-small font-medium text-pp-text";

const FIGURE = "mono text-body text-pp-text break-all md:text-small";

// Button's own disabled treatment, so a field inside a disabled fieldset and a
// disabled button fade to the same token.
const FIELD_DISABLED = "disabled:text-pp-text-faint";

// Every field a preset carries, printed as create() receives it. The bigints are
// stringified and never scaled, grouped or converted: MATH 10 fixes these values
// and this page is not a second place they get arithmetic done to them. The two
// USD strings are committed alongside them for the same reason.
const RAW_FIELDS = [
  { label: "S", read: (preset: Preset) => preset.S.toString() },
  { label: "R6", read: (preset: Preset) => preset.R6.toString() },
  { label: "rX18", read: (preset: Preset) => preset.rX18.toString() },
  { label: "x0", read: (preset: Preset) => preset.x0.toString() },
  { label: "Start market cap", read: (preset: Preset) => preset.startMarketCapUsd },
  // MATH [7] and the preset rows in MATH section 10: this committed string is R*(r+1),
  // the market cap at the Summit, and not R6 — Ridge reads MC $3,750 -> $60,000, which
  // is [8] and then [7], the two ends of one curve. The shared field is named
  // targetRaiseUsd, which is what put the wrong word on this row; the raise itself is
  // the R6 above, in the units create() receives.
  { label: "Summit market cap", read: (preset: Preset) => preset.targetRaiseUsd },
] as const;

// The route chart's geometry, which is RouteChart.tsx's and is re-declared here
// against DerivedParams rather than imported: that file's types are a live
// market's, read from a curve that exists, and this one draws a market that does
// not yet. Its two reasons for hand-drawn SVG hold here as well — the chart
// library's horizontal axis is a time scale and this one is a token amount, and
// the 60 kB that library costs stays out of the create route.

// Sixty-five points across the domain, which is finer than the pixels a 280px frame has
// for a curve that is smooth and monotone over the whole of it.
const SAMPLES = 64;

// The reserve at any point on the route, from the invariant rather than from a formula of
// this file's own: MATH [3] conserves k = x*y across every ASCENT trade, so x is x0*y0
// over the supply that is left. Floored, like every division on chain.
function reserveAt(params: DerivedParams, y: bigint): bigint {
  return (params.x0 * params.y0) / y;
}

// A position inside the box, in percent. The ratio is taken in basis points so the only
// value ever coerced to a float is an integer below ten thousand and one and never a
// chain figure. The token route's copy of this clamps both ends because it places a live
// price the pool's own rounding can put a unit above the route; the only points placed
// here are samples between the frame's own two ends, so there is nothing to clamp.
function place(value: bigint, low: bigint, high: bigint): number {
  return Number(((value - low) * BPS_DENOM) / (high - low)) / 100;
}

// The two ends of the route are the two ends of the frame, so the curve touches all four
// sides and no axis needs a scale printed down it. The top is the price the contract will
// hold at the Summit — y1 as derived, with its own reserve — rather than an interpolation
// towards it.
interface Frame {
  Ts: bigint;
  low: bigint;
  high: bigint;
}

function frameOf(params: DerivedParams): Frame {
  return {
    Ts: params.Ts,
    low: priceX18(params.x0, params.y0),
    high: priceX18(reserveAt(params, params.y1), params.y1),
  };
}

// One pass, two paths: the line and the fill under it. The viewBox is 100 by 100 and the
// SVG stretches it to the box, which is what lets these coordinates and CSS percentages
// be the same numbers.
function routePaths(params: DerivedParams, frame: Frame): { line: string; area: string } {
  const points: string[] = [];
  for (let i = 0; i <= SAMPLES; i += 1) {
    const sold = (frame.Ts * BigInt(i)) / BigInt(SAMPLES);
    const y = params.y0 - sold;
    const price = priceX18(reserveAt(params, y), y);
    const left = place(sold, 0n, frame.Ts).toFixed(2);
    const top = (100 - place(price, frame.low, frame.high)).toFixed(2);
    points.push(`${left},${top}`);
  }
  const line = `M${points.join("L")}`;
  return { line, area: `${line}L100,100L0,100Z` };
}

// Every rule in this frame is one physical pixel whatever the box is. The viewBox is
// stretched to fit, so an ordinary stroke would come out thicker across than down.
function Rule({
  x1,
  y1,
  x2,
  y2,
  tone,
  width = 1,
}: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  tone: string;
  width?: number;
}) {
  return (
    <line
      x1={x1}
      y1={y1}
      x2={x2}
      y2={y2}
      strokeWidth={width}
      vectorEffect="non-scaling-stroke"
      className={tone}
    />
  );
}

function Legend({ tone, label, children }: { tone: string; label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="flex items-center gap-2 text-small text-pp-text-muted">
        <span aria-hidden className={`h-2 w-2 rounded-pp ${tone}`} />
        {label}
      </span>
      <span className={FIGURE}>{children}</span>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-small text-pp-text-muted">{label}</dt>
      <dd className={FIGURE}>{children}</dd>
    </div>
  );
}

// The multiple as the user holds it, out of the 1e18-scaled field the contract
// stores. Exact rather than capped: this prints the number that was typed, and
// @peakpump/shared/format has no ratio formatter to take it from.
function formatMultiple(rX18: bigint): string {
  const whole = rX18 / WAD;
  const fraction = (rX18 % WAD).toString().padStart(18, "0").replace(/0+$/, "");
  return fraction === "" ? `${whole}x` : `${whole}.${fraction}x`;
}

// MATH 6.1 splits the trade fee top-down and the creator's share is CREATOR_BPS
// of the trade. Across a volume figure this is the sum of many trades rather
// than one of them, so it is floored the way the split itself is.
function creatorEarned6(volume6: bigint): bigint {
  return (volume6 * CREATOR_BPS) / BPS_DENOM;
}

interface StepEconomicsProps {
  state: CreateState;
  dispatch: Dispatch<CreateAction>;
  maxDevBuy: UseQueryResult<bigint>;
}

export function StepEconomics({ state, dispatch, maxDevBuy }: StepEconomicsProps) {
  const { mode, custom, devBuyText, antiSnipeOn, antiSnipe } = state.economics;

  const sId = useId();
  const supplyId = `${sId}-supply`;
  const raiseId = `${sId}-raise`;
  const multipleId = `${sId}-multiple`;
  const customNoteId = `${sId}-custom-note`;
  const devBuyId = `${sId}-dev-buy`;
  const devBuyNoteId = `${sId}-dev-buy-note`;
  const blocksId = `${sId}-blocks`;
  const capId = `${sId}-cap`;
  const antiSnipeNoteId = `${sId}-anti-snipe-note`;
  const dailyId = `${sId}-daily`;
  const monthlyId = `${sId}-monthly`;

  // Volume the creator picks to price their own share with. Local, because
  // nothing here reaches create(): the model carries what is submitted and these
  // two are a calculator.
  const [dailyText, setDailyText] = useState("");
  const [monthlyText, setMonthlyText] = useState("");

  const preview = derivedPreview(state);
  const customReason = customIssue(state);
  const antiSnipeReason = antiSnipeIssue(state);
  // The same hold-back as the identity step: the reasons stay live for the Next
  // gate, and only the notes wait. The custom triple is one entry, so a blur of
  // any of its three fields shows the sentence the three are judged by; the
  // anti-snipe pair is one for the same reason.
  const customShown = state.blurred.custom && customReason !== null;
  const antiSnipeShown = state.blurred.antiSnipe && antiSnipeReason !== null;

  // parsedDevBuy is private to the model, so this is the identical expression
  // rather than a second opinion about what parses: empty is a legal zero and
  // anything malformed is null, which devBuyIssue below carries the sentence for.
  const devBuy6 = devBuyText === "" ? 0n : parseAmount(devBuyText, USDC_QUOTE_DECIMALS);

  // First non-null wins, in the order a reader can act in it: what the text is,
  // then what the factory says the amount may be. The cap is always the live
  // view (hooks/useMaxDevBuy.ts) and never the shared pure twin, and it exists
  // only once the economics themselves derive — while they do not, the custom
  // panel already carries the reason.
  const cap6 = maxDevBuy.data;
  const devBuyReason =
    devBuyIssue(state) ??
    (preview === null || cap6 === undefined || devBuy6 === null || devBuy6 <= cap6
      ? null
      : `The dev-buy is capped at Ts/20: at most ${formatUsdc6(cap6)} at these values.`);
  const devBuyShown = state.blurred.devBuy && devBuyReason !== null;

  // The one preview in this product that is computed instead of quoted, because
  // the curve it prices has no contract to ask yet. The arithmetic is the
  // contract's own (packages/shared/src/curve.ts) and TRADE_FEE_BPS is the flat
  // fee MATH 6 fixes, which is what fees.ts keeps that constant for. The cap
  // above stays the factory's live answer, the live fee included.
  const devBuyQuote =
    preview === null || devBuy6 === null || devBuy6 === 0n
      ? null
      : buyQuote(preview.derived.x0, preview.derived.y0, devBuy6, TRADE_FEE_BPS);

  // MATH [4]: p1/p0 is r squared, so the multiple is the reserve's climb and the
  // price's is its square. The example is this form's own value rather than a
  // pair of literals, and it is absent for exactly as long as the value is.
  const multipleHint =
    preview === null
      ? "The reserve climbs by this multiple and the price by its square."
      : `The reserve climbs by this multiple and the price by its square: ${formatMultiple(preview.rX18)} on the reserve is ${formatMultiple((preview.rX18 * preview.rX18) / WAD)} on the price.`;

  const daily6 = parseAmount(dailyText, USDC_QUOTE_DECIMALS);
  const monthly6 = parseAmount(monthlyText, USDC_QUOTE_DECIMALS);

  return (
    <>
      <fieldset className="flex flex-col gap-4">
        <legend className="text-heading font-medium text-pp-text">Raise preset</legend>
        <p className="text-small text-pp-text-muted">
          One curve shape, three sizes. These are the values create() receives.
        </p>
        <div className="flex flex-col gap-4 md:grid md:grid-cols-3 md:items-start">
          {PRESETS.map((preset) => (
            <Panel key={preset.key} as="section" title={preset.label}>
              <div className="flex flex-col gap-3">
                <label className="pp-press flex min-h-[44px] items-center gap-2 text-body text-pp-text">
                  <input
                    type="radio"
                    name="preset"
                    value={preset.key}
                    checked={mode.kind === "preset" && mode.presetKey === preset.key}
                    onChange={() => dispatch({ type: "set-preset", presetKey: preset.key })}
                    className="accent-pp-accent h-4 w-4"
                  />
                  Use {preset.label}
                </label>
                <dl className="flex flex-col gap-2">
                  {RAW_FIELDS.map((field) => (
                    <Row key={field.label} label={field.label}>
                      {field.read(preset)}
                    </Row>
                  ))}
                </dl>
              </div>
            </Panel>
          ))}
        </div>

        {/* The fourth option, in the same radio group as the three above so the
            four read as one choice. Its fields stay on screen while a preset is
            selected, disabled: what a preset is made of is three values, and
            this is where they are typed. */}
        <Panel as="section" title="Custom" className="max-w-[560px]">
          <div className="flex flex-col gap-4">
            <label className="pp-press flex min-h-[44px] items-center gap-2 text-body text-pp-text">
              <input
                type="radio"
                name="preset"
                value="custom"
                checked={mode.kind === "custom"}
                onChange={() => dispatch({ type: "set-custom" })}
                className="accent-pp-accent h-4 w-4"
              />
              Set your own
            </label>

            <fieldset disabled={mode.kind !== "custom"} className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <div className="flex items-baseline justify-between gap-2">
                  <label htmlFor={supplyId} className={LABEL}>
                    Supply
                  </label>
                  <span className="text-small text-pp-text-muted">tokens</span>
                </div>
                <input
                  id={supplyId}
                  name="supply"
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="e.g. 1000000000"
                  className={`${FIELD} ${FIELD_DISABLED} mono min-h-[44px]`}
                  value={custom.sText}
                  onChange={(event) =>
                    dispatch({ type: "set-custom-s", value: sanitizeAmountText(event.target.value) })
                  }
                  onBlur={() => dispatch({ type: "blur", field: "custom" })}
                  aria-invalid={customShown}
                  aria-describedby={customShown ? customNoteId : undefined}
                />
              </div>

              <div className="flex flex-col gap-2">
                <div className="flex items-baseline justify-between gap-2">
                  <label htmlFor={raiseId} className={LABEL}>
                    Raise
                  </label>
                  <span className="text-small text-pp-text-muted">USDC</span>
                </div>
                <input
                  id={raiseId}
                  name="raise"
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="e.g. 3000"
                  className={`${FIELD} ${FIELD_DISABLED} mono min-h-[44px]`}
                  value={custom.r6Text}
                  onChange={(event) =>
                    dispatch({
                      type: "set-custom-r6",
                      value: sanitizeAmountText(event.target.value),
                    })
                  }
                  onBlur={() => dispatch({ type: "blur", field: "custom" })}
                  aria-invalid={customShown}
                  aria-describedby={customShown ? customNoteId : undefined}
                />
              </div>

              <div className="flex flex-col gap-2">
                <div className="flex items-baseline justify-between gap-2">
                  <label htmlFor={multipleId} className={LABEL}>
                    Multiple
                  </label>
                  <span className="text-small text-pp-text-muted">x</span>
                </div>
                <input
                  id={multipleId}
                  name="multiple"
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="e.g. 4"
                  className={`${FIELD} ${FIELD_DISABLED} mono min-h-[44px]`}
                  value={custom.multipleText}
                  onChange={(event) =>
                    dispatch({
                      type: "set-custom-multiple",
                      value: sanitizeAmountText(event.target.value),
                    })
                  }
                  onBlur={() => dispatch({ type: "blur", field: "custom" })}
                  aria-invalid={customShown}
                  aria-describedby={customShown ? customNoteId : undefined}
                />
                <p className="text-small text-pp-text-muted">{multipleHint}</p>
              </div>
            </fieldset>

            {/* One reason for the three fields together: deriveParams judges the
                triple, so a sentence under any single field would name the wrong
                one. */}
            {customShown && (
              <p id={customNoteId} className="text-small text-pp-down">
                {customReason}
              </p>
            )}
          </div>
        </Panel>
      </fieldset>

      <Panel as="section" title="What the curve derives" className="max-w-[560px]">
        {preview === null ? (
          <p className="text-small text-pp-text-muted">
            These figures arrive when the supply, raise and multiple are valid.
          </p>
        ) : (
          <DerivedFigures preview={preview} />
        )}
      </Panel>

      <Panel as="section" title="Dev buy" className="max-w-[560px]">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-2">
              <label htmlFor={devBuyId} className={LABEL}>
                Amount
              </label>
              <span className="text-small text-pp-text-muted">USDC</span>
            </div>
            <input
              id={devBuyId}
              name="dev-buy"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              placeholder="0"
              className={`${FIELD} mono min-h-[44px]`}
              value={devBuyText}
              onChange={(event) =>
                dispatch({ type: "set-dev-buy", value: sanitizeAmountText(event.target.value) })
              }
              onBlur={() => dispatch({ type: "blur", field: "devBuy" })}
              aria-invalid={devBuyShown}
              aria-describedby={devBuyShown ? devBuyNoteId : undefined}
            />
            <p className="text-small text-pp-text-muted">
              The first buy on this market, made by create() itself. Leave it empty to buy
              nothing.
            </p>
            {devBuyShown && (
              <p id={devBuyNoteId} className="text-small text-pp-down">
                {devBuyReason}
              </p>
            )}
            {/* A pending cap needs no skeleton: what is missing is a sentence,
                not a figure on screen. A failed one says why, because without it
                the amount is unjudged. */}
            {maxDevBuy.isError && (
              <ReadFailure error={maxDevBuy.error} onRetry={maxDevBuy.refetch} />
            )}
          </div>

          {preview !== null && devBuyQuote !== null && (
            <dl className="flex flex-col gap-2">
              <Row label="Tokens received">{formatTokenAmount(devBuyQuote.tokensOut)}</Row>
              <Row label="Share of supply">
                {formatPercent((devBuyQuote.tokensOut * BPS_DENOM) / preview.S)}
              </Row>
              <Row label="Fee">{formatUsdc6(devBuyQuote.fee6)}</Row>
            </dl>
          )}

          <p className="text-small text-pp-text-muted">
            The buy runs through the factory inside the anti-snipe window, so a live window
            does not block it.
          </p>
        </div>
      </Panel>

      <Panel as="section" title="Anti snipe" className="max-w-[560px]">
        <div className="flex flex-col gap-4">
          <label className="pp-press flex min-h-[44px] items-center gap-2 text-body text-pp-text">
            <input
              type="checkbox"
              checked={antiSnipeOn}
              onChange={(event) =>
                dispatch({ type: "set-anti-snipe", on: event.target.checked })
              }
              aria-describedby={antiSnipeNoteId}
              className="accent-pp-accent h-4 w-4"
            />
            Run an anti-snipe window
          </label>

          <fieldset disabled={!antiSnipeOn} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between gap-2">
                <label htmlFor={blocksId} className={LABEL}>
                  Window
                </label>
                <span className="text-small text-pp-text-muted">blocks</span>
              </div>
              <input
                id={blocksId}
                name="anti-snipe-blocks"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                placeholder={`1 to ${ANTI_SNIPE_MAX_BLOCKS}`}
                className={`${FIELD} ${FIELD_DISABLED} mono min-h-[44px]`}
                value={antiSnipe.blocksText}
                onChange={(event) =>
                  dispatch({
                    type: "set-anti-snipe-blocks",
                    // Whole blocks, so the point goes too: the model reads this
                    // field with a digits-only test and a stripped point would
                    // otherwise turn 1.5 into 15.
                    value: event.target.value.replace(/[^\d]/g, ""),
                  })
                }
                onBlur={() => dispatch({ type: "blur", field: "antiSnipe" })}
                aria-invalid={antiSnipeShown}
                aria-describedby={antiSnipeShown ? antiSnipeNoteId : undefined}
              />
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between gap-2">
                <label htmlFor={capId} className={LABEL}>
                  Per address cap
                </label>
                <span className="text-small text-pp-text-muted">USDC</span>
              </div>
              <input
                id={capId}
                name="anti-snipe-cap"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                placeholder="e.g. 100"
                className={`${FIELD} ${FIELD_DISABLED} mono min-h-[44px]`}
                value={antiSnipe.maxBuyText}
                onChange={(event) =>
                  dispatch({
                    type: "set-anti-snipe-max-buy",
                    value: sanitizeAmountText(event.target.value),
                  })
                }
                onBlur={() => dispatch({ type: "blur", field: "antiSnipe" })}
                aria-invalid={antiSnipeShown}
                aria-describedby={antiSnipeShown ? antiSnipeNoteId : undefined}
              />
            </div>
          </fieldset>

          {antiSnipeShown && (
            <p className="text-small text-pp-down">{antiSnipeReason}</p>
          )}

          <p id={antiSnipeNoteId} className="text-small text-pp-text-muted">
            The window slows bots down, it does not stop them. Buyers receive at their own
            address; the factory&apos;s own calls are exempt, so the dev buy above still
            runs. The length and the cap are set together or not at all.
          </p>
        </div>
      </Panel>

      <Panel as="section" title="Creator earnings" className="max-w-[560px]">
        <div className="flex flex-col gap-4">
          <p className="text-body text-pp-text">
            You earn {formatFeeBps(CREATOR_BPS)} of every trade.
          </p>
          <p className="text-small text-pp-text-muted">
            Fees are credited on each trade and pulled with claim, never pushed. One balance
            per address, across every market this account created.
          </p>

          <div className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-2">
              <label htmlFor={dailyId} className={LABEL}>
                Daily volume
              </label>
              <span className="text-small text-pp-text-muted">USDC</span>
            </div>
            <input
              id={dailyId}
              name="daily-volume"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              placeholder="e.g. 500"
              className={`${FIELD} mono min-h-[44px]`}
              value={dailyText}
              onChange={(event) => setDailyText(sanitizeAmountText(event.target.value))}
            />
            {daily6 !== null && (
              <p className="text-small text-pp-text-muted">
                At that volume: {formatUsdc6(creatorEarned6(daily6))} USDC a day.
              </p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-2">
              <label htmlFor={monthlyId} className={LABEL}>
                Monthly volume
              </label>
              <span className="text-small text-pp-text-muted">USDC</span>
            </div>
            <input
              id={monthlyId}
              name="monthly-volume"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              placeholder="e.g. 15000"
              className={`${FIELD} mono min-h-[44px]`}
              value={monthlyText}
              onChange={(event) => setMonthlyText(sanitizeAmountText(event.target.value))}
            />
            {monthly6 !== null && (
              <p className="text-small text-pp-text-muted">
                At that volume: {formatUsdc6(creatorEarned6(monthly6))} USDC a month.
              </p>
            )}
          </div>

          <p className="text-small text-pp-text-muted">
            Both volumes are a calculator. Neither is sent with create().
          </p>
        </div>
      </Panel>
    </>
  );
}

// Split out so the figures and the route are written against a preview that
// exists, rather than against a null check repeated down the panel.
function DerivedFigures({ preview }: { preview: EconomicsPreview }) {
  const d = preview.derived;

  // Keyed on the four values the route is a function of and not on the struct
  // around them: derivedPreview builds a fresh object on every render, while
  // these are bigints and compare by value, so a keystroke in the dev-buy field
  // below leaves the path alone.
  const plot = useMemo(() => {
    const frame = frameOf(d);
    return { frame, ...routePaths(d, frame) };
  }, [d.Ts, d.x0, d.y0, d.y1]);

  // The Summit end, from the invariant: y1 as derived, with the reserve MATH [3]
  // puts beside it. The same pair the frame's top edge is drawn from.
  const summitX = reserveAt(d, d.y1);
  const rounding = reff6Sentence(d.Reff6, preview.R6);

  const label = `Price against tokens sold, from ${formatPriceX18(plot.frame.low)} to ${formatPriceX18(plot.frame.high)} USDC per token across the ${formatTokenAmount(plot.frame.Ts)} tokens the ascent sells`;

  return (
    <div className="flex flex-col gap-4">
      <dl className="flex flex-col gap-2">
        <Row label="Ts">{formatTokenAmount(d.Ts)}</Row>
        <Row label="Tl">{formatTokenAmount(d.Tl)}</Row>
        <Row label="y0">{formatTokenAmount(d.y0)}</Row>
        {/* MATH 0: x0 and Reff6 are USDC in 6-decimal units, and the four token
            figures around them are wei. */}
        <Row label="x0">{formatUsdc6(d.x0)}</Row>
        <Row label="y1">{formatTokenAmount(d.y1)}</Row>
        <Row label="Reff6">{formatUsdc6(d.Reff6)}</Row>
        <Row label="p0">{formatPriceX18(priceX18(d.x0, d.y0))}</Row>
        <Row label="p1">{formatPriceX18(priceX18(summitX, d.y1))}</Row>
        <Row label="Start market cap">{formatMarketCap(marketCap6(d.x0, d.y0, preview.S))}</Row>
        <Row label="Summit market cap">
          {formatMarketCap(marketCap6(summitX, d.y1, preview.S))}
        </Row>
        <Row label="Multiple">{formatMultiple(preview.rX18)}</Row>
      </dl>

      {rounding !== null && <p className="text-small text-pp-text-muted">{rounding}</p>}

      <div className="flex flex-col gap-3">
        <div className="relative w-full" style={{ height: CHART_HEIGHT }}>
          <svg
            role="img"
            aria-label={label}
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="absolute inset-0 h-full w-full"
          >
            {/* Depth from a surface step and a hairline, which is where DESIGN.md takes it
                from. No shadow, no gradient. */}
            <path d={plot.area} className="fill-pp-surface-2" />
            {/* The Summit is the right edge, because the route ends where ASCENT does. Solid
                rather than dashed: a dash pattern stretches with a viewBox this one does,
                and non-scaling-stroke holds the width without holding the gaps. */}
            <Rule x1={100} y1={0} x2={100} y2={100} tone="stroke-pp-accent" width={2} />
            <path
              d={plot.line}
              fill="none"
              strokeWidth={2}
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
              className="stroke-pp-text"
            />
          </svg>
        </div>
        {/* Both axes named once, so the figure below can be a bare price. */}
        <p className="text-small text-pp-text-muted">
          Price in USDC per token, against tokens sold. The route ends at the Summit.
        </p>
        <Legend tone="bg-pp-accent" label="Summit">
          {formatPriceX18(plot.frame.high)}
        </Legend>
      </div>
    </div>
  );
}
