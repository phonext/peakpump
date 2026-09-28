// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @dev Pure bonding-curve math. Every formula is quoted from docs/MATH.md with
/// its rounding direction; none is re-derived here. All parameters are uint256:
/// the uint128 storage packing belongs to Curve, not to this library. Multi-value
/// results are returned in named structs so Curve.buy keeps compiling with
/// via_ir disabled (a loose-tuple return there hits "stack too deep").
library CurveMath {
    uint256 internal constant WAD = 1e18;
    uint256 internal constant PRICE_SCALE = 1e30;
    uint256 internal constant BPS_DENOM = 10000;

    // MATH 3 creation bounds.
    uint256 internal constant S_MIN = 1e24;
    uint256 internal constant S_MAX = 1e30;
    uint256 internal constant R6_MIN = 1e9;
    uint256 internal constant R6_MAX = 1e13;
    uint256 internal constant R_MIN = 2e18;
    uint256 internal constant R_MAX = 20e18;

    error SupplyOutOfRange();
    error RaiseOutOfRange();
    error MultipleOutOfRange();
    error SupplyNotAboveTs();
    error Y0NotAboveTs();
    error X0NotPositive();
    error Y1NotPositive();

    struct DerivedParams {
        uint256 Ts;
        uint256 Tl;
        uint256 y0;
        uint256 x0;
        uint256 y1;
        uint256 Reff6;
    }

    struct BuyQuote {
        uint256 tokensOut;
        uint256 fee6;
        uint256 net6;
    }

    struct SellQuote {
        uint256 usdcOut6;
        uint256 fee6;
        uint256 gross6;
    }

    struct CrossingQuote {
        uint256 netNeeded6;
        uint256 feeUsed6;
        uint256 spend6;
    }

    /// @dev MATH 3. The five rounding directions are load-bearing (MATH 5): Ts and
    /// y0 floor, x0 ceils. Tl is S - Ts and y1 is y0 - Ts, never computed
    /// independently. Every bound and positivity check of MATH 3 is enforced.
    function deriveParams(uint256 S, uint256 R6, uint256 rX18) internal pure returns (DerivedParams memory p) {
        if (S < S_MIN || S > S_MAX) revert SupplyOutOfRange();
        if (R6 < R6_MIN || R6 > R6_MAX) revert RaiseOutOfRange();
        if (rX18 < R_MIN || rX18 > R_MAX) revert MultipleOutOfRange();

        p.Ts = Math.mulDiv(S, rX18, rX18 + WAD, Math.Rounding.Floor);
        if (S <= p.Ts) revert SupplyNotAboveTs();
        p.Tl = S - p.Ts;

        p.y0 = Math.mulDiv(p.Ts, rX18, rX18 - WAD, Math.Rounding.Floor);
        if (p.y0 <= p.Ts) revert Y0NotAboveTs();
        p.y1 = p.y0 - p.Ts;
        if (p.y1 == 0) revert Y1NotPositive();

        p.x0 = Math.mulDiv(R6, WAD, rX18 - WAD, Math.Rounding.Ceil);
        if (p.x0 == 0) revert X0NotPositive();

        p.Reff6 = Math.mulDiv(p.x0, rX18 - WAD, WAD, Math.Rounding.Floor);
    }

    /// @dev MATH 6.1, the only permitted split. Return before any division when
    /// feeBps == 0. protocolFee6 is a subtraction, never a second mulDiv: two
    /// independent ceils can exceed the total by one unit.
    function splitFee(uint256 fee6, uint256 feeBps, uint256 creatorBps)
        internal
        pure
        returns (uint256 creatorFee6, uint256 protocolFee6)
    {
        if (feeBps == 0) return (0, 0);
        creatorFee6 = Math.mulDiv(fee6, creatorBps, feeBps, Math.Rounding.Floor);
        protocolFee6 = fee6 - creatorFee6;
    }

    /// @dev MATH 6.2. Fee ceils on the USDC leg, only net6 enters the pool.
    function buyQuote(uint256 x, uint256 y, uint256 usdcIn6, uint256 feeBps) internal pure returns (BuyQuote memory q) {
        q.fee6 = Math.mulDiv(usdcIn6, feeBps, BPS_DENOM, Math.Rounding.Ceil);
        q.net6 = usdcIn6 - q.fee6;
        q.tokensOut = Math.mulDiv(y, q.net6, x + q.net6, Math.Rounding.Floor);
    }

    /// @dev MATH 6.3. gross6 (not usdcOut6) is what leaves the pool in Curve.
    function sellQuote(uint256 x, uint256 y, uint256 tokensIn, uint256 feeBps)
        internal
        pure
        returns (SellQuote memory q)
    {
        q.gross6 = Math.mulDiv(x, tokensIn, y + tokensIn, Math.Rounding.Floor);
        q.fee6 = Math.mulDiv(q.gross6, feeBps, BPS_DENOM, Math.Rounding.Ceil);
        q.usdcOut6 = q.gross6 - q.fee6;
    }

    /// @dev MATH 6.4. Denominator is the market constant y1, not y - remaining.
    /// The caller (Curve) enforces feeBps <= 200, so BPS_DENOM - feeBps > 0.
    function crossingQuote(uint256 x, uint256 y1, uint256 remaining, uint256 feeBps)
        internal
        pure
        returns (CrossingQuote memory q)
    {
        q.netNeeded6 = Math.mulDiv(x, remaining, y1, Math.Rounding.Ceil);
        q.spend6 = Math.mulDiv(q.netNeeded6, BPS_DENOM, BPS_DENOM - feeBps, Math.Rounding.Ceil);
        q.feeUsed6 = q.spend6 - q.netNeeded6;
    }

    /// @dev MATH [9]. USDC per whole token, 18-dp fixed point.
    function priceX18(uint256 x, uint256 y) internal pure returns (uint256) {
        return Math.mulDiv(x, PRICE_SCALE, y, Math.Rounding.Floor);
    }

    /// @dev MATH [10]. The only market cap formula.
    function marketCap6(uint256 x, uint256 y, uint256 S) internal pure returns (uint256) {
        return Math.mulDiv(x, S, y, Math.Rounding.Floor);
    }
}
