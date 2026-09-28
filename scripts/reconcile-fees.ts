// Fee reconciliation against the live Arc Testnet deployment. Read-only: it
// makes no transaction and never signs.
//
// Run:  tsx scripts/reconcile-fees.ts
//
// The host list comes from the frozen chain object, so this script reaches for
// the same hosts the app does and no URL is restated here. ARC_RPC_URL narrows
// it to one host when a network blocks the others. Reachability varies by
// egress address, not by deployment: some networks are answered with a
// Cloudflare refusal and some mirrors prune history older than the deployment.
//
// Two reconciliations, kept separate by design. A single global equality check
// would let a creator shortfall hide behind a protocol surplus:
//
//   internal solvency (strict):
//     vault native balance == (sum of every FeeVault balance) * 1e12 + dustWei
//   attribution, creator side only:
//     sum of creator-reason credits == sum over trades of floor(fee6*creatorBps/feeBps)
//     and creatorFee6 + protocolFee6 == fee6 on every trade
//   MATH T5, per market:
//     sum Trade.fee6 == sum of that curve's FeeVault credits - sum DustSwept.credited6
//
// FeeVault.dustWei is the uint256 vault accumulator. It is not the per-curve
// uint96 dustWei, which a market sweeps into the vault with DustSwept.

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  fallback,
  http,
  type Abi,
  type AbiEvent,
  type Address,
  type Log,
} from "viem";
import { arcTestnet } from "@peakpump/shared/chain";
import { CurveAbi, FeeVaultAbi, PeakpumpFactoryAbi } from "@peakpump/contracts-abi";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");

const RPC_URLS = process.env.ARC_RPC_URL
  ? [process.env.ARC_RPC_URL]
  : arcTestnet.rpcUrls.default.http;

// eth_getLogs range caps differ by host and by plan, and the failure arrives as
// a JSON-RPC error inside an HTTP 200 body rather than as a status code: the Arc
// network itself answers -32012 above 20,000 blocks, a mirror may cap a free
// plan far lower, and a pruned node answers 4444 for anything older than its
// window. No single constant is right wherever this script is run, so a rejected
// range is halved and retried down to a floor, and a cap that cannot be honoured
// at all is reported rather than silently truncated.
const CHUNK_START = 20_000;
const CHUNK_FLOOR = 256;

type Deployment = {
  contracts: { PeakpumpFactory: Address; FeeVault: Address };
  startBlock: number;
};

const deployment = JSON.parse(
  readFileSync(resolve(REPO, "contracts/deployments/arc-testnet.json"), "utf8"),
) as Deployment;

const FACTORY = deployment.contracts.PeakpumpFactory;
const VAULT = deployment.contracts.FeeVault;
const FROM = deployment.startBlock;

const client = createPublicClient({
  chain: arcTestnet,
  transport: fallback(RPC_URLS.map((url) => http(url))),
});

// eth_getLogs must be filtered on the emitter, never on a topic alone: the
// EIP-7708 system emitter fires Transfer for every native USDC movement on the
// chain, and the ERC-20 USDC contract emits its own 6-decimal Transfer on top.
function eventOf(abi: Abi, name: string): AbiEvent {
  const found = abi.find((i) => i.type === "event" && i.name === name);
  if (!found) throw new Error(`the ${name} event is absent from the generated ABI`);
  return found as AbiEvent;
}

async function logs(
  address: Address,
  event: AbiEvent,
  from: number,
  to: number,
): Promise<Log<bigint, number, false, AbiEvent>[]> {
  const out: Log<bigint, number, false, AbiEvent>[] = [];
  let chunk = CHUNK_START;
  let start = from;
  while (start <= to) {
    let end = Math.min(start + chunk - 1, to);
    for (;;) {
      try {
        const batch = await client.getLogs({
          address,
          event,
          fromBlock: BigInt(start),
          toBlock: BigInt(end),
        });
        out.push(...batch);
        break;
      } catch (err) {
        if (chunk > CHUNK_FLOOR && isRangeError(err)) {
          // This host's cap is lower than the chunk in use. Halving keeps the
          // scan complete; the next range starts from where this one succeeded.
          chunk = Math.max(CHUNK_FLOOR, chunk >> 1);
          end = Math.min(start + chunk - 1, to);
          continue;
        }
        throw err;
      }
    }
    start = end + 1;
  }
  return out;
}

// -32012 is the range-too-large code Arc documents; drpc phrases the same limit
// as a plan message. Both are reasons to retry smaller, not to abort.
function isRangeError(err: unknown): boolean {
  const text = err instanceof Error ? `${err.message} ${String((err as { details?: string }).details ?? "")}` : String(err);
  return /-32012|range/i.test(text);
}

interface Market {
  curve: Address;
  creator: Address;
  treasury: Address;
  feeBps: bigint;
  creatorBps: bigint;
  startBlock: bigint;
}

async function main() {
  const head = await client.getBlockNumber();

  // Named up front: a mirror that prunes answers every recent read and only
  // fails on the deployment window, so the gap between head and the deployment
  // block is the thing to report, not a later -4444 on the first log scan.
  const gap = head - BigInt(FROM);
  console.log(`chain head ${head}   deployment block ${FROM}   ${gap} blocks of history`);
  if (head < BigInt(FROM)) {
    console.error("the node's head is behind the deployment block; the RPC is pointing at the wrong chain");
    process.exitCode = 2;
    return;
  }

  // Confirm the deployment window is actually servable before scanning. A pruned
  // node reports the same history as absent, and the scan would otherwise fail
  // on the first range having already emitted nothing.
  try {
    await client.getLogs({
      address: FACTORY,
      event: eventOf(PeakpumpFactoryAbi, "MarketCreated"),
      fromBlock: BigInt(FROM),
      toBlock: BigInt(Math.min(FROM + CHUNK_FLOOR - 1, Number(head))),
    });
  } catch (err) {
    console.error("the reachable node cannot serve logs from the deployment block.");
    console.error(String(err));
    console.error(
      "\nThis is an egress or pruning limitation of the RPC, not a discrepancy in the\n" +
        "deployment. Run this script from a network that reaches an archival host:\n\n" +
        "  ARC_RPC_URL=https://rpc.testnet.arc.io tsx scripts/reconcile-fees.ts\n\n" +
        "The fee split is UNVERIFIED until a run prints its two reconciliations.",
    );
    process.exitCode = 2;
    return;
  }

  const created = await logs(FACTORY, eventOf(PeakpumpFactoryAbi, "MarketCreated"), FROM, Number(head));
  console.log(`markets discovered: ${created.length}   head ${head}   from ${FROM}`);

  const markets: Market[] = [];
  for (const log of created) {
    const args = log.args as { curve: Address; creator: Address };
    // Read from storage: these are the values the contract actually applied when
    // it split each fee, and the market's own pair is the only one that applies.
    const [feeBps, creatorBps, treasury] = await Promise.all([
      client.readContract({ address: args.curve, abi: CurveAbi, functionName: "feeBps" }),
      client.readContract({ address: args.curve, abi: CurveAbi, functionName: "creatorBps" }),
      client.readContract({ address: args.curve, abi: CurveAbi, functionName: "treasury" }),
    ]);
    markets.push({
      curve: args.curve,
      creator: args.creator,
      treasury: treasury as Address,
      // BigInt rather than a cast: the generated ABIs are not "as const", so viem
      // narrows these returns to number, and either a number or a bigint is
      // accepted here without lying about the type.
      feeBps: BigInt(feeBps),
      creatorBps: BigInt(creatorBps),
      startBlock: BigInt(log.blockNumber ?? 0n),
    });
  }

  // The vault ledger, replayed from its own events. Both credit paths are here:
  // creditPair emits Credited, and a bare native transfer through receive() emits
  // Credited for the whole units and DustCredited when the sub-1e12 remainder
  // accumulates into a claimable unit. Claimed subtracts.
  const [credited, dustCredited, claimed] = await Promise.all([
    logs(VAULT, eventOf(FeeVaultAbi, "Credited"), FROM, Number(head)),
    logs(VAULT, eventOf(FeeVaultAbi, "DustCredited"), FROM, Number(head)),
    logs(VAULT, eventOf(FeeVaultAbi, "Claimed"), FROM, Number(head)),
  ]);

  const balances: Map<Address, bigint> = new Map();
  const creditByTx: Map<string, { to: Address; amount6: bigint; reason: bigint }[]> = new Map();
  for (const log of credited) {
    const a = log.args as { to: Address; amount6: bigint; reason: bigint };
    balances.set(a.to, (balances.get(a.to) ?? 0n) + a.amount6);
    const key = (log.transactionHash as string) ?? "0x";
    if (!creditByTx.has(key)) creditByTx.set(key, []);
    creditByTx.get(key)!.push({ to: a.to, amount6: a.amount6, reason: a.reason });
  }
  // DustCredited accrues to the treasury: _creditNative rolls the accumulated
  // sub-1e12 remainders into a claimable unit on that address, not the sender's.
  const vaultTreasury = (await client.readContract({
    address: VAULT, abi: FeeVaultAbi, functionName: "treasury",
  })) as Address;
  for (const log of dustCredited) {
    const a = log.args as { amount6: bigint };
    balances.set(vaultTreasury, (balances.get(vaultTreasury) ?? 0n) + a.amount6);
  }
  for (const log of claimed) {
    const a = log.args as { to: Address; amount6: bigint };
    balances.set(a.to, (balances.get(a.to) ?? 0n) - a.amount6);
  }

  const dustWei = (await client.readContract({
    address: VAULT, abi: FeeVaultAbi, functionName: "dustWei",
  })) as bigint;
  const vaultBalance = await client.getBalance({ address: VAULT });

  // ---- internal solvency, strict ----
  let sumBalances = 0n;
  for (const v of balances.values()) sumBalances += v < 0n ? 0n : v;
  const held = sumBalances * 1_000_000_000_000n + dustWei;
  console.log("\n--- internal solvency ---");
  console.log(`  vault native balance   ${vaultBalance}`);
  console.log(`  sum balances * 1e12    ${sumBalances * 1_000_000_000_000n}`);
  console.log(`  vault dustWei          ${dustWei}`);
  console.log(`  computed held          ${held}`);
  console.log(held === vaultBalance ? "  PASS" : "  DRIFT — blocks the deploy");

  // ---- attribution + MATH T5, per market ----
  console.log("\n--- attribution + MATH T5, per market ---");
  let anyDrift = false;
  for (const m of markets) {
    const [trades, swept] = await Promise.all([
      logs(m.curve, eventOf(CurveAbi, "Trade"), Number(m.startBlock), Number(head)),
      logs(m.curve, eventOf(CurveAbi, "DustSwept"), Number(m.startBlock), Number(head)),
    ]);

    let sumFee6 = 0n;
    let sumCreatorExpected = 0n;
    let splitOk = true;
    for (const log of trades) {
      const a = log.args as { fee6: bigint };
      sumFee6 += a.fee6;
      // splitFee, replicated exactly: one ceil on the total, floor on the creator
      // share, the protocol side by subtraction. Two independent ceils is a bug.
      // The contract returns (0, 0) before any division when feeBps is 0, and so
      // does this — dividing by zero here would report a rounding bug that does
      // not exist.
      const creatorFee6 = m.feeBps === 0n ? 0n : (a.fee6 * m.creatorBps) / m.feeBps;
      const protocolFee6 = a.fee6 - creatorFee6;
      sumCreatorExpected += creatorFee6;
      if (creatorFee6 + protocolFee6 !== a.fee6) splitOk = false;
    }

    // A curve's credits are the Credited events in the same transactions as its
    // trades: creditPair is called inside buy and sell, so the tx hash identifies
    // the market. The sweep credit goes to the treasury and is counted here, not
    // against a trade.
    let actualCreator = 0n;
    let actualProtocol = 0n;
    for (const log of trades) {
      for (const c of creditByTx.get((log.transactionHash as string) ?? "0x") ?? []) {
        if (c.to === m.creator) actualCreator += c.amount6;
        if (c.to === m.treasury) actualProtocol += c.amount6;
      }
    }
    const sweptCredited6 = swept.reduce(
      (acc, log) => acc + (log.args as { credited6: bigint }).credited6,
      0n);
    // DustSwept credits land on the treasury in the same tx as the sweep.
    for (const log of swept) {
      for (const c of creditByTx.get((log.transactionHash as string) ?? "0x") ?? []) {
        if (c.to === m.treasury) actualProtocol += c.amount6;
      }
    }

    const expectedTotal = sumFee6 + sweptCredited6;
    const actualTotal = actualCreator + actualProtocol;
    const creatorDrift = actualCreator - sumCreatorExpected;
    const t5Drift = actualTotal - expectedTotal;

    if (creatorDrift !== 0n || t5Drift !== 0n || !splitOk) anyDrift = true;
    console.log(
      `  ${m.curve}` +
        `\n    trades ${trades.length}   fee6 ${sumFee6}   swept6 ${sweptCredited6}` +
        `\n    creator expected ${sumCreatorExpected}  actual ${actualCreator}  drift ${creatorDrift}` +
        `\n    T5 actual ${actualTotal}  expected ${expectedTotal}  drift ${t5Drift}` +
        `\n    split sums to fee6: ${splitOk}`,
    );
  }

  console.log("\n--- verdict ---");
  if (anyDrift || held !== vaultBalance) {
    console.log("DRIFT — a rounding bug, the deploy is blocked");
    process.exitCode = 1;
  } else {
    console.log("no drift");
  }
}

main().catch((err) => {
  // A range cap or a blocked egress is a reportable state, not a crash to hide.
  console.error("reconciliation could not complete:");
  console.error(err);
  process.exitCode = 2;
});
