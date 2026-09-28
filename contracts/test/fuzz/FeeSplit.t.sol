// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {CurveMath} from "../../src/libraries/CurveMath.sol";

/// @dev MATH 6.1 top-down split, T6. The two shares always sum to fee6, the creator
/// never over-collects, and feeBps == 0 short-circuits before any division.
contract FeeSplit is Test {
    function testFuzz_splitSumsAndBounds(uint256 rawFee, uint256 rawCreator, uint256 rawAmount) public pure {
        uint256 feeBps = bound(rawFee, 0, 200);
        uint256 creatorBps = bound(rawCreator, 0, feeBps);
        uint256 amount6 = bound(rawAmount, 0, 1e13);
        // fee6 as MATH 6.2 computes it, reused rather than re-derived.
        uint256 fee6 = CurveMath.buyQuote(1, 1, amount6, feeBps).fee6;

        (uint256 creatorFee6, uint256 protocolFee6) = CurveMath.splitFee(fee6, feeBps, creatorBps);

        assertEq(creatorFee6 + protocolFee6, fee6, "shares sum to fee6 (T6)");

        // creatorFee6 = floor(fee6*creatorBps/feeBps), so floor*divisor <= dividend.
        if (feeBps > 0) {
            assertLe(creatorFee6 * feeBps, fee6 * creatorBps, "creator never over-collects");
        } else {
            assertEq(fee6, 0, "zero fee rate yields zero fee");
            assertEq(creatorFee6, 0, "no creator fee at zero rate");
            assertEq(protocolFee6, 0, "no protocol fee at zero rate");
        }
    }
}
