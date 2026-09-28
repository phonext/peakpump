// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {PeakpumpFactory} from "../../src/PeakpumpFactory.sol";
import {Curve} from "../../src/Curve.sol";
import {PeakToken} from "../../src/PeakToken.sol";
import {FeeVault} from "../../src/FeeVault.sol";
import {CurveMath} from "../../src/libraries/CurveMath.sol";

// A launcher that clones and initializes a market exactly like PeakpumpFactory but
// DELIBERATELY skips feeVault.registerCurve. It is set as its own vault's factory,
// so it COULD register; skipping proves registration -- not merely being the
// factory -- is what authorizes a curve to credit, and a create() that omitted the
// call would brick its own dev-buy with NotAuthorized.
contract SkippingLauncher {
    function launchAndBuy(
        address curveImpl,
        address tokenImpl,
        address vault,
        address treasury,
        uint256 S,
        uint256 R6,
        uint256 rX18
    ) external payable returns (address curve) {
        address token = Clones.clone(tokenImpl);
        curve = Clones.clone(curveImpl);
        Curve(payable(curve)).initialize(
            Curve.InitParams({
                token: token,
                creator: msg.sender,
                treasury: treasury,
                feeVault: vault,
                factory: address(this),
                S: S,
                R6: R6,
                rX18: rX18,
                feeBps: 125,
                creatorBps: 30,
                protocolBps: 95,
                antiSnipeBlocks: 0,
                maxBuyPerAddress6: 0
            })
        );
        PeakToken(token).initialize("Skip", "SKIP", curve, S);
        // No registerCurve here.
        Curve(payable(curve)).buy{value: msg.value}(0, block.timestamp, msg.sender);
    }
}

// Real contracts wired through the real factory (no mocks except SkippingLauncher).
// Every quote is CurveMath, every reserve is read through the contract's own views,
// and native balances are only ever checked with >=.
contract FullLifecycleTest is Test {
    uint256 constant SUP = 1e27;
    uint256 constant R_X18 = 4e18;
    uint256 constant TS = 8e26;
    uint256 constant Y0 = 1066666666666666666666666666;
    uint256 constant R6_RIDGE = 12e9;
    uint256 constant X0_RIDGE = 4e9;
    uint16 constant FEE_BPS = 125;
    uint16 constant CREATOR_BPS = 30;
    // The Anvil account Arc pre-blocklists; our contracts must not gate on it.
    address constant ARC_BLOCKLISTED = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8;

    FeeVault vault;
    PeakpumpFactory factory;
    address curveImpl;
    address tokenImpl;

    address owner = makeAddr("owner");
    address treasury = makeAddr("treasury");
    address creator = makeAddr("creator");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    function setUp() public {
        vault = new FeeVault(treasury);
        tokenImpl = address(new PeakToken());
        curveImpl = address(new Curve());
        factory = new PeakpumpFactory(owner, address(vault), curveImpl, tokenImpl, treasury);
        vault.setFactory(address(factory));
        vm.deal(creator, 1e30);
        vm.deal(alice, 1e30);
        vm.deal(bob, 1e30);
    }

    function _wei(uint256 usdcIn6) internal pure returns (uint256) {
        return usdcIn6 * 1e12;
    }

    function _ridge(uint256 devBuy6) internal returns (Curve curve, PeakToken token) {
        PeakpumpFactory.CreateParams memory p;
        p.name = "Ridge Market";
        p.symbol = "RIDGE";
        p.metadataURI = "ipfs://ridge";
        p.presetId = 2; // Ridge
        p.devBuy6 = devBuy6;
        vm.prank(creator);
        (address t, address c) = factory.create{value: _wei(devBuy6)}(p);
        return (Curve(payable(c)), PeakToken(t));
    }

    // T1/T2 (MATH 9). reserveWei is (state == ASCENT ? x - x0 : x) * 1e12 verbatim from
    // MATH 9: usdcRaised6() would be wrong here because in PEAK it returns the FROZEN
    // raised6 snapshot while the live reserve keeps moving with x (a PEAK sell drops it
    // below raised6). deferredWei is MATH 9's totalDeferredWei ghost; every payout here
    // goes to an EOA that accepts the stipend so it stays zero, but reading the real
    // ledger for the three trading addresses keeps the bound exact, not assumed. Called
    // after every step of the lifecycle.
    function _assertSolvent(Curve c, PeakToken t) internal view {
        uint256 reserveWei =
            (c.state() == Curve.Phase.ASCENT ? uint256(c.x()) - c.x0() : uint256(c.x())) * 1e12;
        uint256 deferredWei = c.deferred(alice) + c.deferred(bob) + c.deferred(creator);
        assertGe(address(c).balance, reserveWei + c.dustWei() + deferredWei, "T1: native covers reserve+dust");
        assertGe(t.balanceOf(address(c)), uint256(c.S()) - c.sold(), "T2: token held covers S - sold");
    }

    // Create, drive across the Summit, then trade in PEAK. Solvency (T1/T2) after
    // every step; the curve self-asserts A1-A4 internally on each buy.
    function test_fullLifecycle_acrossAndPastSummit() public {
        (Curve curve, PeakToken token) = _ridge(0);

        bool crossed;
        for (uint256 i = 0; i < 10 && curve.state() == Curve.Phase.ASCENT; i++) {
            vm.prank(alice);
            curve.buy{value: _wei(3e9)}(0, block.timestamp, alice);
            _assertSolvent(curve, token);
            if (curve.state() == Curve.Phase.PEAK) crossed = true;
        }
        assertTrue(crossed, "market crossed the summit");
        // MATH 10: the preset summit lands at raised6 == R6 + 1 (floored y0).
        assertEq(curve.raised6(), R6_RIDGE + 1, "summit raised6 == R6 + 1");
        assertEq(curve.usdcRaised6(), R6_RIDGE + 1, "PEAK usdcRaised6 reads raised6");

        // PEAK: more buys and a sell. sold may pass Ts now, capped only by S.
        for (uint256 i = 0; i < 3; i++) {
            vm.prank(bob);
            curve.buy{value: _wei(2e9)}(0, block.timestamp, bob);
            _assertSolvent(curve, token);
            assertLe(curve.sold(), curve.S(), "sold never exceeds S");
        }
        uint256 half = token.balanceOf(alice) / 2;
        vm.prank(alice);
        curve.sell(half, 0, block.timestamp);
        _assertSolvent(curve, token);
        assertEq(uint8(curve.state()), uint8(Curve.Phase.PEAK), "state stays PEAK after a sell");
    }

    // The creator's claimable equals the sum of the creator-reason Credited
    // events the vault emitted for it over the trades -- read from the events, never
    // from a Trade field. A buy and a sell both charge a fee and credit the creator.
    function test_a35_creatorClaimableMatchesCreditedEvents() public {
        (Curve curve, PeakToken token) = _ridge(0);

        vm.recordLogs();
        vm.prank(alice);
        curve.buy{value: _wei(3e9)}(0, block.timestamp, alice);
        // Read the balance BEFORE the prank: an external staticcall consumes vm.prank, so
        // token.balanceOf(alice) inside the sell() argument would spend it and sell() would
        // run as this test contract (zero tokens) instead of alice.
        uint256 sellAmt = token.balanceOf(alice) / 3;
        vm.prank(alice);
        curve.sell(sellAmt, 0, block.timestamp);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        assertEq(vault.balances(creator), _sumCreditedTo(logs, creator), "creator claimable == sum of credits");
        assertGt(vault.balances(creator), 0, "creator earned a real fee");
    }

    bytes32 constant CREDITED_SIG = keccak256("Credited(address,uint256,uint8)");

    function _sumCreditedTo(Vm.Log[] memory logs, address who) internal view returns (uint256 sum) {
        for (uint256 i = 0; i < logs.length; i++) {
            if (
                logs[i].emitter == address(vault) && logs[i].topics.length == 2 && logs[i].topics[0] == CREDITED_SIG
                    && address(uint160(uint256(logs[i].topics[1]))) == who
            ) {
                (uint256 amt,) = abi.decode(logs[i].data, (uint256, uint8));
                sum += amt;
            }
        }
    }

    // Regression: a create with a live anti-snipe window AND a non-zero dev-buy
    // succeeds only because the factory is exempt from both window rules.
    function test_createWithWindowAndDevBuy_succeeds() public {
        uint256 devBuy6 = factory.maxDevBuy6(SUP, R6_RIDGE, R_X18, FEE_BPS) / 2;
        PeakpumpFactory.CreateParams memory p;
        p.name = "Windowed";
        p.symbol = "WIN";
        p.metadataURI = "ipfs://win";
        p.presetId = 2;
        p.devBuy6 = devBuy6;
        p.antiSnipeBlocks = 100;
        p.maxBuyPerAddress6 = 1e6; // paired; below the dev-buy, which is still exempt
        vm.prank(creator);
        (address token, address curve) = factory.create{value: _wei(devBuy6)}(p);
        assertGt(PeakToken(token).balanceOf(creator), 0, "dev-buy went through the window");
        assertGt(Curve(payable(curve)).antiSnipeEndBlock(), block.number, "window is live");
    }

    function test_createWindowWithoutCap_reverts() public {
        PeakpumpFactory.CreateParams memory p;
        p.name = "Bad";
        p.symbol = "BAD";
        p.presetId = 2;
        p.antiSnipeBlocks = 100;
        p.maxBuyPerAddress6 = 0;
        vm.prank(creator);
        vm.expectRevert(PeakpumpFactory.AntiSnipePairingInvalid.selector);
        factory.create(p);
    }

    // A live market's fees are frozen in its clone at initialize; a later
    // setDefaultFees cannot move them, and a real trade still charges the old rate.
    function test_liveMarketFees_frozenAfterSetDefaultFees() public {
        (Curve curve,) = _ridge(0);
        assertEq(curve.feeBps(), 125, "market opened at 125");

        vm.prank(owner);
        factory.setDefaultFees(60, 15, 45); // future markets only
        assertEq(curve.feeBps(), 125, "live market still 125 after admin change");

        // A real buy still charges the frozen 125 bps (oracle: buyQuote at 125).
        uint256 usdcIn6 = 3e9;
        CurveMath.BuyQuote memory q = CurveMath.buyQuote(curve.x(), curve.y(), usdcIn6, 125);
        (uint256 cFee6, uint256 pFee6) = CurveMath.splitFee(q.fee6, 125, CREATOR_BPS);
        vm.prank(alice);
        curve.buy{value: _wei(usdcIn6)}(0, block.timestamp, alice);
        assertEq(vault.balances(creator), cFee6, "creator fee at old rate");
        assertEq(vault.balances(treasury), pFee6, "protocol fee at old rate");
    }

    function test_devBuyCapBoundary_exactThenReverts() public {
        uint256 m = factory.maxDevBuy6(SUP, R6_RIDGE, R_X18, FEE_BPS);
        (Curve curve,) = _ridge(m);
        assertLe(uint256(curve.sold()) * 20, TS, "at the cap sold*20 <= Ts");

        PeakpumpFactory.CreateParams memory p;
        p.name = "Over";
        p.symbol = "OVER";
        p.presetId = 2;
        p.devBuy6 = m + 1;
        vm.prank(creator);
        vm.expectRevert(PeakpumpFactory.DevBuyExceedsCap.selector);
        factory.create{value: _wei(m + 1)}(p);
    }

    function test_governanceRevertsAndLockIrreversible() public {
        vm.prank(owner);
        vm.expectRevert(PeakpumpFactory.FeeConfigInvalid.selector);
        factory.setDefaultFees(201, 100, 101); // feeBps > 200
        vm.prank(owner);
        vm.expectRevert(PeakpumpFactory.FeeConfigInvalid.selector);
        factory.setDefaultFees(125, 30, 90); // split does not sum to feeBps

        vm.prank(owner);
        factory.lock();
        vm.prank(owner);
        vm.expectRevert(PeakpumpFactory.GovernanceLocked.selector);
        factory.setTreasury(alice);
        vm.prank(owner);
        vm.expectRevert(PeakpumpFactory.AlreadyLocked.selector);
        factory.lock();
    }

    // Arc enforces its blocklist at the token-transfer layer, not in our launcher:
    // a blocklisted address can still create a market.
    function test_blocklistedCreatorCanCreate() public {
        vm.deal(ARC_BLOCKLISTED, 1e30);
        PeakpumpFactory.CreateParams memory p;
        p.name = "Blocklisted";
        p.symbol = "BLK";
        p.presetId = 2;
        vm.prank(ARC_BLOCKLISTED);
        (, address curve) = factory.create(p);
        assertEq(Curve(payable(curve)).creator(), ARC_BLOCKLISTED, "blocklisted creator recorded");
        assertEq(factory.marketCount(), 1, "market created");
    }

    // An indivisible create succeeds; the sub-1e12 remainder floors into dustWei and
    // the vault's native balance rises by it. No whole 6-dp unit, so treasury is flat.
    function test_indivisibleValue_dustNotTreasury() public {
        uint256 rem = 3e11;
        uint256 dust0 = vault.dustWei();
        uint256 vbal0 = address(vault).balance;
        uint256 t0 = vault.balances(treasury);

        PeakpumpFactory.CreateParams memory p;
        p.name = "Dust";
        p.symbol = "DUST";
        p.presetId = 2; // devBuy6 == 0, creationFee6 == 0 -> sum == 0
        vm.prank(creator);
        factory.create{value: rem}(p);

        assertEq(vault.dustWei() - dust0, rem, "remainder lands in dustWei");
        assertGe(address(vault).balance, vbal0 + rem, "vault native rose by the remainder");
        assertEq(vault.balances(treasury), t0, "treasury unchanged on a sub-unit");
    }

    // A launcher that is its OWN vault's authorized factory but omits registerCurve
    // produces a market whose dev-buy reverts NotAuthorized: registration, not
    // factory identity, is the credit gate. A real create() that skipped it would
    // brick its own dev-buy the same way.
    function test_skippedRegistration_bricksDevBuy() public {
        FeeVault vault2 = new FeeVault(treasury);
        SkippingLauncher launcher = new SkippingLauncher();
        vault2.setFactory(address(launcher));

        vm.prank(creator);
        vm.expectRevert(FeeVault.NotAuthorized.selector);
        launcher.launchAndBuy{value: _wei(1e8)}(curveImpl, tokenImpl, address(vault2), treasury, SUP, R6_RIDGE, R_X18);
    }

    // A hand-deployed Curve of identical bytecode, initialized to point at
    // the real vault and factory but never registered, cannot credit fees.
    function test_a28a_unregisteredIdenticalCurveCannotCredit() public {
        address t = Clones.clone(tokenImpl);
        address c = Clones.clone(curveImpl);
        // initialize is factory-gated (Curve.sol:191): only p.factory may call it. Prank as
        // the real factory so the rogue curve initializes pointing at the real factory and
        // vault exactly as claimed -- yet it was never passed to registerCurve.
        vm.prank(address(factory));
        Curve(payable(c)).initialize(
            Curve.InitParams({
                token: t,
                creator: creator,
                treasury: treasury,
                feeVault: address(vault),
                factory: address(factory),
                S: SUP,
                R6: R6_RIDGE,
                rX18: R_X18,
                feeBps: 125,
                creatorBps: 30,
                protocolBps: 95,
                antiSnipeBlocks: 0,
                maxBuyPerAddress6: 0
            })
        );
        PeakToken(t).initialize("Rogue", "ROG", c, SUP);

        vm.prank(alice);
        vm.expectRevert(FeeVault.NotAuthorized.selector);
        Curve(payable(c)).buy{value: _wei(1e8)}(0, block.timestamp, alice);
    }
}
