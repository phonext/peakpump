// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {CurveTestBase} from "../unit/Curve.t.sol";
import {Curve} from "../../src/Curve.sol";
import {PeakToken} from "../../src/PeakToken.sol";
import {CurveMath} from "../../src/libraries/CurveMath.sol";

// Bounded property fuzz for one market at a time; the platform-wide invariant
// suite lives in test/invariant. Every property is one of the MATH 9 theorems
// T1-T6 or an ASCENT invariant A1; each fee6 is taken from CurveMath, never
// re-derived. Reserves are read only through the contract's own views, never a
// raw balance except the two >= solvency checks a test is allowed to make.
contract BuySellFuzzTest is CurveTestBase {
    // A valid split for any fee rate: mirror the real 30/125 creator share and let
    // protocol take the remainder, so creatorBps + protocolBps == feeBps exactly
    // for every rate the sweep visits (initialize's FeeConfigInvalid guard).
    function _splitBps(uint16 feeBps) internal pure returns (uint16 c, uint16 p) {
        c = uint16((uint256(feeBps) * 30) / 125);
        p = feeBps - c;
    }

    // The five rates the merged floor names: 0 exercises the FeeVault-skip path
    // under fuzz, 200 is the hard cap, 125 is production.
    function _feeAt(uint256 sel) internal pure returns (uint16) {
        uint16[5] memory fees = [uint16(0), 1, 100, 125, 200];
        return fees[sel];
    }

    // T3 (MATH 9): buy usdcIn6, then the sell of every token received leaves at
    // most net6 back out of the pool. Floor rounding keeps k rising, so a round
    // trip can never return more reserve than it put in.
    function testFuzz_t3_grossLeNet(uint256 usdcIn6) public {
        usdcIn6 = bound(usdcIn6, 1000, 5e9); // net6 < 12e9 netNeeded on Ridge: no cross
        (Curve curve, PeakToken token) = _ridge();
        CurveMath.BuyQuote memory bq = CurveMath.buyQuote(X0_RIDGE, Y0, usdcIn6, FEE_BPS);
        vm.prank(alice);
        curve.buy{value: _wei(usdcIn6)}(0, block.timestamp, alice);
        CurveMath.SellQuote memory sq = CurveMath.sellQuote(curve.x(), curve.y(), token.balanceOf(alice), FEE_BPS);
        assertLe(sq.gross6, bq.net6, "T3: gross6 <= net6");
    }

    // T6 (MATH 9): the top-down split always sums back to fee6, for every fee6 and
    // every valid (feeBps, creatorBps). Two independent ceils would break this.
    function testFuzz_t6_splitSumsToFee(uint256 fee6, uint16 feeBps, uint16 creatorBps) public pure {
        feeBps = uint16(bound(feeBps, 1, 200));
        creatorBps = uint16(bound(creatorBps, 0, feeBps));
        fee6 = bound(fee6, 0, 1e15);
        (uint256 c, uint256 p) = CurveMath.splitFee(fee6, feeBps, creatorBps);
        assertEq(c + p, fee6, "T6: creatorFee6 + protocolFee6 == fee6");
        assertLe(c, fee6, "creator share within fee6");
    }

    // T4 (MATH 9): a non-crossing round trip at 125 bps loses within [2.40%, 2.60%]
    // regardless of size. Constant-product impact is symmetric and cancels; only the
    // two fee legs (~2.4844% combined) and sub-unit flooring remain.
    function testFuzz_t4_roundTripBand125(uint256 usdcIn6) public {
        usdcIn6 = bound(usdcIn6, 1e6, 5e9); // >= 1e6 so the relative band applies; < cross
        (Curve curve, PeakToken token) = _ridge();
        uint256 balBefore = alice.balance;
        vm.startPrank(alice);
        curve.buy{value: _wei(usdcIn6)}(0, block.timestamp, alice);
        assertLe(curve.sold(), TS, "A1: sold <= Ts in ASCENT");
        curve.sell(token.balanceOf(alice), 0, block.timestamp);
        vm.stopPrank();
        uint256 loss6 = (balBefore - alice.balance) / 1e12;
        assertGe(loss6 * 10000, usdcIn6 * 240, "round-trip loss >= 2.40%");
        assertLe(loss6 * 10000, usdcIn6 * 260, "round-trip loss <= 2.60%");
    }

    // Merged floor: the round trip and the T1/T2 solvency invariants hold across
    // every rate in the sweep. feeBps == 0 drives a buy and a sell with no FeeVault
    // call at all; 200 is the hard cap. loss is bounded by the two fee legs plus a
    // few flooring units, never more.
    function testFuzz_roundTripAcrossFees(uint256 usdcIn6, uint256 feeSel) public {
        uint16 feeBps = _feeAt(bound(feeSel, 0, 4));
        (uint16 cBps, uint16 pBps) = _splitBps(feeBps);
        usdcIn6 = bound(usdcIn6, 1000, 5e9);
        (Curve curve, PeakToken token) = _market(R6_RIDGE, feeBps, cBps, pBps, 0, 0, creator, true);
        uint256 balBefore = alice.balance;
        vm.startPrank(alice);
        curve.buy{value: _wei(usdcIn6)}(0, block.timestamp, alice);
        assertLe(curve.sold(), TS, "A1: sold <= Ts in ASCENT");
        curve.sell(token.balanceOf(alice), 0, block.timestamp);
        vm.stopPrank();
        // T1/T2 in the >= form. usdcRaised6() is the REAL reserve (x - x0 in ASCENT),
        // never the virtual x, so x0 is not double-counted as native.
        assertGe(
            address(curve).balance,
            uint256(curve.usdcRaised6()) * 1e12 + curve.dustWei(),
            "T1: native held covers reserve + dust"
        );
        assertGe(token.balanceOf(address(curve)), SUP - curve.sold(), "T2: token held covers S - sold");
        uint256 loss6 = (balBefore - alice.balance) / 1e12;
        assertLe(loss6, (2 * uint256(feeBps) * usdcIn6) / 10000 + 8, "loss within both fee legs + rounding");
    }

    // T1, T2, A1 after every step of a random buy/sell sequence, and T5 at the end:
    // per-market fee reconciliation (sum of fee6 over the trades == the FeeVault
    // credits of THIS curve, no dust swept). A 1-wei donation proves the >= tolerates
    // native the accounting never expects. Amounts stay non-crossing so the run lives
    // entirely in ASCENT, where A1 (sold <= Ts) is the live cap.
    function testFuzz_invariantsAndT5(uint256 seed) public {
        (Curve curve, PeakToken token) = _ridge();
        vm.deal(address(curve), address(curve).balance + 1); // donation: >= must still hold
        uint256 sumFee6; // ghost: fee6 charged over every executed trade

        for (uint256 i = 0; i < 8; i++) {
            seed = uint256(keccak256(abi.encode(seed, i)));
            if (seed & 1 == 0) {
                uint256 usdcIn6 = bound(seed >> 1, 1000, 5e8);
                sumFee6 += CurveMath.buyQuote(curve.x(), curve.y(), usdcIn6, FEE_BPS).fee6;
                vm.prank(alice);
                curve.buy{value: _wei(usdcIn6)}(0, block.timestamp, alice);
            } else {
                uint256 have = token.balanceOf(alice);
                if (have > 1) {
                    uint256 tokensIn = bound(seed >> 1, 1, have);
                    CurveMath.SellQuote memory sq = CurveMath.sellQuote(curve.x(), curve.y(), tokensIn, FEE_BPS);
                    if (sq.usdcOut6 >= 1) {
                        sumFee6 += sq.fee6;
                        vm.prank(alice);
                        curve.sell(tokensIn, 0, block.timestamp);
                    }
                }
            }
            assertGe(
                address(curve).balance,
                uint256(curve.usdcRaised6()) * 1e12 + curve.dustWei(),
                "T1: native held covers reserve + dust"
            );
            assertGe(token.balanceOf(address(curve)), SUP - curve.sold(), "T2: token held covers S - sold");
            assertLe(curve.sold(), TS, "A1: sold <= Ts in ASCENT");
        }
        // No cross and _wei() leaves no remainder, so no dust is swept: the whole fee
        // stream sits in the vault ledger, split but summing back to sumFee6.
        assertEq(vault.balances(creator) + vault.balances(treasury), sumFee6, "T5: per-market fee reconciliation");
    }
}
