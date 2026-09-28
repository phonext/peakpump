# SPEC.md — the only behavioural authority in this repository

If code and this file disagree, this file wins, and you stop and tell me.
This file defers to docs/MATH.md for every formula and number (quoted by
section, never re-derived), to the Arc network documentation for every chain
fact, and to docs/DESIGN.md for every visual token. Where a required decision
exists in none of those, this file records it as an OPEN question rather than
inventing it.

Requirement style: MUST / MUST NOT statements are the testable surface. A line
that names a MATH section (for example "MATH 6.2") is a pointer to the
authority, not a re-derivation.

## 1 Overview, scope, and what this project explicitly is not

- peakpump is a single-chain bonding-curve token launch platform on the Arc
  network testnet (chain id 5042002, RPC https://rpc.testnet.arc.io). It has no
  relation to any earlier project.
- Each market is a constant-product curve with a virtual USDC offset that runs
  two phases, ASCENT then PEAK, joined at the Summit (MATH 1). Value is priced
  entirely on chain; there is no off-chain price.
- MUST NOT contain, anywhere in the repository: a Uniswap integration, an
  automated-market-maker pair, an LP token, a router, an external DEX, an
  `openAt`, or an `opener` (MATH 1). "Pair" here means an AMM
  liquidity pair and nothing else: FeeVault's required `creditPair` (5.4) is a
  pull-payment ledger entry in one storage write, is not an AMM construct, and
  is outside this bullet. The curve is live from initialize; there is no
  separate opening step.
- MUST NOT forward an RPC call or quote a trade server side; no `/api/rpc` style
  proxy route may exist ("Proxies" is a Vercel fair-use violation and the
  browser talks to the RPC directly).
- Scope is testnet with faucet USDC. On the Arc network, native USDC and the
  6-decimal ERC-20 view at 0x3600...0000 are one asset, not two (MATH 0);
  every USDC amount in this system is either 18-decimal `msg.value`
  or its 6-decimal view, related only by `usdcIn6 = msg.value / 1e12`.
- This SPEC covers the Arc Testnet deployment only (chain id 5042002, faucet
  USDC). Mainnet deployment, real-USDC fees, fiat, token listing, and any audit
  claim are out of scope; every fee number in this repository is a testnet
  number and no UI copy may imply real value. A mainnet deployment is a separate
  future SPEC that begins with an independent security review.

## 2 Vocabulary: Ascent, Peak, Summit, Basecamp/Ridge/Alpine

- Phase one is ASCENT. Phase two is PEAK. The transition is the Summit and its
  function is `_summit()` (MATH 1, MATH 7).
- The three presets are Basecamp, Ridge and Alpine. They share one curve shape
  (S = 1e27, r = 4e18) and differ only in the raise R6 (MATH 10).
- One word per concept, no synonyms. The words kindling, blazing, flashpoint,
  ember, blaze, inferno, bondfire and BondToken MUST NOT appear in shipped copy
  — the strings a reader sees in apps/web/{app,components,lib} and
  packages/ui/src. The ban is a copy rule on this project's own
  strings: it does not reach the declarations that state it, the test fixture
  that asserts it, or a user's token name or symbol. No path,
  script, comment or document may refer to a directory under /mnt/c or to any
  earlier project folder.
- The contracts are named exactly PeakpumpFactory, PeakToken, Curve, FeeVault
  (section 5).

## 3 Actors: creator, trader, admin, treasury, indexer — powers and limits

- creator: the address that calls `PeakpumpFactory.create()`. MAY perform one
  optional dev-buy in the same transaction, capped at Ts/20 (MATH 10 supply).
  Is credited the creator share of every fee on its market
  (creatorBps of feeBps, MATH 6) and pulls it from FeeVault with `claim()`. Has
  no power over the curve after creation: cannot pause, re-price, or withdraw
  reserves.
- trader: any address. MAY `buy` and `sell` subject to the minimum-trade and
  anti-snipe rules (MATH 11, section 5.3). Has no privileged power.
- admin: the factory owner. Has exactly three setters plus `lock()` and nothing
  more (section 4). MUST NOT be able to touch a live curve's reserves, fee
  rate, or state.
- treasury: the address that receives the protocol share of fees, set by
  `setTreasury` (section 4.3). It is a payout destination only and holds no
  contract role.
- indexer: read-only off-chain service. Owns history and lists only; it is
  never authoritative for any tradeable number (section 6.1). MUST NOT be in
  the path of a buy, sell, or quote.

## 4 Admin powers — exactly three, plus lock()

- The factory exposes exactly three setters and `lock()`. MUST NOT expose any
  further mutating admin function. Each setter MUST revert after `lock()`.
- Each setter MUST be restricted to the owner and MUST emit an event recording
  the old and new value.

### 4.1 setDefaultFees(feeBps, creatorBps, protocolBps) — future markets only

- MUST set only the defaults copied into curves created afterwards. MUST NOT
  alter any already-deployed curve (fees are stored per curve at initialize,
  MATH 4 slot E, and are flat for that curve's life, MATH 6).
- MUST enforce the MATH 6 caps: `feeBps <= 200` and
  `creatorBps + protocolBps == feeBps`. A call violating either MUST revert
  with a named error.
- The shipped defaults are feeBps 125, creatorBps 30, protocolBps 95, lpBps 0
  (MATH 6). lpBps is not built and is not a parameter.

### 4.2 setCreationFee(fee6) — capped at 5 USDC

- MUST store a creation fee in 6-decimal USDC units charged on `create()`.
- MUST reject any `fee6 > 5_000_000` (5 USDC) with a named error.
- `fee6 == 0` MUST be legal and MUST mean create() charges no creation fee.
- A non-zero creation fee MUST be credited inside FeeVault to the protocol
  accrual balance, pull-only in the same way trade fees are, in the same
  transaction that creates the market. It MUST NOT be forwarded to an address
  during creation and MUST NOT be sent with a raw call. The testnet deployed
  value of creationFee6 is 0, but the credit path MUST be implemented and tested
  with a non-zero value so a later change is a parameter change, not a code
  change.

### 4.3 setTreasury(address)

- MUST update the protocol fee destination for future credits.
- MUST reject the zero address (a value transfer to 0x0 reverts on this chain
  with "Zero address not allowed", so a zero treasury would brick every protocol
  payout). Conservative reading in absence of an explicit rule.
- Changing the treasury MUST affect future credits only and MUST NOT move a
  balance already credited. The protocol share MUST be credited into the same
  per-address pull ledger FeeVault uses for creator fees, keyed to the treasury
  address in effect at the instant of the credit, in the same transaction as the
  trade; there is no separate protocol accrual account, so no redirect of an
  already-recorded credit is expressible.
- A test MUST credit with treasury A, call `setTreasury(B)`, credit again, and
  prove A claims exactly the first amount and B exactly the second, and that
  neither can claim the other's.

### 4.4 lock() — one-shot, irreversible, kills every setter above forever

- MUST be callable once by the owner. A second call MUST revert.
- After `lock()`, setDefaultFees, setCreationFee and setTreasury MUST all
  revert permanently. There MUST be no unlock path.
- MUST emit a one-time event. `create()` and all trading MUST remain fully
  functional after lock — lock freezes governance, not the market.

## 5 Contracts

- Four contracts only: PeakpumpFactory, PeakToken, Curve, FeeVault. Curve and
  PeakToken are deployed as minimal-proxy clones of upgradeable implementations.
- Every implementation MUST call `_disableInitializers()` in its constructor,
  and every `initialize` MUST carry the `initializer` modifier.
- Every uint128 / uint120 / uint96 / uint48 storage write MUST go through
  SafeCast; a bare cast is banned (MATH 4). Every product of two
  packed storage fields MUST be computed in uint256 (MATH 8).
- Every write path MUST set gas per MATH 12:
  `maxFeePerGas = min(max(20 gwei, suggested*2), 20_001 gwei)`,
  `maxPriorityFeePerGas = 1 gwei`. This is a client-side requirement on the
  transaction builder, not on-chain code.

### 5.1 PeakpumpFactory

- `create()` MUST validate parameters against MATH 3 bounds, each with its own
  named error: `1e24 <= S <= 1e30`, `1e9 <= R6 <= 1e13`, `2e18 <= r <= 20e18`,
  and the derived positivity checks (y0 > Ts, S > Ts, x0 > 0, y1 > 0). MUST NOT
  re-derive any deriveParams formula; it computes Ts, Tl, y0, x0, y1, Reff6 by
  the exact rounding directions of MATH 3.
- Clone-and-init order MUST be: deploy PeakToken clone, deploy Curve clone,
  initialize the Curve, initialize the PeakToken minting fixed supply S once to
  the Curve (MATH 4, 5.2), then `registerCurve` on the FeeVault BEFORE any
  dev-buy runs, then the optional dev-buy.
- The dev-buy cap is Ts/20, enforced as a post-hoc assert after the dev-buy
  executes, and exposed as a `maxDevBuy6` (or equivalent) view. A
  dev-buy MUST NOT be able to cross the Summit; no test covers that case
  because Ts/20 can never reach Ts.
- Factory anti-snipe exemption: inside the anti-snipe window the curve requires
  `to == msg.sender`, EXCEPT when `msg.sender` is the factory.
  Without this exemption every `create()` with `antiSnipeBlocks > 0` reverts.
  The dev-buy therefore runs through the factory and is exempt.
- `antiSnipeBlocks > 0` and `maxBuyPerAddress6 > 0` MUST be set together or
  neither; a mixed pair MUST revert with a named error (a zero cap
  with a live window bricks the market for the whole window).
- msg.value accounting: `usdcIn6 = msg.value / 1e12` (MATH 0). Any sub-1e12
  remainder MUST NOT be rounded up into a credited balance; it is
  refunded to the payer or credited as protocol dust with FLOOR and a `dustWei`
  accumulator (section 5.4). There is no msg.value divisibility check.
- name/symbol blocklist MUST be enforced at create() (section 6.5), including
  rejecting symbols beginning with ARC.
- Any residual USDC left in the factory after a create() (for example the
  creation fee, or an un-refunded remainder) MUST be swept to the FeeVault.
  The factory MUST NOT retain a USDC balance across calls.
- MUST emit a market-created event carrying at least the curve address, token
  address, creator, and the stored curve parameters. The canonical event is
  MarketCreated and its signature is frozen:

```solidity
  event MarketCreated(
    address indexed curve,        // topic1
    address indexed token,        // topic2
    address indexed creator,      // topic3
    uint256 marketId,             // sequential, starts at 1
    uint120 y0,
    uint120 tSupply6,
    uint120 tSummit6,
    uint48  antiSnipeEndBlock,
    uint120 maxBuyPerAddress6,
    uint16  feeBpsTotal,
    uint16  feeBpsCreator,
    uint16  feeBpsProtocol,
    uint120 creationFee6
  )
```

  Exactly three indexed topics, in the order curve, token, creator, because
  those are the three the frontend and the indexer filter on. The stored curve
  parameters are emitted as values, never re-derived by any consumer. Field
  order is frozen: appending a field is a breaking change that requires a new
  event name, never a reorder.

- Immediately after MarketCreated, in the same transaction and on every
  create, the factory MUST emit MarketMetadata:

```solidity
  event MarketMetadata(
    address indexed curve,
    string  name,
    string  symbol,
    string  metadataURI
  )
```

  name, symbol and metadataURI are in no frozen event and are stored nowhere
  on chain, so this event is the indexer's only source for them. Its field
  order is frozen on the same terms as MarketCreated.

### 5.2 PeakToken: ERC20Upgradeable clone, 18 decimals, fixed supply

- MUST be `ERC20Upgradeable`, 18 decimals, with the full fixed supply S minted
  exactly once to the Curve at initialize (MATH 4 slot C, MATH 10). No further
  mint path may exist.
- MUST expose `pullFrom` used by selling, guarded by `msg.sender == curve`.
  MUST NOT override `allowance()`; if you are about to write an
  allowance override, stop. Selling never uses ERC-20 approval.
- Implementation MUST call `_disableInitializers()` in its constructor and
  nothing beyond the above (no burn, no owner mint, no pause).

### 5.3 Curve

- Storage layout MUST be exactly MATH 4 slots A..K, in that order, starting at
  slot 0, with no storage gaps, and the Solidity declaration order MUST reproduce
  those slots. The "no added fields" wording this bullet previously carried is
  superseded: `factory`, `dustWei` and `deferred` are part of the
  layout, and nothing beyond A..K may be added without amending MATH 4 and
  appending a decision. `factory` MUST be declared immediately before `dustWei` so
  the two pack into the single 256-bit slot I, which is verified with `forge
  inspect`; `boughtInWindow6` is slot J and `deferred` is slot K, in that order,
  after slot I and not before it. `factory` is storage and not immutable, so each
  clone carries its own pointer and the layout stays clone-safe. `y` and `Tl` are
  in no slot.
- `initialize` MUST write the once-only constants (y0, S, Ts, y1) and assert
  `y1 == y0 - Ts` (MATH 3). It MUST assert y0 > Ts, S > Ts, x0 > 0, y1 > 0.
- `y()` MUST be computed, never stored: `y() = (state == ASCENT) ? y0 - sold : S - sold`
  (MATH 4). A stored y is a stop-and-ask violation.
- The trade entry points are exactly
  `buy(uint256 minTokensOut, uint256 deadline, address to) payable` and
  `sell(uint256 tokensIn, uint256 minUsdcOut6, uint256 deadline)`, with the
  parameters in that order, because `PeakpumpFactory.create` calls
  `buy{value: ...}(0, block.timestamp, creator)`. Both MUST require `block.timestamp <= deadline` and
  revert with `DeadlineExpired` otherwise; the comparison is `<=` and not `<`
  because Arc timestamps are non-decreasing rather than strictly increasing and
  two consecutive blocks may share one. minTokensOut and minUsdcOut6 bound
  price, deadline bounds time, and the two are not substitutes.
- `buy` MUST follow MATH 6.2: fee6 = ceil(usdcIn6*feeBps/1e4), net6 = usdcIn6 -
  fee6, tokensOut = floor(y*net6/(x+net6)), and only net6 enters the pool
  (x += net6). On the crossing path (MATH 6.4) tokensOut is ASSIGNED to
  `remaining` (= Ts - sold) and MUST NOT be recomputed from the curve; that
  branch exists only in ASCENT.
- After every buy the trigger MUST be unconditional:
  `if (state == ASCENT && sold == Ts) _summit();` (MATH 7). A buy
  that lands exactly on Ts through the ordinary path MUST reach it too.
- `sell` MUST follow MATH 6.3: gross6 = floor(x*tokensIn/(y+tokensIn)),
  fee6 = ceil(gross6*feeBps/1e4), usdcOut6 = gross6 - fee6, and gross6 (not
  usdcOut6) leaves the pool (x -= gross6).
- Fee split MUST be the single top-down form of MATH 6.1: one Ceil for fee6,
  floor for creatorFee6, protocolFee6 by subtraction. When fee6 == 0 the
  FeeVault call MUST be skipped entirely (MATH 6.1).
- Minimum trade (MATH 11): buy requires usdcIn6 >= 1000, net6 >= 1,
  tokensOut >= 1; sell requires tokensIn >= 1, usdcOut6 >= 1, and tokensIn <=
  sold in BOTH phases. Each is a named require.
- `quoteBuy` / `quoteSell` MUST NOT revert on an under-minimum or out-of-phase
  amount; they return a status code so the UI renders a sentence (MATH 11).
  quoteBuy MUST NOT enter the crossing branch in PEAK (MATH 6.4).
- `_summit` MUST perform exactly the four writes of MATH 7 (compute
  `real = x - x0` before zeroing x0; x = real; x0 = 0; raised6 = toUint120(real);
  state = PEAK) with zero value transfers and no y write. After it: the
  sold <= Ts cap is gone, fee rate unchanged, `progressBps()` returns 10000,
  `usdcRaised6()` returns the raised6 snapshot and never x (MATH 7).
- `_payout` MUST be the single outbound USDC path and MUST NOT revert the trade
  when a transfer fails: on the Arc network a transfer can revert for reasons
  unrelated to us. The transfer is attempted with a 100000 gas stipend; on failure
  the full wei amount, remainder included, is recorded in `deferred[recipient]`,
  `PayoutDeferred` is emitted, and the trade completes. A failed payout is never
  credited to the FeeVault, so the vault holds fees and nothing else (MATH 8).
- `withdrawDeferred()` MUST be `nonReentrant`, MUST zero the caller's entry before
  the external call, MUST revert with `NothingDeferred` on a zero entry, and MUST
  revert if the transfer fails so the amount stays claimable.
- `sweepDust` MUST be `nonReentrant` and permissionless. It MUST revert with
  `NothingToSweep` when `dustWei` is zero; otherwise it MUST read `dustWei` into a
  local, zero the storage field, credit floor(amount/1e12) to the treasury
  snapshotted at `initialize` through the FeeVault while sending
  exactly that wei amount, and emit `DustSwept(weiAmount, credited6)`. If
  floor(amount/1e12) is zero it MUST make no FeeVault call and MUST revert with
  the same `NothingToSweep`. It MUST move exactly `dustWei` and never a
  balance-derived amount, and MUST NOT touch the reserves backing y or sold
  (MATH 8).
- `address(this).balance` and `balanceOf` MUST NOT appear anywhere in Curve.sol at
  all, `sweepDust` included (MATH 8): a donation can then neither be swept nor
  influence any decision the contract makes.
- On-chain invariants MUST be asserted from storage reads only, never against a
  balance, in the order checks, effects, invariant asserts, interactions
  (MATH 8): A1 state==ASCENT => sold <= Ts; A2 x > 0 and y() > 0; A3
  state==ASCENT => x*y() >= x0*y0 (x0*y0 from the stored floored y0); A4 a
  non-crossing trade => k_after >= k_entry (A4 skipped on the crossing trade).
  MUST NOT compare any balance with `==` (MATH 8).
- Anti-snipe: while `block.number < antiSnipeEndBlock`, `to == msg.sender` is
  mandatory and per-address buys are capped by `maxBuyPerAddress6` tracked in
  `boughtInWindow6` (MATH 4). The factory is exempt from the entire
  anti-snipe block, both the `to == msg.sender` check and the cumulative
  per-address cap, and nothing else is exempt from either:
  a cap that bound the dev-buy would make `create()` revert whenever devBuy6
  exceeded `maxBuyPerAddress6`. Ordering MUST use block number, never
  `block.timestamp` (Arc timestamps are non-decreasing only).

### 5.4 FeeVault

- MUST expose `credit` (accrue a fee to an account), `registerCurve` (authorize
  a curve to credit, called by the factory before dev-buy per 5.1), `claim`
  (pull-only payout to the caller), and `dustWei` accounting.
- Fees MUST be credited only, never pushed; a recipient obtains value solely by
  calling `claim()`. `claim()` MUST use the same deferral fallback
  as any outbound transfer.
- `creditPair` MUST exist to record the creator and protocol shares of one fee
  in a single call while keeping them independently claimable, consistent with
  MATH 6.1 (creatorFee6 + protocolFee6 == fee6).
- `dustWei` MUST accumulate sub-1e12 remainders credited to the protocol with
  FLOOR. The vault MUST NOT ever credit more than it holds; a
  remainder is never rounded up into a balance.
- FeeVault MUST hold `mapping(address => bool) private isRegisteredCurve`,
  written only by the factory, only at creation, only to true, and never to
  false. `credit` and `creditPair` MUST revert unless
  `isRegisteredCurve[msg.sender]`. The factory address in FeeVault MUST be
  immutable, with no owner override, no pause, and no path to register a curve
  after creation. A test MUST prove that a hand-deployed Curve with identical
  bytecode cannot credit.

### 5.5 Full error and event catalogue, with the exact field list of Trade

- Every revert path named in this SPEC and in MATH (bounds in MATH 3, mixed
  anti-snipe pair, over-cap creation fee, minimum-trade guards in MATH 11,
  post-lock setters, non-registered crediting) MUST have its own distinct named
  custom error. A bare `require(false)` or a shared generic error is a defect.
- Every buy or sell that charges a non-zero fee MUST emit exactly one Trade
  event, and the fee amount it carries MUST reconcile with FeeVault credits per
  market: within one market taken in isolation, the sum of Trade fee6 equals that
  curve's FeeVault credits minus the sum of its DustSwept.credited6 (MATH T5).
  Platform-wide the form is the ledger identity, and a global equality between Trade
  fees and total FeeVault credits MUST NOT be asserted.
- The Trade event MUST carry at minimum: the market/curve identity, the trader,
  the side (buy or sell), the USDC leg (usdcIn6 or usdcOut6), the token leg
  (tokensOut or tokensIn), fee6, and the post-trade `sold` and `x` so the
  indexer can build candles and positions without an RPC round-trip (section
  6.3). Native USDC movement additionally emits the EIP-7708 system log; the
  indexer filters by emitter, not topic.
- The canonical Trade event is frozen:

```solidity
  event Trade(
    address indexed curve,        // topic1
    address indexed trader,       // topic2
    bool    indexed isBuy,        // topic3
    uint120 usdcIn6,
    uint120 usdcOut6,
    uint120 tokenIn,
    uint120 tokenOut,
    uint120 fee6,
    uint120 tReserve6After,
    uint120 supplySold6After,
    uint8   phaseAfter            // 0 = ASCENT, 1 = PEAK
  )
```

  fee6 is the single authoritative fee number and the UI displays this and
  nothing it computed itself. Both an in and an out field exist for each side and
  the unused one is zero, so no consumer has to branch on direction to read an
  amount. phaseAfter is emitted rather than inferred. Ordering for every consumer
  is (blockNumber, logIndex), always, with no exception and no fallback to
  timestamp. Field order is frozen on the same terms as MarketCreated.

- Anything a trade must report beyond those eleven fields goes into TradeDetail,
  and Trade gains nothing. TradeDetail MUST be emitted immediately
  after Trade in the same transaction, on every trade and not only on a crossing
  one, so no indexer ever has to branch on its absence:

```solidity
  event TradeDetail(
    address indexed trader,
    address indexed to,
    uint256 spend6,
    uint256 poolDelta6,
    bool    crossed,
    uint8   stateAfter
  )
```

  poolDelta6 is net6 on a buy and gross6 on a sell; spend6 is usdcIn6 - refund6
  on a buy and zero on a sell.
- The three remaining Curve events are:

```solidity
  event Summit(uint120 raised6, uint128 y, uint256 priceX18)
  event PayoutDeferred(address indexed recipient, uint256 weiAmount)
  event DustSwept(uint256 weiAmount, uint256 credited6)
```

  Summit is emitted by `_summit()` and the indexer reads raised6 from it, so
  removing it breaks the indexer; y and priceX18 spare the indexer a recomputation
  of the post-summit curve state. PayoutDeferred records a failed push
  and the wei amount added to `deferred[recipient]`; DustSwept records a sweep and
  is what separates a dust credit from a fee credit (section 5.3, MATH T5,
  section 6.2).
- The new paths need these named errors, each distinct: `DeadlineExpired` when
  `block.timestamp > deadline`, `WindowCapExceeded` when a buy inside the
  anti-snipe window would take `boughtInWindow6` past `maxBuyPerAddress6`,
  `RecipientNotSender` when `to != msg.sender` inside that window and the caller
  is not the factory, `NothingDeferred` on a `withdrawDeferred()` with a zero
  entry, and `NothingToSweep` on a `sweepDust` with nothing to credit.

### 5.6 Deployment order and the contents of deployments/arc-testnet.json

- Deployment order MUST be: FeeVault, then the PeakToken implementation, then
  the Curve implementation, then PeakpumpFactory wired to all three, then the
  admin `setDefaultFees` / `setCreationFee` / `setTreasury` calls, and finally
  `lock()` only when governance is intentionally frozen.
- No deploy, broadcast, migrate or push command is run by the tooling in this
  repository; each MUST be printed for the operator to run.
- `deployments/arc-testnet.json` MUST record chain id 5042002 and the deployed
  addresses of FeeVault, the PeakToken implementation, the Curve
  implementation, and PeakpumpFactory, plus the deployment block used as the
  indexer start block (index only from our own deployment block: the EIP-7708
  system log fires for every native USDC movement on the whole chain).
- The exact schema of `deployments/arc-testnet.json` is fixed as follows; the
  path, filename, and deployment-block requirement above are unchanged:

```json
  {
    "chainId": 5042002,
    "network": "arc-testnet",
    "deployedAt": "<ISO 8601 UTC>",
    "commit": "<full git sha of the deploying tree>",
    "solc": "0.8.28",
    "evmVersion": "cancun",
    "optimizerRuns": 200,
    "startBlock": <earliest of the four deployment blocks>,
    "contracts": {
      "PeakpumpFactory": "0x…",
      "FeeVault":        "0x…",
      "CurveImpl":       "0x…",
      "PeakTokenImpl":   "0x…"
    },
    "blocks": {
      "PeakpumpFactory": <deployment block>,
      "FeeVault":        <deployment block>,
      "CurveImpl":       <deployment block>,
      "PeakTokenImpl":   <deployment block>
    }
  }
```

- `startBlock` MUST be the block number of the earliest of the four deployments
  and is the value the indexer starts from; `contracts` holds the four addresses
  as checksummed strings and `blocks` holds the same four keys, each the block
  number of that deployment. Addresses MUST NOT be duplicated elsewhere and ABIs
  live only in `packages/contracts-abi`. The commit sha is the version, so there
  is no version tag field. The file MUST be committed, and a build MUST fail if a
  contract the code imports is missing from it.

## 6 Off-chain

### 6.1 The golden data rule

- Every tradeable number (price, quote, reserves, sold, progress, fee
  breakdown, balances used in a trade) MUST come from the RPC at read time
  (MATH [9], [10] evaluated on chain via views), never from the indexer.
- The indexer owns history and lists only (candles, recent trades, holder
  lists, leaderboards). A number the user could trade against MUST NOT be
  sourced from it. A test/lint MUST be able to show no trade-panel value is
  read from an indexer endpoint.

### 6.2 Data sources and which one is authoritative for which field

- RPC (https://rpc.testnet.arc.io) is authoritative for: live price,
  quoteBuy/quoteSell, x, sold, state, progressBps, usdcRaised6, market cap
  (MATH [10]), and any pre-trade balance.
- The indexer (Envio HyperSync https://arc-testnet.hypersync.xyz / HyperRPC
  https://arc-testnet.rpc.hypersync.xyz) is authoritative for: trade
  history, candles, holder and position lists, creator aggregates, fee-credit
  history, and global aggregates (section 6.3).
- Postgres is authoritative for social and account data only (section 6.4) and
  for no chain-derived value.
- The indexer MUST be Envio HyperIndex, self-hosted in development and
  Envio-hosted for the testnet deployment. It MUST index exactly MarketCreated, MarketMetadata, Trade, TradeDetail, Summit and the FeeVault credit and claim events (section
  5.5). It is a convenience layer: no tradeable number is ever
  read from it (section 6.1), and the token page MUST remain correct with the
  indexer completely offline, with only the chart empty.
- A dust credit is not a fee credit, and DustSwept (section 5.5) is what separates
  the two. Within one market taken in isolation, the sum of fee6 over that
  market's Trade events equals the sum of that curve's FeeVault credits minus
  the sum of its DustSwept.credited6 (MATH T5). Platform-wide the correct form is
  the ledger identity and not MATH T5, which is scoped to one market: the creation
  fee, the factory residual sweep, curve dust sweeps and any bare force-send are
  all vault credits that no Trade event accounts for, so a global equality between
  Trade fees and total FeeVault credits MUST NOT be asserted.

### 6.3 Indexer entities

- MUST define exactly: Token, Trade, Candle, Holder, Position, Creator,
  FeeCredit, Global. Each MUST be derivable purely from on-chain logs indexed
  from our deployment block onward, filtering Transfer-type logs
  by emitter address, never by topic alone.
- Trade entities MUST be built from the on-chain Trade event (section 5.5), not
  from re-quoting the RPC. Candle MUST be aggregated from Trade. FeeCredit MUST
  reconcile with FeeVault credits per market, minus that curve's
  DustSwept.credited6 (MATH T5); platform-wide the form is the ledger identity and
  never a global equality (section 6.2).
- Candle intervals MUST be exactly 1m, 5m, 1h and 1d, four and no more, built
  from Trade events only, keyed (token, interval, bucketStart), holding open,
  high, low, close, volume6 and tradeCount. A bucket with no trade MUST NOT
  exist; the client draws a flat carry-forward rather than the indexer
  interpolating one.
- Scope, one line per entity: Token is the market, keyed by curve address; Trade
  is one row per Trade event; Holder is the current token balance per (token,
  address); Position is cost basis and realised result per (token, address);
  Creator aggregates per creator address; FeeCredit is the fee ledger and claim
  history; Global holds protocol-wide totals. Position, Creator and Global are
  pure aggregates derived from Trade and FeeCredit and require no new event.

### 6.4 Database models

- MUST define exactly: User, Wallet, SiweNonce, Comment, WatchlistItem, Follow,
  Upload, Report. No chain data in Postgres, ever:
  no price, balance, reserve, trade, or holder amount may be stored in
  Postgres. A schema review MUST be able to confirm this.
- Wallet auth is SIWE-style (SiweNonce is the single-use challenge). Auth MUST
  be SIWE / EIP-4361: `domain` is the deployed host with no scheme; `statement`
  is exactly "Sign in to peakpump. This request will not create a transaction or
  cost any fee."; `chainId` is 5042002. The nonce MUST be 32 bytes of CSPRNG hex,
  single-use, deleted on first successful verify, TTL 5 minutes, and bound to the
  address that requested it. The session MUST be a signed HttpOnly SameSite=Lax
  cookie, 7 days, with no refresh: expiry means signing in again. Signing in MUST
  NOT be required to read anything and MUST NOT be required to trade; it is
  required only to comment and to edit a profile.

### 6.5 The name/symbol/description blocklist, and why symbols beginning with ARC are rejected

- create() and every write path that accepts a name, symbol, or description
  MUST reject blocklisted content, and the same blocklist MUST be enforced
  client side for early feedback and server side / on chain as the authority.
- Symbols beginning with `ARC` (case-insensitive) MUST be rejected. Reason:
  the Circle brand policy forbids using the Arc mark in a way that implies
  affiliation, and an ARC-prefixed ticker reads as an official Arc-network
  asset. This is a brand-safety rule, not a technical one.
- The blocklist MUST also cover the forbidden-vocabulary words of section 2 and
  the possessive/plural forms "Arc's" / "Arcs".
- An exact-match reserved-symbol list of USDC, EURC, WETH, WBTC, USDT and
  PEAKPUMP MUST be rejected, alongside and in addition to the ARC-prefix rule
  above, which already rejects any ARC-prefixed symbol and is not weakened. The
  matching rule is therefore exact-match against this list and prefix-match for
  ARC. There is no profanity list and no impersonation blocklist: validation is
  mechanical only, and duplicate names are allowed because the UI always shows
  the curve address next to a name.

### 6.6 Uploads and content-addressed metadata

- Uploaded images and token metadata MUST be content-addressed (addressed by a
  hash of their bytes) so identical content dedupes and a URL is immutable.
- Vercel image limits mean fixed sizes MUST be generated at upload
  time (the section-1.3 set is 64 / 256 / 512), MUST NOT be produced
  on-the-fly, and MUST NOT pass through the Vercel image optimizer; served
  images MUST carry a long `s-maxage`.
- Uploaded bytes MUST go to an S3-compatible object store (Cloudflare R2) via a
  presigned PUT issued by our own API route after size and magic-byte validation.
  Keys MUST be content-addressed as `uploads/<sha256 of bytes>.<ext>`; there is
  no IPFS and no CID. Accepted types are PNG, JPEG and WebP only, sniffed by
  magic bytes and never by extension or Content-Type header, with a hard limit
  of 2 MiB. The fixed image sizes remain the section-1.3 set
  stated above in this section; this requirement does not restate them.

### 6.7 API route table with method, auth, rate limit and cache header

- No route may forward an RPC call or quote a trade server side;
  there is no `/api/rpc`. Read-heavy list endpoints MUST be cached (an uncached
  list endpoint is the first thing to exhaust Fast Origin
  Transfer).
- Every route MUST declare method, auth requirement, rate limit, and cache
  header. Mutating social routes (comment, watchlist, follow, report, upload)
  MUST require wallet auth (section 6.4) and MUST be rate limited. The OG image
  route `api/og/token/[address]` MUST use a long `s-maxage`.
- DEFERRED: the complete route list with concrete method/auth/limit/cache
  values is not given by any document. Flagged; the constraints above are the
  fixed rules the table MUST satisfy. The API surface and its route
  table MUST list every route with its method, auth requirement, rate limit and
  cache header, adding no route absent from that table.

## 7 Security model: threat list, one paragraph per threat on why it fails

- Reserve drain via direct transfer: an attacker donates USDC to the curve to
  distort accounting. Fails because no invariant compares a balance with `==`
  and A1..A4 read storage only (MATH 8): a donation cannot move price or
  trigger the Summit, and cannot brick the market by equality.
- Fee-tier gaming: moving price into a cheaper bracket then selling in one
  transaction. Fails because the fee rate is flat in both phases and read from
  storage, never a function of live reserves (MATH 6).
- Summit overshoot / brick: a large buy overshoots Ts so the `sold == Ts`
  trigger never fires. Fails because the crossing branch ASSIGNS
  tokensOut = remaining and the trigger is unconditional (MATH 6.4, 7).
- Insolvency on sell: paying the fee out of reserves. Fails because gross6, not
  usdcOut6, leaves the pool (MATH 6.3) and A3 is exactly solvency (MATH 8).
- Anti-snipe evasion: buying to a third address inside the window. Fails
  because `to == msg.sender` is mandatory in-window, with the single factory
  exemption for the dev-buy (section 5.1/5.3).
- Sub-1e12 dust theft: rounding a remainder up into a credited balance so the
  vault owes more than it holds. Fails because remainders are refunded or
  FLOOR-credited to `dustWei`, never rounded up (section 5.4).
- Reentrancy: a malicious recipient re-enters during payout. Fails because
  on-chain invariants are asserted before interactions and payouts are pull /
  deferral only, never pushed inside a trade (MATH 8).
- CallFrom / Multicall3From sender-spoofing: the whole no-approval model rests
  on `pullFrom` being guarded by `msg.sender == curve` (section 5.2). On the
  Arc network the CallFrom precompile at 0x1800...0003, used by Multicall3From
  (0x522fAf9A91c41c443c66765030741e4AaCe147D0) and Memo
  (0x5294E9927c3306DcBaDb03fe70b92e01cCede505), lets a caller preserve/select
  the original `msg.sender` for a subcall. The threat is
  that an attacker uses it to present `msg.sender == curve` to `pullFrom` and
  drain a holder's tokens.
  Closed only by a dated on-chain observation: the no-approve assumption may be
  asserted by no document, only by a dated on-chain observation (the probe and
  its status live in `contracts/test/fork/ArcFork.t.sol`). Until that
  observation exists, the no-approve flow is unproven and no
  contract may be written against it; `pullFrom`'s guard MUST NOT be satisfiable
  by any caller other than the genuine curve clone.

## 8 Frontend

### 8.1 Design tokens: colour, type scale, spacing, radius, motion

- Visual tokens (colour, type scale, spacing, radius, motion) are the sole
  authority of docs/DESIGN.md. This section points at
  DESIGN.md and restates no visual value.

### 8.2 Component inventory

- DEFERRED: the component set is a visual/product decision owned by
  DESIGN.md. The only fixed requirements are those
  forced elsewhere in this SPEC: a trade panel (8.5), a fee-breakdown display
  (8.5), a price chart using lightweight-charts with mandatory TradingView
  attribution (8.3), and the social surfaces (8.6). The remaining inventory is
  deferred to the visual authority.

### 8.3 Brand strings, the footer disclaimer, the Circle trademark line, the TradingView attribution, and the no-possessive rule for the word Arc

- The footer and a `/brand` page MUST carry the Circle attribution line.
  The Arc logo/icon MUST NOT be used as favicon, app icon, or
  avatar (NO INCORPORATION); the name is written as plain text only.
- A TradingView attribution ("product creator" notice from the NOTICE file plus
  a link to https://www.tradingview.com) MUST appear wherever lightweight-charts
  is used, and in the footer; it is mandatory, not optional.
- No UI copy, comment, or doc may write "Arc's" or "Arcs"; write
  "the Arc network" or "USDC on Arc". A lint MUST enforce
  this and the banned marketing words / no-exclamation / no-emoji rules.
- The footer of every page MUST carry three attribution blocks, in this order
  and always visible:
  1. "Arc is a trademark of Circle Internet Group, Inc. peakpump is an
     independent project, not affiliated with, endorsed by, or sponsored by
     Circle."
  2. "Testnet only. Tokens and balances shown here have no monetary value.
     Nothing here is an offer, a solicitation, or financial advice."
  3. The TradingView attribution required by the lightweight-charts NOTICE file,
     copied verbatim out of node_modules/lightweight-charts/NOTICE at the version
     installed, together with the link that file requires. It MUST NOT be
     paraphrased and MUST NOT be copied from any document, including this one:
     read the installed NOTICE file and transcribe it.
  The word Arc appears as a bare proper noun, never as Arc's and never as Arcs.

### 8.4 Page inventory with the job of each page

- The page set is closed and is exactly six pages, plus the required not-found
  and error boundaries at every level:
  1. `/` (home) — the list/discovery page, indexer-backed and cached
     (section 6.7).
  2. `/token/[curve]` — the market page: chart, trade panel, and social surfaces
     (sections 8.5, 8.6).
  3. `/create` — the create() form with the client-side blocklist (section 6.5).
  4. `/profile/[address]` — creator and holder aggregates.
  5. `/brand` — carries the Circle trademark and attribution content in full; the
     footer attribution of section 8.3 is in addition to it, not a substitute.
  6. `/styleguide` — a development surface that carries a noindex.
  Everything else is excluded — no blog, no docs page, no changelog page, no
  about page, no leaderboard, no referral page — and adding a page is a decision
  recorded against this SPEC first.

### 8.5 The trade panel, field by field, including the fee breakdown

- Amount input MUST be in USDC for buys and in tokens for sells; the panel MUST
  quote via RPC `quoteBuy`/`quoteSell` only (section 6.1), never the indexer.
- The panel MUST render a quote status code as a sentence rather than a raw
  revert when the amount is under-minimum or out of phase (MATH 11).
- The fee breakdown MUST show fee6, creatorFee6 and protocolFee6 exactly as
  computed by MATH 6.1 (single top-down split; creatorFee6 + protocolFee6 ==
  fee6). It MUST NOT recompute fees with an independent formula; it displays the
  quote's returned values. When fee6 == 0 the breakdown MUST show no fee.
- The panel MUST show the net token/USDC out and, for buys near the Summit, the
  refund of any un-spent USDC (MATH 6.4 refund6). It MUST NOT display a market
  cap computed with any expression other than MATH [10].
- Slippage tolerance MUST offer presets 0.5%, 1%, 3% and a custom field, default
  1%, stored per browser. The panel MUST always show minimum received for a buy
  and minimum USDC out for a sell, in the monospace face. The base figure MUST
  be the quote struct's own tokensOut or usdcOut6 and MUST NOT be re-derived;
  only the tolerance the user chose is applied to it, in integer arithmetic and
  floored. A custom value above 5% MUST show an inline warning
  and require a second confirming action. The number that reaches the submit
  control MUST be the most recent quote this client holds for the exact amount
  being submitted, and the submit control MUST disable itself whenever the
  figures on screen are not that quote's own. Every quote MUST be re-read on the
  live cadence while the tab is visible and MUST NOT be served from a cache.
  Staleness beyond that MUST be bounded on chain rather than by a block
  comparison in the client: minTokensOut and minUsdcOut6 bound price, and the
  deadline bounds time.
  The panel MUST offer a deadline in minutes and MUST read the chain's own
  timestamp at the moment of signing to compute it.

### 8.6 Social surfaces

- MUST expose comments, watchlist, and follow, backed only by the Postgres
  models of section 6.4 and never by chain data. A report action (Report model)
  MUST exist. All mutations MUST require wallet auth and be rate limited
  (section 6.7).
- A report MUST write one row holding the reporter address, the target, a reason
  from the fixed set spam, impersonation, abuse and other, and a timestamp, with
  one report per address per target.
- Comments MUST be flat: no threading, no replies, no nesting. A comment MUST be
  at most 500 characters and is limited to one per address per market per 30
  seconds, enforced server side. An author MAY soft-delete their own comment into
  a tombstone that keeps the row. There MUST be no notification of any kind and
  no email, and no comment or report is ever a signal any contract reads. There
  is no admin UI on testnet: reports are triaged by a direct database query.

## 9 Testing strategy and the coverage bar per file

- Solidity tests MUST assert the MATH test invariants T1..T8 (MATH 9), treating
  presets and fuzzed cases differently for continuity (T7 / MATH 5) and using
  the conditional round-trip band of T4. Fee reconciliation T5 and T6 MUST be
  covered.
- The Summit MUST be tested from both the crossing path (MATH 6.4) and an exact
  landing on Ts through the ordinary path (MATH 7). There is no dev-buy Summit
  crossing test (impossible by the Ts/20 cap, section 5.1).
- ffi MUST stay disabled. Differential vectors MUST come from a committed JSON
  fixture read with `vm.readFile`, every number stored as a STRING and parsed
  with `vm.parseUint`; `vm.parseJson` MUST NOT be used for large integers
  (it mis-parses large integers).
- Verification MUST run narrowest-first: `forge test --mc <Name>` before
  `forge test`, and `pnpm typecheck` on the touched package before the repo.
- Coverage on Curve.sol, CurveMath.sol, PeakpumpFactory.sol and FeeVault.sol
  MUST be at least 95% line and 90% branch, reported per file; below either
  number the work is not complete. Coverage is a floor, not a goal: it MUST NOT be
  reached by deleting an assertion, widening a bound, or adding a test that
  asserts nothing.

## 10 Operational procedures

- Operational procedures (deploy, index start, env setup) live in the README at
  the repository root. This SPEC only requires
  that no broadcasting/deploying/migrating/pushing command is ever run by the
  tooling; each MUST be printed for the operator.
- Until a procedure is written, this section is a forward reference only and
  MUST NOT duplicate any command here.
