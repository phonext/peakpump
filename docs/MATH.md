# MATH.md — the only mathematical authority in this repository
# If code and this file disagree, this file wins. Never re-derive a formula.

## 0. Units — memorise these four lines
x, x0, R6, fee6, raised6   : USDC in 6-decimal units (1_000_000 == $1)
y, y0, S, Ts, Tl, sold     : token in wei (18 decimals)
r                          : price multiple, 18-decimal fixed point (rX18)
msg.value                  : native USDC in 18 decimals. usdcIn6 = msg.value / 1e12
NO other scaling factor exists anywhere in this system.

## 1. The model
A constant-product curve with a virtual USDC offset.
Phase ASCENT: x = x0 + realUsdcRaised, y = y0 - sold, k = x*y
Phase PEAK  : x = realUsdcHeld,        y = S  - sold, x0 = 0
The moment of transition is called the Summit.
There is no pair, no LP token, no router, no Uniswap, no external DEX, ever.

## 2. Closed forms (all proved, do not re-derive)
S total supply, R target raise, r the reserve multiple: x1 = x0*r, y1 = y0/r.

[1]  R  = x0*(r-1)                     x0 = R/(r-1)
[2]  Ts = y0*(r-1)/r                   y0 = Ts*r/(r-1)
[3]  x1*y1 = x0*y0                     (k exactly conserved in ASCENT)
[4]  p1/p0 = r^2
[5]  Ts = S*r/(r+1)                    (price continuity, proved in section 5)
[6]  Tl = S - Ts   ==   Ts/r
[7]  MC_summit = R*(r+1)
[8]  MC_start  = R*(r+1)/r^2
[9]  priceX18   = x * 1e30 / y         (USDC per whole token, 18-dp fixed point)
[10] marketCap6 = mulDiv(x, S, y, Floor)      <-- the ONLY market cap formula.
     Any expression containing 1e18 or 1e12 next to a market cap is a bug.
[11] y0/S = r^2/(r^2 - 1)  <= 4/3 at r = 2. y0 never exceeds 1.34*S.

Two mandatory sanity checks, and they must both pass on the same market:
  virtual, at the summit:
    mulDiv(16_000_000_000, 1e27, 266666666666666666666666666) = 60_000_000_000
  real, immediately after:
    mulDiv(12_000_000_000, 1e27, 200000000000000000000000000) = 60_000_000_000
Both are $60,000 = mulDiv(R6, rX18 + 1e18, 1e18) = 12000 * 5 for the Ridge
preset. Agreement between the two is the numerical statement of section 5.

Overflow budget, verified: x <= 2e13, y0 <= 1.34e30, so x*1e30 <= 2e43 and
x*y <= 2.7e43, both far inside uint256. Every product still gets widened.

## 3. deriveParams — mandatory rounding directions
  Ts = mulDiv(S,  r,    r + 1e18, Floor)
  Tl = S - Ts                                   <-- NEVER computed independently
  y0 = mulDiv(Ts, r,    r - 1e18, Floor)
  x0 = mulDiv(R6, 1e18, r - 1e18, Ceil)
  y1 = y0 - Ts                                  <-- a constant for the market
  Reff6 = mulDiv(x0, r - 1e18, 1e18, Floor)     <-- the raise this market really
                                                    needs; see section 9/T8
Bounds enforced at creation, each with its own named error:
  1e24 <= S <= 1e30            (1M .. 1T whole tokens)
  1e9  <= R6 <= 1e13           ($1,000 .. $10,000,000)
  2e18 <= r  <= 20e18
  y0 > Ts  and  S > Ts  and  x0 > 0  and  y1 > 0     (asserted, not assumed)
  y1 == y0 - Ts asserted once at initialize, so the stored constant can never
  drift from its definition

## 4. y is NEVER stored
  y() = (state == ASCENT) ? y0 - sold : S - sold
This is a design rule, not an optimisation. It makes the single most dangerous
bug in the system unrepresentable: at the summit sold == Ts, so y moves from
y0 - Ts == y1 to S - Ts == Tl automatically, with zero storage writes. A stored
y that is not updated at the summit reports a price that is too low by the
factor (r-1)/r, which is an instant 25% crash at r = 4.

Storage layout, and nothing may be added to it without changing this file:
  A: uint128 x          | uint128 sold
  B: uint128 x0         | uint120 raised6 | uint8 state
  C: uint128 y0         | uint128 S        (written once in initialize)
  D: uint128 Ts         | uint128 y1       (written once in initialize)
  E: address token      | uint16 feeBps | uint16 creatorBps | uint16 protocolBps
                        | uint48 antiSnipeEndBlock        = 256 bits exactly
  F: address creator    | uint96 maxBuyPerAddress6        = 256 bits exactly
  G: address treasury
  H: address feeVault
  I: address factory    | uint96 dustWei                  = 256 bits exactly
  J: mapping(address => uint128) boughtInWindow6
  K: mapping(address => uint256) deferred

antiSnipeEndBlock is uint48, not uint32. Arc is already past block 58,600,000
and adds roughly 63,000,000 blocks a year at a 0.5s block time, so uint32
overflows in about 68 years. Slot E has exactly 48 bits free after the address
and the three uint16 fields, so uint48 is free and uint32 buys nothing.

factory is storage and not immutable. An immutable is baked into the
implementation's runtime code and a clone executes that same code, so it could
never differ per market anyway; and SPEC 5.6 deploys the Curve implementation
before the factory exists, so the value is not knowable at implementation
construction time. One SLOAD on the two guarded paths is the price of that
ordering, and it is paid knowingly.

dustWei is uint96 and holds the accumulated sub-1e12 remainders of msg.value.
Each buy contributes at most 1e12 - 1 wei and uint96 caps at 7.9e28, so it
cannot overflow inside any reachable history. It is still written through
SafeCast.toUint96.

deferred is denominated in wei, not in 6-decimal units, because it records the
exact amount of a transfer that failed, remainder included.

boughtInWindow6 needs no start epoch. Every market is a fresh clone and the
anti-snipe window is one absolute interval that ends at antiSnipeEndBlock; the
mapping is never read after that block and is never reused, so there is nothing
for a start epoch to disambiguate.

y is in no slot. Tl is in no slot. The OpenZeppelin upgradeable base contracts
use ERC-7201 namespaced storage, so they cannot collide with slots A..K. Do not
insert storage gaps: this layout starts at slot 0 and is exact.

SafeCast.toUint120, toUint96 and toUint48 all exist in OpenZeppelin v5.

## 5. Price continuity at the summit — an EXACT equality, not a margin
With exact rational values the condition p_after >= p_before reduces to
  r^2 * Tl == y0 * (r - 1)
which, substituting Tl = Ts/r and y0 = Ts*r/(r-1), is an identity. The sign of
the residual is therefore decided entirely by the rounding directions of
section 3, and both floors push in the dangerous direction: a floored y0 lowers
y1 and RAISES p_before, a floored Ts raises Tl and LOWERS p_after.

For S = 1e27 and r = 4e18 the residual has been verified positive analytically,
not merely spot-checked. With those parameters Ts = 8e26 and Tl = 2e26 are both
exact and only y0 is floored, giving y0 = 4*y1 + 2, hence x_final = 4*x0 + 1 and
raised6 = R6 + 1. The condition p_after > p_before then reduces to
  2e26 - 6*x0 - 2 > 0
i.e. x0 < 3.33e25, and the bounds of section 3 cap x0 at 1e13. So for the
preset curve shape the inequality holds for EVERY legal R6, not just the three
named presets.

Test rules, and they are not the same for presets and for arbitrary parameters:
  presets   : assert p_after >= p_before, and p_after - p_before <= 4e30 / Ts
  fuzzed    : assert |p_after - p_before| <= 4e30 / Ts, both directions
NOTHING ON CHAIN MAY DEPEND ON THE SIGN. The summit moves zero value, so a
one-wei residual in either direction is a display artefact, never a solvency
event. If you ever find yourself writing on-chain logic that assumes the sign,
stop and re-read this section.

## 6. Fees
tradeFeeBps = 125   creatorBps = 30   protocolBps = 95   lpBps = 0 (not built)
Flat across the entire curve, in both phases. NEVER tiered by market cap: a rate
that depends on live reserves lets an attacker move the price into a cheaper
bracket and sell in the same transaction. If a tier is ever required, the only
safe form reads the rate from storage once at function entry.
Hard caps: feeBps <= 200, creatorBps + protocolBps == feeBps.
Fees are always charged on the USDC leg, never on the token leg. A holder's
token balance is never reduced by a fee.

### 6.1 The only permitted split, top-down
  if (feeBps == 0) return (0, 0);                    // before any division
  fee6         = mulDiv(amount6, feeBps, 10000, Ceil);
  creatorFee6  = mulDiv(fee6, creatorBps, feeBps, Floor);
  protocolFee6 = fee6 - creatorFee6;                 // subtraction, never mulDiv
Two independent Ceil calls can exceed the total by one unit; that single unit
breaks fee reconciliation and can make spend6 > usdcIn6 on the crossing path,
i.e. a revert with no visible cause. Independent shares are forbidden.
When fee6 == 0 the curve skips the FeeVault call entirely.

### 6.2 Buy
  fee6      = ceil(usdcIn6 * feeBps / 1e4)
  net6      = usdcIn6 - fee6
  tokensOut = floor(y * net6 / (x + net6))
  x += net6                       <-- only net enters the pool

### 6.3 Sell
  gross6   = floor(x * tokensIn / (y + tokensIn))
  fee6     = ceil(gross6 * feeBps / 1e4)
  usdcOut6 = gross6 - fee6
  x -= gross6                     <-- gross leaves the pool, NOT usdcOut6
Subtracting usdcOut6 makes the contract pay the fee out of its own reserves and
eventually become insolvent.

### 6.4 Crossing the summit
remaining = Ts - sold. The denominator is the market constant y1, because
y - remaining == (y0 - sold) - (Ts - sold) == y0 - Ts == y1.
  netNeeded6 = ceil(x * remaining / y1)
  spend6     = ceil(netNeeded6 * 1e4 / (1e4 - feeBps))
  feeUsed6   = spend6 - netNeeded6
  refund6    = usdcIn6 - spend6
  tokensOut  = remaining          <-- ASSIGNED. Never recomputed from the curve.

Three properties, each proved and each with a mandatory test:
  (a) spend6 <= usdcIn6 inside this branch. Proof: entering the branch means
      tokensOut > remaining, i.e. net6*y1 > remaining*x, i.e. net6 >= netNeeded6.
      Since net6 == floor(usdcIn6*(1e4-feeBps)/1e4), usdcIn6 itself satisfies the
      defining inequality of spend6, and spend6 is the least such value.
  (b) net6 at spend6 equals netNeeded6 EXACTLY. Proof: for integer s,
      s - ceil(s*f/1e4) == floor(s*(1e4-f)/1e4)  (write s*f = q*1e4 + t).
      Minimality gives (s-1)*(1e4-f) < n*1e4, hence s*(1e4-f) < n*1e4 + (1e4-f)
      < (n+1)*1e4, hence the floor is exactly n. So feeUsed6 equals
      ceil(spend6*feeBps/1e4) with no surplus, and no unit is silently
      converted into extra fee.
  (c) minimality: spend6 - 1 does not buy `remaining`.
feeBps <= 200 guarantees the denominator 1e4 - feeBps >= 9800 > 0.
The derivative of the curve at the summit is of order y1/x1 ~= 1.67e16 token
wei per USDC unit for the Ridge preset. That is why tokensOut is assigned and
never recomputed: a recomputed value overshoots Ts by an enormous margin, the
sold == Ts trigger never fires, and the market is bricked forever.

This branch exists only in ASCENT. quoteBuy must not enter it in PEAK.

## 7. The summit transition — four writes, zero transfers
  uint128 real = x - x0;      // compute BEFORE zeroing x0
  x = real; x0 = 0; raised6 = SafeCast.toUint120(real); state = PEAK;
No deployment, no graduation fee, no value movement, no y write (section 4).
After it: the sold <= Ts cap is gone, sold keeps being maintained, the fee rate
is unchanged, progressBps() returns 10000, usdcRaised6() returns the raised6
snapshot and never x.
The trigger is unconditional and branch-independent:
  if (state == ASCENT && sold == Ts) _summit();
A buy that lands exactly on Ts through the ordinary path must reach it too.

## 8. Invariants asserted ON CHAIN (storage reads only, never a balance)
  A1  state == ASCENT  =>  sold <= Ts
  A2  x > 0  and  y() > 0
  A3  state == ASCENT  =>  x * y() >= x0 * y0
  A4  any trade that does not cross the summit  =>  k_after >= k_entry
A3 is not a heuristic, it is exactly equivalent to solvency. Selling every token
that exists at once is the worst case (a constant-product sale is path
independent in exact arithmetic and every Floor only reduces the payout), and
  gross = floor(x*sold/y0) <= x - x0   <=>   x*(y0 - sold) >= x0*y0.
x0*y0 must be computed from the STORED, already floored y0, never re-derived: a
re-derived y0 is larger, makes A3 stricter than reality and reverts the last buy
before the summit.
In PEAK x0 == 0 makes A3 vacuous and that is correct: with x0 == 0 selling
everything pays floor(x*sold/S) < x, so solvency is structural.
A4 is skipped for the trade that crosses, where k legitimately falls to
((r-1)/r)^2 of its previous value, which is 0.5625 at r = 4.
Both fields of every product are widened to uint256 before multiplying.
Never assert equality against balanceOf or address(this).balance: anybody can
donate 1 wei and permanently brick the market.
Order inside every state-changing function: checks, effects, on-chain
invariant asserts, then interactions. Asserting before the external calls makes
a failure cheap and keeps the asserts unreachable by a reentrant caller.
balanceOf and address(this).balance appear nowhere in Curve.sol, sweepDust
included: sweepDust moves exactly dustWei and zeroes it, so a donation can
neither be swept nor influence any decision the contract makes.
A failed payout is recorded in the contract's own deferred ledger and is
withdrawn with withdrawDeferred. It never becomes a FeeVault credit, so the
vault holds fees and nothing else.


## 9. Invariants asserted IN TESTS ONLY, as inequalities
   T1  nativeHeld >= reserveWei + dustWei + totalDeferredWei, where
      reserveWei = (state == ASCENT ? x - x0 : x) * 1e12 and totalDeferredWei
      is a ghost variable kept by the test handler and not contract storage.
      This is never an equality: anyone may donate, and donated native USDC is
      deliberately unreachable.
  T2  tokenHeld  >= S - sold
  T3  round trip before fees: gross6 <= net6            (Floor property)
  T4  round trip after fees, feeBps = 125:
        usdcIn6 >= 1_000_000  ->  loss is in [2.40%, 2.60%]
        usdcIn6 <  1_000_000  ->  loss <= 2.4844% * usdcIn6 + 4 units
      The relative band is only meaningful once rounding is negligible. A
      constant-product round trip has ZERO net price impact because the fee is
      taken outside the pool, so the entire loss is 1-(1-f)^2 = 2.484375% plus
      at most a few units of Floor. Worked counterexample for why the band must
      be conditional: usdcIn6 = 1000 gives fee1 = 13, net = 987, fee2 = 13,
      out = 974, loss = 2.60% and one Floor away from 2.70%. The lower bound
      catches a missing fee, the upper bound catches a doubled fee; a one-sided
      test catches half the bugs.
  T5  within one market taken in isolation, the sum of fee6 over that market's
      Trade events equals the sum of that curve's FeeVault credits minus the
      sum of its DustSwept.credited6. Curve.sweepDust is a vault credit but is
      not a fee, and the DustSwept event is what lets this hold on every market
      instead of only on one where no sweep has run.
      Platform-wide the correct form is the ledger identity and not this one: the
      creation fee, the factory residual sweep and any bare force-send are all
      vault credits that no Trade event accounts for. Never assert a global
      equality between Trade fees and total FeeVault credits.
  T6  creatorFee6 + protocolFee6 == fee6, for every input
  T7  section 5 continuity assertions, presets and fuzzed cases treated
      differently
  T8  raised6 in [Reff6, Reff6 + 2] where Reff6 = mulDiv(x0, r-1e18, 1e18,
      Floor). It is NOT [R6, R6+2]: because x0 is rounded up, Reff6 can exceed
      R6 by up to (r/1e18 - 2) units. For the three presets (r-1)==3 divides R6
      so Reff6 == R6 and raised6 == R6 + 1, but a custom market with r = 20 and
      R6 = 1_000_000_002 gives x0 = 52_631_580 and Reff6 == R6 + 18. Never
      assert against R6.
T8 (scope, amended 2026-08-30). The tight band Reff6 <= raised6 <= Reff6 + 2,
and the preset identity raised6 == R6 + 1 of section 10, hold for a summit
reached by BUYS ALONE, with no sell anywhere before the crossing trade. They do
NOT hold once a single sell has occurred. Reason: a buy moves the reserve by
exactly net6 and takes its floor on the token leg, so that floor raises k by at
most x and lifts x_final = k / y1 by at most x / y1, which is below 1e-16 of one
6-decimal unit and is never observable. A sell takes its floor on the USDC leg,
so it leaves in the reserve up to one whole unit of x that the ideal curve would
not have left, and one unit retained while y == y_cur is worth up to
y_cur / y1 <= y0 / y1 units of x once y is pinned to y1 at the summit. Sells are
therefore the only source of drift, and the number of buys is irrelevant. On a
buys-only path the band is asserted in test/unit/Summit.t.sol, whose _assertT8
reaches the summit with two monotonic buys and is in scope under this wording.
test/fuzz/BuySell.t.sol does not assert this band and is not part of its scope.

T8b (campaign form). After an arbitrary sequence of trades, at the instant the
summit is reached:
    raised6 >= Reff6                                  always
    raised6 <= Reff6 + 2 + n * (y0 / y1 + 1)          n = state-changing trades
                                                      before the crossing
raised6 = x - x0 is path-dependent above Reff6 and is bounded above by no fixed
constant. Reason: A4 of section 8 makes k = x * y() non-decreasing, so a sell
may retain up to one 6-decimal unit of x through rounding, worth up to y0 / y1
units of x at the summit, and the crossing quote's own ceiling contributes at
most one more. Only sells contribute to the n term; counting every
state-changing trade is a deliberately loose bound, and the invariant suite uses
the handler's running total, which can only loosen it further and never tighten
it. A single buy-sell round trip before the crossing already yields
raised6 == R6 + 3 on Basecamp, which is why the tight band is not an invariant.
Measured: over 256 runs and 16384 calls the minimum observed raised6 - Reff6 was
2 and never negative. Nothing is weakened: the lower bound raised6 >= Reff6 is
unchanged and is asserted continuously.
raised6 is frozen at the crossing while PEAK buys and sells keep moving x in
both directions, per section 7. The identity raised6 == x therefore holds only at
the instant of the summit, is asserted there in test/unit/Summit.t.sol, and is
NOT a campaign invariant.


## 10. Presets — one curve shape, three raises
S = 1e27 wei (1,000,000,000 tokens), r = 4e18 for all three, therefore
  Ts    = 800000000000000000000000000
  Tl    = 200000000000000000000000000
  y0    = 1066666666666666666666666666      (floor of Ts*4/3)
  y1    = 266666666666666666666666666
  y0    = 4*y1 + 2                          (the source of the +1 below)
  Basecamp  R6 =  3_000_000_000   x0 =  1_000_000_000   MC $937.50  -> $15,000
  Ridge     R6 = 12_000_000_000   x0 =  4_000_000_000   MC $3,750   -> $60,000
  Alpine    R6 = 60_000_000_000   x0 = 20_000_000_000   MC $18,750  -> $300,000
Every value is an exact integer except y0, which must be asserted against the
floored literal above. Because y0 is floored, x0*y0 exceeds x1*y1 by exactly
2*x0, which is 8e9 for Ridge, so x_final = 4*x0 + 1 and raised6 == R6 + 1
rather than R6. Ridge start price = mulDiv(4e9, 1e30, y0) / 1e18 = 0.00000375
USDC per whole token; that literal appears in the UI copy and must match.

## 11. Minimum trade size — a real revert path, not a nicety
A buy of usdcIn6 = 1 with feeBps = 125 gives fee6 = 1, net6 = 0, tokensOut = 0:
the user pays a pure fee for nothing. A sell whose gross6 is 1 gives
usdcOut6 = 0: the user destroys tokens for nothing and k rises for free.
  buy:  require usdcIn6 >= 1000 (=$0.001), net6 >= 1, tokensOut >= 1
  sell: require tokensIn >= 1, usdcOut6 >= 1, tokensIn <= sold in BOTH phases
The sold check is provably redundant in PEAK, because circulating supply is
always exactly sold, so no holder can present more. Keep it anyway: a named
require costs a few gas and closes a whole class of future silent bugs.
quoteBuy and quoteSell must NOT revert on an under-minimum amount. They return
a status code so the UI can render a sentence instead of a raw revert.

## 12. Gas price — a floor AND a ceiling
The Arc protocol minimum base fee on testnet is 20 Gwei and the documented
maximum is 20,000 Gwei. Every write path therefore uses
  maxFeePerGas = min( max(20 gwei, suggested * 2), 20_001 gwei )
  maxPriorityFeePerGas = 1 gwei
with `suggested` from eth_feeHistory. Hardcoding 20 gwei as the value leaves
every user transaction pending the first time the base fee rises above it. An
unbounded suggested*2 is equally wrong in the other direction: a known arc-node
issue reports eth_gasPrice returning stale values, and one bad reading would
produce an absurd cap and an "insufficient funds" error for a funded user. The
protocol ceiling is the only honest upper bound, so clamp to it.
