// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {CurveMath} from "../../src/libraries/CurveMath.sol";

/// @dev Proves CurveMath.sol equals the independent curve.ts reference for every
/// committed vector. Numbers are read as strings and parsed with vm.parseUint;
/// vm.parseJson mis-parses integers past ~1e15 (foundry #3754) and ours reach 1e30.
/// Equality is EXACT: a single-unit rounding disagreement is a bug, not noise.
contract CurveDiff is Test {
    struct Cols {
        uint256[] S;
        uint256[] R6;
        uint256[] rX18;
        uint256[] feeBps;
        uint256[] creatorBps;
        uint256[] usdcIn6;
        uint256[] tokensIn;
        uint256[] remaining;
        uint256[] Ts;
        uint256[] Tl;
        uint256[] y0;
        uint256[] x0;
        uint256[] y1;
        uint256[] Reff6;
        uint256[] buyTokensOut;
        uint256[] buyFee6;
        uint256[] buyNet6;
        uint256[] sellUsdcOut6;
        uint256[] sellFee6;
        uint256[] sellGross6;
        uint256[] crossNetNeeded6;
        uint256[] crossFeeUsed6;
        uint256[] crossSpend6;
        uint256[] price;
        uint256[] mcap;
        uint256[] splitCreatorFee6;
        uint256[] splitProtocolFee6;
    }

    string json;

    function setUp() public {
        json = vm.readFile("test/fixtures/curve-vectors.json");
    }

    function _col(string memory key) internal view returns (uint256[] memory out) {
        string[] memory s = vm.parseJsonStringArray(json, key);
        out = new uint256[](s.length);
        for (uint256 i; i < s.length; ++i) {
            out[i] = vm.parseUint(s[i]);
        }
    }

    function _load() internal view returns (Cols memory c) {
        c.S = _col(".S");
        c.R6 = _col(".R6");
        c.rX18 = _col(".rX18");
        c.feeBps = _col(".feeBps");
        c.creatorBps = _col(".creatorBps");
        c.usdcIn6 = _col(".usdcIn6");
        c.tokensIn = _col(".tokensIn");
        c.remaining = _col(".remaining");
        c.Ts = _col(".Ts");
        c.Tl = _col(".Tl");
        c.y0 = _col(".y0");
        c.x0 = _col(".x0");
        c.y1 = _col(".y1");
        c.Reff6 = _col(".Reff6");
        c.buyTokensOut = _col(".buyTokensOut");
        c.buyFee6 = _col(".buyFee6");
        c.buyNet6 = _col(".buyNet6");
        c.sellUsdcOut6 = _col(".sellUsdcOut6");
        c.sellFee6 = _col(".sellFee6");
        c.sellGross6 = _col(".sellGross6");
        c.crossNetNeeded6 = _col(".crossNetNeeded6");
        c.crossFeeUsed6 = _col(".crossFeeUsed6");
        c.crossSpend6 = _col(".crossSpend6");
        c.price = _col(".price");
        c.mcap = _col(".mcap");
        c.splitCreatorFee6 = _col(".splitCreatorFee6");
        c.splitProtocolFee6 = _col(".splitProtocolFee6");
    }

    function test_matchesReference() public view {
        Cols memory c = _load();
        uint256 n = c.S.length;
        assertEq(n, 2000, "case count");

        for (uint256 i; i < n; ++i) {
            CurveMath.DerivedParams memory p = CurveMath.deriveParams(c.S[i], c.R6[i], c.rX18[i]);
            assertEq(p.Ts, c.Ts[i], "Ts");
            assertEq(p.Tl, c.Tl[i], "Tl");
            assertEq(p.y0, c.y0[i], "y0");
            assertEq(p.x0, c.x0[i], "x0");
            assertEq(p.y1, c.y1[i], "y1");
            assertEq(p.Reff6, c.Reff6[i], "Reff6");

            CurveMath.BuyQuote memory bq = CurveMath.buyQuote(p.x0, p.y0, c.usdcIn6[i], c.feeBps[i]);
            assertEq(bq.tokensOut, c.buyTokensOut[i], "buyTokensOut");
            assertEq(bq.fee6, c.buyFee6[i], "buyFee6");
            assertEq(bq.net6, c.buyNet6[i], "buyNet6");

            CurveMath.SellQuote memory sq = CurveMath.sellQuote(p.x0, p.y0, c.tokensIn[i], c.feeBps[i]);
            assertEq(sq.usdcOut6, c.sellUsdcOut6[i], "sellUsdcOut6");
            assertEq(sq.fee6, c.sellFee6[i], "sellFee6");
            assertEq(sq.gross6, c.sellGross6[i], "sellGross6");

            CurveMath.CrossingQuote memory cq = CurveMath.crossingQuote(p.x0, p.y1, c.remaining[i], c.feeBps[i]);
            assertEq(cq.netNeeded6, c.crossNetNeeded6[i], "crossNetNeeded6");
            assertEq(cq.feeUsed6, c.crossFeeUsed6[i], "crossFeeUsed6");
            assertEq(cq.spend6, c.crossSpend6[i], "crossSpend6");

            assertEq(CurveMath.priceX18(p.x0, p.y0), c.price[i], "price");
            assertEq(CurveMath.marketCap6(p.x0, p.y0, c.S[i]), c.mcap[i], "mcap");

            (uint256 cFee, uint256 pFee) = CurveMath.splitFee(bq.fee6, c.feeBps[i], c.creatorBps[i]);
            assertEq(cFee, c.splitCreatorFee6[i], "splitCreatorFee6");
            assertEq(pFee, c.splitProtocolFee6[i], "splitProtocolFee6");
        }
    }
}
