// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {InvariantBase} from "./InvariantBase.sol";

// Two FeeVault solvency invariants and MATH 9 T5/T6, all from emitted events.
//   (a) FeeVault internal solvency, a strict equality.
//   T5  per-market fee reconciliation (fees == curve credits - dust swept).
//   T6  the fee split reconciles to the total.
// A global equality between Trade fees and total vault credits is forbidden: the
// creation fee, a residual sweep and any force-send are credits no Trade accounts
// for. donateToVault exercises exactly that, so these must hold through it.
contract FeeInvariant is InvariantBase {
    // The vault owes exactly what it holds. Strict equality is valid --
    // every native path into the vault (creditPair, credit, receive, claim) moves
    // balances and dustWei by the same amount, and the handler never selfdestructs
    // value in. donateToVault lands on treasury, which is summed below.
    function invariant_feeVaultInternalSolvency() public view {
        address[] memory h = handler.balanceHolders();
        uint256 sum6;
        for (uint256 i = 0; i < h.length; i++) {
            sum6 += vault.balances(h[i]);
        }
        assertEq(address(vault).balance, sum6 * 1e12 + vault.dustWei(), "native == balances*1e12 + dustWei");
    }

    // T5, scoped to this one market: the sum of Trade.fee6 equals the sum of the
    // curve's vault credits minus the sum of DustSwept.credited6. The sweep credit
    // is a vault credit but not a fee, and subtracting DustSwept is what cancels it.
    function invariant_T5_feeReconciliation() public view {
        assertEq(
            handler.ghost_tradeFee6(),
            handler.ghost_curveCredited6() - handler.ghost_dustSwept6(),
            "T5: trade fees == curve credits - dust swept"
        );
    }

    // T6 in aggregate, from the Credited events themselves: the creator share plus
    // the protocol share credited over all trades equals the total fee charged.
    function invariant_T6_splitReconciles() public view {
        assertEq(
            handler.ghost_creatorCredited6() + handler.ghost_protocolCreditedByTrade6(),
            handler.ghost_tradeFee6(),
            "T6: creator + protocol credits == trade fees"
        );
    }
}
