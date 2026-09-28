// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {InvariantBase} from "./InvariantBase.sol";

// MATH 9 T2 and the fixed-supply fact. T2 is an inequality: a holder may donate
// tokens to the curve, so held tokens can only ever exceed the unsold count, never
// fall below it. Total supply is minted once at initialize and never moves.
contract SupplyInvariant is InvariantBase {
    function invariant_T2_tokenHeldCoversUnsold() public view {
        assertGe(token.balanceOf(address(curve)), uint256(curve.S()) - curve.sold(), "T2: held >= S - sold");
    }

    // No mint or burn exists after initialize, so the whole supply is conserved.
    // Equality is safe here: totalSupply is not a balance and cannot be donated to.
    function invariant_totalSupplyFixedAtS() public view {
        assertEq(token.totalSupply(), curve.S(), "supply fixed at S");
    }
}
