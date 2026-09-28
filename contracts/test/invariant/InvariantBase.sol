// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {console} from "forge-std/console.sol";
import {PeakpumpFactory} from "../../src/PeakpumpFactory.sol";
import {Curve} from "../../src/Curve.sol";
import {PeakToken} from "../../src/PeakToken.sol";
import {FeeVault} from "../../src/FeeVault.sol";
import {InvariantHandler} from "./InvariantHandler.sol";

// Shared wiring for the four invariant suites. Each suite inherits this, so all
// four campaigns drive the SAME handler over ONE real Basecamp market, built
// through the real factory with no mocks. The suite adds only its topical
// invariant_ hooks; setUp, the handler, and the anti-vacuity machinery live here.
//
// Basecamp (MATH 10): S = 1e27, r = 4e18, R6 = 3e9 -> x0 = 1e9, Reff6 == R6.
// The constants are the floored literals of MATH 10, not re-derived here.
abstract contract InvariantBase is Test {
    uint256 internal constant S = 1e27;
    uint256 internal constant TS = 8e26;
    uint256 internal constant X0 = 1e9;
    uint256 internal constant Y0 = 1066666666666666666666666666;
    uint256 internal constant REFF6 = 3e9; // Basecamp: (r-1e18) divides R6, so Reff6 == R6
    uint16 internal constant FEE_BPS = 125;

    FeeVault internal vault;
    PeakpumpFactory internal factory;
    Curve internal curve;
    PeakToken internal token;
    InvariantHandler internal handler;

    address internal owner = makeAddr("owner");
    address internal treasury = makeAddr("treasury");
    address internal creator = makeAddr("creator");

    function setUp() public virtual {
        vault = new FeeVault(treasury);
        address tokenImpl = address(new PeakToken());
        address curveImpl = address(new Curve());
        factory = new PeakpumpFactory(owner, address(vault), curveImpl, tokenImpl, treasury);
        vault.setFactory(address(factory));

        // Basecamp, no dev-buy and no creation fee, so the market opens with an empty
        // vault: sold == 0, every ghost == 0, and the T5/vault ledgers start clean.
        PeakpumpFactory.CreateParams memory p;
        p.name = "Basecamp Market";
        p.symbol = "BASE";
        p.metadataURI = "ipfs://base";
        p.presetId = 1;
        vm.prank(creator);
        (address t, address c) = factory.create(p);
        curve = Curve(payable(c));
        token = PeakToken(t);

        handler = new InvariantHandler(curve, token, vault, creator, treasury);
        // Only the handler is fuzzed: the curve, token, vault and factory are reached
        // solely through its guarded, event-attributing actions.
        targetContract(address(handler));
    }

    // Called once after the whole campaign. The properties above are only
    // meaningful if the fuzzer actually traded; a buy is the cheapest action that
    // always succeeds once an actor is funded, so its count is the honest floor.
    // Per-action reachability is proved deterministically in the test below, which
    // does not depend on the fuzzer's luck.
    function afterInvariant() public view {
        assertGt(handler.buyCalls(), 0, "anti-vacuity: campaign never traded");
    }

    // The call-distribution summary (visible under -vvv). Asserts nothing; it exists
    // so a degenerate run that stopped exercising a path is visible, not silent.
    function invariant_callSummary() public view {
        console.log("buys", handler.buyCalls());
        console.log("sells", handler.sellCalls());
        console.log("claims", handler.claimCalls());
        console.log("sweeps", handler.sweepCalls());
        console.log("withdraws", handler.withdrawCalls());
        console.log("toggles", handler.toggleCalls());
        console.log("vaultDonations", handler.donateVaultCalls());
        console.log("curveDonations", handler.donateCurveCalls());
    }

    // Deterministic proof that every handler action can succeed and take effect, so
    // no invariant above can pass merely because a path was never reached. Drives
    // the handler directly (not through the fuzzer) and asserts each counter moved.
    function test_handlerActionsAllReachable() public {
        // A buy carrying a sub-unit remainder: seeds a token position AND curve dust.
        handler.buy(0, 1e8, 7e11);
        assertGt(handler.buyCalls(), 0, "buy unreachable");
        assertGt(curve.sold(), 0, "buy had no effect");

        // The same actor now holds tokens, so it can sell.
        handler.sell(0, type(uint256).max); // bound clamps to the holding
        assertGt(handler.sellCalls(), 0, "sell unreachable");

        // Push curve dust past one whole 6-dp unit, then sweep it to the vault.
        while (curve.dustWei() < 1e12) {
            handler.buy(0, 1000, 9e11);
        }
        handler.sweepDust(0);
        assertGt(handler.sweepCalls(), 0, "sweep unreachable");

        // The trades above credited the creator; claim clears that balance.
        handler.claimFees(0); // even seed -> creator, who earned a fee
        assertGt(handler.claimCalls(), 0, "claim unreachable");

        // Force a deferral: actor 1 buys, then rejects payouts and sells, so the sell
        // proceeds defer; toggling back lets it withdraw.
        handler.buy(1, 5e9, 0);
        handler.toggleReject(1, true);
        assertGt(handler.toggleCalls(), 0, "toggle unreachable");
        handler.sell(1, type(uint256).max);
        assertGt(handler.ghost_totalDeferredWei(), 0, "no deferral created");
        handler.withdrawDeferred(1);
        assertGt(handler.withdrawCalls(), 0, "withdraw unreachable");
        assertEq(handler.ghost_totalDeferredWei(), 0, "withdraw cleared the ghost");

        // A non-trade vault credit and an unreachable curve donation.
        handler.donateToVault(2, 1e15);
        assertGt(handler.donateVaultCalls(), 0, "vault donation unreachable");
        handler.donateToCurve(2, 1e15);
        assertGt(handler.donateCurveCalls(), 0, "curve donation unreachable");
    }
}
