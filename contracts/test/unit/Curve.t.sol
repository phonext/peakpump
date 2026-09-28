// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, Vm} from "forge-std/Test.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {Curve} from "../../src/Curve.sol";
import {PeakToken} from "../../src/PeakToken.sol";
import {FeeVault} from "../../src/FeeVault.sol";
import {CurveMath} from "../../src/libraries/CurveMath.sol";

// A trader that can be told to reject native receipt, standing in for a
// blocklisted or code-bearing recipient whose payout the curve must defer. It
// forwards buy and sell so its own address is the curve's msg.sender.
contract RejectingTrader {
    Curve internal curve;
    bool public reject;

    constructor(Curve c) {
        curve = c;
        reject = true;
    }

    function setReject(bool r) external {
        reject = r;
    }

    function buy(uint256 minOut, uint256 deadline, address to) external payable {
        curve.buy{value: msg.value}(minOut, deadline, to);
    }

    function sell(uint256 tokensIn, uint256 minOut, uint256 deadline) external {
        curve.sell(tokensIn, minOut, deadline);
    }

    function withdraw() external {
        curve.withdrawDeferred();
    }

    receive() external payable {
        if (reject) revert("rejected");
    }
}

// A malicious receiver that re-enters the Curve during the native payout of its
// own sell. Its receive() runs inside sell()'s _payout (a 100000-gas stipend)
// while the nonReentrant lock is held, and attempts a buy() that is valid in
// every respect but the lock: 1e15 wei == the 1000-unit minimum, a fresh
// deadline, tokens to itself. The re-entrant call is made through try/catch so
// the revert is swallowed -- the outer payout still completes once (no bounce,
// no double-spend) -- and the revert selector is captured for the test.
contract ReentrantTrader {
    Curve internal immutable curve;
    bool internal armed;
    bytes4 public reentryError;

    constructor(Curve c) {
        curve = c;
    }

    function buyIn(uint256 deadline) external payable {
        curve.buy{value: msg.value}(0, deadline, address(this));
    }

    function sellOut(uint256 tokensIn, uint256 deadline) external {
        armed = true;
        curve.sell(tokensIn, 0, deadline);
        armed = false;
    }

    receive() external payable {
        if (!armed) return;
        try curve.buy{value: 1e15}(0, block.timestamp, address(this)) {
            reentryError = bytes4(0); // re-entry was NOT blocked
        } catch (bytes memory reason) {
            bytes4 sel;
            if (reason.length >= 4) {
                assembly {
                    sel := mload(add(reason, 0x20))
                }
            }
            reentryError = sel;
        }
    }
}

// Shared harness for the Curve unit tests. _disableInitializers() blocks a
// direct init of the implementation, so every market is a clone initialized from
// a pranked factory, exactly as PeakpumpFactory does.
abstract contract CurveTestBase is Test {
    Curve internal impl;
    PeakToken internal tokenImpl;
    FeeVault internal vault;

    address internal factory = makeAddr("factory");
    address internal creator = makeAddr("creator");
    address internal treasury = makeAddr("treasury");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    // MATH 10 preset literals. S and r are shared across the three presets, so
    // Ts, Tl, y0 and y1 are identical for all of them; only R6 and x0 differ.
    uint256 internal constant SUP = 1e27;
    uint256 internal constant R_X18 = 4e18;
    uint128 internal constant TS = 8e26;
    uint128 internal constant TL = 2e26;
    uint128 internal constant Y0 = 1066666666666666666666666666;
    uint128 internal constant Y1 = 266666666666666666666666666;
    uint256 internal constant R6_BASECAMP = 3e9;
    uint256 internal constant R6_RIDGE = 12e9;
    uint256 internal constant R6_ALPINE = 60e9;
    uint128 internal constant X0_BASECAMP = 1e9;
    uint128 internal constant X0_RIDGE = 4e9;
    uint128 internal constant X0_ALPINE = 20e9;

    uint16 internal constant FEE_BPS = 125;
    uint16 internal constant CREATOR_BPS = 30;
    uint16 internal constant PROTOCOL_BPS = 95;

    // The Arc Testnet seeds a blocklisted address at index 1 of the standard test
    // mnemonic; in the forge EVM it is an ordinary EOA, used here to
    // stand for a creator whose fee can only be credited, never pushed.
    address internal constant ARC_BLOCKLISTED = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8;

    function setUp() public virtual {
        impl = new Curve();
        tokenImpl = new PeakToken();
        vault = new FeeVault(treasury);
        vault.setFactory(factory);
        vm.deal(alice, 1e30);
        vm.deal(bob, 1e30);
    }

    // Clone the curve and token and initialize the token, but stop short of
    // curve.initialize so a caller can arm vm.expectRevert directly on it. Returns
    // the params it would have used. This is why the initialize-revert tests do not
    // go through _market: expectRevert must sit on the initialize call, not on the
    // Clones.clone CREATE that _market runs first.
    function _prep(
        uint256 r6,
        uint16 feeBps,
        uint16 creatorBps,
        uint16 protocolBps,
        uint256 antiSnipeBlocks,
        uint96 maxBuy6,
        address creator_
    ) internal returns (Curve curve, PeakToken token, Curve.InitParams memory p) {
        curve = Curve(payable(Clones.clone(address(impl))));
        token = PeakToken(Clones.clone(address(tokenImpl)));
        token.initialize("Peakpump Test", "PEAK", address(curve), SUP);
        p = Curve.InitParams({
            token: address(token),
            creator: creator_,
            treasury: treasury,
            feeVault: address(vault),
            factory: factory,
            S: SUP,
            R6: r6,
            rX18: R_X18,
            feeBps: feeBps,
            creatorBps: creatorBps,
            protocolBps: protocolBps,
            antiSnipeBlocks: antiSnipeBlocks,
            maxBuyPerAddress6: maxBuy6
        });
    }

    // Full-control market builder: prep, initialize from the factory, and
    // (optionally) register the curve so vault credits pass.
    function _market(
        uint256 r6,
        uint16 feeBps,
        uint16 creatorBps,
        uint16 protocolBps,
        uint256 antiSnipeBlocks,
        uint96 maxBuy6,
        address creator_,
        bool register
    ) internal returns (Curve curve, PeakToken token) {
        Curve.InitParams memory p;
        (curve, token, p) = _prep(r6, feeBps, creatorBps, protocolBps, antiSnipeBlocks, maxBuy6, creator_);
        vm.prank(factory);
        curve.initialize(p);
        if (register) {
            vm.prank(factory);
            vault.registerCurve(address(curve));
        }
    }


    // The default: a registered Ridge market, 125 bps, no anti-snipe window.
    function _ridge() internal returns (Curve curve, PeakToken token) {
        return _market(R6_RIDGE, FEE_BPS, CREATOR_BPS, PROTOCOL_BPS, 0, 0, creator, true);
    }

    // value in wei for a whole-unit usdcIn6 amount, leaving zero remainder.
    function _wei(uint256 usdcIn6) internal pure returns (uint256) {
        return usdcIn6 * 1e12;
    }
}

contract CurveTest is CurveTestBase {
    // Mirror of Curve's events so vm.expectEmit can match by signature.
    event Trade(
        address indexed curve,
        address indexed trader,
        bool indexed isBuy,
        uint120 usdcIn6,
        uint120 usdcOut6,
        uint120 tokenIn,
        uint120 tokenOut,
        uint120 fee6,
        uint120 tReserve6After,
        uint120 supplySold6After,
        uint8 phaseAfter
    );
    event TradeDetail(
        address indexed trader, address indexed to, uint256 spend6, uint256 poolDelta6, bool crossed, uint8 stateAfter
    );
    event PayoutDeferred(address indexed recipient, uint256 weiAmount);
    event DustSwept(uint256 weiAmount, uint256 credited6);

    // ----- initialize -----

    function test_initializeStoresRidgeParams() public {
        (Curve curve,) = _market(R6_RIDGE, FEE_BPS, CREATOR_BPS, PROTOCOL_BPS, 10, 5e9, creator, true);
        assertEq(curve.Ts(), TS, "Ts");
        assertEq(curve.y0(), Y0, "y0");
        assertEq(curve.y1(), Y1, "y1");
        assertEq(curve.S(), SUP, "S");
        assertEq(curve.x0(), X0_RIDGE, "x0");
        assertEq(curve.x(), X0_RIDGE, "x==x0");
        assertEq(curve.sold(), 0, "sold");
        assertEq(uint8(curve.state()), uint8(Curve.Phase.ASCENT), "state");
        assertEq(curve.raised6(), 0, "raised6");
        assertEq(curve.antiSnipeEndBlock(), block.number + 10, "antiSnipeEnd");
        assertEq(curve.maxBuyPerAddress6(), 5e9, "cap");
        assertEq(curve.feeBps(), FEE_BPS);
        assertEq(curve.creatorBps(), CREATOR_BPS);
        assertEq(curve.protocolBps(), PROTOCOL_BPS);
        assertEq(curve.token() != address(0), true);
        assertEq(curve.creator(), creator);
        assertEq(curve.treasury(), treasury);
        assertEq(curve.feeVault(), address(vault));
        assertEq(curve.factory(), factory);
    }

    function test_initializeRejectsNonFactory() public {
        Curve curve = Curve(payable(Clones.clone(address(impl))));
        PeakToken token = PeakToken(Clones.clone(address(tokenImpl)));
        token.initialize("Peakpump Test", "PEAK", address(curve), SUP);
        Curve.InitParams memory p = Curve.InitParams({
            token: address(token),
            creator: creator,
            treasury: treasury,
            feeVault: address(vault),
            factory: factory,
            S: SUP,
            R6: R6_RIDGE,
            rX18: R_X18,
            feeBps: FEE_BPS,
            creatorBps: CREATOR_BPS,
            protocolBps: PROTOCOL_BPS,
            antiSnipeBlocks: 0,
            maxBuyPerAddress6: 0
        });
        // Any caller other than the named factory is rejected.
        vm.prank(bob);
        vm.expectRevert(Curve.NotFactory.selector);
        curve.initialize(p);
    }

    function test_initializeRejectsBadFeeConfig() public {
        // feeBps above the hard cap.
        (Curve c1,, Curve.InitParams memory p1) = _prep(R6_RIDGE, 201, 100, 101, 0, 0, creator);
        vm.prank(factory);
        vm.expectRevert(Curve.FeeConfigInvalid.selector);
        c1.initialize(p1);
        // Shares that do not sum to the total.
        (Curve c2,, Curve.InitParams memory p2) = _prep(R6_RIDGE, 125, 30, 94, 0, 0, creator);
        vm.prank(factory);
        vm.expectRevert(Curve.FeeConfigInvalid.selector);
        c2.initialize(p2);
    }

    function test_initializeRejectsAntiSnipeMisconfig() public {
        // A live window with a zero cap.
        (Curve c1,, Curve.InitParams memory p1) = _prep(R6_RIDGE, FEE_BPS, CREATOR_BPS, PROTOCOL_BPS, 10, 0, creator);
        vm.prank(factory);
        vm.expectRevert(Curve.AntiSnipeMisconfigured.selector);
        c1.initialize(p1);
        // A cap with no window.
        (Curve c2,, Curve.InitParams memory p2) = _prep(R6_RIDGE, FEE_BPS, CREATOR_BPS, PROTOCOL_BPS, 0, 5e9, creator);
        vm.prank(factory);
        vm.expectRevert(Curve.AntiSnipeMisconfigured.selector);
        c2.initialize(p2);
    }

    function test_initializeIsOneShot() public {
        (Curve curve, PeakToken token) = _ridge();
        Curve.InitParams memory p = Curve.InitParams({
            token: address(token),
            creator: creator,
            treasury: treasury,
            feeVault: address(vault),
            factory: factory,
            S: SUP,
            R6: R6_RIDGE,
            rX18: R_X18,
            feeBps: FEE_BPS,
            creatorBps: CREATOR_BPS,
            protocolBps: PROTOCOL_BPS,
            antiSnipeBlocks: 0,
            maxBuyPerAddress6: 0
        });
        vm.prank(factory);
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        curve.initialize(p);
    }

    // The five SPEC-5.3 re-asserts guard the SafeCast store round-trip. On valid
    // Ridge input they pass; deriveParams already reverts every uint256-level
    // violation, so they cannot be forced without a library/SafeCast bug, and a
    // fabricated test for a state the code has made impossible is not written.
    function test_storeIntegrityHoldsOnRidge() public {
        (Curve curve,) = _ridge();
        assertEq(curve.y1(), curve.y0() - curve.Ts(), "y1==y0-Ts");
        assertGt(curve.y0(), curve.Ts(), "y0>Ts");
        assertGt(curve.S(), curve.Ts(), "S>Ts");
        assertGt(curve.x0(), 0, "x0>0");
        assertGt(curve.y1(), 0, "y1>0");
    }

    // ----- buy, ASCENT, no crossing -----

    function test_buyAscentNonCrossing() public {
        (Curve curve, PeakToken token) = _ridge();
        uint256 usdcIn6 = 1e6;

        CurveMath.BuyQuote memory q = CurveMath.buyQuote(X0_RIDGE, Y0, usdcIn6, FEE_BPS);
        (uint256 expCreator, uint256 expProtocol) = CurveMath.splitFee(q.fee6, FEE_BPS, CREATOR_BPS);

        vm.prank(alice);
        curve.buy{value: _wei(usdcIn6)}(0, block.timestamp, alice);

        // Only net6 enters the pool; sold advances by tokensOut (MATH 6.2).
        assertEq(curve.x(), uint256(X0_RIDGE) + q.net6, "x += net6");
        assertEq(curve.sold(), q.tokensOut, "sold += tokensOut");
        assertEq(token.balanceOf(alice), q.tokensOut, "buyer holds tokensOut");
        assertEq(uint8(curve.state()), uint8(Curve.Phase.ASCENT), "still ASCENT");

        // The fee is credited to the vault, split top-down, never pushed.
        assertEq(expCreator + expProtocol, q.fee6, "split sums to fee");
        assertEq(vault.balances(creator), expCreator, "creator credited");
        assertEq(vault.balances(treasury), expProtocol, "treasury credited");
    }

    function test_buyRevertsBelowMinimum() public {
        (Curve curve,) = _ridge();
        vm.prank(alice);
        vm.expectRevert(Curve.BelowMinimumTrade.selector);
        curve.buy{value: _wei(999)}(0, block.timestamp, alice);
    }

    function test_buyRevertsPastDeadlineButAcceptsEqual() public {
        (Curve curve,) = _ridge();
        vm.warp(1000);
        vm.prank(alice);
        vm.expectRevert(Curve.DeadlineExpired.selector);
        curve.buy{value: _wei(1e6)}(0, 999, alice);

        // deadline == block.timestamp is allowed (the comparison is <=).
        vm.prank(alice);
        curve.buy{value: _wei(1e6)}(0, 1000, alice);
        assertGt(curve.sold(), 0);
    }

    function test_buyRevertsOnSlippage() public {
        (Curve curve,) = _ridge();
        CurveMath.BuyQuote memory q = CurveMath.buyQuote(X0_RIDGE, Y0, 1e6, FEE_BPS);
        vm.prank(alice);
        vm.expectRevert(Curve.InsufficientTokensOut.selector);
        curve.buy{value: _wei(1e6)}(q.tokensOut + 1, block.timestamp, alice);
    }

    // MATH 11 mandates net6 >= 1 and tokensOut >= 1. With usdcIn6 >= 1000 and
    // feeBps <= 200, net6 >= usdcIn6 * 0.98 >= 980, and in ASCENT/early-PEAK
    // tokensOut is enormous, so ZeroNetAfterFee and ZeroTokensOut cannot be forced
    // without a smaller minimum or a larger fee than the config permits. Like the
    // initialize re-asserts, these guards are proven by the boundary buy passing;
    // a fabricated test for a state the config has made impossible is not written.
    function test_buyAtMinimumSucceeds() public {
        (Curve curve,) = _ridge();
        CurveMath.BuyQuote memory q = CurveMath.buyQuote(X0_RIDGE, Y0, 1000, FEE_BPS);
        assertGt(q.net6, 0, "net6 >= 1 at the minimum");
        assertGt(q.tokensOut, 0, "tokensOut >= 1 at the minimum");

        vm.prank(alice);
        curve.buy{value: _wei(1000)}(0, block.timestamp, alice);
        assertEq(curve.sold(), q.tokensOut);
    }


    // The sub-1e12 remainder becomes protocol dust and is never refunded.
    function test_dustAccumulatesNeverRefunded() public {
        (Curve curve,) = _ridge();
        uint256 rem = 123456; // < 1e12
        uint256 balBefore = alice.balance;

        vm.prank(alice);
        curve.buy{value: _wei(1e6) + rem}(0, block.timestamp, alice);
        assertEq(curve.dustWei(), rem, "first remainder");

        vm.prank(alice);
        curve.buy{value: _wei(1e6) + 1}(0, block.timestamp, alice);
        assertEq(curve.dustWei(), rem + 1, "remainders sum");

        // The buyer paid the whole value; no part of the remainder came back.
        assertEq(alice.balance, balBefore - (_wei(1e6) + rem) - (_wei(1e6) + 1), "no refund of dust");
    }

    // fee6 == 0 skips the FeeVault call entirely (MATH 6.1). The only reachable
    // route is a feeBps == 0 market (creatorBps + protocolBps == 0 is legal); both
    // a buy and a sell must succeed with no credit recorded.
    function test_zeroFeeMarketSkipsVault() public {
        (Curve curve, PeakToken token) = _market(R6_RIDGE, 0, 0, 0, 0, 0, creator, true);

        vm.prank(alice);
        curve.buy{value: _wei(1e6)}(0, block.timestamp, alice);
        assertEq(vault.balances(creator), 0, "no creator credit on zero-fee buy");
        assertEq(vault.balances(treasury), 0, "no treasury credit on zero-fee buy");

        uint256 held = token.balanceOf(alice);
        vm.prank(alice);
        curve.sell(held, 0, block.timestamp);
        assertEq(vault.balances(creator), 0, "no creator credit on zero-fee sell");
        assertEq(vault.balances(treasury), 0, "no treasury credit on zero-fee sell");
        assertEq(curve.sold(), 0, "sold returns to zero after full round trip");
    }

    // ----- anti-snipe window -----

    function test_antiSnipeRecipientLock() public {
        (Curve curve,) = _market(R6_RIDGE, FEE_BPS, CREATOR_BPS, PROTOCOL_BPS, 10, 5e9, creator, true);
        vm.prank(alice);
        vm.expectRevert(Curve.RecipientNotSender.selector);
        curve.buy{value: _wei(1e6)}(0, block.timestamp, bob);
    }

    function test_antiSnipeCapCumulative() public {
        (Curve curve,) = _market(R6_RIDGE, FEE_BPS, CREATOR_BPS, PROTOCOL_BPS, 10, 3e9, creator, true);
        // Neither 2e9 buy crosses, so spent6 == usdcIn6 and the cap counts it whole.
        vm.prank(alice);
        curve.buy{value: _wei(2e9)}(0, block.timestamp, alice);
        assertEq(curve.boughtInWindow6(alice), 2e9, "first spend accrues");

        // The running total 4e9 exceeds the 3e9 cap on the second buy.
        vm.prank(alice);
        vm.expectRevert(Curve.WindowCapExceeded.selector);
        curve.buy{value: _wei(2e9)}(0, block.timestamp, alice);
    }

    function test_antiSnipeFactoryExempt() public {
        (Curve curve, PeakToken token) = _market(R6_RIDGE, FEE_BPS, CREATOR_BPS, PROTOCOL_BPS, 10, 5e9, creator, true);
        vm.deal(factory, 1e30);
        // Above the 5e9 cap and to a third party: the factory dev-buy is exempt from
        // both the recipient lock and the cap; nothing accrues for it.
        vm.prank(factory);
        curve.buy{value: _wei(10e9)}(0, block.timestamp, alice);
        assertGt(token.balanceOf(alice), 0, "recipient received tokens");
        assertEq(curve.boughtInWindow6(factory), 0, "factory never accrues");
    }

    // Note 1, decisive: the cap counts spent6 (usdcIn6 - refund6), never usdcIn6.
    // A crossing buy of 15e9 spends only spend6 ~= 12.15e9; the ~2.85e9 refund does
    // not consume allowance. With the cap set between the two, counting usdcIn6
    // would revert and counting spent6 passes.
    function test_antiSnipeCountsSpentNotUsdcIn() public {
        CurveMath.CrossingQuote memory cq = CurveMath.crossingQuote(X0_RIDGE, Y1, TS, FEE_BPS);
        (Curve curve,) = _market(R6_RIDGE, FEE_BPS, CREATOR_BPS, PROTOCOL_BPS, 10, 13e9, creator, true);
        assertLt(cq.spend6, 13e9, "spend6 below cap");
        assertGt(uint256(15e9), 13e9, "usdcIn6 above cap");

        vm.prank(alice);
        curve.buy{value: _wei(15e9)}(0, block.timestamp, alice);
        assertEq(uint8(curve.state()), uint8(Curve.Phase.PEAK), "crossed to PEAK");
        assertEq(curve.boughtInWindow6(alice), cq.spend6, "only spend6 consumes allowance");
    }

    function test_antiSnipePostWindowRelaxed() public {
        (Curve curve, PeakToken token) = _market(R6_RIDGE, FEE_BPS, CREATOR_BPS, PROTOCOL_BPS, 10, 5e9, creator, true);
        vm.roll(block.number + 11); // past antiSnipeEndBlock
        // Both relaxations apply to everyone: to != msg.sender, and above the cap.
        vm.prank(bob);
        curve.buy{value: _wei(10e9)}(0, block.timestamp, alice);
        assertGt(token.balanceOf(alice), 0, "third-party recipient allowed after window");
        assertEq(curve.boughtInWindow6(bob), 0, "no accrual after the window");
    }

    // ----- sell, both phases -----

    function test_sellAscentBasic() public {
        (Curve curve, PeakToken token) = _ridge();
        // A buy first so alice holds tokens and sold advances.
        vm.prank(alice);
        curve.buy{value: _wei(1e7)}(0, block.timestamp, alice);
        uint256 held = token.balanceOf(alice);
        uint256 xBefore = curve.x();
        uint256 soldBefore = curve.sold();

        uint256 tokensIn = held / 2;
        CurveMath.SellQuote memory q = CurveMath.sellQuote(xBefore, curve.y(), tokensIn, FEE_BPS);
        uint256 balBefore = alice.balance;

        // No approval is ever granted; pullFrom moves the tokens regardless.
        assertEq(token.allowance(alice, address(curve)), 0, "no allowance before");
        vm.prank(alice);
        curve.sell(tokensIn, 0, block.timestamp);
        assertEq(token.allowance(alice, address(curve)), 0, "no allowance after");

        // gross6 leaves the pool, not usdcOut6 (MATH 6.3); sold falls by tokensIn.
        assertEq(curve.x(), xBefore - q.gross6, "x -= gross6");
        assertEq(curve.sold(), soldBefore - tokensIn, "sold -= tokensIn");
        assertEq(token.balanceOf(alice), held - tokensIn, "tokens pulled");
        assertEq(alice.balance, balBefore + q.usdcOut6 * 1e12, "paid usdcOut6*1e12");
        assertEq(uint8(curve.state()), uint8(Curve.Phase.ASCENT), "still ASCENT");
    }

    function test_sellRejectsSelfTrade() public {
        (Curve curve,) = _ridge();
        // The curve selling to itself is rejected before any other check (note 4).
        vm.prank(address(curve));
        vm.expectRevert(Curve.SelfTrade.selector);
        curve.sell(1, 0, block.timestamp);
    }

    function test_sellGuards() public {
        (Curve curve, PeakToken token) = _ridge();
        vm.prank(alice);
        curve.buy{value: _wei(1e7)}(0, block.timestamp, alice);
        uint256 held = token.balanceOf(alice);

        // Below minimum: zero tokens in.
        vm.prank(alice);
        vm.expectRevert(Curve.BelowMinimumTrade.selector);
        curve.sell(0, 0, block.timestamp);

        // More than the whole sold supply, in ASCENT. Read sold() before
        // expectRevert so the guarded call is sell, not the sold() staticcall.
        uint256 tooMuch = curve.sold() + 1;
        vm.prank(alice);
        vm.expectRevert(Curve.ExceedsSold.selector);
        curve.sell(tooMuch, 0, block.timestamp);

        // One token wei yields zero usdc out on this curve (gross6 floors to 0).
        vm.prank(alice);
        vm.expectRevert(Curve.ZeroUsdcOut.selector);
        curve.sell(1, 0, block.timestamp);

        // Past the deadline.
        vm.warp(1000);
        vm.prank(alice);
        vm.expectRevert(Curve.DeadlineExpired.selector);
        curve.sell(held / 2, 0, 999);

        // Slippage: demand one more unit than the quote pays.
        CurveMath.SellQuote memory q = CurveMath.sellQuote(curve.x(), curve.y(), held / 2, FEE_BPS);
        vm.prank(alice);
        vm.expectRevert(Curve.InsufficientUsdcOut.selector);
        curve.sell(held / 2, q.usdcOut6 + 1, 1000);

        // deadline == block.timestamp is allowed on the sell side too.
        vm.prank(alice);
        curve.sell(held / 2, 0, 1000);
        assertLt(curve.sold(), held, "sold fell");
    }

    function test_sellExceedsSoldInPeak() public {
        (Curve curve,) = _ridge();
        // A 15e9 buy overshoots the Summit and lands in PEAK with sold == Ts.
        vm.prank(alice);
        curve.buy{value: _wei(15e9)}(0, block.timestamp, alice);
        assertEq(uint8(curve.state()), uint8(Curve.Phase.PEAK), "in PEAK");

        // The guard still holds in PEAK: no holder can present more than sold.
        // Read sold() first: it is an external call and would otherwise be the one
        // vm.expectRevert binds to.
        uint256 tooMuch = curve.sold() + 1;
        vm.prank(alice);
        vm.expectRevert(Curve.ExceedsSold.selector);
        curve.sell(tooMuch, 0, block.timestamp);
    }

    // A sell that SUCCEEDS after the Summit. The crossing buy lands alice in PEAK
    // holding Ts; she then sells half. Fees are flat across both phases, so the
    // rate is still 125 bps and the fee credited is exactly
    // the FEE_BPS quote of this trade, split top-down -- there is no post-summit
    // re-rating and the fee is credited, never pushed.
    function test_sellPeakChargesPreSummitRate() public {
        (Curve curve, PeakToken token) = _ridge();
        vm.prank(alice);
        curve.buy{value: _wei(15e9)}(0, block.timestamp, alice); // overshoots => PEAK
        assertEq(uint8(curve.state()), uint8(Curve.Phase.PEAK), "in PEAK");
        assertEq(curve.feeBps(), FEE_BPS, "fee rate is the unchanged pre-summit 125 bps");

        uint256 held = token.balanceOf(alice); // == Ts
        uint256 tokensIn = held / 2;
        uint256 xBefore = curve.x();
        uint256 soldBefore = curve.sold();
        uint256 balBefore = alice.balance;
        uint256 creatorBefore = vault.balances(creator);
        uint256 treasuryBefore = vault.balances(treasury);

        // PEAK quote: y() = S - sold, and the SAME 125 bps rate as ASCENT.
        CurveMath.SellQuote memory q = CurveMath.sellQuote(xBefore, curve.y(), tokensIn, FEE_BPS);
        (uint256 creatorFee6, uint256 protocolFee6) = CurveMath.splitFee(q.fee6, FEE_BPS, CREATOR_BPS);

        vm.prank(alice);
        curve.sell(tokensIn, 0, block.timestamp);

        assertEq(uint8(curve.state()), uint8(Curve.Phase.PEAK), "still PEAK after the sell");
        assertEq(curve.x(), xBefore - q.gross6, "x -= gross6 (MATH 6.3)");
        assertEq(curve.sold(), soldBefore - tokensIn, "sold -= tokensIn in PEAK");
        assertEq(token.balanceOf(alice), held - tokensIn, "tokens pulled via pullFrom");
        assertEq(alice.balance, balBefore + q.usdcOut6 * 1e12, "paid usdcOut6*1e12");

        // The fee charged equals the 125 bps quote exactly, credited to the vault
        // and split top-down; a re-rated or double-ceil'd fee would break this.
        assertEq(vault.balances(creator) - creatorBefore, creatorFee6, "creator credited its 125 bps split");
        assertEq(vault.balances(treasury) - treasuryBefore, protocolFee6, "treasury credited its 125 bps split");
        assertEq(
            (vault.balances(creator) - creatorBefore) + (vault.balances(treasury) - treasuryBefore),
            q.fee6,
            "fee charged == FEE_BPS quote, the pre-summit rate"
        );
    }

    // ----- deferral and withdrawal -----

    // nonReentrant blocks re-entry on the Curve itself, not merely on the FeeVault.
    // A ReentrantTrader sells; its receive() fires inside _payout while the lock is
    // held and tries an otherwise-valid buy(). The re-entrant call reverts on OZ's
    // guard error (not a business rule), the outer sell settles exactly once, and
    // nothing is double-spent: sold and x move by this sell alone, no phantom tokens
    // land, and the payout is delivered once rather than deferred.
    function test_reentrancyGuardBlocksReenterOnPayout() public {
        (Curve curve, PeakToken token) = _ridge();
        ReentrantTrader attacker = new ReentrantTrader(curve);
        vm.deal(address(attacker), 1e30);

        // Buy sends no native back, so receive() is never armed on the way in.
        attacker.buyIn{value: _wei(1e7)}(block.timestamp);
        uint256 held = token.balanceOf(address(attacker));

        uint256 xBefore = curve.x();
        uint256 soldBefore = curve.sold();
        uint256 nativeBefore = address(attacker).balance;
        CurveMath.SellQuote memory q = CurveMath.sellQuote(xBefore, curve.y(), held, FEE_BPS);

        attacker.sellOut(held, block.timestamp);

        // The lock, not some incidental check, stopped the re-entrant buy.
        assertEq(
            attacker.reentryError(),
            bytes4(keccak256("ReentrancyGuardReentrantCall()")),
            "re-entrant buy reverted on the reentrancy guard"
        );
        // A slipped-in buy would have raised sold and x and minted the attacker
        // tokens; none of that happened. The reverted buy returned its 1e15, so the
        // only native delta is the one payout.
        assertEq(curve.sold(), soldBefore - held, "sold fell by tokensIn only");
        assertEq(curve.x(), xBefore - q.gross6, "x fell by gross6 only, no re-entrant net6");
        assertEq(token.balanceOf(address(attacker)), 0, "no phantom tokens from a re-entrant buy");
        assertEq(curve.deferred(address(attacker)), 0, "payout delivered, not deferred");
        assertEq(address(attacker).balance, nativeBefore + q.usdcOut6 * 1e12, "paid usdcOut6*1e12 once");
    }

    function test_sellDeferralLifecycle() public {
        (Curve curve, PeakToken token) = _ridge();
        RejectingTrader rt = new RejectingTrader(curve);
        vm.deal(address(rt), 1e30);

        // rt buys (token.transfer does not touch its receive), so it holds tokens.
        rt.buy{value: _wei(1e7)}(0, block.timestamp, address(rt));
        uint256 held = token.balanceOf(address(rt));
        uint256 vaultCreatorBefore = vault.balances(creator);
        uint256 vaultTreasuryBefore = vault.balances(treasury);

        // The sell payout bounces (reject == true): it defers, the trade still
        // completes, and no fee is lost from the vault ledger.
        CurveMath.SellQuote memory q = CurveMath.sellQuote(curve.x(), curve.y(), held, FEE_BPS);
        vm.expectEmit(true, false, false, true, address(curve));
        emit PayoutDeferred(address(rt), q.usdcOut6 * 1e12);
        rt.sell(held, 0, block.timestamp);
        assertEq(curve.deferred(address(rt)), q.usdcOut6 * 1e12, "deferred exactly usdcOut6*1e12");
        assertGt(vault.balances(creator) + vault.balances(treasury), vaultCreatorBefore + vaultTreasuryBefore, "fee still credited");

        // While the reject stands, withdraw reverts and the balance stays claimable.
        vm.expectRevert();
        rt.withdraw();
        assertEq(curve.deferred(address(rt)), q.usdcOut6 * 1e12, "still claimable after failed withdraw");

        // Lift the reject: the deferred value is paid out exactly, once.
        rt.setReject(false);
        uint256 amt = curve.deferred(address(rt));
        uint256 balBefore = address(rt).balance;
        rt.withdraw();
        assertEq(address(rt).balance, balBefore + amt, "withdraw pays exactly");
        assertEq(curve.deferred(address(rt)), 0, "cleared");
    }

    function test_withdrawDeferredRevertsOnNothing() public {
        (Curve curve,) = _ridge();
        vm.prank(alice);
        vm.expectRevert(Curve.NothingDeferred.selector);
        curve.withdrawDeferred();
    }

    // A creator that cannot be paid by a push (here the Arc seeded blocklisted
    // address) does not brick its market: the fee is credited to the vault, never
    // pushed, so the buy succeeds and the credit is recorded for a later claim.
    function test_blocklistedCreatorTradesSucceed() public {
        (Curve curve,) = _market(R6_RIDGE, FEE_BPS, CREATOR_BPS, PROTOCOL_BPS, 0, 0, ARC_BLOCKLISTED, true);
        CurveMath.BuyQuote memory q = CurveMath.buyQuote(X0_RIDGE, Y0, 1e6, FEE_BPS);
        (uint256 expCreator,) = CurveMath.splitFee(q.fee6, FEE_BPS, CREATOR_BPS);

        vm.prank(alice);
        curve.buy{value: _wei(1e6)}(0, block.timestamp, alice);

        assertEq(vault.balances(ARC_BLOCKLISTED), expCreator, "creator fee credited, not pushed");
        assertEq(ARC_BLOCKLISTED.balance, 0, "nothing pushed to the creator");
    }

    // ----- sweepDust -----

    function test_sweepDustAscent() public {
        // Zero-fee market so the treasury ledger moves only by the dust credit.
        (Curve curve,) = _market(R6_RIDGE, 0, 0, 0, 0, 0, creator, true);
        uint256 rem = 1e12 - 1;
        vm.startPrank(alice);
        curve.buy{value: _wei(1e6) + rem}(0, block.timestamp, alice);
        curve.buy{value: _wei(1e6) + rem}(0, block.timestamp, alice);
        vm.stopPrank();
        assertEq(curve.dustWei(), 2 * rem, "dust summed");

        uint256 xBefore = curve.x();
        uint256 soldBefore = curve.sold();
        uint256 treasuryBefore = vault.balances(treasury);
        uint256 amt = curve.dustWei();

        vm.expectEmit(false, false, false, true, address(curve));
        emit DustSwept(amt, amt / 1e12);
        curve.sweepDust();

        assertEq(curve.dustWei(), 0, "dust zeroed");
        assertEq(vault.balances(treasury), treasuryBefore + amt / 1e12, "treasury credited floor(amt/1e12)");
        assertEq(curve.x(), xBefore, "reserves untouched");
        assertEq(curve.sold(), soldBefore, "sold untouched");
    }

    function test_sweepDustPeak() public {
        (Curve curve,) = _market(R6_RIDGE, 0, 0, 0, 0, 0, creator, true);
        // Cross to PEAK with an exact whole-unit spend so the crossing buy leaves
        // no dust of its own (refund6 == 0 on a zero-fee market).
        CurveMath.CrossingQuote memory cq = CurveMath.crossingQuote(X0_RIDGE, Y1, TS, 0);
        vm.startPrank(alice);
        curve.buy{value: _wei(cq.spend6)}(0, block.timestamp, alice);
        assertEq(uint8(curve.state()), uint8(Curve.Phase.PEAK), "in PEAK");

        uint256 rem = 1e12 - 1;
        curve.buy{value: _wei(1e6) + rem}(0, block.timestamp, alice);
        curve.buy{value: _wei(1e6) + rem}(0, block.timestamp, alice);
        vm.stopPrank();

        uint256 amt = curve.dustWei();
        assertEq(amt, 2 * rem, "dust summed in PEAK");
        uint256 treasuryBefore = vault.balances(treasury);

        vm.expectEmit(false, false, false, true, address(curve));
        emit DustSwept(amt, amt / 1e12);
        curve.sweepDust();
        assertEq(curve.dustWei(), 0, "dust zeroed");
        assertEq(vault.balances(treasury), treasuryBefore + amt / 1e12, "treasury credited");
    }

    function test_sweepDustNothingToSweep() public {
        (Curve curve,) = _ridge();
        // Nothing accumulated at all.
        vm.expectRevert(Curve.NothingToSweep.selector);
        curve.sweepDust();

        // A sub-1e12 remainder is present but not even one whole unit to credit.
        vm.prank(alice);
        curve.buy{value: _wei(1e6) + 123456}(0, block.timestamp, alice);
        assertEq(curve.dustWei(), 123456, "dust below one unit");
        vm.expectRevert(Curve.NothingToSweep.selector);
        curve.sweepDust();
    }

    // ----- views -----

    function test_viewsAscent() public {
        (Curve curve,) = _ridge();
        vm.prank(alice);
        curve.buy{value: _wei(1e7)}(0, block.timestamp, alice);

        assertEq(curve.y(), uint256(Y0) - curve.sold(), "y() = y0 - sold in ASCENT");
        assertEq(curve.priceX18(), CurveMath.priceX18(curve.x(), curve.y()), "priceX18");
        assertEq(curve.marketCap6(), CurveMath.marketCap6(curve.x(), curve.y(), SUP), "marketCap6");
        assertEq(curve.progressBps(), Math.mulDiv(curve.sold(), 10000, TS, Math.Rounding.Floor), "progress floor");
        assertEq(curve.usdcRaised6(), uint256(curve.x()) - curve.x0(), "raised = x - x0 in ASCENT");
    }

    function test_viewsPeak() public {
        (Curve curve,) = _ridge();
        vm.prank(alice);
        curve.buy{value: _wei(15e9)}(0, block.timestamp, alice);
        assertEq(uint8(curve.state()), uint8(Curve.Phase.PEAK), "in PEAK");

        assertEq(curve.y(), uint256(SUP) - curve.sold(), "y() = S - sold in PEAK");
        assertEq(curve.progressBps(), 10000, "progress pinned at 10000");
        assertEq(curve.usdcRaised6(), curve.raised6(), "raised = raised6 in PEAK, never x");
    }

    // ----- quotes: never revert, and mirror the trade field-for-field -----

    function test_quoteBuyMirrorsBuy() public {
        (Curve curve,) = _ridge();
        Curve.BuyQuote memory r = curve.quoteBuy(1e6);
        CurveMath.BuyQuote memory oq = CurveMath.buyQuote(X0_RIDGE, Y0, 1e6, FEE_BPS);
        (uint256 c, uint256 p) = CurveMath.splitFee(oq.fee6, FEE_BPS, CREATOR_BPS);

        assertEq(uint8(r.status), uint8(Curve.QuoteStatus.Ok), "Ok");
        assertEq(r.crossed, false, "not crossing");
        assertEq(r.tokensOut, oq.tokensOut, "tokensOut");
        assertEq(r.fee6, oq.fee6, "fee6");
        assertEq(r.net6, oq.net6, "net6");
        assertEq(r.spend6, 1e6, "spend6 == usdcIn6");
        assertEq(r.refund6, 0, "no refund");
        assertEq(r.creatorFee6, c, "creator split");
        assertEq(r.protocolFee6, p, "protocol split");

        // The trade reproduces the quote exactly.
        vm.prank(alice);
        curve.buy{value: _wei(1e6)}(0, block.timestamp, alice);
        assertEq(curve.sold(), r.tokensOut, "trade sold == quoted tokensOut");
        assertEq(vault.balances(creator), r.creatorFee6, "trade credited quoted creator fee");
        assertEq(vault.balances(treasury), r.protocolFee6, "trade credited quoted protocol fee");
    }

    function test_quoteBuyCrossingMirrors() public {
        (Curve curve,) = _ridge();
        Curve.BuyQuote memory r = curve.quoteBuy(15e9);
        CurveMath.CrossingQuote memory cq = CurveMath.crossingQuote(X0_RIDGE, Y1, TS, FEE_BPS);

        assertEq(r.crossed, true, "crossing");
        assertEq(r.tokensOut, TS, "tokensOut ASSIGNED to remaining");
        assertEq(r.net6, cq.netNeeded6, "net6 == netNeeded6");
        assertEq(r.fee6, cq.feeUsed6, "fee6 == feeUsed6");
        assertEq(r.spend6, cq.spend6, "spend6");
        assertEq(r.refund6, 15e9 - cq.spend6, "refund6");

        vm.prank(alice);
        curve.buy{value: _wei(15e9)}(0, block.timestamp, alice);
        assertEq(curve.sold(), TS, "trade lands exactly on Ts");
        assertEq(uint8(curve.state()), uint8(Curve.Phase.PEAK), "trade crossed to PEAK");
        assertEq(curve.deferred(alice), 0, "refund paid, not deferred");
    }

    function test_quoteBuyStatusesAndNeverRevert() public {
        (Curve curve,) = _ridge();
        // Below the minimum: reported, not reverted.
        assertEq(uint8(curve.quoteBuy(1).status), uint8(Curve.QuoteStatus.BelowMinimum), "below min");
        assertEq(curve.quoteBuy(1).tokensOut, 0, "no tokens quoted below min");

        // A very large input still returns rather than reverting.
        Curve.BuyQuote memory big = curve.quoteBuy(1e15);
        assertEq(big.crossed, true, "huge input crosses");

        // In PEAK the crossing branch is unreachable: crossed is never true.
        vm.prank(alice);
        curve.buy{value: _wei(15e9)}(0, block.timestamp, alice);
        Curve.BuyQuote memory peak = curve.quoteBuy(1e9);
        assertEq(uint8(peak.status), uint8(Curve.QuoteStatus.Ok), "Ok in PEAK");
        assertEq(peak.crossed, false, "never crossed in PEAK");
    }

    function test_quoteSellMirrorsSell() public {
        (Curve curve, PeakToken token) = _ridge();
        vm.prank(alice);
        curve.buy{value: _wei(1e7)}(0, block.timestamp, alice);
        uint256 tokensIn = token.balanceOf(alice) / 3;

        Curve.SellQuote memory r = curve.quoteSell(tokensIn);
        CurveMath.SellQuote memory oq = CurveMath.sellQuote(curve.x(), curve.y(), tokensIn, FEE_BPS);
        (uint256 c, uint256 p) = CurveMath.splitFee(oq.fee6, FEE_BPS, CREATOR_BPS);
        assertEq(uint8(r.status), uint8(Curve.QuoteStatus.Ok), "Ok");
        assertEq(r.usdcOut6, oq.usdcOut6, "usdcOut6");
        assertEq(r.fee6, oq.fee6, "fee6");
        assertEq(r.gross6, oq.gross6, "gross6");
        assertEq(r.creatorFee6, c, "creator split");
        assertEq(r.protocolFee6, p, "protocol split");

        uint256 xBefore = curve.x();
        uint256 balBefore = alice.balance;
        vm.prank(alice);
        curve.sell(tokensIn, 0, block.timestamp);
        assertEq(alice.balance, balBefore + r.usdcOut6 * 1e12, "trade paid quoted usdcOut6");
        assertEq(curve.x(), xBefore - r.gross6, "trade removed quoted gross6");

        // Status paths, no revert.
        assertEq(uint8(curve.quoteSell(0).status), uint8(Curve.QuoteStatus.BelowMinimum), "below min");
        assertEq(uint8(curve.quoteSell(curve.sold() + 1).status), uint8(Curve.QuoteStatus.ExceedsSold), "exceeds sold");
        // A one-wei-token sell is above the tokensIn floor yet its gross6 floors to
        // zero against a ~1e27 reserve, so the view reports ZeroUsdcOut rather than
        // reverting: a real UI quote for a dust-sized position (SPEC 6.1).
        assertEq(uint8(curve.quoteSell(1).status), uint8(Curve.QuoteStatus.ZeroUsdcOut), "dust sell rounds to zero out");
    }

    // ----- credit isolation and the crossing landing -----

    // A curve of identical bytecode that the factory never registered cannot credit
    // the vault, so its very first fee-bearing buy reverts.
    function test_unregisteredCurveCannotCredit() public {
        (Curve curve,) = _market(R6_RIDGE, FEE_BPS, CREATOR_BPS, PROTOCOL_BPS, 0, 0, creator, false);
        vm.prank(alice);
        vm.expectRevert(FeeVault.NotAuthorized.selector);
        curve.buy{value: _wei(1e6)}(0, block.timestamp, alice);
    }

    function test_crossingExactSpendZeroRefund() public {
        (Curve curve,) = _ridge();
        CurveMath.CrossingQuote memory cq = CurveMath.crossingQuote(X0_RIDGE, Y1, TS, FEE_BPS);

        // usdcIn6 == spend6: enters the crossing branch with no refund and still
        // reaches the Summit, distinct from the over-crossing-with-refund case.
        Curve.BuyQuote memory r = curve.quoteBuy(cq.spend6);
        assertEq(r.crossed, true, "crossing branch");
        assertEq(r.refund6, 0, "zero refund at exact spend");

        vm.prank(alice);
        curve.buy{value: _wei(cq.spend6)}(0, block.timestamp, alice);
        assertEq(curve.sold(), TS, "sold lands exactly on Ts");
        assertEq(uint8(curve.state()), uint8(Curve.Phase.PEAK), "crossed to PEAK");
        assertEq(curve.deferred(alice), 0, "no deferral");
    }

    function test_crossingOvershootRefund() public {
        (Curve curve,) = _ridge();
        CurveMath.CrossingQuote memory cq = CurveMath.crossingQuote(X0_RIDGE, Y1, TS, FEE_BPS);
        uint256 balBefore = alice.balance;

        vm.prank(alice);
        curve.buy{value: _wei(15e9)}(0, block.timestamp, alice);

        assertEq(curve.sold(), TS, "sold lands exactly on Ts, never above");
        // The refund was paid, so the buyer parted with exactly spend6 of native.
        assertEq(balBefore - alice.balance, cq.spend6 * 1e12, "net paid == spend6*1e12");
        assertEq(curve.deferred(alice), 0, "refund paid, not deferred");
    }

    // A native and a token donation to the curve move no decision, because the
    // contract reads only storage (x, sold, y()) and never a balance (MATH 8).
    function test_donationDoesNotPerturb() public {
        (Curve curve, PeakToken token) = _ridge();
        vm.prank(alice);
        curve.buy{value: _wei(1e6)}(0, block.timestamp, alice);

        // Donate one token wei and one native wei directly to the curve.
        vm.prank(alice);
        token.transfer(address(curve), 1);
        vm.deal(address(curve), address(curve).balance + 1);

        uint256 expected = CurveMath.buyQuote(curve.x(), curve.y(), 1e6, FEE_BPS).tokensOut;
        assertEq(curve.quoteBuy(1e6).tokensOut, expected, "quote unperturbed by donation");

        uint256 soldBefore = curve.sold();
        vm.prank(bob);
        curve.buy{value: _wei(1e6)}(0, block.timestamp, bob);
        assertEq(curve.sold() - soldBefore, expected, "trade unperturbed by donation");
    }

    // Decode the packed slots directly and reconcile each field with its getter, so
    // the MATH 4 layout is proven by storage, not only by forge inspect.
    function test_storageLayoutPacking() public {
        (Curve curve,) = _market(R6_RIDGE, FEE_BPS, CREATOR_BPS, PROTOCOL_BPS, 10, 5e9, creator, true);
        vm.prank(alice);
        curve.buy{value: _wei(1e6) + 789}(0, block.timestamp, alice);

        uint256 s0 = uint256(vm.load(address(curve), bytes32(uint256(0))));
        assertEq(uint128(s0), curve.x(), "slot0 low = x");
        assertEq(uint128(s0 >> 128), curve.sold(), "slot0 high = sold");

        uint256 s1 = uint256(vm.load(address(curve), bytes32(uint256(1))));
        assertEq(uint128(s1), curve.x0(), "slot1 x0");
        assertEq(uint120(s1 >> 128), curve.raised6(), "slot1 raised6");
        assertEq(uint8(s1 >> 248), uint8(curve.state()), "slot1 state");

        uint256 s4 = uint256(vm.load(address(curve), bytes32(uint256(4))));
        assertEq(address(uint160(s4)), curve.token(), "slot4 token");
        assertEq(uint16(s4 >> 160), curve.feeBps(), "slot4 feeBps");
        assertEq(uint16(s4 >> 176), curve.creatorBps(), "slot4 creatorBps");
        assertEq(uint16(s4 >> 192), curve.protocolBps(), "slot4 protocolBps");
        assertEq(uint48(s4 >> 208), curve.antiSnipeEndBlock(), "slot4 antiSnipeEndBlock");

        uint256 s5 = uint256(vm.load(address(curve), bytes32(uint256(5))));
        assertEq(address(uint160(s5)), curve.creator(), "slot5 creator");
        assertEq(uint96(s5 >> 160), curve.maxBuyPerAddress6(), "slot5 maxBuyPerAddress6");

        uint256 s8 = uint256(vm.load(address(curve), bytes32(uint256(8))));
        assertEq(address(uint160(s8)), curve.factory(), "slot8 factory");
        assertEq(uint96(s8 >> 160), curve.dustWei(), "slot8 dustWei");
    }

    // ----- Trade / TradeDetail wire format -----

    function test_tradeEventsBuy() public {
        (Curve curve,) = _ridge();
        CurveMath.BuyQuote memory oq = CurveMath.buyQuote(X0_RIDGE, Y0, 1e6, FEE_BPS);
        uint120 xAfter = uint120(uint256(X0_RIDGE) + oq.net6);
        uint120 soldAfter = uint120(oq.tokensOut);

        vm.expectEmit(true, true, true, true, address(curve));
        emit Trade(address(curve), alice, true, uint120(1e6), 0, 0, uint120(oq.tokensOut), uint120(oq.fee6), xAfter, soldAfter, 0);
        vm.expectEmit(true, true, true, true, address(curve));
        emit TradeDetail(alice, alice, 1e6, oq.net6, false, 0);

        vm.prank(alice);
        curve.buy{value: _wei(1e6)}(0, block.timestamp, alice);

        assertEq(curve.x(), xAfter, "tReserve6After == x()");
        assertEq(curve.sold(), soldAfter, "supplySold6After == sold()");
    }

    function test_tradeEventsSell() public {
        (Curve curve, PeakToken token) = _ridge();
        vm.prank(alice);
        curve.buy{value: _wei(1e7)}(0, block.timestamp, alice);

        uint256 tokensIn = token.balanceOf(alice) / 3;
        uint256 xNow = curve.x();
        uint256 soldNow = curve.sold();
        CurveMath.SellQuote memory oq = CurveMath.sellQuote(xNow, curve.y(), tokensIn, FEE_BPS);
        uint120 xAfter = uint120(xNow - oq.gross6);
        uint120 soldAfter = uint120(soldNow - tokensIn);

        vm.expectEmit(true, true, true, true, address(curve));
        emit Trade(address(curve), alice, false, 0, uint120(oq.usdcOut6), uint120(tokensIn), 0, uint120(oq.fee6), xAfter, soldAfter, 0);
        vm.expectEmit(true, true, true, true, address(curve));
        emit TradeDetail(alice, alice, 0, oq.gross6, false, 0);

        vm.prank(alice);
        curve.sell(tokensIn, 0, block.timestamp);

        assertEq(curve.x(), xAfter, "tReserve6After == x()");
        assertEq(curve.sold(), soldAfter, "supplySold6After == sold()");
    }

    // ----- fee reconciliation and round-trip loss (MATH 9 T5, T4) -----

    // T5 for one market: every fee6 recorded on a Trade equals the vault credits of
    // this curve, minus any swept dust. No dust is swept here, so the two sides are
    // equal. The split sums to fee6 by construction (creditPair credits both legs).
    function test_feeReconciliationSingleMarket() public {
        (Curve curve, PeakToken token) = _ridge();
        uint256 total;

        total += CurveMath.buyQuote(curve.x(), curve.y(), 1e7, FEE_BPS).fee6;
        vm.prank(alice);
        curve.buy{value: _wei(1e7)}(0, block.timestamp, alice);

        total += CurveMath.buyQuote(curve.x(), curve.y(), 5e6, FEE_BPS).fee6;
        vm.prank(bob);
        curve.buy{value: _wei(5e6)}(0, block.timestamp, bob);

        uint256 tokensIn = token.balanceOf(alice) / 2;
        total += CurveMath.sellQuote(curve.x(), curve.y(), tokensIn, FEE_BPS).fee6;
        vm.prank(alice);
        curve.sell(tokensIn, 0, block.timestamp);

        assertEq(vault.balances(creator) + vault.balances(treasury), total, "credits reconcile with fee6 sum");
    }

    function test_roundTripLossBand1e6() public {
        (Curve curve, PeakToken token) = _ridge();
        uint256 balBefore = alice.balance;

        vm.startPrank(alice);
        curve.buy{value: _wei(1e6)}(0, block.timestamp, alice);
        curve.sell(token.balanceOf(alice), 0, block.timestamp);
        vm.stopPrank();

        uint256 loss6 = (balBefore - alice.balance) / 1e12;
        assertGe(loss6, 24000, "loss >= 2.40%");
        assertLe(loss6, 26000, "loss <= 2.60%");
    }

    function test_roundTripLossSmall() public {
        (Curve curve, PeakToken token) = _ridge();
        uint256 usdcIn6 = 1000;
        uint256 balBefore = alice.balance;

        vm.startPrank(alice);
        curve.buy{value: _wei(usdcIn6)}(0, block.timestamp, alice);
        curve.sell(token.balanceOf(alice), 0, block.timestamp);
        vm.stopPrank();

        uint256 loss6 = (balBefore - alice.balance) / 1e12;
        // The relative band does not apply this small; the absolute bound does.
        assertLe(loss6, (24844 * usdcIn6) / 1_000_000 + 4, "loss <= 2.4844%*usdcIn6 + 4");
    }
}

