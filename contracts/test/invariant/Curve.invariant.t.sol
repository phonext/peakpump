// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {InvariantBase} from "./InvariantBase.sol";
import {Curve} from "../../src/Curve.sol";
import {CurveMath} from "../../src/libraries/CurveMath.sol";

// MATH 8 curve invariants A1-A3 (A4 is a per-trade property the contract self-
// asserts on every buy/sell), plus the structural facts of the ASCENT/PEAK state
// machine and the T8 raised6 band. Every check reads storage only, through the
// curve's own views.
contract CurveInvariant is InvariantBase {
    // A1: sold never runs past Ts while the market is still climbing.
    function invariant_A1_ascentSoldWithinTs() public view {
        if (curve.state() == Curve.Phase.ASCENT) {
            assertLe(curve.sold(), TS, "A1: sold <= Ts in ASCENT");
        }
    }

    // A2: reserves stay strictly positive in both phases.
    function invariant_A2_reservesPositive() public view {
        assertGt(curve.x(), 0, "A2: x > 0");
        assertGt(curve.y(), 0, "A2: y > 0");
    }

    // A3: the ASCENT constant-product floor holds against the STORED, floored y0.
    // Vacuous in PEAK, where x0 is zero.
    function invariant_A3_ascentSolvency() public view {
        if (curve.state() == Curve.Phase.ASCENT) {
            assertGe(uint256(curve.x()) * curve.y(), X0 * Y0, "A3: x*y >= x0*y0");
        }
    }

    // Circulating supply is capped by S in both phases (PEAK lets sold pass Ts).
    function invariant_soldNeverExceedsS() public view {
        assertLe(curve.sold(), curve.S(), "sold <= S");
    }

    // Raw Basecamp create() inputs (MATH 10), the exact triple PeakpumpFactory
    // resolves for presetId 1. Fed to deriveParams so Reff6 carries the library's
    // floor rounding; MATH 9 T8 forbids asserting raised6 against R6 itself.
    uint256 private constant R6_RAW = 3e9;
    uint256 private constant RX18 = 4e18;

    // MATH 9 T8/T8b, quoted verbatim from the amended document:
    //   T8 (scope). The tight band Reff6 <= raised6 <= Reff6 + 2, and the preset
    //   identity raised6 == R6 + 1 of section 10, hold for a summit reached by BUYS
    //   ALONE, with no sell anywhere before the crossing trade. A buy takes its floor
    //   on the token leg and lifts x_final = k / y1 by at most x / y1, which is never
    //   observable; a sell takes its floor on the USDC leg and retains up to one unit
    //   of x, worth up to y0 / y1 units at the summit. Sells are the only source of
    //   drift.
    //   T8b (campaign form). raised6 >= Reff6 always, and
    //   raised6 <= Reff6 + 2 + n * (y0 / y1 + 1), where n is the number of
    //   state-changing trades before the crossing, a deliberately loose stand-in for
    //   the number of sells. raised6 is frozen at the crossing while PEAK trading
    //   keeps moving x, so raised6 == x holds only at the instant of the summit and is
    //   NOT a campaign invariant.
    // n uses the handler's running total of successful trades (buyCalls + sellCalls),
    // which is >= the count before the crossing: it only loosens the upper bound,
    // never tightens it. The lower bound is not slack: a proof run of the campaign
    // with `raised6 >= Reff6` as the sole new assertion measured a minimum
    // raised6 - Reff6 == 2 over 256 runs and 16384 calls, never negative.
    function invariant_stateMachineConsistency() public view {
        uint256 reff6 = CurveMath.deriveParams(curve.S(), R6_RAW, RX18).Reff6;
        if (curve.state() == Curve.Phase.PEAK) {
            assertEq(curve.x0(), 0, "PEAK: x0 zeroed at the Summit");
            assertGe(curve.raised6(), reff6, "T8b lower: raised6 >= Reff6");
            uint256 n = handler.buyCalls() + handler.sellCalls();
            uint256 bound = reff6 + 2 + n * (uint256(curve.y0()) / curve.y1() + 1);
            assertLe(curve.raised6(), bound, "T8b upper: raised6 <= Reff6 + 2 + n*(y0/y1+1)");
        } else {
            assertEq(curve.raised6(), 0, "ASCENT: raised6 unset until the Summit");
            assertEq(uint256(curve.x0()), X0, "ASCENT: x0 stays at genesis");
            assertGe(uint256(curve.x()), curve.x0(), "ASCENT: x >= x0");
        }
    }
}
