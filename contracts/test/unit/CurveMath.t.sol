// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {CurveMath} from "../../src/libraries/CurveMath.sol";

/// @dev Preset and bound checks quoted from MATH 3, 5 and 10. Every number here is
/// a literal from docs/MATH.md, never re-derived.
contract CurveMathTest is Test {
    uint256 constant S = 1e27;
    uint256 constant R = 4e18;

    // MATH 10 exact integers; y0 is the floored literal.
    uint256 constant TS = 800000000000000000000000000;
    uint256 constant TL = 200000000000000000000000000;
    uint256 constant Y0 = 1066666666666666666666666666;
    uint256 constant Y1 = 266666666666666666666666666;

    // External wrapper so vm.expectRevert sees a call frame: deriveParams is an
    // inlined internal function and would otherwise revert in the test's own frame.
    function derive(uint256 s, uint256 r6, uint256 r) external pure returns (CurveMath.DerivedParams memory) {
        return CurveMath.deriveParams(s, r6, r);
    }

    function _assertPreset(uint256 r6, uint256 x0Expected) internal pure {
        CurveMath.DerivedParams memory p = CurveMath.deriveParams(S, r6, R);
        assertEq(p.Ts, TS, "Ts");
        assertEq(p.Tl, TL, "Tl");
        assertEq(p.y0, Y0, "y0");
        assertEq(p.y1, Y1, "y1");
        assertEq(p.y0, 4 * p.y1 + 2, "y0 == 4*y1 + 2");
        assertEq(p.x0, x0Expected, "x0");
        assertEq(p.Reff6, r6, "Reff6 == R6 for presets");
    }

    function test_presets() public pure {
        _assertPreset(3_000_000_000, 1_000_000_000); // Basecamp
        _assertPreset(12_000_000_000, 4_000_000_000); // Ridge
        _assertPreset(60_000_000_000, 20_000_000_000); // Alpine
    }

    // MATH [4]: p1/p0 == r^2 == 16. Exact for the preset shape, asserted within one ulp.
    function _assertRatio(uint256 x0) internal pure {
        uint256 p0 = CurveMath.priceX18(x0, Y0);
        uint256 p1 = CurveMath.priceX18(4 * x0, Y1);
        assertApproxEqAbs(p1, 16 * p0, 1, "p1/p0 == r^2");
    }

    function test_priceRatioIsRSquared() public pure {
        _assertRatio(1_000_000_000);
        _assertRatio(4_000_000_000);
        _assertRatio(20_000_000_000);
    }

    // MATH 2: the two mandatory market-cap sanity checks, virtual at the summit and
    // real immediately after, must agree and both equal $60,000 for Ridge.
    function test_math2SanityChecks() public pure {
        uint256 expected = Math.mulDiv(12_000_000_000, R + 1e18, 1e18); // mulDiv(R6, r+1e18, 1e18)
        assertEq(expected, 60_000_000_000, "Ridge R6*(r+1)");
        assertEq(CurveMath.marketCap6(16_000_000_000, Y1, S), expected, "virtual at summit");
        assertEq(CurveMath.marketCap6(12_000_000_000, TL, S), expected, "real after summit");
    }

    // MATH 10: Ridge start price 0.00000375 USDC per whole token.
    function test_ridgeStartPrice() public pure {
        assertEq(CurveMath.priceX18(4_000_000_000, Y0), 3750000000000, "Ridge start price");
    }

    // MATH T8: x0 rounds up, so Reff6 exceeds R6 by 18 here. Never assert against R6.
    function test_counterexampleReff6() public pure {
        CurveMath.DerivedParams memory p = CurveMath.deriveParams(S, 1_000_000_002, 20e18);
        assertEq(p.x0, 52_631_580, "x0");
        assertEq(p.Reff6, 1_000_000_002 + 18, "Reff6 == R6 + 18");
    }

    function test_revert_supplyBelowMin() public {
        vm.expectRevert(CurveMath.SupplyOutOfRange.selector);
        this.derive(1e24 - 1, 12e9, R);
    }

    function test_revert_supplyAboveMax() public {
        vm.expectRevert(CurveMath.SupplyOutOfRange.selector);
        this.derive(1e30 + 1, 12e9, R);
    }

    function test_revert_raiseBelowMin() public {
        vm.expectRevert(CurveMath.RaiseOutOfRange.selector);
        this.derive(S, 1e9 - 1, R);
    }

    function test_revert_raiseAboveMax() public {
        vm.expectRevert(CurveMath.RaiseOutOfRange.selector);
        this.derive(S, 1e13 + 1, R);
    }

    function test_revert_multipleBelowMin() public {
        vm.expectRevert(CurveMath.MultipleOutOfRange.selector);
        this.derive(S, 12e9, 2e18 - 1);
    }

    function test_revert_multipleAboveMax() public {
        vm.expectRevert(CurveMath.MultipleOutOfRange.selector);
        this.derive(S, 12e9, 20e18 + 1);
    }
}
