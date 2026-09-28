// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {CurveMath} from "./libraries/CurveMath.sol";

// Only the two token entry points the curve calls are declared; the token is our
// own PeakToken clone, so a full import would add nothing.
interface IPeakToken {
    function transfer(address to, uint256 amount) external returns (bool);
    function pullFrom(address from, uint256 amount) external;
}

interface IFeeVault {
    function creditPair(address a, uint256 amountA6, address b, uint256 amountB6) external payable;
    function credit(address to) external payable;
}

/// @dev One bonding-curve market: holds reserves, executes buy and sell, crosses
/// the Summit exactly once, and asserts solvency from storage only. No formula is
/// re-derived here; each is quoted from docs/MATH.md and computed in CurveMath.
/// balanceOf and address(this).balance appear nowhere (MATH 8) so a donation can
/// never move a decision the contract makes.
contract Curve is Initializable, ReentrancyGuardUpgradeable {
    using SafeCast for uint256;

    enum Phase {
        ASCENT,
        PEAK
    }

    // Slots A..K per docs/MATH.md 4, exact declaration order, no gaps; the OZ
    // upgradeable bases use ERC-7201 storage so this begins at slot 0. y and Tl
    // live in no slot: y is derived by y(), Tl by S - Ts.
    // slot 0 (A)
    uint128 public x;
    uint128 public sold;
    // slot 1 (B)
    uint128 public x0;
    uint120 public raised6;
    Phase public state;
    // slot 2 (C)
    uint128 public y0;
    uint128 public S;
    // slot 3 (D)
    uint128 public Ts;
    uint128 public y1;
    // slot 4 (E)
    address public token;
    uint16 public feeBps;
    uint16 public creatorBps;
    uint16 public protocolBps;
    uint48 public antiSnipeEndBlock;
    // slot 5 (F)
    address public creator;
    uint96 public maxBuyPerAddress6;
    // slot 6 (G), slot 7 (H)
    address public treasury;
    address public feeVault;
    // slot 8 (I): factory is storage, not immutable — the implementation is deployed
    // before the factory exists, so the value is unknowable at construction and a
    // clone still runs the implementation's code after initialize sets it.
    address public factory;
    uint96 public dustWei;
    // slot 9 (J), slot 10 (K)
    mapping(address => uint128) public boughtInWindow6;
    mapping(address => uint256) public deferred;

    // Frozen wire format, SPEC 5.5. Names carry no unit:
    // tReserve6After is x (6-dp USDC), supplySold6After is sold (18-dp token wei).
    event Trade(
        address indexed curve,
        address indexed trader,
        bool indexed isBuy,
        uint120 usdcIn6,
        uint120 usdcOut6,
        uint120 tokenIn,
        uint120 tokenOut,
        uint120 fee6,
        uint120 tReserve6After,
        uint120 supplySold6After,
        uint8 phaseAfter
    );
    event TradeDetail(
        address indexed trader,
        address indexed to,
        uint256 spend6,
        uint256 poolDelta6,
        bool crossed,
        uint8 stateAfter
    );
    event Summit(uint120 raised6, uint128 y, uint256 priceX18);
    event PayoutDeferred(address indexed recipient, uint256 weiAmount);
    event DustSwept(uint256 weiAmount, uint256 credited6);

    error NotFactory();
    error FeeConfigInvalid();
    error AntiSnipeMisconfigured();
    error BadY1();
    error BadY0();
    error BadSupply();
    error BadX0();
    error DeadlineExpired();
    error BelowMinimumTrade();
    error ZeroNetAfterFee();
    error ZeroTokensOut();
    error ZeroUsdcOut();
    error ExceedsSold();
    error SelfTrade();
    error RecipientNotSender();
    error WindowCapExceeded();
    error InsufficientTokensOut();
    error InsufficientUsdcOut();
    error InvariantBroken();
    error NothingDeferred();
    error NothingToSweep();

    // Returned by the quote views so the UI renders a sentence instead of catching
    // a revert. Closed is reserved for a future halted state — declared, never
    // returned; a later release may use it, so do not delete it.
    enum QuoteStatus {
        Ok,
        BelowMinimum,
        ZeroNetAfterFee,
        ZeroTokensOut,
        ZeroUsdcOut,
        ExceedsSold,
        Closed
    }

    // These mirror the trade paths field-for-field, crossing branch included. They
    // are distinct from CurveMath's like-named structs, which are always referenced
    // qualified as CurveMath.BuyQuote / CurveMath.SellQuote.
    struct BuyQuote {
        QuoteStatus status;
        uint256 tokensOut;
        uint256 fee6;
        uint256 creatorFee6;
        uint256 protocolFee6;
        uint256 net6;
        uint256 spend6;
        uint256 refund6;
        bool crossed;
    }

    struct SellQuote {
        QuoteStatus status;
        uint256 usdcOut6;
        uint256 fee6;
        uint256 creatorFee6;
        uint256 protocolFee6;
        uint256 gross6;
    }

    constructor() {
        _disableInitializers();
    }

    // Native USDC arriving by bare send is intentionally unreachable: never counted,
    // never a decision input, and unswept (sweepDust moves exactly dustWei). Kept as
    // an ABI-surface choice, not defensive code; do not delete it.
    receive() external payable {}

    // The 13 init fields travel as one calldata struct. Flattened into positional
    // parameters they overflow the stack with via_ir off (a banned workaround).
    // PeakpumpFactory.create builds this and passes
    // raw S, R6, rX18 — the curve is the single deriving and asserting authority.
    struct InitParams {
        address token;
        address creator;
        address treasury;
        address feeVault;
        address factory;
        uint256 S;
        uint256 R6;
        uint256 rX18;
        uint16 feeBps;
        uint16 creatorBps;
        uint16 protocolBps;
        uint256 antiSnipeBlocks;
        uint96 maxBuyPerAddress6;
    }

    // Factory-only, once. The factory clones and initializes in one transaction, so
    // requiring msg.sender to equal the factory field binds the clone to its deployer
    // with no front-run gap.
    function initialize(InitParams calldata p) external initializer {
        if (msg.sender != p.factory) revert NotFactory();
        __ReentrancyGuard_init();

        // The fee split must reconcile, so the two shares sum to the total exactly.
        // SPEC is silent on these, so they are added, not a contradiction (Note 3).
        if (p.feeBps > 200) revert FeeConfigInvalid();
        if (uint256(p.creatorBps) + p.protocolBps != p.feeBps) revert FeeConfigInvalid();
        // A live window with a zero cap bricks every buy; a cap with no window is
        // dead config. They stand together or not at all.
        if ((p.antiSnipeBlocks == 0) != (p.maxBuyPerAddress6 == 0)) revert AntiSnipeMisconfigured();

        CurveMath.DerivedParams memory d = CurveMath.deriveParams(p.S, p.R6, p.rX18);
        Ts = d.Ts.toUint128();
        y0 = d.y0.toUint128();
        y1 = d.y1.toUint128();
        S = p.S.toUint128();
        x0 = d.x0.toUint128();
        x = d.x0.toUint128();

        token = p.token;
        creator = p.creator;
        treasury = p.treasury;
        feeVault = p.feeVault;
        factory = p.factory;
        feeBps = p.feeBps;
        creatorBps = p.creatorBps;
        protocolBps = p.protocolBps;
        antiSnipeEndBlock = (block.number + p.antiSnipeBlocks).toUint48();
        maxBuyPerAddress6 = p.maxBuyPerAddress6;

        // SPEC 5.3 asserts, re-checked on the STORED uint128 values: these guard the
        // SafeCast round-trip that deriveParams (which works in uint256) does not.
        if (y1 != y0 - Ts) revert BadY1();
        if (y0 <= Ts) revert BadY0();
        if (S <= Ts) revert BadSupply();
        if (x0 == 0) revert BadX0();
        if (y1 == 0) revert BadY1();
        // sold, raised6, state stay clone-zero: ASCENT, nothing sold, nothing raised.
    }

    // Parameter order is frozen: the factory dev-buy calls
    // buy{value: ...}(0, block.timestamp, creator).
    function buy(uint256 minTokensOut, uint256 deadline, address to) external payable nonReentrant {
        uint256 usdcIn6 = msg.value / 1e12;
        if (block.timestamp > deadline) revert DeadlineExpired();
        if (usdcIn6 < 1000) revert BelowMinimumTrade();
        // The sub-1e12 remainder is protocol dust with a FLOOR accumulator, never
        // refunded; on any later revert it rolls back.
        dustWei = (uint256(dustWei) + (msg.value % 1e12)).toUint96();

        bool wasAscent = state == Phase.ASCENT;
        uint256 kEntry = uint256(x) * y();

        uint256 tokensOut;
        uint256 net6;
        uint256 fee6;
        uint256 refund6;
        bool crossed;
        // Quote first so the crossing branch (which sets refund6) is resolved before
        // anti-snipe. CurveMath results are memory structs in a scoped block so their
        // locals release and buy compiles with via_ir off.
        {
            CurveMath.BuyQuote memory q = CurveMath.buyQuote(x, y(), usdcIn6, feeBps);
            if (q.net6 < 1) revert ZeroNetAfterFee();
            if (q.tokensOut < 1) revert ZeroTokensOut();
            net6 = q.net6;
            fee6 = q.fee6;
            tokensOut = q.tokensOut;
            if (wasAscent) {
                uint256 remaining = Ts - sold; // safe: the invariant keeps sold <= Ts in ASCENT
                if (q.tokensOut > remaining) {
                    CurveMath.CrossingQuote memory cq = CurveMath.crossingQuote(x, y1, remaining, feeBps);
                    crossed = true;
                    net6 = cq.netNeeded6;
                    fee6 = cq.feeUsed6;
                    refund6 = usdcIn6 - cq.spend6;
                    tokensOut = remaining; // MATH 6.4: ASSIGNED, never recomputed
                }
            }
        }

        x = (uint256(x) + net6).toUint128();
        sold = (uint256(sold) + tokensOut).toUint128();

        // Anti-snipe after the quote: the cap counts what is actually spent
        // (usdcIn6 - refund6), keyed on the buyer. The factory dev-buy is exempt from
        // both the recipient lock and the cap.
        if (block.number < antiSnipeEndBlock && msg.sender != factory) {
            if (to != msg.sender) revert RecipientNotSender();
            uint256 acc = uint256(boughtInWindow6[msg.sender]) + (usdcIn6 - refund6);
            boughtInWindow6[msg.sender] = acc.toUint128();
            if (acc > maxBuyPerAddress6) revert WindowCapExceeded();
        }

        if (state == Phase.ASCENT && sold == Ts) _summit();

        if (tokensOut < minTokensOut) revert InsufficientTokensOut();

        // A4 is skipped whenever this buy crossed the Summit. An exact landing fires
        // _summit() too, and the transition legitimately drops k from the ASCENT
        // curve to the PEAK curve (MATH 8); "crossed" (the crossing-quote branch) is
        // a strict subset, so the flag here is "did we summit this call".
        _assertInvariants(wasAscent && state == Phase.PEAK, kEntry);

        _emitTradeBuy(to, usdcIn6, tokensOut, fee6, net6, refund6, crossed);

        IPeakToken(token).transfer(to, tokensOut);
        if (fee6 != 0) {
            (uint256 creatorFee6, uint256 protocolFee6) = CurveMath.splitFee(fee6, feeBps, creatorBps);
            IFeeVault(feeVault).creditPair{value: fee6 * 1e12}(creator, creatorFee6, treasury, protocolFee6);
        }
        if (refund6 != 0) _payout(msg.sender, refund6 * 1e12);
    }

    // No recipient parameter: proceeds always go to msg.sender. Both phases.
    function sell(uint256 tokensIn, uint256 minUsdcOut6, uint256 deadline) external nonReentrant {
        if (msg.sender == address(this)) revert SelfTrade();
        if (block.timestamp > deadline) revert DeadlineExpired();
        if (tokensIn < 1) revert BelowMinimumTrade();
        // Redundant in PEAK (circulating supply is exactly sold, so no holder can
        // present more) but kept as a cheap named guard in both phases.
        if (tokensIn > sold) revert ExceedsSold();

        uint256 kEntry = uint256(x) * y();

        uint256 usdcOut6;
        uint256 fee6;
        uint256 gross6;
        {
            CurveMath.SellQuote memory q = CurveMath.sellQuote(x, y(), tokensIn, feeBps);
            if (q.usdcOut6 < 1) revert ZeroUsdcOut();
            usdcOut6 = q.usdcOut6;
            fee6 = q.fee6;
            gross6 = q.gross6;
        }

        sold = (uint256(sold) - tokensIn).toUint128();
        x = (uint256(x) - gross6).toUint128(); // gross6 leaves the pool, not usdcOut6 (MATH 6.3)

        if (usdcOut6 < minUsdcOut6) revert InsufficientUsdcOut();

        _assertInvariants(false, kEntry); // a sell never crosses; A4 holds as k rises

        _emitTradeSell(usdcOut6, tokensIn, fee6, gross6);

        IPeakToken(token).pullFrom(msg.sender, tokensIn); // never transferFrom, no approve
        if (fee6 != 0) {
            (uint256 creatorFee6, uint256 protocolFee6) = CurveMath.splitFee(fee6, feeBps, creatorBps);
            IFeeVault(feeVault).creditPair{value: fee6 * 1e12}(creator, creatorFee6, treasury, protocolFee6);
        }
        _payout(msg.sender, usdcOut6 * 1e12);
    }

    // Both trade events fire on every trade, fee6 == 0 included; TradeDetail right
    // after Trade. Split out of buy/sell only so the 11-field Trade emit does not
    // deepen those stacks past the via_ir-off limit. tReserve6After/supplySold6After
    // read the post-effect storage.
    function _emitTradeBuy(
        address to,
        uint256 usdcIn6,
        uint256 tokensOut,
        uint256 fee6,
        uint256 net6,
        uint256 refund6,
        bool crossed
    ) private {
        emit Trade(
            address(this),
            to,
            true,
            usdcIn6.toUint120(),
            0,
            0,
            tokensOut.toUint120(),
            fee6.toUint120(),
            uint256(x).toUint120(),
            uint256(sold).toUint120(),
            uint8(state)
        );
        emit TradeDetail(msg.sender, to, usdcIn6 - refund6, net6, crossed, uint8(state));
    }

    function _emitTradeSell(uint256 usdcOut6, uint256 tokensIn, uint256 fee6, uint256 gross6) private {
        emit Trade(
            address(this),
            msg.sender,
            false,
            0,
            usdcOut6.toUint120(),
            tokensIn.toUint120(),
            0,
            fee6.toUint120(),
            uint256(x).toUint120(),
            uint256(sold).toUint120(),
            uint8(state)
        );
        emit TradeDetail(msg.sender, msg.sender, 0, gross6, false, uint8(state));
    }

    // MATH 7: four writes, zero transfers. real is read before x0 is zeroed. No
    // deploy, no fee, no value movement, and no y write — at sold == Ts, y() moves
    // from y1 to Tl on its own (MATH 4).
    function _summit() private {
        uint128 real = x - x0;
        x = real;
        x0 = 0;
        raised6 = uint256(real).toUint120();
        state = Phase.PEAK;
        emit Summit(raised6, y().toUint128(), priceX18());
    }

    // Sell proceeds and buy refunds only, always to msg.sender, so there is no third
    // party to grief and the stipend is not a security boundary. It is generous
    // because a smart-account / EIP-7702 sender may run code on receipt. A failed
    // send defers into this contract's own ledger, never a FeeVault credit: on the
    // Arc network a transfer can revert for reasons unrelated to us, and the value
    // stays claimable with withdrawDeferred rather than lost.
    function _payout(address recipient, uint256 weiAmount) private {
        (bool ok,) = recipient.call{value: weiAmount, gas: 100000}("");
        if (!ok) {
            deferred[recipient] += weiAmount;
            emit PayoutDeferred(recipient, weiAmount);
        }
    }

    function withdrawDeferred() external nonReentrant {
        uint256 amt = deferred[msg.sender];
        if (amt == 0) revert NothingDeferred();
        deferred[msg.sender] = 0;
        (bool ok,) = msg.sender.call{value: amt}("");
        require(ok); // on failure the zeroing rolls back, so the balance stays claimable
    }

    // Permissionless: moves exactly dustWei to the FeeVault for
    // the treasury and zeroes it. Never reads a balance and never touches reserves,
    // so a donation can neither be swept nor change the outcome. Reverts, with no
    // FeeVault call, when there is not even one whole 6-dp unit to credit.
    function sweepDust() external nonReentrant {
        uint256 amt = dustWei;
        if (amt == 0 || amt / 1e12 == 0) revert NothingToSweep();
        dustWei = 0;
        IFeeVault(feeVault).credit{value: amt}(treasury);
        emit DustSwept(amt, amt / 1e12);
    }

    // MATH 8, storage reads only, asserted before interactions. Products of packed
    // fields are widened to uint256. skipA4 is set by the caller when the trade
    // crossed the Summit.
    function _assertInvariants(bool skipA4, uint256 kEntry) private view {
        if (state == Phase.ASCENT && sold > Ts) revert InvariantBroken(); // A1: sold <= Ts
        if (x == 0 || y() == 0) revert InvariantBroken(); // A2: reserves stay positive
        // A3 solvency: x0*y0 from the STORED, already-floored y0 (a re-derived y0 is
        // larger and would revert the last legal buy). Vacuous in PEAK, x0 == 0.
        if (state == Phase.ASCENT && uint256(x) * y() < uint256(x0) * uint256(y0)) revert InvariantBroken();
        // A4: k does not fall on a trade that stays on one curve.
        if (!skipA4 && uint256(x) * y() < kEntry) revert InvariantBroken();
    }

    function y() public view returns (uint256) {
        return state == Phase.ASCENT ? uint256(y0) - sold : uint256(S) - sold;
    }

    function priceX18() public view returns (uint256) {
        return CurveMath.priceX18(x, y());
    }

    function marketCap6() public view returns (uint256) {
        return CurveMath.marketCap6(x, y(), S);
    }

    function progressBps() public view returns (uint256) {
        return state == Phase.ASCENT ? Math.mulDiv(sold, 10000, Ts, Math.Rounding.Floor) : 10000;
    }

    function usdcRaised6() public view returns (uint256) {
        return state == Phase.ASCENT ? uint256(x) - x0 : uint256(raised6);
    }

    // Mirrors buy() exactly, crossing branch included, and never reverts: a bad
    // input is reported as a QuoteStatus. spend6 == usdcIn6 - refund6, as TradeDetail
    // records. Fields are written straight into the return struct to keep the stack
    // shallow with via_ir off.
    function quoteBuy(uint256 usdcIn6) external view returns (BuyQuote memory r) {
        if (usdcIn6 < 1000) {
            r.status = QuoteStatus.BelowMinimum;
            return r;
        }
        CurveMath.BuyQuote memory q = CurveMath.buyQuote(x, y(), usdcIn6, feeBps);
        if (q.net6 < 1) {
            r.status = QuoteStatus.ZeroNetAfterFee;
            return r;
        }
        if (q.tokensOut < 1) {
            r.status = QuoteStatus.ZeroTokensOut;
            return r;
        }
        r.tokensOut = q.tokensOut;
        r.fee6 = q.fee6;
        r.net6 = q.net6;
        r.spend6 = usdcIn6;
        if (state == Phase.ASCENT) {
            uint256 remaining = Ts - sold;
            if (q.tokensOut > remaining) {
                CurveMath.CrossingQuote memory cq = CurveMath.crossingQuote(x, y1, remaining, feeBps);
                r.crossed = true;
                r.tokensOut = remaining;
                r.fee6 = cq.feeUsed6;
                r.net6 = cq.netNeeded6;
                r.spend6 = cq.spend6;
                r.refund6 = usdcIn6 - cq.spend6;
            }
        }
        (r.creatorFee6, r.protocolFee6) = CurveMath.splitFee(r.fee6, feeBps, creatorBps);
        r.status = QuoteStatus.Ok;
    }

    // Mirrors sell() exactly and never reverts. Closed is never returned here.
    function quoteSell(uint256 tokensIn) external view returns (SellQuote memory r) {
        if (tokensIn < 1) {
            r.status = QuoteStatus.BelowMinimum;
            return r;
        }
        if (tokensIn > sold) {
            r.status = QuoteStatus.ExceedsSold;
            return r;
        }
        CurveMath.SellQuote memory q = CurveMath.sellQuote(x, y(), tokensIn, feeBps);
        if (q.usdcOut6 < 1) {
            r.status = QuoteStatus.ZeroUsdcOut;
            return r;
        }
        r.usdcOut6 = q.usdcOut6;
        r.fee6 = q.fee6;
        r.gross6 = q.gross6;
        (r.creatorFee6, r.protocolFee6) = CurveMath.splitFee(q.fee6, feeBps, creatorBps);
        r.status = QuoteStatus.Ok;
    }
}