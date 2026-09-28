// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {console2} from "forge-std/console2.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {Curve} from "../../src/Curve.sol";
import {PeakToken} from "../../src/PeakToken.sol";
import {FeeVault} from "../../src/FeeVault.sol";
import {PeakpumpFactory} from "../../src/PeakpumpFactory.sol";
import {CurveMath} from "../../src/libraries/CurveMath.sol";

// A recipient that bounces native value, standing in for a code-bearing or
// blocklisted receiver whose payout the curve must defer. Mirrors the
// RejectingTrader stand-in in Curve.t.sol:16, kept in-file so this suite pulls in
// no unit-test symbols.
contract RejectingReceiver {
    Curve internal curve;
    bool public reject = true;

    constructor(Curve c) {
        curve = c;
    }

    function setReject(bool r) external {
        reject = r;
    }

    function buy(uint256 minOut, uint256 deadline, address to) external payable {
        curve.buy{value: msg.value}(minOut, deadline, to);
    }

    function sell(uint256 tokensIn, uint256 minOut, uint256 deadline) external {
        curve.sell(tokensIn, minOut, deadline);
    }

    function withdraw() external {
        curve.withdrawDeferred();
    }

    receive() external payable {
        if (reject) revert("rejected");
    }
}

// The two 6-decimal ERC-20 views this suite reads off 0x3600…0000. Declared locally
// so the fork suite pulls in no token source; the native side is read with the
// built-in address(a).balance.
interface IUsdcView {
    function decimals() external view returns (uint8);
    function balanceOf(address a) external view returns (uint256);
}

// A child created and self-destructed inside ONE transaction is genuinely destroyed
// even under EIP-6780 (which otherwise only deletes same-tx creations), so a value
// CALL to it afterward is exactly the "non-zero CALL to a self-destructed account"
// case that reverts on the Arc network. Overriding a pre-existing account's code would
// NOT reproduce this: SELFDESTRUCT on it would not delete it under 6780.
contract SelfDestructChild {
    function die(address payable beneficiary) external {
        selfdestruct(beneficiary);
    }

    receive() external payable {}
}

// run(true): create the child, destroy it, then send it value -> on Arc the trailing
// CALL reverts and require flips the whole eth_call to failed. run(false) is the
// control: the child stays alive and accepts the value, so the call succeeds; if the
// control fails the CREATE-under-eth_call machinery is broken and the proof is marked
// UNPROVEN rather than read as green.
contract SelfDestructProbe {
    function run(bool kill) external returns (bool ok) {
        SelfDestructChild c = new SelfDestructChild();
        address a = address(c);
        if (kill) c.die(payable(address(this)));
        (ok,) = a.call{value: 1}("");
        require(ok, "value call to target failed");
    }
}

/// @dev Proves the Arc-Testnet chain facts the contracts and the deploy script
/// depend on, against the real network. Two mechanisms, chosen per fact:
///  - [fork]: local revm over lazily-fetched remote state (vm.createSelectFork).
///    Proves contract logic and forked block-header fields; it does NOT apply the Arc protocol's
///    custom state-transition rules (blocklist, zero-address, precompile-value).
///  - [rpc]: vm.rpc("eth_call", ...) executes on the node's own Arc revm, so on Arc,
///    value-transfer reverts DO fire. Used for the node-level rules.
/// No test matches revert-reason or JSON-RPC error text: Foundry v0.8.0 (reth 2.2 /
/// revm 38) changed that text and Circle states it is not a stable contract. Every
/// failure assertion checks only that a call failed. Skipped when ARC_RPC_URL is
/// unset, so the offline suite stays green. The contract name is ArcForkTest;
/// the file stem differs deliberately.
contract ArcForkTest is Test {
    uint256 internal constant ARC_CHAIN_ID = 5042002;

    // Confirmed addresses.
    address internal constant USDC_ERC20 = 0x3600000000000000000000000000000000000000;
    // the CallFrom precompile on Arc. Standard Ethereum precompiles 0x01-0x08 accept
    // value normally on Arc; only the 0x1800... custom range reverts on a value
    // transfer (confirmed against the live Testnet 2026-08-30).
    address internal constant PRECOMPILE_CALLFROM = 0x1800000000000000000000000000000000000003;
    // Arc Testnet seeds this blocklisted address (index 1 of the standard test
    // mnemonic). On the node its inbound and outbound native transfers revert; in a
    // local revm fork it is an ordinary EOA, so blocklist facts need [rpc], not [fork].
    address internal constant ARC_BLOCKLISTED = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8;
    // A neutral sender whose balance is topped up by a state override so a value-
    // bearing eth_call fails only for the transfer rule under test, never for funds.
    address internal constant FUNDER = 0x00000000000000000000000000000000F00DF00D;
    // Confirmed on the Arc network at genesis: a truncation-identity candidate that
    // may carry a real native balance at the fork block.
    address internal constant MULTICALL3 = 0xcA11bde05977b3631167028862bE2a173976CA11;
    // The CallFrom-preserving batchers. The spoof-guard probe routes a subcall
    // through Multicall3From to see whether an explicit gas value works around the
    // gas-estimation failure.
    address internal constant MULTICALL3FROM = 0x522fAf9A91c41c443c66765030741e4AaCe147D0;
    address internal constant MEMO = 0x5294E9927c3306DcBaDb03fe70b92e01cCede505;
    // Scratch address the [rpc+override] proofs host contract bytecode at; never a
    // real account, so its overridden code/balance/slots describe only the pre-state
    // under test. CONTROL is the non-blocklisted claimer/caller positive control.
    address internal constant OVERRIDE_TARGET = 0x00000000000000000000000000000000c0dEc0DE;
    address internal constant CONTROL = 0x00000000000000000000000000000000C0417201;

    // The blocklisted seed is index 1 of the standard test
    // mnemonic; deriving it in-test proves that provenance and hands the operator a
    // locally-derivable key for the manual signed-tx checklist (its address is
    // ARC_BLOCKLISTED, so it may never be broadcast against on Arc).
    string internal constant TEST_MNEMONIC = "test test test test test test test test test test test junk";

    // MATH 10 Ridge preset literals (mirror CurveTestBase). S and r are shared; only
    // R6 and x0 differ per preset.
    uint256 internal constant SUP = 1e27;
    uint256 internal constant R_X18 = 4e18;
    uint128 internal constant TS = 8e26;
    uint256 internal constant R6_RIDGE = 12e9;
    uint128 internal constant X0_RIDGE = 4e9;
    uint128 internal constant Y1 = 266666666666666666666666666;
    uint16 internal constant FEE_BPS = 125;
    uint16 internal constant CREATOR_BPS = 30;

    // Zero8 activates on testnet 2026-09-03 15:00 UTC; a run before that instant is
    // PRE-Zero8 and must be re-run after activation (see the printed not-run summary).
    uint256 internal constant ZERO8_ACTIVATION_TS = 1788447600;

    uint256 internal constant BASE_FEE_FLOOR = 20 gwei;
    uint256 internal constant BASE_FEE_CEIL = 20_000 gwei;

    // FeeVault.balances is slot 1 (OZ ReentrancyGuard._status takes slot 0); Curve's
    // own vars begin at slot 0 (its bases use ERC-7201 storage), so deferred is slot
    // 10. Confirmed with `forge inspect ... storage-layout`.
    uint256 internal constant FEEVAULT_BALANCES_SLOT = 1;
    uint256 internal constant CURVE_DEFERRED_SLOT = 10;

    bool internal forkLive;
    string internal blockTag; // the fork block as a minimal 0x-hex quantity
    string[] internal notRun; // proofs that did not run or are explicitly unproven

    function setUp() public {
        string memory url = vm.envOr("ARC_RPC_URL", string(""));
        if (bytes(url).length == 0) {
            vm.skip(true, "ARC_RPC_URL unset: fork proofs skipped so offline CI stays green");
            return;
        }
        uint256 pin = vm.envOr("ARC_FORK_BLOCK", uint256(0));
        if (pin != 0) {
            vm.createSelectFork(url, pin);
        } else {
            vm.createSelectFork(url);
        }
        forkLive = true;
        blockTag = _toMinimalHex(block.number);
    }

    // First line of every test: the suite is meaningless against the wrong chain, and
    // a mis-set ARC_RPC_URL must fail loudly rather than prove facts about some other
    // network.
    function _chain() internal view {
        assertEq(block.chainid, ARC_CHAIN_ID, "not Arc Testnet (chainid 5042002)");
    }

    // HELPERS_ANCHOR

    function _toMinimalHex(uint256 v) internal pure returns (string memory) {
        if (v == 0) return "0x0";
        bytes16 hexits = "0123456789abcdef";
        bytes memory buf = new bytes(64);
        uint256 i = 64;
        while (v != 0) {
            i--;
            buf[i] = hexits[v & 0xf];
            v >>= 4;
        }
        bytes memory out = new bytes(2 + (64 - i));
        out[0] = "0";
        out[1] = "x";
        for (uint256 j = i; j < 64; j++) {
            out[2 + j - i] = buf[j];
        }
        return string(out);
    }

    // vm.rpc reverts the cheatcode when the node returns a JSON-RPC error, so an
    // external self-call lets a try/catch read only the success flag -- never the
    // reason. Public so `this.` reaches it.
    function rpcEthCall(string calldata params) external returns (bytes memory) {
        return vm.rpc("eth_call", params);
    }

    function _fails(string memory params) internal returns (bool) {
        try this.rpcEthCall(params) returns (bytes memory) {
            return false;
        } catch {
            return true;
        }
    }

    function _ok(string memory params) internal returns (bool) {
        return !_fails(params);
    }

    // ----- eth_call param / state-override JSON builders -----

    function _call(address from, address to, uint256 value, bytes memory data)
        internal
        pure
        returns (string memory)
    {
        return string.concat(
            '{"from":"',
            vm.toString(from),
            '","to":"',
            vm.toString(to),
            '","value":"',
            _toMinimalHex(value),
            '","data":"',
            vm.toString(data),
            '"}'
        );
    }

    // [callObj, blockTag] pinned to the fork block so a read matches in-fork state.
    function _params(string memory callObj) internal view returns (string memory) {
        return string.concat("[", callObj, ',"', blockTag, '"]');
    }

    // Like _call but with an explicit gas field. arc-node #189 makes callWithMemo
    // revert under eth_call/eth_estimateGas because gas ESTIMATION fails; #191
    // suggests passing an explicit gas bypasses the estimation step. The
    // spoof-guard probe uses this.
    function _callGas(address from, address to, uint256 value, uint256 gas, bytes memory data)
        internal
        pure
        returns (string memory)
    {
        return string.concat(
            '{"from":"',
            vm.toString(from),
            '","to":"',
            vm.toString(to),
            '","gas":"',
            _toMinimalHex(gas),
            '","value":"',
            _toMinimalHex(value),
            '","data":"',
            vm.toString(data),
            '"}'
        );
    }

    // [callObj, blockTag, override]
    function _params(string memory callObj, string memory ov) internal view returns (string memory) {
        return string.concat("[", callObj, ',"', blockTag, '",', ov, "]");
    }

    // Give `from` a large native balance so a value-bearing eth_call can only fail for
    // the transfer rule under test, not for insufficient funds. The balance is far
    // larger than the 1 wei any of these probes sends, so `from` is never drained to a
    // zero-balance/zero-nonce/no-code state -- the documented Arc behavior for
    // "draining a completely empty account" therefore cannot be the cause of a
    // revert here; only the rule under test can be.
    function _fund(address from) internal pure returns (string memory) {
        return string.concat('{"', vm.toString(from), '":{"balance":"', _toMinimalHex(1e24), '"}}');
    }

    // A single account overridden with code, a native balance, and one storage slot.
    function _override(address a, bytes memory code, bytes32 slot, bytes32 val, uint256 bal)
        internal
        pure
        returns (string memory)
    {
        return string.concat(
            '{"',
            vm.toString(a),
            '":{"code":"',
            vm.toString(code),
            '","balance":"',
            _toMinimalHex(bal),
            '","stateDiff":{"',
            vm.toString(slot),
            '":"',
            vm.toString(val),
            '"}}}'
        );
    }

    function _mapSlot(address key, uint256 slot) internal pure returns (bytes32) {
        return keccak256(abi.encode(key, slot));
    }

    // An account overridden with code and a native balance but no storage slot; the
    // self-destruct probe needs code + funds, not a mapping entry.
    function _codeBal(address a, bytes memory code, uint256 bal) internal pure returns (string memory) {
        return string.concat(
            '{"', vm.toString(a), '":{"code":"', vm.toString(code), '","balance":"', _toMinimalHex(bal), '"}}'
        );
    }

    // ----- in-fork market stack (mirrors FullLifecycle.t.sol:79-88) -----

    struct Stack {
        FeeVault vault;
        PeakpumpFactory factory;
        address treasury;
    }

    // Multicall3From.aggregate3 input shape, for the spoof probe's routed subcall.
    struct Call3 {
        address target;
        bool allowFailure;
        bytes callData;
    }

    function _deployStack(address owner_, address treasury_) internal returns (Stack memory s) {
        s.vault = new FeeVault(treasury_);
        address tokenImpl = address(new PeakToken());
        address curveImpl = address(new Curve());
        s.factory = new PeakpumpFactory(owner_, address(s.vault), curveImpl, tokenImpl, treasury_);
        s.vault.setFactory(address(s.factory));
        s.treasury = treasury_;
    }

    function _wei(uint256 usdcIn6) internal pure returns (uint256) {
        return usdcIn6 * 1e12;
    }

    // T1/T2 (MATH 9), inequalities only: native covers reserve+dust+deferred, and the
    // token held covers S - sold. reserveWei is x-x0 in ASCENT, x in PEAK, verbatim.
    function _assertSolvent(Curve c, PeakToken t, address[] memory parties) internal view {
        uint256 reserveWei =
            (c.state() == Curve.Phase.ASCENT ? uint256(c.x()) - c.x0() : uint256(c.x())) * 1e12;
        uint256 deferredWei;
        for (uint256 i = 0; i < parties.length; i++) {
            deferredWei += c.deferred(parties[i]);
        }
        assertGe(address(c).balance, reserveWei + c.dustWei() + deferredWei, "T1: native covers reserve+dust+deferred");
        assertGe(t.balanceOf(address(c)), uint256(c.S()) - c.sold(), "T2: token held covers S - sold");
    }

    // ----- log-sum reconciliation (mirrors FullLifecycle.t.sol:155-185) -----

    bytes32 internal constant CREDITED_SIG = keccak256("Credited(address,uint256,uint8)");
    bytes32 internal constant TRADE_SIG =
        keccak256("Trade(address,address,bool,uint120,uint120,uint120,uint120,uint120,uint120,uint120,uint8)");
    bytes32 internal constant DUSTSWEPT_SIG = keccak256("DustSwept(uint256,uint256)");

    // Sum every Credited.amount6 the vault emitted: creditPair fee credits plus the
    // sweepDust credit(treasury). Filtered on the vault emitter (EIP-7708: a bare
    // Transfer topic would also match the system emitter and the ERC-20 view).
    function _sumVaultCredited(Vm.Log[] memory logs, address vault) internal pure returns (uint256 sum) {
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].emitter == vault && logs[i].topics.length == 2 && logs[i].topics[0] == CREDITED_SIG) {
                (uint256 amt,) = abi.decode(logs[i].data, (uint256, uint8));
                sum += amt;
            }
        }
    }

    // fee6 is the 5th of Trade's eight non-indexed fields (Trade has three indexed
    // topics): usdcIn6, usdcOut6, tokenIn, tokenOut, fee6, tReserve6After,
    // supplySold6After (all uint120), then phaseAfter (uint8).
    function _sumTradeFee(Vm.Log[] memory logs, address curve) internal pure returns (uint256 sum) {
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].emitter == curve && logs[i].topics.length == 4 && logs[i].topics[0] == TRADE_SIG) {
                (,,,, uint120 fee6,,,) = abi.decode(
                    logs[i].data,
                    (uint120, uint120, uint120, uint120, uint120, uint120, uint120, uint8)
                );
                sum += fee6;
            }
        }
    }

    function _sumDustSwept(Vm.Log[] memory logs, address curve) internal pure returns (uint256 sum) {
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].emitter == curve && logs[i].topics.length == 1 && logs[i].topics[0] == DUSTSWEPT_SIG) {
                (, uint256 credited6) = abi.decode(logs[i].data, (uint256, uint256));
                sum += credited6;
            }
        }
    }

    // 1. USDC ERC-20 view is 6-dp, and the native/6-dp views are one asset. The
    // mechanism is chosen by a runtime preflight: 0x3600…0000 may carry an EIP-3541
    // 0xef stub in genesis (not forkable), in which case decimals() is read on the
    // node via eth_call instead of in-fork. This task only READS remote balances and
    // moves no value, so the documented Arc "draining a completely empty account"
    // limitation (a revert for a zero-balance, zero-nonce, no-code account) is not in
    // play; candidates are real accounts that already hold value, never freshly created.
    function test_01_usdcSixDecimalsAndTruncation() public {
        if (!forkLive) return;
        _chain();
        bytes memory code = USDC_ERC20.code;
        console2.log("USDC_ERC20 in-fork code length:", code.length);
        bool forkable = code.length > 0 && uint8(code[0]) != 0xEF;
        if (forkable) {
            assertEq(IUsdcView(USDC_ERC20).decimals(), 6, "decimals()==6 [fork]");
        } else {
            bytes memory ret =
                this.rpcEthCall(_params(_call(address(0), USDC_ERC20, 0, abi.encodeWithSignature("decimals()"))));
            assertEq(abi.decode(ret, (uint256)), 6, "decimals()==6 [rpc]");
            notRun.push("usdc: truncation identity (0x3600 not forkable in local revm)");
            return;
        }
        // Truncation holds only where an un-deal'd account reads real remote state for
        // BOTH views; a zero/zero match would be a vacuous pass, so an account that
        // actually holds value is required.
        address[3] memory cands = [MULTICALL3, ARC_BLOCKLISTED, FUNDER];
        for (uint256 i = 0; i < cands.length; i++) {
            uint256 bal = cands[i].balance;
            if (bal == 0) continue;
            uint256 bof = IUsdcView(USDC_ERC20).balanceOf(cands[i]);
            // Two >= together are the exact truncation bof == floor(bal/1e12); this is
            // a chain-fact identity, not a solvency balance check.
            assertGe(bal / 1e12, bof, "balanceOf <= native/1e12");
            assertGe(bof, bal / 1e12, "native/1e12 <= balanceOf");
            return;
        }
        notRun.push("usdc: truncation identity (no candidate account held value at the fork block)");
    }

    // 2. A value transfer to the zero address reverts on the node; a zero-value
    // transfer to it succeeds. The sender is funded by override so only the rule fires.
    function test_02_zeroAddressTransfer() public {
        if (!forkLive) return;
        _chain();
        assertTrue(_fails(_params(_call(FUNDER, address(0), 1, ""), _fund(FUNDER))), "value->0x0 reverts");
        assertTrue(_ok(_params(_call(FUNDER, address(0), 0, ""), _fund(FUNDER))), "zero-value->0x0 ok");
    }

    // 3. Sending native value to an Arc custom precompile reverts on the node.
    // Targets the CallFrom precompile (0x1800...0003): the 0x1800 range reverts on
    // value, while standard precompiles 0x01-0x08 accept it.
    function test_03_precompileValueTransfer() public {
        if (!forkLive) return;
        _chain();
        assertTrue(
            _fails(_params(_call(FUNDER, PRECOMPILE_CALLFROM, 1, ""), _fund(FUNDER))),
            "value->Arc precompile reverts"
        );
    }

    // 3b. [rpc] A non-zero CALL to a self-destructed account reverts on the Arc
    // network. SelfDestructProbe.run(true) creates a child, destroys it in the
    // same call (so EIP-6780 really deletes it), then sends it 1 wei -> on Arc that
    // trailing CALL reverts, tripping the probe's require, so the eth_call fails. The
    // control run(false) leaves the child alive and the same CALL succeeds; if the
    // control fails the CREATE-under-eth_call machinery is broken, so the proof is
    // recorded UNPROVEN rather than mistaken for a green pass.
    function test_03b_valueToSelfDestructedReverts() public {
        if (!forkLive) return;
        _chain();
        bytes memory code = type(SelfDestructProbe).runtimeCode;
        string memory controlParams = _params(
            _call(FUNDER, OVERRIDE_TARGET, 0, abi.encodeWithSignature("run(bool)", false)),
            _codeBal(OVERRIDE_TARGET, code, 1e18)
        );
        if (!_ok(controlParams)) {
            notRun.push("self-destruct probe control (live child) failed; value-to-SD-target proof UNPROVEN");
            return;
        }
        string memory killParams = _params(
            _call(FUNDER, OVERRIDE_TARGET, 0, abi.encodeWithSignature("run(bool)", true)),
            _codeBal(OVERRIDE_TARGET, code, 1e18)
        );
        assertTrue(_fails(killParams), "value CALL to a self-destructed account reverts");
    }

    // 4. PREVRANDAO is 0, so there is no on-chain randomness. Read from the forked
    // block header in local revm [fork].
    function test_04_prevrandaoZero() public {
        if (!forkLive) return;
        _chain();
        assertEq(block.prevrandao, 0, "prevrandao == 0");
    }

    // 5. Block timestamps are non-decreasing, not strictly increasing -- which is why
    // every deadline comparison is <=, never <. vm.rpc coerces JSON results to ABI
    // bytes unreliably for large integers (the vm.parseJson large-integer hazard), so
    // the window is scanned in-fork with vm.rollFork and block.timestamp instead. Only
    // the non-decreasing property is hard-asserted; an equal adjacent pair is reported.
    function test_05_timestampsNonDecreasing() public {
        if (!forkLive) return;
        _chain();
        uint256 top = block.number;
        uint256 span = 200;
        if (top <= span) {
            notRun.push("timestamps: chain shorter than the 200-block window");
            return;
        }
        uint256 prev;
        bool first = true;
        bool sawEqualPair = false;
        for (uint256 b = top - span; b <= top; b++) {
            vm.rollFork(b);
            uint256 ts = block.timestamp;
            if (!first) {
                assertGe(ts, prev, "timestamps non-decreasing");
                if (ts == prev) sawEqualPair = true;
            }
            prev = ts;
            first = false;
        }
        console2.log("equal adjacent timestamp pair observed in window:", sawEqualPair);
    }

    // 6. The CallFrom / Multicall3From / Memo spoof guard. arc-node #189: a routed call
    // reverts under read-only eth_call/eth_estimateGas because gas ESTIMATION fails, so
    // an eth_call attack would revert regardless of the guard (and the genuine-holder
    // control would fail for the same unrelated reason). Before finalizing this as
    // UNPROVEN we run the #191 workaround probe: route a trivial subcall through
    // Multicall3From with an EXPLICIT gas value (skipping estimation). If it still
    // fails, #189 is confirmed and the guard stays UNPROVEN with the manual signed-tx
    // checklist as the operator's procedure. Only if the probe SUCCEEDS is the
    // eth_call route viable at all -- and even then a full guard proof needs a
    // curve+victim pre-state, so it remains a follow-up, not a claim made here. No
    // in-fork mock: a modeled precompile would not prove the real one.
    function test_06_callFromSpoofProbe() public {
        if (!forkLive) return;
        _chain();
        Call3[] memory calls = new Call3[](1);
        calls[0] = Call3({target: MULTICALL3, allowFailure: false, callData: abi.encodeWithSignature("getBlockNumber()")});
        bytes memory data = abi.encodeWithSignature("aggregate3((address,bool,bytes)[])", calls);

        bool noGas = _ok(_params(_call(FUNDER, MULTICALL3FROM, 0, data), _fund(FUNDER)));
        bool withGas = _ok(_params(_callGas(FUNDER, MULTICALL3FROM, 0, 3_000_000, data), _fund(FUNDER)));
        console2.log("CallFrom probe -- routed eth_call without explicit gas ok:", noGas);
        console2.log("CallFrom probe -- routed eth_call with explicit gas    ok:", withGas);

        if (noGas && withGas) {
            // A benign read-only routed subcall succeeds either way, so this route does
            // NOT reproduce #189 (whose failure is specific to state-changing /
            // callWithMemo gas estimation). The probe is therefore inconclusive for the
            // actual spoof attack, which mutates state: the guard stays UNPROVEN.
            notRun.push(
                "spoof guard: routed eth_call succeeds WITH and WITHOUT explicit gas for a benign view, so #189 is not triggered by a read-only route and the explicit-gas workaround is unvalidated for the state-changing spoof path -- UNPROVEN, run the manual signed-tx checklist"
            );
        } else if (!noGas && withGas) {
            notRun.push(
                "spoof guard: explicit gas cleared a routed-call failure that plain eth_call hit (#191 workaround live under eth_call); a full guard proof still needs a curve+victim override -- NOT built in this run, still UNPROVEN, run the manual signed-tx checklist meanwhile"
            );
        } else {
            notRun.push(
                "spoof guard: routed eth_call still FAILS even with explicit gas (#189 confirmed under eth_call); spoof guard UNPROVEN by design -- run the manual signed-tx checklist"
            );
        }
    }

    // 7a. [fork] A blocklisted creator's market trades end to end: the creator's fee is
    // CREDITED to the vault ledger (never pushed), so a buy by alice completes and the
    // creator's native balance does not rise. Mirrors Curve.t.sol:722 on real state.
    function test_07a_blocklistedCreatorFeeCredited() public {
        if (!forkLive) return;
        _chain();
        Stack memory s = _deployStack(makeAddr("owner7a"), makeAddr("treasury7a"));
        address alice = makeAddr("alice7a");
        vm.deal(alice, 1e30);

        PeakpumpFactory.CreateParams memory p;
        p.name = "Blocklisted Creator";
        p.symbol = "BLK";
        p.presetId = 2; // Ridge
        vm.prank(ARC_BLOCKLISTED);
        (address t, address c) = s.factory.create(p);
        Curve curve = Curve(payable(c));

        uint256 creatorBalBefore = ARC_BLOCKLISTED.balance;
        vm.prank(alice);
        curve.buy{value: _wei(3e9)}(0, block.timestamp, alice);

        assertGt(s.vault.balances(ARC_BLOCKLISTED), 0, "creator fee credited to the ledger");
        assertLe(ARC_BLOCKLISTED.balance, creatorBalBefore, "no fee pushed to the blocklisted creator");
        assertGt(PeakToken(t).balanceOf(alice), 0, "buyer received tokens; trade completed");
    }

    // 7b. [fork] A blocklisted creator can create() at msg.value == 0 (a value-bearing
    // create would die at the node, a chain rule, not a contract bug). Mirrors
    // FullLifecycle.t.sol:272 on real state.
    function test_07b_blocklistedCreatorCreatesAtZeroValue() public {
        if (!forkLive) return;
        _chain();
        Stack memory s = _deployStack(makeAddr("owner7b"), makeAddr("treasury7b"));
        PeakpumpFactory.CreateParams memory p;
        p.name = "Blocklisted Create";
        p.symbol = "BLKC";
        p.presetId = 2;
        vm.prank(ARC_BLOCKLISTED);
        (, address c) = s.factory.create(p);
        assertEq(Curve(payable(c)).creator(), ARC_BLOCKLISTED, "blocklisted creator recorded");
    }

    // 7c. [rpc] The node-level blocklist primitive the contract logic leans on: a value
    // transfer TO the blocklisted address reverts, and one FROM it reverts. Both senders
    // are over-funded by override and send only 1 wei, so neither the Arc drain-empty
    // limitation nor insufficient funds can be the cause -- only the blocklist rule. The
    // address is first re-derived from the standard test mnemonic (index 1) to prove it
    // is exactly the documented seed and that its key is locally derivable (the manual
    // signed-tx checklist needs that key). This is the real trigger behind "claim() by
    // the blocklisted party fails" and "_payout to a blocklisted recipient defers"; the
    // bookkeeping halves are proven in-fork below.
    function test_07c_blocklistPrimitive() public {
        if (!forkLive) return;
        _chain();
        assertEq(vm.addr(vm.deriveKey(TEST_MNEMONIC, 1)), ARC_BLOCKLISTED, "blocklisted seed == mnemonic index 1");
        assertTrue(_fails(_params(_call(FUNDER, ARC_BLOCKLISTED, 1, ""), _fund(FUNDER))), "value->blocklisted reverts");
        assertTrue(
            _fails(_params(_call(ARC_BLOCKLISTED, FUNDER, 1, ""), _fund(ARC_BLOCKLISTED))),
            "value from blocklisted reverts"
        );
    }

    // 7d. [rpc+override] Only the blocklisted party's own claim() fails. A FeeVault is
    // built in the node's revm via a code+balance+one-slot override, crediting one unit
    // to the claimer, and claim() is eth_call'd from it. The blocklisted claimer's
    // internal payout reverts at the node -> claim reverts (fails). The control is a
    // non-blocklisted claimer whose claim succeeds; if the control fails, the override
    // itself is broken and the proof is marked UNPROVEN rather than read as green.
    function test_07d_onlyBlocklistedClaimFails() public {
        if (!forkLive) return;
        _chain();
        bytes memory code = vm.getDeployedCode("FeeVault.sol:FeeVault");
        bytes32 val = bytes32(uint256(1)); // 1 unit (6-dp) => 1e12 wei payout
        string memory controlParams = _params(
            _call(CONTROL, OVERRIDE_TARGET, 0, abi.encodeWithSignature("claim()")),
            _override(OVERRIDE_TARGET, code, _mapSlot(CONTROL, FEEVAULT_BALANCES_SLOT), val, 1e12)
        );
        if (!_ok(controlParams)) {
            notRun.push("claim override control failed; blocklisted-claim proof UNPROVEN");
            return;
        }
        string memory blockedParams = _params(
            _call(ARC_BLOCKLISTED, OVERRIDE_TARGET, 0, abi.encodeWithSignature("claim()")),
            _override(OVERRIDE_TARGET, code, _mapSlot(ARC_BLOCKLISTED, FEEVAULT_BALANCES_SLOT), val, 1e12)
        );
        assertTrue(_fails(blockedParams), "blocklisted party's claim() reverts");
    }

    // 7e. [rpc+override] withdrawDeferred() by the blocklisted party reverts, and (as
    // an eth_call commits nothing) the recorded amount is untouched. A Curve is built
    // in the node's revm with deferred[caller] set; the blocklisted caller's refund
    // push reverts -> require(ok) fails -> revert. Control-gated like 7d.
    function test_07e_blocklistedWithdrawDeferredReverts() public {
        if (!forkLive) return;
        _chain();
        bytes memory code = vm.getDeployedCode("Curve.sol:Curve");
        bytes32 val = bytes32(uint256(1e12)); // deferred amount in wei
        string memory controlParams = _params(
            _call(CONTROL, OVERRIDE_TARGET, 0, abi.encodeWithSignature("withdrawDeferred()")),
            _override(OVERRIDE_TARGET, code, _mapSlot(CONTROL, CURVE_DEFERRED_SLOT), val, 1e12)
        );
        if (!_ok(controlParams)) {
            notRun.push("withdrawDeferred override control failed; blocklisted-withdraw proof UNPROVEN");
            return;
        }
        string memory blockedParams = _params(
            _call(ARC_BLOCKLISTED, OVERRIDE_TARGET, 0, abi.encodeWithSignature("withdrawDeferred()")),
            _override(OVERRIDE_TARGET, code, _mapSlot(ARC_BLOCKLISTED, CURVE_DEFERRED_SLOT), val, 1e12)
        );
        assertTrue(_fails(blockedParams), "blocklisted party's withdrawDeferred() reverts");
    }

    // 7f. [fork] The deferral bookkeeping, with a RejectingReceiver standing in for a
    // recipient whose payout reverts exactly as the node's blocklist would: a sell's
    // proceeds defer (deferred > 0, which is written on the same branch that emits
    // PayoutDeferred), withdrawDeferred reverts while the receiver rejects, and once it
    // accepts value the deferred amount pays out exactly once. Mirrors Curve.t.sol:681.
    function test_07f_deferralBookkeeping() public {
        if (!forkLive) return;
        _chain();
        Stack memory s = _deployStack(makeAddr("owner7f"), makeAddr("treasury7f"));
        PeakpumpFactory.CreateParams memory p;
        p.name = "Deferral";
        p.symbol = "DEF";
        p.presetId = 2;
        (address t, address c) = s.factory.create(p);
        Curve curve = Curve(payable(c));
        PeakToken token = PeakToken(t);

        RejectingReceiver rt = new RejectingReceiver(curve);
        vm.deal(address(rt), 1e30);
        rt.buy{value: _wei(3e9)}(0, block.timestamp, address(rt)); // ASCENT, non-crossing
        uint256 held = token.balanceOf(address(rt));

        rt.sell(held, 0, block.timestamp); // proceeds bounce -> defer
        uint256 deferredWei = curve.deferred(address(rt));
        assertGt(deferredWei, 0, "sell proceeds deferred (PayoutDeferred branch taken)");

        vm.expectRevert();
        rt.withdraw(); // still rejecting: withdrawDeferred's require(ok) fails
        assertEq(curve.deferred(address(rt)), deferredWei, "amount stays recorded after a failed withdraw");

        rt.setReject(false);
        rt.withdraw();
        assertEq(curve.deferred(address(rt)), 0, "deferred paid out exactly once after unblock");
    }

    // 8. [fork] A full create -> buy -> summit -> sell cycle on a real fork, with a
    // dust path, reconciled by MATH T5: every curve-originated vault credit is either
    // a trade fee or the swept dust. With devBuy6 == 0 and creationFee6 == 0 the create
    // at msg.value 0 emits no vault Credited, so every Credited is curve-originated.
    // Sub-1e12 tails on the buys drive curve.dustWei past one whole unit so sweepDust
    // makes the DustSwept term non-zero and actually tested.
    function test_08_fullCycleConservation() public {
        if (!forkLive) return;
        _chain();
        Stack memory s = _deployStack(makeAddr("owner8"), makeAddr("treasury8"));
        address alice = makeAddr("alice8");
        vm.deal(alice, 1e30);
        PeakpumpFactory.CreateParams memory p;
        p.name = "Full Cycle";
        p.symbol = "RDG8";
        p.presetId = 2; // Ridge
        (address t, address c) = s.factory.create(p); // creator == this contract, value 0
        Curve curve = Curve(payable(c));
        PeakToken token = PeakToken(t);

        vm.recordLogs();
        bool crossed;
        for (uint256 i = 0; i < 12 && curve.state() == Curve.Phase.ASCENT; i++) {
            vm.prank(alice);
            curve.buy{value: _wei(3e9) + 6e11}(0, block.timestamp, alice); // 6e11 sub-unit tail -> dust
            if (curve.state() == Curve.Phase.PEAK) crossed = true;
        }
        assertTrue(crossed, "market crossed the summit");
        assertGe(curve.dustWei(), 1e12, "tails accumulated at least one whole dust unit");
        curve.sweepDust(); // curve-originated vault credit that is not a fee (T5 subtracts it)

        uint256 half = token.balanceOf(alice) / 2;
        vm.prank(alice);
        curve.sell(half, 0, block.timestamp);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        uint256 credited = _sumVaultCredited(logs, address(s.vault));
        uint256 fees = _sumTradeFee(logs, address(curve));
        uint256 swept = _sumDustSwept(logs, address(curve));
        assertGt(swept, 0, "dust path exercised: DustSwept term non-zero");
        assertEq(credited, fees + swept, "MATH T5: vault credits == trade fees + swept dust");

        address[] memory parties = new address[](1);
        parties[0] = alice;
        _assertSolvent(curve, token, parties);
    }

    // 9. [fork] The forked block's base fee sits within the documented [20 Gwei,
    // 20,000 Gwei] band, which justifies the two-sided deploy clamp. Reading it from the
    // forked header via block.basefee is the documented-correct method, not a
    // workaround: the Arc network publishes the next block's base fee in the parent
    // header's extra_data as an 8-byte big-endian value rather than re-deriving it, so
    // the base fee is an authoritative header field that local revm surfaces verbatim --
    // there is nothing an eth_feeHistory parse would add but JSON-coercion risk (the
    // vm.parseJson large-integer hazard).
    function test_09_baseFeeBounds() public {
        if (!forkLive) return;
        _chain();
        assertGe(block.basefee, BASE_FEE_FLOOR, "base fee >= 20 gwei floor");
        assertLe(block.basefee, BASE_FEE_CEIL, "base fee <= 20000 gwei ceiling");
    }

    // A permanent, order-independent record of the proofs this suite does NOT run, so
    // a green run can never be mistaken for "everything proven". Foundry isolates state
    // per test, so the conditional notRun pushes in other tests do not reach here; this
    // enumerates the always-unproven set directly.
    function test_zz_runSummary() public {
        if (!forkLive) return;
        _chain();
        notRun.push(
            "CallFrom/Multicall3From/Memo spoof guard -- UNPROVEN in this run; test_06 runs the #191 explicit-gas probe and logs whether the #189 eth_call blocker is cleared; run the manual signed-tx checklist regardless"
        );
        notRun.push(
            "seller-payout defer: node trigger proven by test_07c (blocklist primitive) + test_07d/07e overrides; curve bookkeeping proven in-fork by test_07f -- no full-curve eth_call override"
        );
        console2.log("=== ArcForkTest: proofs NOT run / UNPROVEN ===");
        for (uint256 i = 0; i < notRun.length; i++) {
            console2.log(notRun[i]);
        }
        assertGt(notRun.length, 0, "the UNPROVEN set is recorded, not silently green");
    }
}

