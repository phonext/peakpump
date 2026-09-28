// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {CurveMath} from "../../src/libraries/CurveMath.sol";

/// @dev The rounding directions of MATH 3/6 exist to keep the pool solvent and the
/// crossing spend minimal. These are the on-chain invariants of MATH 8-9 expressed
/// as inequalities on pure math, so a wrong rounding direction fails here rather
/// than on a live market.
contract Rounding is Test {
    // A legal market from fuzzed seeds; deriveParams never reverts inside these bounds.
    function _market(uint256 rawS, uint256 rawR6, uint256 rawR)
        internal
        pure
        returns (CurveMath.DerivedParams memory p, uint256 R6)
    {
        uint256 S = bound(rawS, 1e24, 1e30);
        R6 = bound(rawR6, 1e9, 1e13);
        uint256 r = bound(rawR, 2e18, 20e18);
        p = CurveMath.deriveParams(S, R6, r);
    }

    // net6 as the library computes it (MATH 6.2), reused instead of re-deriving the fee.
    function _net(uint256 amount, uint256 feeBps) internal pure returns (uint256) {
        return CurveMath.buyQuote(1, 1, amount, feeBps).net6;
    }

    // (a) MATH 8 A3/A4: a non-crossing buy never lowers k. x0*y0 uses the floored y0.
    function testFuzz_kNonDecreasingBuy(uint256 rawS, uint256 rawR6, uint256 rawR, uint256 rawFee, uint256 rawIn)
        public
        pure
    {
        (CurveMath.DerivedParams memory p, uint256 R6) = _market(rawS, rawR6, rawR);
        uint256 feeBps = bound(rawFee, 0, 200);
        uint256 usdcIn6 = bound(rawIn, 1000, R6);
        CurveMath.BuyQuote memory q = CurveMath.buyQuote(p.x0, p.y0, usdcIn6, feeBps);
        if (q.tokensOut > p.Ts) return; // a crossing trade: k legitimately falls (A4 exempt)
        uint256 xAfter = p.x0 + q.net6; // only net enters the pool
        uint256 yAfter = p.y0 - q.tokensOut;
        assertGe(xAfter * yAfter, p.x0 * p.y0, "k must not fall on a buy");
    }

    // (a) sell side: gross leaves the pool, tokens return, k rises by the Floor slack.
    function testFuzz_kNonDecreasingSell(uint256 rawS, uint256 rawR6, uint256 rawR, uint256 rawFee, uint256 rawTok)
        public
        pure
    {
        (CurveMath.DerivedParams memory p,) = _market(rawS, rawR6, rawR);
        uint256 feeBps = bound(rawFee, 0, 200);
        uint256 tokensIn = bound(rawTok, 1, p.Ts);
        CurveMath.SellQuote memory q = CurveMath.sellQuote(p.x0, p.y0, tokensIn, feeBps);
        uint256 xAfter = p.x0 - q.gross6; // gross6 leaves the pool, NOT usdcOut6
        uint256 yAfter = p.y0 + tokensIn;
        assertGe(xAfter * yAfter, p.x0 * p.y0, "k must not fall on a sell");
    }

    // (b) MATH 9 T3: an immediate buy-then-sell returns gross6 <= net6. This holds
    // independent of feeBps because the fee is charged outside the pool, so the round
    // trip has zero net price impact and only Floor can bite.
    function testFuzz_roundTripLossy(uint256 rawS, uint256 rawR6, uint256 rawR, uint256 rawFee, uint256 rawIn)
        public
        pure
    {
        (CurveMath.DerivedParams memory p, uint256 R6) = _market(rawS, rawR6, rawR);
        uint256 feeBps = bound(rawFee, 0, 200);
        uint256 usdcIn6 = bound(rawIn, 1000, R6);
        CurveMath.BuyQuote memory b = CurveMath.buyQuote(p.x0, p.y0, usdcIn6, feeBps);
        if (b.tokensOut > p.Ts) return; // non-crossing only
        if (b.tokensOut == 0) return; // nothing to sell back
        CurveMath.SellQuote memory s = CurveMath.sellQuote(p.x0 + b.net6, p.y0 - b.tokensOut, b.tokensOut, feeBps);
        assertLe(s.gross6, b.net6, "round trip must not return more than net in");
    }

    // (c) MATH 6.4(a): inside the crossing branch (the caller's net6 buys strictly
    // more than `remaining`), spend6 never exceeds the caller's usdcIn6.
    function testFuzz_crossingSpendWithinInput(
        uint256 rawS,
        uint256 rawR6,
        uint256 rawR,
        uint256 rawFee,
        uint256 rawIn,
        uint256 rawRem
    ) public pure {
        (CurveMath.DerivedParams memory p, uint256 R6) = _market(rawS, rawR6, rawR);
        uint256 feeBps = bound(rawFee, 0, 200);
        uint256 usdcIn6 = bound(rawIn, 1000, R6);
        uint256 remaining = bound(rawRem, 1, p.Ts);
        if (_net(usdcIn6, feeBps) * p.y1 <= remaining * p.x0) return; // not in the crossing branch
        CurveMath.CrossingQuote memory q = CurveMath.crossingQuote(p.x0, p.y1, remaining, feeBps);
        assertLe(q.spend6, usdcIn6, "spend6 <= usdcIn6 in the crossing branch");
    }

    // (d) MATH 6.4(c): spend6 is minimal. One unit less fails to reach netNeeded6, so
    // it cannot buy `remaining`.
    function testFuzz_crossingMinimality(uint256 rawS, uint256 rawR6, uint256 rawR, uint256 rawFee, uint256 rawRem)
        public
        pure
    {
        (CurveMath.DerivedParams memory p,) = _market(rawS, rawR6, rawR);
        uint256 feeBps = bound(rawFee, 0, 200);
        uint256 remaining = bound(rawRem, 1, p.Ts);
        CurveMath.CrossingQuote memory q = CurveMath.crossingQuote(p.x0, p.y1, remaining, feeBps);
        assertLt(_net(q.spend6 - 1, feeBps), q.netNeeded6, "spend6 is minimal");
    }

    // (e) MATH 6.4(b): at spend6 the net6 equals netNeeded6 exactly, so feeUsed6 is
    // exactly the ceil fee with no surplus unit silently converted into fee.
    function testFuzz_crossingExactNet(uint256 rawS, uint256 rawR6, uint256 rawR, uint256 rawFee, uint256 rawRem)
        public
        pure
    {
        (CurveMath.DerivedParams memory p,) = _market(rawS, rawR6, rawR);
        uint256 feeBps = bound(rawFee, 0, 200);
        uint256 remaining = bound(rawRem, 1, p.Ts);
        CurveMath.CrossingQuote memory q = CurveMath.crossingQuote(p.x0, p.y1, remaining, feeBps);
        assertEq(_net(q.spend6, feeBps), q.netNeeded6, "net6 at spend6 == netNeeded6");
        assertEq(q.feeUsed6, q.spend6 - _net(q.spend6, feeBps), "feeUsed6 has no surplus unit");
    }
}

