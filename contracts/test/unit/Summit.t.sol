// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {CurveTestBase, RejectingTrader} from "./Curve.t.sol";
import {Curve} from "../../src/Curve.sol";
import {PeakToken} from "../../src/PeakToken.sol";
import {CurveMath} from "../../src/libraries/CurveMath.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

// The Summit is the one-way ASCENT to PEAK transition. Everything here exercises
// that crossing: its math (MATH 6.4), the price and market-cap continuity that
// MATH 5 and MATH 2 guarantee, the T8 raise identity, and the frozen post-PEAK
// behaviour. Reserves are read only through the contract's own views or the
// CurveMath oracle; no test re-derives a formula.
contract SummitTest is CurveTestBase {
    event Summit(uint120 raised6, uint128 y, uint256 priceX18);
    event PayoutDeferred(address indexed recipient, uint256 weiAmount);

    function _absDiff(uint256 a, uint256 b) internal pure returns (uint256) {
        return a > b ? a - b : b - a;
    }

    // A non-crossing exact landing on Ts is unreachable at this granularity (one
    // USDC unit moves sold by ~1.67e16 token-wei near the summit), so the exact
    // landing is reached through the crossing ASSIGN, which then trips the
    // unconditional summit trigger. usdcIn6 == spend6 lands sold precisely on Ts.
    function test_crossingExactSpendSummits() public {
        (Curve curve, PeakToken token) = _ridge();
        CurveMath.CrossingQuote memory cq = CurveMath.crossingQuote(X0_RIDGE, Y1, TS, FEE_BPS);
        // MATH 6.4(b): the net at spend6 is exactly netNeeded6, not a unit more.
        assertEq(CurveMath.buyQuote(X0_RIDGE, Y0, cq.spend6, FEE_BPS).net6, cq.netNeeded6, "net6(spend6)==netNeeded6");

        uint256 raised6 = cq.netNeeded6; // real == x - x0 == netNeeded6
        uint256 balBefore = alice.balance;

        vm.expectEmit(false, false, false, true, address(curve));
        emit Summit(uint120(raised6), uint128(TL), CurveMath.priceX18(raised6, TL));
        vm.prank(alice);
        curve.buy{value: _wei(cq.spend6)}(0, block.timestamp, alice);

        // MATH 6.4(a): spend6 <= usdcIn6; here usdcIn6 == spend6, so no refund.
        assertEq(balBefore - alice.balance, _wei(cq.spend6), "no refund at exact spend");
        assertEq(uint8(curve.state()), uint8(Curve.Phase.PEAK), "PEAK");
        assertEq(curve.sold(), TS, "sold lands exactly on Ts");
        assertEq(curve.raised6(), raised6, "raised6 == netNeeded6");
        assertEq(curve.raised6(), R6_RIDGE + 1, "raised6 == R6+1 (Ridge)");
        assertEq(curve.y(), TL, "y() == Tl after the summit");
        assertEq(token.balanceOf(alice), TS, "buyer holds exactly remaining");
    }
    function test_crossingBoundaryBelowStaysAscent() public {
        (Curve curve,) = _ridge();
        CurveMath.CrossingQuote memory cq = CurveMath.crossingQuote(X0_RIDGE, Y1, TS, FEE_BPS);
        // MATH 6.4(c): one unit less than spend6 cannot buy `remaining`.
        vm.prank(alice);
        curve.buy{value: _wei(cq.spend6 - 1)}(0, block.timestamp, alice);
        assertEq(uint8(curve.state()), uint8(Curve.Phase.ASCENT), "still ASCENT");
        assertLt(curve.sold(), TS, "sold below Ts");
    }

    // ----- price continuity across the summit (MATH 5, T7) -----

    function _crossFresh(uint256 r6, uint128 x0) internal returns (Curve curve, uint256 raised6) {
        (curve,) = _market(r6, FEE_BPS, CREATOR_BPS, PROTOCOL_BPS, 0, 0, creator, true);
        CurveMath.CrossingQuote memory cq = CurveMath.crossingQuote(x0, Y1, TS, FEE_BPS);
        vm.prank(alice);
        curve.buy{value: _wei(cq.spend6)}(0, block.timestamp, alice);
        raised6 = curve.raised6();
    }

    function _assertContinuity(uint256 r6, uint128 x0) internal {
        (Curve curve, uint256 raised6) = _crossFresh(r6, x0);
        // ASCENT price at the summit (virtual reserve x0+raised6 over y1) against
        // the PEAK price immediately after (real reserve raised6 over Tl).
        uint256 pBefore = CurveMath.priceX18(x0 + raised6, Y1);
        uint256 pAfter = curve.priceX18();
        assertEq(pAfter, CurveMath.priceX18(raised6, TL), "post-summit price is raised6 over Tl");
        assertGe(pAfter, pBefore, "price does not fall across the summit");
        assertLe(pAfter - pBefore, 4e30 / uint256(TS), "continuity gap within 4e30/Ts");
    }

    function test_continuityThreePresets() public {
        _assertContinuity(R6_BASECAMP, X0_BASECAMP);
        _assertContinuity(R6_RIDGE, X0_RIDGE);
        _assertContinuity(R6_ALPINE, X0_ALPINE);
    }

    function testFuzz_continuity(uint256 r6) public {
        r6 = bound(r6, 1e9, 1e13);
        uint128 x0 = uint128(CurveMath.deriveParams(SUP, r6, R_X18).x0);
        (Curve curve, uint256 raised6) = _crossFresh(r6, x0);
        uint256 pBefore = CurveMath.priceX18(x0 + raised6, Y1);
        uint256 pAfter = curve.priceX18();
        // Nothing on-chain depends on the sign; only the magnitude is bounded.
        assertLe(_absDiff(pAfter, pBefore), 4e30 / uint256(TS), "|price gap| within 4e30/Ts");
    }

    // ----- T8: the raise identity -----

    function _assertT8(uint256 r6, uint128 x0) internal {
        (Curve curve,) = _market(r6, FEE_BPS, CREATOR_BPS, PROTOCOL_BPS, 0, 0, creator, true);
        CurveMath.CrossingQuote memory cq = CurveMath.crossingQuote(x0, Y1, TS, FEE_BPS);
        // Advance to just below the summit so the virtual reserve just before the
        // crossing is observable, then cross with a buy that overshoots the now
        // tiny remaining.
        vm.prank(alice);
        curve.buy{value: _wei(cq.spend6 - 1)}(0, block.timestamp, alice);
        uint256 xNearTop = curve.x();
        vm.prank(bob);
        curve.buy{value: _wei(cq.spend6)}(0, block.timestamp, bob);
        assertEq(uint8(curve.state()), uint8(Curve.Phase.PEAK), "summited");

        uint256 raised6 = curve.usdcRaised6(); // PEAK: returns raised6, never x
        uint256 reff6 = CurveMath.deriveParams(SUP, r6, R_X18).Reff6;
        assertGe(raised6, reff6, "raised6 >= Reff6");
        assertLe(raised6, reff6 + 2, "raised6 <= Reff6 + 2");
        assertEq(raised6, r6 + 1, "raised6 == R6 + 1 for the presets");
        assertLt(raised6, xNearTop, "real raise is below the virtual reserve just before the summit");
        assertEq(curve.x(), curve.raised6(), "MATH 7: summit writes x = raised6");
    }

    function test_t8AllPresets() public {
        _assertT8(R6_BASECAMP, X0_BASECAMP);
        _assertT8(R6_RIDGE, X0_RIDGE);
        _assertT8(R6_ALPINE, X0_ALPINE);
    }

    // ----- frozen post-PEAK behaviour (MATH 7) -----

    function test_postPeakBehaviour() public {
        (Curve curve,) = _ridge();
        CurveMath.CrossingQuote memory cq = CurveMath.crossingQuote(X0_RIDGE, Y1, TS, FEE_BPS);
        vm.prank(alice);
        curve.buy{value: _wei(cq.spend6)}(0, block.timestamp, alice);

        assertEq(curve.x0(), 0, "x0 zeroed: A3 is vacuous in PEAK");
        assertEq(curve.progressBps(), 10000, "progress pinned at 10000");
        assertEq(curve.usdcRaised6(), curve.raised6(), "usdcRaised6 tracks raised6, not x");
        assertEq(curve.feeBps(), FEE_BPS, "fee rate unchanged after the summit");

        uint256 raisedFrozen = curve.raised6();
        uint256 soldBefore = curve.sold();

        // A PEAK buy: the ASCENT sold<=Ts cap is gone, no second summit fires, and
        // usdcRaised6 stays frozen even though x grows.
        vm.prank(bob);
        curve.buy{value: _wei(1e7)}(0, block.timestamp, bob);
        assertEq(uint8(curve.state()), uint8(Curve.Phase.PEAK), "still PEAK, no second summit");
        assertGt(curve.sold(), TS, "sold now exceeds Ts (ASCENT cap gone)");
        assertGt(curve.sold(), soldBefore, "sold advanced in PEAK");
        assertEq(curve.raised6(), raisedFrozen, "raised6 frozen across a PEAK trade");
        assertGt(curve.x(), curve.raised6(), "x grew past the frozen raise");
        assertEq(curve.usdcRaised6(), raisedFrozen, "usdcRaised6 still the frozen raise, not x");
    }

    // ----- balances after the summit: >= only, fee proven via events/ledger -----

    function test_balancesAfterSummitAreConsistent() public {
        (Curve curve, PeakToken token) = _ridge();
        CurveMath.CrossingQuote memory cq = CurveMath.crossingQuote(X0_RIDGE, Y1, TS, FEE_BPS);
        // Exact spend => zero refund => no deferral; alice is an EOA that accepts value.
        vm.prank(alice);
        curve.buy{value: _wei(cq.spend6)}(0, block.timestamp, alice);

        uint256 raised6 = curve.raised6();
        // T1/T2 form: never an equality on a raw balance (MATH 9). The pool's held
        // native must at least cover the recorded reserve, dust and deferred value.
        assertGe(
            address(curve).balance,
            raised6 * 1e12 + curve.dustWei() + curve.deferred(alice),
            "native held covers reserve + dust + deferred"
        );
        assertGe(token.balanceOf(address(curve)), SUP - TS, "token held covers S - Ts");

        // Exactly one fee's worth left the curve: prove it through the FeeVault
        // ledger and the dust ledger, not by differencing a raw balance.
        (uint256 creatorFee6, uint256 protocolFee6) = CurveMath.splitFee(cq.feeUsed6, FEE_BPS, CREATOR_BPS);
        assertEq(vault.balances(creator), creatorFee6, "creator credited its split");
        assertEq(vault.balances(treasury), protocolFee6, "treasury credited its split");
        assertEq(vault.balances(creator) + vault.balances(treasury), cq.feeUsed6, "credits sum to fee6");
        assertEq(curve.dustWei(), 0, "no dust from a whole-unit spend");
    }

    // ----- y is never stored (MATH 4) -----

    function test_yDerivedNotStoredAcrossSummit() public {
        (Curve curve,) = _ridge();
        // slot 2 = y0 | S, slot 3 = Ts | y1 (the CurveTest layout map has no y slot).
        bytes32 slot2Before = vm.load(address(curve), bytes32(uint256(2)));
        bytes32 slot3Before = vm.load(address(curve), bytes32(uint256(3)));

        CurveMath.CrossingQuote memory cq = CurveMath.crossingQuote(X0_RIDGE, Y1, TS, FEE_BPS);
        vm.prank(alice);
        curve.buy{value: _wei(cq.spend6)}(0, block.timestamp, alice);

        assertEq(vm.load(address(curve), bytes32(uint256(2))), slot2Before, "y0|S slot untouched by the summit");
        assertEq(vm.load(address(curve), bytes32(uint256(3))), slot3Before, "Ts|y1 slot untouched by the summit");
        // y() is computed: in PEAK it is S - sold == S - Ts == Tl, no y storage.
        assertEq(curve.y(), SUP - TS, "y() == S - Ts after the summit");
        assertEq(curve.y(), TL, "== Tl");
    }

    // ----- market-cap sanity across the summit (MATH 2) -----

    function _assertMarketCapSanity(uint256 r6, uint128 x0) internal {
        (Curve curve,) = _market(r6, FEE_BPS, CREATOR_BPS, PROTOCOL_BPS, 0, 0, creator, true);
        uint256 target = Math.mulDiv(r6, R_X18 + 1e18, 1e18); // MATH 2
        CurveMath.CrossingQuote memory cq = CurveMath.crossingQuote(x0, Y1, TS, FEE_BPS);
        uint256 raised6 = cq.netNeeded6;
        // Virtual market cap at the summit (before): reserve x0+raised6 over y1.
        uint256 mcVirtual = CurveMath.marketCap6(x0 + raised6, Y1, SUP);
        vm.prank(alice);
        curve.buy{value: _wei(cq.spend6)}(0, block.timestamp, alice);
        uint256 mcReal = curve.marketCap6(); // after: real reserve over Tl
        assertLe(_absDiff(mcVirtual, target), 8, "virtual mcap ~ R6*(r+1)");
        assertLe(_absDiff(mcReal, target), 8, "real mcap ~ R6*(r+1)");
    }

    function test_marketCapSanityAllPresets() public {
        _assertMarketCapSanity(R6_BASECAMP, X0_BASECAMP);
        _assertMarketCapSanity(R6_RIDGE, X0_RIDGE);
        _assertMarketCapSanity(R6_ALPINE, X0_ALPINE);
    }

    // ----- a bouncing payer's refund defers, the crossing still completes -----

    function test_deferredRefundOnCrossingBuy() public {
        (Curve curve, PeakToken token) = _ridge();
        RejectingTrader rt = new RejectingTrader(curve);
        vm.deal(address(rt), 1e30);

        CurveMath.CrossingQuote memory cq = CurveMath.crossingQuote(X0_RIDGE, Y1, TS, FEE_BPS);
        uint256 usdcIn6 = 15e9; // overshoots => a refund of usdcIn6 - spend6
        uint256 refund6 = usdcIn6 - cq.spend6;

        vm.expectEmit(true, false, false, true, address(curve));
        emit PayoutDeferred(address(rt), refund6 * 1e12);
        rt.buy{value: _wei(usdcIn6)}(0, block.timestamp, address(rt));

        // The buy crossed and completed despite the bounced refund.
        assertEq(uint8(curve.state()), uint8(Curve.Phase.PEAK), "crossed to PEAK");
        assertEq(curve.sold(), TS, "sold lands on Ts");
        assertEq(token.balanceOf(address(rt)), TS, "buyer received remaining");
        assertEq(curve.deferred(address(rt)), refund6 * 1e12, "refund deferred, not lost");
    }
}
