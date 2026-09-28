// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {Curve} from "../../src/Curve.sol";
import {PeakToken} from "../../src/PeakToken.sol";
import {FeeVault} from "../../src/FeeVault.sol";

// A trading actor whose native receipt can be toggled to revert, so a payout to it
// defers into Curve.deferred and withdrawDeferred becomes reachable. Deployed and
// funded by the handler; the fuzzer never targets it directly.
contract TraderActor {
    bool public rejectPayouts;

    function setReject(bool r) external {
        rejectPayouts = r;
    }

    // Curve._payout / withdrawDeferred and FeeVault.claim land here. Reverting makes
    // the payout defer; accepting lets a later withdrawDeferred succeed.
    receive() external payable {
        if (rejectPayouts) revert("actor rejects");
    }
}

// The single fuzz target. Every state change to the market goes through one of these
// functions so the campaign can only reach reachable states; property checks live in
// the suites' invariant_ hooks, never here (a revert inside a handler is a rejected
// call, not a failure). Ghosts are maintained from EMITTED EVENTS, not from re-running
// a quote, so the expectations are independent of the code under test.
contract InvariantHandler is Test {
    bytes32 constant TRADE_SIG =
        keccak256("Trade(address,address,bool,uint120,uint120,uint120,uint120,uint120,uint120,uint120,uint8)");
    bytes32 constant CREDITED_SIG = keccak256("Credited(address,uint256,uint8)");
    bytes32 constant CLAIMED_SIG = keccak256("Claimed(address,uint256)");
    bytes32 constant DUSTSWEPT_SIG = keccak256("DustSwept(uint256,uint256)");
    bytes32 constant PAYOUTDEFERRED_SIG = keccak256("PayoutDeferred(address,uint256)");

    // Action kinds, used only to attribute the per-action vault-ledger delta (T5).
    uint8 constant K_TRADE = 0;
    uint8 constant K_CLAIM = 1;
    uint8 constant K_SWEEP = 2;
    uint8 constant K_VAULT_FORCE = 3;
    uint8 constant K_OTHER = 4;

    // Wiring, injected by the base's setUp so every suite shares one market.
    Curve public immutable curve;
    PeakToken public immutable token;
    FeeVault public immutable vault;
    address public immutable creator;
    address public immutable treasury;

    // A small fixed set of actors so positions accumulate across calls instead of
    // being sprayed across fresh addresses the fuzzer never revisits.
    TraderActor[3] public actors;

    // Every ghost below is maintained from EMITTED EVENTS, never from a re-quote,
    // so a suite's property is independent of the arithmetic under test.
    uint256 public ghost_totalDeferredWei; // T1: outstanding failed payouts
    mapping(address => uint256) public ghost_deferredWei; // per recipient, exact debit
    uint256 public ghost_tradeFee6; // T5: sum of Trade.fee6
    uint256 public ghost_curveCredited6; // T5: vault credits caused by THIS curve
    uint256 public ghost_dustSwept6; // T5: sum of DustSwept.credited6
    uint256 public ghost_creatorCredited6; // T6: Credited(Creator) over trades
    uint256 public ghost_protocolCreditedByTrade6; // T6: Credited(Protocol) over trades

    // Success counters: bumped only on a call that took effect, so the anti-vacuity
    // hooks can prove each path was actually reached, not merely selected.
    uint256 public buyCalls;
    uint256 public sellCalls;
    uint256 public claimCalls;
    uint256 public sweepCalls;
    uint256 public withdrawCalls;
    uint256 public toggleCalls;
    uint256 public donateVaultCalls;
    uint256 public donateCurveCalls;

    constructor(Curve c, PeakToken t, FeeVault v, address creator_, address treasury_) {
        curve = c;
        token = t;
        vault = v;
        creator = creator_;
        treasury = treasury_;
        for (uint256 i = 0; i < actors.length; i++) {
            actors[i] = new TraderActor();
        }
    }

    function _actor(uint256 seed) internal view returns (TraderActor a) {
        a = actors[seed % actors.length];
    }

    // Additive: never lowers a balance, so value an actor earned from a sell or a
    // crossing refund survives and the solvency accounting stays honest.
    function _fund(address a, uint256 need) internal {
        if (a.balance < need) vm.deal(a, a.balance + need);
    }

    // The complete set of addresses that can ever hold a FeeVault balance: fees go
    // to creator and treasury; actors are listed only so the sum stays exhaustive.
    function balanceHolders() external view returns (address[] memory h) {
        h = new address[](2 + actors.length);
        h[0] = creator;
        h[1] = treasury;
        for (uint256 i = 0; i < actors.length; i++) {
            h[2 + i] = address(actors[i]);
        }
    }

    // Fold one action's emitted logs into the ghosts. `kind` decides only whether a
    // FeeVault credit is attributed to this curve (T5): a trade or a dust sweep is,
    // a force-send to the vault is not. Reverted calls emit nothing, so a discarded
    // action folds in nothing.
    function _scan(uint8 kind) internal {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i = 0; i < logs.length; i++) {
            Vm.Log memory L = logs[i];
            bytes32 sig = L.topics[0];
            if (L.emitter == address(curve) && sig == TRADE_SIG) {
                (,,,, uint120 fee6,,,) =
                    abi.decode(L.data, (uint120, uint120, uint120, uint120, uint120, uint120, uint120, uint8));
                ghost_tradeFee6 += fee6;
            } else if (L.emitter == address(vault) && sig == CREDITED_SIG) {
                (uint256 amount6, uint8 reason) = abi.decode(L.data, (uint256, uint8));
                if (kind == K_TRADE) {
                    ghost_curveCredited6 += amount6;
                    if (reason == uint8(FeeVault.Reason.Creator)) ghost_creatorCredited6 += amount6;
                    else ghost_protocolCreditedByTrade6 += amount6;
                } else if (kind == K_SWEEP) {
                    ghost_curveCredited6 += amount6;
                }
            } else if (L.emitter == address(curve) && sig == DUSTSWEPT_SIG) {
                (, uint256 credited6) = abi.decode(L.data, (uint256, uint256));
                ghost_dustSwept6 += credited6;
            } else if (L.emitter == address(curve) && sig == PAYOUTDEFERRED_SIG) {
                address recipient = address(uint160(uint256(L.topics[1])));
                uint256 weiAmount = abi.decode(L.data, (uint256));
                ghost_deferredWei[recipient] += weiAmount;
                ghost_totalDeferredWei += weiAmount;
            }
        }
    }

    function buy(uint256 actorSeed, uint256 usdcIn6, uint256 remSeed) external {
        address a = address(_actor(actorSeed)); // hoisted before the prank
        usdcIn6 = bound(usdcIn6, 1000, 8e9);
        uint256 value = usdcIn6 * 1e12 + (remSeed % 1e12); // remainder feeds curve dust
        _fund(a, value);
        vm.recordLogs();
        vm.prank(a);
        try curve.buy{value: value}(0, block.timestamp, a) {
            _scan(K_TRADE);
            buyCalls++;
        } catch {
            vm.getRecordedLogs();
        }
    }

    function sell(uint256 actorSeed, uint256 tokensIn) external {
        address a = address(_actor(actorSeed));
        uint256 bal = token.balanceOf(a); // hoisted before the prank
        uint256 sold_ = curve.sold(); // hoisted before the prank
        uint256 cap = bal < sold_ ? bal : sold_;
        if (cap == 0) return;
        tokensIn = bound(tokensIn, 1, cap);
        vm.recordLogs();
        vm.prank(a);
        try curve.sell(tokensIn, 0, block.timestamp) {
            _scan(K_TRADE);
            sellCalls++;
        } catch {
            vm.getRecordedLogs();
        }
    }

    function sweepDust(uint256) external {
        vm.recordLogs();
        try curve.sweepDust() {
            _scan(K_SWEEP);
            sweepCalls++;
        } catch {
            vm.getRecordedLogs();
        }
    }

    // creator and treasury are the only credited parties, and both are EOAs that
    // accept the payout, so a claim with a non-zero balance never reverts.
    function claimFees(uint256 who) external {
        address party = who % 2 == 0 ? creator : treasury;
        if (vault.balances(party) == 0) return; // hoisted read, before the prank
        vm.recordLogs();
        vm.prank(party);
        vault.claim();
        _scan(K_CLAIM);
        claimCalls++;
    }

    // A non-trade credit: FeeVault.receive routes it to treasury. It must leave T5
    // untouched (K_VAULT_FORCE) while the vault-solvency equality still holds.
    function donateToVault(uint256 actorSeed, uint256 amt) external {
        address a = address(_actor(actorSeed));
        amt = bound(amt, 1, 1e21);
        _fund(a, amt);
        vm.recordLogs();
        vm.prank(a);
        (bool ok,) = payable(address(vault)).call{value: amt}("");
        _scan(K_VAULT_FORCE);
        if (ok) donateVaultCalls++;
    }

    // An unreachable donation into Curve.receive: never counted, never a decision
    // input, so it keeps T1 a strict inequality rather than an equality.
    function donateToCurve(uint256 actorSeed, uint256 amt) external {
        address a = address(_actor(actorSeed));
        amt = bound(amt, 1, 1e21);
        _fund(a, amt);
        vm.prank(a);
        (bool ok,) = payable(address(curve)).call{value: amt}("");
        if (ok) donateCurveCalls++;
    }

    function toggleReject(uint256 actorSeed, bool reject) external {
        _actor(actorSeed).setReject(reject);
        toggleCalls++;
    }

    // owed is read from our independent ghost, not curve.deferred, so the debit
    // stays independent of the storage it checks. Accepting first is required: a
    // still-rejecting recipient makes withdrawDeferred's require(ok) revert.
    function withdrawDeferred(uint256 actorSeed) external {
        TraderActor actor = _actor(actorSeed);
        address a = address(actor);
        uint256 owed = ghost_deferredWei[a];
        if (owed == 0) return;
        actor.setReject(false);
        vm.prank(a);
        curve.withdrawDeferred();
        ghost_totalDeferredWei -= owed;
        ghost_deferredWei[a] = 0;
        withdrawCalls++;
    }
}
