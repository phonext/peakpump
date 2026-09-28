// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, Vm} from "forge-std/Test.sol";
import {FeeVault} from "../src/FeeVault.sol";

// Reverts on receiving native value, standing in for a blocklisted address:
// crediting it is fine, but its own claim can never forward.
contract RevertingClaimer {
    FeeVault internal immutable vault;

    constructor(FeeVault v) {
        vault = v;
    }

    function claim() external {
        vault.claim();
    }

    receive() external payable {
        revert("blocked");
    }
}

// Attempts to re-enter claim() from inside its own payout, swallowing the inner
// revert so the outer claim can still complete. A single payout must result.
contract ReentrantClaimer {
    FeeVault internal immutable vault;
    uint256 public reentryAttempts;

    constructor(FeeVault v) {
        vault = v;
    }

    function claim() external {
        vault.claim();
    }

    receive() external payable {
        reentryAttempts++;
        try vault.claim() {} catch {}
    }
}

contract FeeVaultTest is Test {
    FeeVault internal vault;

    address internal treasury = makeAddr("treasury");
    address internal curve = makeAddr("curve");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal stranger = makeAddr("stranger");

    function setUp() public {
        vault = new FeeVault(treasury);
        // This test contract is the factory.
        vault.setFactory(address(this));
        vault.registerCurve(curve);
        vm.deal(address(this), 1_000_000 ether);
        vm.deal(curve, 1_000_000 ether);
    }

    function _vaultInvariantHolds() internal view returns (bool) {
        uint256 sum = vault.balances(treasury) + vault.balances(curve) + vault.balances(alice) + vault.balances(bob)
            + vault.balances(stranger);
        return address(vault).balance == sum * 1e12 + vault.dustWei();
    }

    function test_setFactoryIsOneShot() public {
        FeeVault v = new FeeVault(treasury);
        v.setFactory(address(this));
        assertEq(v.factory(), address(this));

        vm.expectRevert(FeeVault.AlreadySet.selector);
        v.setFactory(alice);

        FeeVault v2 = new FeeVault(treasury);
        vm.expectRevert(FeeVault.ZeroAddress.selector);
        v2.setFactory(address(0));
    }

    function test_setFactoryRejectsNonDeployer() public {
        FeeVault v = new FeeVault(treasury);

        vm.prank(stranger);
        vm.expectRevert(FeeVault.NotDeployer.selector);
        v.setFactory(address(this));
    }

    function test_registerCurveIsFactoryOnly() public {
        vm.prank(stranger);
        vm.expectRevert(FeeVault.NotFactory.selector);
        vault.registerCurve(bob);
    }

    function test_creditRevertsForUnregisteredCaller() public {
        vm.prank(stranger);
        vm.expectRevert(FeeVault.NotAuthorized.selector);
        vault.credit(alice);

        vm.prank(stranger);
        vm.expectRevert(FeeVault.NotAuthorized.selector);
        vault.creditPair(alice, 1, bob, 1);
    }

    // A registered curve and the factory are both authorized crediters.
    function test_authorizedCritersCanCredit() public {
        vm.prank(curve);
        vault.creditPair{value: 3e12}(alice, 1, treasury, 2);
        assertEq(vault.balances(alice), 1);
        assertEq(vault.balances(treasury), 2);

        // The factory (this contract) may credit too.
        vault.credit{value: 4e12}(bob);
        assertEq(vault.balances(bob), 4);
        assertTrue(_vaultInvariantHolds());
    }

    function test_creditPairRejectsValueMismatch() public {
        vm.prank(curve);
        vm.expectRevert(FeeVault.ValueMismatch.selector);
        vault.creditPair{value: 3e12 - 1}(alice, 1, bob, 2);
    }

    function test_creditPairBothZeroDoesNothing() public {
        vm.recordLogs();
        vm.prank(curve);
        vault.creditPair{value: 0}(alice, 0, bob, 0);

        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(logs.length, 0);
        assertEq(vault.balances(alice), 0);
        assertEq(vault.balances(bob), 0);
    }

    // The exact dust behaviour: a sub-unit remainder accumulates and converts one
    // whole unit at a time.
    function test_dustAccumulatesAndConvertsOneUnit() public {
        vault.credit{value: 15e11}(alice); // 1.5e12
        assertEq(vault.balances(alice), 1);
        assertEq(vault.dustWei(), 5e11);
        assertEq(vault.balances(treasury), 0);

        vault.credit{value: 15e11}(alice);
        assertEq(vault.balances(alice), 2);
        assertEq(vault.dustWei(), 0);
        assertEq(vault.balances(treasury), 1);

        assertTrue(_vaultInvariantHolds());
    }

    // The balance invariant survives an arbitrary mixed sequence.
    function test_balanceInvariantAfterSequence() public {
        vault.credit{value: 15e11}(alice);
        vm.prank(curve);
        vault.creditPair{value: 7e12}(bob, 3, treasury, 4);
        vault.credit{value: 999}(stranger); // pure dust, credits nobody
        vm.prank(curve);
        vault.creditPair{value: 3e12}(alice, 1, bob, 2);

        assertTrue(_vaultInvariantHolds());

        vm.prank(bob);
        vault.claim();
        assertTrue(_vaultInvariantHolds());

        vm.prank(alice);
        vault.claim();
        assertTrue(_vaultInvariantHolds());
    }

    function test_claimForwardsAndZeroes() public {
        vault.credit{value: 5e12}(alice);
        uint256 before = alice.balance;

        vm.prank(alice);
        vault.claim();

        assertEq(alice.balance, before + 5e12);
        assertEq(vault.balances(alice), 0);

        vm.prank(alice);
        vm.expectRevert(FeeVault.NothingToClaim.selector);
        vault.claim();
    }

    // A blocklisted beneficiary is credited without reverting; only its own
    // claim fails, and everyone else is unaffected.
    function test_blocklistedBeneficiaryOnlyBricksItself() public {
        RevertingClaimer blocked = new RevertingClaimer(vault);

        vm.prank(curve);
        vault.creditPair{value: 9e12}(address(blocked), 5, alice, 4);
        assertEq(vault.balances(address(blocked)), 5);
        assertEq(vault.balances(alice), 4);

        vm.expectRevert(FeeVault.TransferFailed.selector);
        blocked.claim();
        // Balance preserved for a later withdrawal path.
        assertEq(vault.balances(address(blocked)), 5);

        // Everyone else still claims.
        uint256 before = alice.balance;
        vm.prank(alice);
        vault.claim();
        assertEq(alice.balance, before + 4e12);
    }

    function test_claimIsReentrancySafe() public {
        ReentrantClaimer attacker = new ReentrantClaimer(vault);

        vm.prank(curve);
        vault.creditPair{value: 5e12}(address(attacker), 5, treasury, 0);
        assertEq(vault.balances(address(attacker)), 5);

        uint256 vaultBefore = address(vault).balance;
        attacker.claim();

        // Re-entry was attempted but blocked; the attacker is paid exactly once.
        assertGe(attacker.reentryAttempts(), 1);
        assertEq(address(attacker).balance, 5e12);
        assertEq(vault.balances(address(attacker)), 0);
        assertEq(address(vault).balance, vaultBefore - 5e12);
    }
}
