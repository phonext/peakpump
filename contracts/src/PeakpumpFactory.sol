// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {CurveMath} from "./libraries/CurveMath.sol";
import {Curve} from "./Curve.sol";
import {PeakToken} from "./PeakToken.sol";
import {FeeVault} from "./FeeVault.sol";

/// @dev The market launcher. One create() clones a PeakToken and a Curve, wires
/// them to the singleton FeeVault, registers the curve so it may credit fees, runs
/// the anti-snipe-exempt creator dev-buy, and emits the two frozen indexer events.
/// Governance is three owner-only setters plus a one-shot lock(); none can move a
/// live market, whose parameters are copied into its clone at initialize (MATH 4
/// slot E). No formula is re-derived here: the curve is the single deriving and
/// asserting authority, so create passes it raw S/R6/rX18.
contract PeakpumpFactory {
    using SafeCast for uint256;

    // Set once at deployment. curveImpl/tokenImpl are the EIP-1167 clone targets;
    // feeVault is the singleton ledger every market credits.
    address public immutable owner;
    FeeVault public immutable feeVault;
    address public immutable curveImpl;
    address public immutable tokenImpl;

    // Governance state, copied into each clone at create and never read back to move
    // a live market (SPEC 4). treasury is the protocol-fee and dust
    // destination in effect at the instant of a credit.
    address public treasury;
    uint16 public defaultFeeBps;
    uint16 public defaultCreatorBps;
    uint16 public defaultProtocolBps;
    uint256 public creationFee6;
    bool public governanceLocked;
    uint256 public marketCount;

    struct CreateParams {
        string name;
        string symbol;
        string metadataURI;
        uint8 presetId; // 0 custom, 1 Basecamp, 2 Ridge, 3 Alpine
        uint256 S;
        uint256 R6;
        uint256 rX18; // read only when presetId == 0
        uint256 devBuy6;
        uint256 antiSnipeBlocks;
        uint256 maxBuyPerAddress6;
    }

    // Canonical event (SPEC 5.1): field order frozen. Three indexed topics only.
    // Frozen misnomers: tSupply6 carries S, tSummit6 carries Ts (both token wei);
    // maxBuyPerAddress6 and creationFee6 are 6-dp USDC.
    event MarketCreated(
        address indexed curve,
        address indexed token,
        address indexed creator,
        uint256 marketId,
        uint120 y0,
        uint120 tSupply6,
        uint120 tSummit6,
        uint48 antiSnipeEndBlock,
        uint120 maxBuyPerAddress6,
        uint16 feeBpsTotal,
        uint16 feeBpsCreator,
        uint16 feeBpsProtocol,
        uint120 creationFee6
    );
    // name/symbol/metadataURI live in no other frozen event and nowhere on
    // chain, so this is the indexer's only source for them. Emitted every create.
    event MarketMetadata(address indexed curve, string name, string symbol, string metadataURI);

    // Governance events carry old and new (SPEC 4); Locked is emitted once.
    event DefaultFeesUpdated(
        uint16 oldFeeBps,
        uint16 oldCreatorBps,
        uint16 oldProtocolBps,
        uint16 newFeeBps,
        uint16 newCreatorBps,
        uint16 newProtocolBps
    );
    event CreationFeeUpdated(uint256 oldFee6, uint256 newFee6);
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);
    event Locked();

    error NotOwner();
    error GovernanceLocked();
    error AlreadyLocked();
    error ZeroAddress();
    error BadPreset();
    error ValueMismatch();
    error DevBuyExceedsCap();
    error AntiSnipeTooLong();
    error AntiSnipePairingInvalid();
    error FeeConfigInvalid();
    error CreationFeeTooHigh();
    error ZeroTreasury();
    error SymbolEmpty();
    error SymbolTooLong();
    error SymbolBadChar();
    error SymbolReserved();
    error SymbolArcPrefix();
    error NameEmpty();
    error NameTooLong();
    error NameControlByte();
    error NameHiddenCodepoint();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier notLocked() {
        if (governanceLocked) revert GovernanceLocked();
        _;
    }

    // The deploy script sets treasury and confirms the split immediately after
    // construction (SPEC 5.6); shipping the MATH 6 defaults here means the factory
    // is never in a zero-treasury or mis-split state, even before those calls run.
    constructor(address owner_, address feeVault_, address curveImpl_, address tokenImpl_, address treasury_) {
        if (
            owner_ == address(0) || feeVault_ == address(0) || curveImpl_ == address(0) || tokenImpl_ == address(0)
                || treasury_ == address(0)
        ) revert ZeroAddress();
        owner = owner_;
        feeVault = FeeVault(payable(feeVault_));
        curveImpl = curveImpl_;
        tokenImpl = tokenImpl_;
        treasury = treasury_;
        defaultFeeBps = 125;
        defaultCreatorBps = 30;
        defaultProtocolBps = 95;
        // creationFee6 starts at 0; governanceLocked is false; marketCount is 0.
    }

    // The contract routes native USDC through create() and the FeeVault, so a
    // payable fallback closes a class of silent future failures rather than serving
    // any current path: no create() flow leaves value here that step 10 does not
    // sweep, and no dev-buy can cross the Summit (refund6 is always 0). Mirrors the
    // same deliberate ABI choice on Curve, not defensive code for a reachable state.
    receive() external payable {}

    function create(CreateParams calldata p) external payable returns (address token, address curve) {
        (uint256 S, uint256 R6, uint256 rX18) = _resolveTriple(p);
        _validateName(p.name);
        _validateSymbol(p.symbol);
        if (p.antiSnipeBlocks > 300) revert AntiSnipeTooLong();
        // Both-or-neither, fail-fast before any clone (the curve re-checks it too).
        if ((p.antiSnipeBlocks == 0) != (p.maxBuyPerAddress6 == 0)) revert AntiSnipePairingInvalid();
        // Reverts the MATH 3 bound errors before a clone is ever deployed; d is
        // reused for the event fields and the dev-buy cap.
        CurveMath.DerivedParams memory d = CurveMath.deriveParams(S, R6, rX18);

        // No msg.value divisibility check: the sub-1e12 remainder is accepted and
        // credited as protocol dust below. The 6-dp total must match exactly, so an
        // overpayment reverts rather than being confiscated.
        uint256 rem = msg.value % 1e12;
        if (msg.value / 1e12 != creationFee6 + p.devBuy6) revert ValueMismatch();

        uint96 mb96 = p.maxBuyPerAddress6.toUint96();
        (token, curve) = _deployMarket(S, R6, rX18, mb96, p);

        // Creation fee plus the indivisible remainder, credited to the treasury via
        // the vault BEFORE the dev-buy so buy() runs with the factory holding only
        // the dev-buy value. credit() floors to 6 dp: a sub-1e12 remainder lands in
        // FeeVault.dustWei, and credit() does not revert on a zero-floored value.
        {
            uint256 v = uint256(creationFee6) * 1e12 + rem;
            if (v != 0) feeVault.credit{value: v}(treasury);
        }

        // Both events before the dev-buy so the indexer sees the market before its
        // first Trade. marketId starts at 1.
        _emitMarketCreated(curve, token, ++marketCount, S, d, p, mb96);
        emit MarketMetadata(curve, p.name, p.symbol, p.metadataURI);

        // Recipient is the creator, so the tokens and the Trade attribute to the
        // creator; the factory is exempt from both anti-snipe rules
        // (see Curve.sol). A dev-buy capped at Ts/20 can never cross the
        // Summit, so refund6 is always 0 and no payout returns to the factory.
        if (p.devBuy6 > 0) Curve(payable(curve)).buy{value: p.devBuy6 * 1e12}(0, block.timestamp, msg.sender);

        // The cap on the REAL result (sold*20 <= Ts), widened before the multiply,
        // bit-exact with maxDevBuy6 -- a post-hoc assert, never a second formula.
        if (uint256(Curve(payable(curve)).sold()) * 20 > d.Ts) revert DevBuyExceedsCap();

        // SPEC 5.1: the factory retains no USDC across calls. Normally exactly zero;
        // this absorbs only a force-send. `!= 0` is not an equality on a balance.
        uint256 bal = address(this).balance;
        if (bal != 0) feeVault.credit{value: bal}(treasury);
    }

    // Clone the pair, initialize the curve from raw S/R6/rX18, mint S to the curve,
    // and register it so its dev-buy may credit the vault. Split out of create() so
    // the 13-field InitParams build keeps its own stack frame (via_ir is off).
    function _deployMarket(uint256 S, uint256 R6, uint256 rX18, uint96 mb96, CreateParams calldata p)
        private
        returns (address token, address curve)
    {
        token = Clones.clone(tokenImpl);
        curve = Clones.clone(curveImpl);
        Curve(payable(curve)).initialize(
            Curve.InitParams({
                token: token,
                creator: msg.sender,
                treasury: treasury,
                feeVault: address(feeVault),
                factory: address(this),
                S: S,
                R6: R6,
                rX18: rX18,
                feeBps: defaultFeeBps,
                creatorBps: defaultCreatorBps,
                protocolBps: defaultProtocolBps,
                antiSnipeBlocks: p.antiSnipeBlocks,
                maxBuyPerAddress6: mb96
            })
        );
        PeakToken(token).initialize(p.name, p.symbol, curve, S);
        feeVault.registerCurve(curve);
    }

    function _emitMarketCreated(
        address curve,
        address token,
        uint256 marketId,
        uint256 S,
        CurveMath.DerivedParams memory d,
        CreateParams calldata p,
        uint96 mb96
    ) private {
        emit MarketCreated(
            curve,
            token,
            msg.sender,
            marketId,
            d.y0.toUint120(),
            S.toUint120(),
            d.Ts.toUint120(),
            (block.number + p.antiSnipeBlocks).toUint48(),
            uint256(mb96).toUint120(),
            defaultFeeBps,
            defaultCreatorBps,
            defaultProtocolBps,
            creationFee6.toUint120()
        );
    }

    // Preset shape is one curve (S = 1e27, r = 4e18, MATH 10) at three raises; a
    // non-zero presetId ignores p.S/R6/rX18 entirely and does not validate them.
    function _resolveTriple(CreateParams calldata p) private pure returns (uint256 S, uint256 R6, uint256 rX18) {
        if (p.presetId == 0) return (p.S, p.R6, p.rX18);
        if (p.presetId == 1) return (1e27, 3e9, 4e18);
        if (p.presetId == 2) return (1e27, 12e9, 4e18);
        if (p.presetId == 3) return (1e27, 60e9, 4e18);
        revert BadPreset();
    }

    // On-chain validation, each rule its own named error. metadataURI is a
    // pass-through: the client and the metadata routes own its shape. This project's own
    // forbidden-vocabulary and Arc-possessive copy rules (SPEC 6) are deliberately
    // NOT applied to a user's name or symbol -- those govern our copy, not a market.
    function _validateSymbol(string calldata symbol) private pure {
        bytes memory s = bytes(symbol);
        uint256 len = s.length;
        if (len == 0) revert SymbolEmpty();
        if (len > 10) revert SymbolTooLong();
        for (uint256 i = 0; i < len; i++) {
            uint8 b = uint8(s[i]);
            bool ok = (b >= 0x30 && b <= 0x39) || (b >= 0x41 && b <= 0x5A);
            if (!ok) revert SymbolBadChar();
        }
        bytes32 h = keccak256(s);
        if (
            h == keccak256(bytes("USDC")) || h == keccak256(bytes("EURC")) || h == keccak256(bytes("WETH"))
                || h == keccak256(bytes("WBTC")) || h == keccak256(bytes("USDT")) || h == keccak256(bytes("PEAKPUMP"))
        ) revert SymbolReserved();
        // Charset is upper-only, so the three raw bytes A R C are the whole test.
        if (len >= 3 && uint8(s[0]) == 0x41 && uint8(s[1]) == 0x52 && uint8(s[2]) == 0x43) revert SymbolArcPrefix();
    }

    function _validateName(string calldata name) private pure {
        bytes memory n = bytes(name);
        uint256 len = n.length;
        if (len == 0) revert NameEmpty();
        if (len > 32) revert NameTooLong();
        for (uint256 i = 0; i < len; i++) {
            uint8 b = uint8(n[i]);
            if (b < 0x20) revert NameControlByte();
            // Zero-width / bidi / BOM runs, matched as their UTF-8 byte sequences.
            if (b == 0xE2 && i + 2 < len) {
                uint8 b1 = uint8(n[i + 1]);
                uint8 b2 = uint8(n[i + 2]);
                if (b1 == 0x80 && ((b2 >= 0x8B && b2 <= 0x8F) || (b2 >= 0xAA && b2 <= 0xAE))) {
                    revert NameHiddenCodepoint();
                }
                if (b1 == 0x81 && b2 >= 0xA6 && b2 <= 0xA9) revert NameHiddenCodepoint();
            } else if (b == 0xEF && i + 2 < len) {
                if (uint8(n[i + 1]) == 0xBB && uint8(n[i + 2]) == 0xBF) revert NameHiddenCodepoint();
            }
        }
    }

    // Governance: three setters + lock(), owner-only, each recording old and new.
    // A change touches future markets only; a live market's fees and treasury are
    // frozen in its clone at initialize (MATH 4 slot E) and can never be moved.

    function setDefaultFees(uint16 feeBps, uint16 creatorBps, uint16 protocolBps) external onlyOwner notLocked {
        if (feeBps > 200) revert FeeConfigInvalid();
        if (uint256(creatorBps) + protocolBps != feeBps) revert FeeConfigInvalid();
        emit DefaultFeesUpdated(defaultFeeBps, defaultCreatorBps, defaultProtocolBps, feeBps, creatorBps, protocolBps);
        defaultFeeBps = feeBps;
        defaultCreatorBps = creatorBps;
        defaultProtocolBps = protocolBps;
    }

    function setCreationFee(uint256 fee6) external onlyOwner notLocked {
        if (fee6 > 5_000_000) revert CreationFeeTooHigh();
        emit CreationFeeUpdated(creationFee6, fee6);
        creationFee6 = fee6;
    }

    function setTreasury(address t) external onlyOwner notLocked {
        if (t == address(0)) revert ZeroTreasury();
        emit TreasuryUpdated(treasury, t);
        treasury = t;
    }

    function lock() external onlyOwner {
        if (governanceLocked) revert AlreadyLocked();
        governanceLocked = true;
        emit Locked();
    }

    // The largest usdcIn6 whose first buy from the pristine (x0, y0) state still
    // satisfies the step-9 cap sold*20 <= Ts. buyQuote is internal pure, so this is
    // a pure view with no external call. A closed-form seed lands within a few units
    // of the boundary; the two corrections walk to the exact largest passing value,
    // so cand passes the cap and cand+1 does not -- bit-exact with the on-chain assert.
    function maxDevBuy6(uint256 S, uint256 R6, uint256 rX18, uint256 feeBps) external pure returns (uint256) {
        CurveMath.DerivedParams memory d = CurveMath.deriveParams(S, R6, rX18);
        uint256 T = d.Ts / 20;
        uint256 netStar = Math.mulDiv(T, d.x0, d.y0 - T);
        uint256 cand = Math.mulDiv(netStar, 1e4, 1e4 - feeBps);
        while (CurveMath.buyQuote(d.x0, d.y0, cand + 1, feeBps).tokensOut * 20 <= d.Ts) {
            cand++;
        }
        while (cand > 0 && CurveMath.buyQuote(d.x0, d.y0, cand, feeBps).tokensOut * 20 > d.Ts) {
            cand--;
        }
        return cand;
    }
}
