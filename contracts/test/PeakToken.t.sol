// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {PeakToken} from "../src/PeakToken.sol";

// This test contract stands in for the factory: it deploys the implementation,
// clones it, and initializes the clones.
contract PeakTokenTest is Test {
    PeakToken internal impl;

    address internal curve = makeAddr("curve");
    address internal holder = makeAddr("holder");
    address internal stranger = makeAddr("stranger");

    uint256 internal constant SUPPLY = 1e27;

    function setUp() public {
        impl = new PeakToken();
    }

    function _newClone() internal returns (PeakToken token) {
        token = PeakToken(Clones.clone(address(impl)));
    }

    // The single most invisible bug: a clone of a plain ERC20 reports "" from
    // name(). Prove the clone reads the values set in initialize.
    function test_cloneReportsNameSymbolDecimals() public {
        PeakToken token = _newClone();
        token.initialize("Peakpump Ridge", "RIDGE", curve, SUPPLY);

        assertEq(token.name(), "Peakpump Ridge");
        assertEq(token.symbol(), "RIDGE");
        assertEq(token.decimals(), 18);
        assertEq(token.totalSupply(), SUPPLY);
        assertEq(token.balanceOf(curve), SUPPLY);
        assertEq(token.curve(), curve);
    }

    function test_implementationCannotBeInitialized() public {
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        impl.initialize("X", "X", curve, SUPPLY);
    }

    function test_initializeCannotBeCalledTwice() public {
        PeakToken token = _newClone();
        token.initialize("Peakpump Ridge", "RIDGE", curve, SUPPLY);

        vm.expectRevert(Initializable.InvalidInitialization.selector);
        token.initialize("Peakpump Ridge", "RIDGE", curve, SUPPLY);
    }

    // A holder sells its whole position with no approve of any kind. The curve
    // is the only caller that can move it, and it does so through pullFrom.
    function test_sellWithZeroApprove() public {
        PeakToken token = _newClone();
        token.initialize("Peakpump Ridge", "RIDGE", curve, SUPPLY);

        // A prior buy moved tokens from the curve to the holder.
        vm.prank(curve);
        token.transfer(holder, 100e18);
        assertEq(token.balanceOf(holder), 100e18);

        // The holder never approves anyone.
        assertEq(token.allowance(holder, curve), 0);

        // The curve pulls the holder's tokens back on a sell.
        vm.prank(curve);
        token.pullFrom(holder, 100e18);

        assertEq(token.balanceOf(holder), 0);
        assertEq(token.balanceOf(curve), SUPPLY);
        assertEq(token.allowance(holder, curve), 0);
    }

    function test_pullFromRevertsForEveryCallerButCurve() public {
        PeakToken token = _newClone();
        token.initialize("Peakpump Ridge", "RIDGE", curve, SUPPLY);
        vm.prank(curve);
        token.transfer(holder, 100e18);

        // The holder itself cannot pull.
        vm.prank(holder);
        vm.expectRevert(PeakToken.NotCurve.selector);
        token.pullFrom(holder, 1);

        // The factory cannot pull.
        vm.expectRevert(PeakToken.NotCurve.selector);
        token.pullFrom(holder, 1);

        // A stranger cannot pull.
        vm.prank(stranger);
        vm.expectRevert(PeakToken.NotCurve.selector);
        token.pullFrom(holder, 1);

        // The curve can.
        vm.prank(curve);
        token.pullFrom(holder, 1);
        assertEq(token.balanceOf(holder), 100e18 - 1);
    }
}
