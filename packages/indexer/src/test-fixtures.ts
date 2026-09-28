import type { Address } from "envio";
import { FACTORY, FEE_VAULT } from "./deployment";

// Fixed parties and markets for the simulate fixtures. The uniform-hex
// addresses are their own EIP-55 checksums; the mixed-case one is a viem
// checksum. None of them collides with the two real deployed addresses.
export const ZERO: Address = "0x0000000000000000000000000000000000000000";
export const CREATOR: Address = "0x1111111111111111111111111111111111111111";
export const TRADER_A: Address = "0x2222222222222222222222222222222222222222";
export const TRADER_B: Address = "0x3333333333333333333333333333333333333333";
export const TRADER_C: Address = "0x4444444444444444444444444444444444444444";
export const CURVE: Address = "0x5555555555555555555555555555555555555555";
export const TOKEN: Address = "0x6666666666666666666666666666666666666666";
export const CURVE_2: Address = "0x7777777777777777777777777777777777777777";
export const TOKEN_2: Address = "0x8888888888888888888888888888888888888888";
export const TREASURY: Address = "0x9999999999999999999999999999999999999999";
export const BYSTANDER: Address = "0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa";

// Simulate blocks start at the configured start_block: the runner may filter
// anything below it, and the real indexer never sees earlier blocks either.
export const BLOCK = 59_806_903;
export const TS = 1_771_000_000;

// Where and when a simulate item lands. Events of one transaction share the
// hash; the join tests depend on that.
export interface Meta {
  block: number;
  timestamp: number;
  logIndex: number;
  hash: string;
}

function env(m: Meta, srcAddress: Address) {
  return {
    srcAddress,
    logIndex: m.logIndex,
    block: { number: m.block, timestamp: m.timestamp },
  };
}

// Only Trade, TradeDetail and Credited select the transaction hash in
// config.yaml (it is the join key), so only their fixtures may carry one; the
// generated types reject a hash on every other event.
function envWithTx(m: Meta, srcAddress: Address) {
  return { ...env(m, srcAddress), transaction: { hash: m.hash } };
}

export function mintTransfer(m: Meta, to: Address, value: bigint, token: Address = TOKEN) {
  return {
    contract: "PeakToken" as const,
    event: "Transfer" as const,
    ...env(m, token),
    params: { from: ZERO, to, value },
  };
}

export function transfer(
  m: Meta,
  from: Address,
  to: Address,
  value: bigint,
  token: Address = TOKEN,
) {
  return {
    contract: "PeakToken" as const,
    event: "Transfer" as const,
    ...env(m, token),
    params: { from, to, value },
  };
}

export function credited(m: Meta, p: { to: Address; amount6: bigint; reason: bigint }) {
  return {
    contract: "FeeVault" as const,
    event: "Credited" as const,
    ...envWithTx(m, FEE_VAULT),
    params: p,
  };
}

export function claimed(m: Meta, p: { to: Address; amount6: bigint }) {
  return {
    contract: "FeeVault" as const,
    event: "Claimed" as const,
    ...env(m, FEE_VAULT),
    params: p,
  };
}

export interface MarketCreatedOverrides {
  curve?: Address;
  token?: Address;
  creator?: Address;
  marketId?: bigint;
  y0?: bigint;
  tSupply6?: bigint;
  tSummit6?: bigint;
  antiSnipeEndBlock?: bigint;
  maxBuyPerAddress6?: bigint;
  feeBpsTotal?: bigint;
  feeBpsCreator?: bigint;
  feeBpsProtocol?: bigint;
  creationFee6?: bigint;
}

export function marketCreated(m: Meta, o: MarketCreatedOverrides = {}) {
  return {
    contract: "PeakpumpFactory" as const,
    event: "MarketCreated" as const,
    ...env(m, FACTORY),
    params: {
      curve: o.curve ?? CURVE,
      token: o.token ?? TOKEN,
      creator: o.creator ?? CREATOR,
      marketId: o.marketId ?? 1n,
      y0: o.y0 ?? 1_000_000n,
      // S and Ts in token wei, under the event's own misnomer field names.
      tSupply6: o.tSupply6 ?? 1_500_000n,
      tSummit6: o.tSummit6 ?? 600_000n,
      antiSnipeEndBlock: o.antiSnipeEndBlock ?? BigInt(BLOCK + 10),
      maxBuyPerAddress6: o.maxBuyPerAddress6 ?? 50_000n,
      feeBpsTotal: o.feeBpsTotal ?? 125n,
      feeBpsCreator: o.feeBpsCreator ?? 30n,
      feeBpsProtocol: o.feeBpsProtocol ?? 95n,
      creationFee6: o.creationFee6 ?? 1_000_000n,
    },
  };
}

export function marketMetadata(
  m: Meta,
  o: { curve?: Address; name?: string; symbol?: string; metadataURI?: string } = {},
) {
  return {
    contract: "PeakpumpFactory" as const,
    event: "MarketMetadata" as const,
    ...env(m, FACTORY),
    params: {
      curve: o.curve ?? CURVE,
      name: o.name ?? "Test Token",
      symbol: o.symbol ?? "TST",
      metadataURI: o.metadataURI ?? "ipfs://bafytest",
    },
  };
}

export interface TradeParams {
  curve?: Address;
  trader?: Address;
  isBuy: boolean;
  usdcIn6?: bigint;
  usdcOut6?: bigint;
  tokenIn?: bigint;
  tokenOut?: bigint;
  fee6?: bigint;
  tReserve6After?: bigint;
  supplySold6After?: bigint;
  phaseAfter?: bigint;
}

export function trade(m: Meta, p: TradeParams) {
  return {
    contract: "Curve" as const,
    event: "Trade" as const,
    ...envWithTx(m, p.curve ?? CURVE),
    params: {
      curve: p.curve ?? CURVE,
      trader: p.trader ?? TRADER_A,
      isBuy: p.isBuy,
      usdcIn6: p.usdcIn6 ?? 0n,
      usdcOut6: p.usdcOut6 ?? 0n,
      tokenIn: p.tokenIn ?? 0n,
      tokenOut: p.tokenOut ?? 0n,
      fee6: p.fee6 ?? 0n,
      tReserve6After: p.tReserve6After ?? 0n,
      supplySold6After: p.supplySold6After ?? 0n,
      phaseAfter: p.phaseAfter ?? 0n,
    },
  };
}

export function tradeDetail(
  m: Meta,
  p: {
    trader?: Address;
    to?: Address;
    spend6?: bigint;
    poolDelta6?: bigint;
    crossed?: boolean;
    stateAfter?: bigint;
  } = {},
) {
  return {
    contract: "Curve" as const,
    event: "TradeDetail" as const,
    ...envWithTx(m, CURVE),
    params: {
      trader: p.trader ?? TRADER_A,
      to: p.to ?? TRADER_A,
      spend6: p.spend6 ?? 0n,
      poolDelta6: p.poolDelta6 ?? 0n,
      crossed: p.crossed ?? false,
      stateAfter: p.stateAfter ?? 0n,
    },
  };
}

export function summit(
  m: Meta,
  p: { curve?: Address; raised6?: bigint; y?: bigint; priceX18?: bigint } = {},
) {
  return {
    contract: "Curve" as const,
    event: "Summit" as const,
    ...env(m, p.curve ?? CURVE),
    params: {
      raised6: p.raised6 ?? 0n,
      y: p.y ?? 0n,
      priceX18: p.priceX18 ?? 0n,
    },
  };
}
