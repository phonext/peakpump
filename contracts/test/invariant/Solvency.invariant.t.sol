// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {InvariantBase} from "./InvariantBase.sol";
import {Curve} from "../../src/Curve.sol";

// MATH 9 T1: the curve's native balance always covers the live reserve, the
// accumulated dust, and every outstanding failed payout. Never an equality --
// anyone may donate native, and donated USDC is deliberately unreachable, which
// the handler exercises with donateToCurve so this bound is genuinely slack.
contract SolvencyInvariant is InvariantBase {
    function invariant_T1_nativeCoversReserveDustDeferred() public view {
        // reserveWei verbatim from MATH 9: x - x0 while climbing, x once at PEAK.
        uint256 reserveWei =
            (curve.state() == Curve.Phase.ASCENT ? uint256(curve.x()) - curve.x0() : uint256(curve.x())) * 1e12;
        // totalDeferredWei is the handler's independent ghost, kept from PayoutDeferred
        // events and cleared on withdrawDeferred, never read back from curve storage.
        assertGe(
            address(curve).balance,
            reserveWei + curve.dustWei() + handler.ghost_totalDeferredWei(),
            "T1: native >= reserve + dust + deferred"
        );
    }
}
