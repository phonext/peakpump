// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {PeakpumpFactory} from "../../src/PeakpumpFactory.sol";
import {Curve} from "../../src/Curve.sol";
import {PeakToken} from "../../src/PeakToken.sol";
import {FeeVault} from "../../src/FeeVault.sol";
import {CurveMath} from "../../src/libraries/CurveMath.sol";

// Standalone (NOT CurveTestBase, which wires the vault to a fake factory): here the
// real PeakpumpFactory is the vault's factory, so registerCurve and the dev-buy's
// creditPair run for real. CurveMath is the oracle; no formula is re-derived. The
// isRegisteredCurve map is private, so registration is proven indirectly -- a
// dev-buy whose creditPair lands in the vault could only run on a registered curve.
contract PeakpumpFactoryTest is Test {
    // MATH 10 preset literals (S = 1e27, r = 4e18). y0 floors, x0 is exact here.
    uint256 constant SUP = 1e27;
    uint256 constant R_X18 = 4e18;
    uint256 constant TS = 8e26;
    uint256 constant TL = 2e26;
    uint256 constant Y0 = 1066666666666666666666666666;
    uint256 constant Y1 = 266666666666666666666666666;
    uint256 constant R6_BASECAMP = 3e9;
    uint256 constant R6_RIDGE = 12e9;
    uint256 constant R6_ALPINE = 60e9;
    uint256 constant X0_BASECAMP = 1e9;
    uint256 constant X0_RIDGE = 4e9;
    uint256 constant X0_ALPINE = 20e9;
    uint16 constant FEE_BPS = 125;
    uint16 constant CREATOR_BPS = 30;
    uint16 constant PROTOCOL_BPS = 95;

    FeeVault vault;
    PeakpumpFactory factory;
    address curveImpl;
    address tokenImpl;

    address owner = makeAddr("owner");
    address treasury = makeAddr("treasury");
    address creator = makeAddr("creator");
    address alice = makeAddr("alice");

    // Re-declared so vm.expectEmit can name them; identical to PeakpumpFactory's.
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
    event MarketMetadata(address indexed curve, string name, string symbol, string metadataURI);

    // Curve's frozen buy/sell event, re-declared so expectEmit can match its topics.
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

    // Governance events, re-declared for expectEmit (each carries old and new).
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

    function setUp() public {
        vault = new FeeVault(treasury);
        tokenImpl = address(new PeakToken());
        curveImpl = address(new Curve());
        factory = new PeakpumpFactory(owner, address(vault), curveImpl, tokenImpl, treasury);
        // This test contract deployed the vault, so it is the one-shot deployer.
        vault.setFactory(address(factory));
        vm.deal(creator, 1e30);
        vm.deal(alice, 1e30);
    }

    function _wei(uint256 usdcIn6) internal pure returns (uint256) {
        return usdcIn6 * 1e12;
    }

    // A default-valid custom-market build; individual tests override single fields.
    function _custom(uint256 S, uint256 R6, uint256 rX18, uint256 devBuy6)
        internal
        pure
        returns (PeakpumpFactory.CreateParams memory p)
    {
        p.name = "Test Market";
        p.symbol = "TEST";
        p.metadataURI = "ipfs://meta";
        p.presetId = 0;
        p.S = S;
        p.R6 = R6;
        p.rX18 = rX18;
        p.devBuy6 = devBuy6;
        p.antiSnipeBlocks = 0;
        p.maxBuyPerAddress6 = 0;
    }

    function _preset(uint8 presetId, uint256 devBuy6)
        internal
        pure
        returns (PeakpumpFactory.CreateParams memory p)
    {
        p.name = "Preset Market";
        p.symbol = "PRE";
        p.metadataURI = "ipfs://preset";
        p.presetId = presetId;
        p.devBuy6 = devBuy6;
    }

    // The two clones are CREATE'd in _deployMarket in the order token then curve, so
    // their addresses follow from the factory's nonce at the call site.
    function _predict() internal view returns (address token, address curve) {
        uint256 n = vm.getNonce(address(factory));
        token = vm.computeCreateAddress(address(factory), n);
        curve = vm.computeCreateAddress(address(factory), n + 1);
    }

    // Create as `creator`, funding exactly creationFee6 + devBuy6. The fee is read
    // into a local before the prank: an external view left in the create() argument
    // list spends the prank on its own staticcall, so create would run as this test
    // contract, not `creator`.
    function _create(PeakpumpFactory.CreateParams memory p) internal returns (Curve curve, PeakToken token) {
        uint256 value = _wei(p.devBuy6 + factory.creationFee6());
        vm.prank(creator);
        (address t, address c) = factory.create{value: value}(p);
        return (Curve(payable(c)), PeakToken(t));
    }

    function test_createCustom_deploysWiresAndMints() public {
        (address predToken, address predCurve) = _predict();
        vm.prank(creator);
        (address token, address curve) = factory.create(_custom(SUP, R6_RIDGE, R_X18, 0));

        assertEq(token, predToken, "token clone address");
        assertEq(curve, predCurve, "curve clone address");
        assertEq(factory.marketCount(), 1, "marketId starts at 1");
        // S minted entirely to the curve; nothing sold yet.
        assertEq(PeakToken(token).totalSupply(), SUP, "supply is S");
        assertEq(PeakToken(token).balanceOf(curve), SUP, "S minted to curve");
        assertEq(Curve(payable(curve)).sold(), 0, "nothing sold at create");
        // Raw triple derived by the curve, never pre-derived by the factory.
        assertEq(Curve(payable(curve)).S(), SUP, "curve S");
        assertEq(Curve(payable(curve)).Ts(), TS, "curve Ts");
        assertEq(Curve(payable(curve)).y0(), Y0, "curve y0");
        assertEq(Curve(payable(curve)).x0(), X0_RIDGE, "curve x0");
        assertEq(Curve(payable(curve)).creator(), creator, "creator recorded");
        assertEq(Curve(payable(curve)).token(), token, "token wired");
        assertEq(Curve(payable(curve)).feeVault(), address(vault), "vault wired");
        assertEq(Curve(payable(curve)).factory(), address(factory), "factory wired");
    }

    function test_createPresets_marketIdsAndParams() public {
        (Curve b,) = _create(_preset(1, 0));
        (Curve r,) = _create(_preset(2, 0));
        (Curve a,) = _create(_preset(3, 0));

        assertEq(factory.marketCount(), 3, "three markets, ids 1..3");
        // Every preset shares S/Ts/y0; only x0 tracks the raise (MATH 10).
        assertEq(b.x0(), X0_BASECAMP, "Basecamp x0");
        assertEq(r.x0(), X0_RIDGE, "Ridge x0");
        assertEq(a.x0(), X0_ALPINE, "Alpine x0");
        assertEq(b.Ts(), TS, "Basecamp Ts");
        assertEq(r.y0(), Y0, "Ridge y0");
        assertEq(a.S(), SUP, "Alpine S");
    }

    function test_createBadPreset_reverts() public {
        PeakpumpFactory.CreateParams memory p = _preset(4, 0);
        vm.prank(creator);
        vm.expectRevert(PeakpumpFactory.BadPreset.selector);
        factory.create(p);
    }

    // MarketCreated and MarketMetadata carry the frozen event fields, both before any
    // Trade. devBuy6 == 0 keeps this create free of buy events, so the two market
    // events are the first logs and expectEmit matches them in order.
    function test_createEmitsMarketCreatedAndMetadata() public {
        (address predToken, address predCurve) = _predict();
        uint48 endBlock = uint48(block.number); // antiSnipeBlocks == 0
        PeakpumpFactory.CreateParams memory p = _preset(2, 0);

        vm.expectEmit(true, true, true, true);
        emit MarketCreated(
            predCurve, predToken, creator, 1, uint120(Y0), uint120(SUP), uint120(TS), endBlock, 0, 125, 30, 95, 0
        );
        vm.expectEmit(true, true, true, true);
        emit MarketMetadata(predCurve, p.name, p.symbol, p.metadataURI);

        vm.prank(creator);
        factory.create(p);
    }

    // The dev-buy is recipient = creator, so the tokens and the Trade attribute to
    // the creator, and the creator's fee slice is claimable in the vault. Trade
    // topics are checked (curve, trader, isBuy); its data is the curve's own concern.
    function test_devBuy_creatorGetsTokensTradeAndFee() public {
        uint256 devBuy6 = factory.maxDevBuy6(SUP, R6_RIDGE, R_X18, FEE_BPS) / 2; // well under the cap
        (, address predCurve) = _predict();
        CurveMath.BuyQuote memory bq = CurveMath.buyQuote(X0_RIDGE, Y0, devBuy6, FEE_BPS);
        (uint256 creatorFee6, uint256 protocolFee6) = CurveMath.splitFee(bq.fee6, FEE_BPS, CREATOR_BPS);

        vm.expectEmit(true, true, true, false);
        emit Trade(predCurve, creator, true, 0, 0, 0, 0, 0, 0, 0, 0);

        vm.prank(creator);
        (address token, address curve) = factory.create{value: _wei(devBuy6)}(_custom(SUP, R6_RIDGE, R_X18, devBuy6));

        assertEq(curve, predCurve, "curve address");
        assertEq(PeakToken(token).balanceOf(creator), bq.tokensOut, "creator receives dev-buy tokens");
        assertEq(Curve(payable(curve)).sold(), bq.tokensOut, "sold == dev-buy tokens");
        assertEq(vault.balances(creator), creatorFee6, "creator fee credited");
        assertEq(vault.balances(treasury), protocolFee6, "protocol fee credited");
        assertGt(creatorFee6, 0, "dev-buy pays the creator a real slice");
    }

    // The factory is exempt from both anti-snipe rules, so a dev-buy inside a live
    // window succeeds where a non-exempt buyer would revert RecipientNotSender.
    function test_devBuy_exemptInsideAntiSnipeWindow() public {
        uint256 devBuy6 = factory.maxDevBuy6(SUP, R6_RIDGE, R_X18, FEE_BPS) / 2;
        PeakpumpFactory.CreateParams memory p = _custom(SUP, R6_RIDGE, R_X18, devBuy6);
        p.antiSnipeBlocks = 100;
        p.maxBuyPerAddress6 = 1e6; // below the dev-buy: proves the cap is skipped too
        vm.prank(creator);
        (address token, address curve) = factory.create{value: _wei(devBuy6)}(p);
        assertGt(PeakToken(token).balanceOf(creator), 0, "dev-buy went through in the window");
        assertGt(Curve(payable(curve)).antiSnipeEndBlock(), block.number, "window is live");
    }

    // devBuy6 == maxDevBuy6 lands exactly on sold*20 <= Ts; one unit more trips the
    // step-9 assert. Driven through a real create() for every MATH 10 raise, so the
    // create-level two-sided boundary holds for Basecamp, Ridge and Alpine, not Ridge
    // alone. The view and the assert share the same `*20 <= Ts` boundary.
    function test_devBuyCap_boundaryExactThenReverts() public {
        _assertCreateBoundary(R6_BASECAMP);
        _assertCreateBoundary(R6_RIDGE);
        _assertCreateBoundary(R6_ALPINE);
    }

    // Ts is shared across the presets (it depends only on S and r, not the raise), so
    // the single TS literal bounds all three. maxBuy6 > 0 for every preset, so the
    // fuzz's cap == 0 skip is never taken here: both real creates always run.
    function _assertCreateBoundary(uint256 R6) internal {
        uint256 maxBuy6 = factory.maxDevBuy6(SUP, R6, R_X18, FEE_BPS);
        assertGt(maxBuy6, 0, "preset cap is non-zero");

        (Curve curve,) = _create(_custom(SUP, R6, R_X18, maxBuy6));
        assertLe(uint256(curve.sold()) * 20, TS, "at the cap sold*20 <= Ts");

        PeakpumpFactory.CreateParams memory over = _custom(SUP, R6, R_X18, maxBuy6 + 1);
        vm.prank(creator);
        vm.expectRevert(PeakpumpFactory.DevBuyExceedsCap.selector);
        factory.create{value: _wei(maxBuy6 + 1)}(over);
    }

    // The 6-dp total must match exactly: an under- or over-payment reverts rather
    // than being confiscated. The sub-1e12 remainder is the one thing accepted.
    function test_valueMismatch_underAndOver() public {
        PeakpumpFactory.CreateParams memory p = _custom(SUP, R6_RIDGE, R_X18, 1e9);
        vm.prank(creator);
        vm.expectRevert(PeakpumpFactory.ValueMismatch.selector);
        factory.create{value: _wei(1e9 - 1)}(p);

        vm.prank(creator);
        vm.expectRevert(PeakpumpFactory.ValueMismatch.selector);
        factory.create{value: _wei(1e9 + 1)}(p);
    }

    // An indivisible msg.value succeeds: the 6-dp part matches, the sub-1e12 remainder
    // floors into the vault's dustWei accumulator (never balances[treasury], which
    // cannot move on a single sub-unit) and the vault's native balance rises by it.
    function test_indivisibleValue_remainderToDust() public {
        uint256 rem = 5e11; // < 1e12, floors to zero 6-dp units
        uint256 dust0 = vault.dustWei();
        uint256 vbal0 = address(vault).balance;
        uint256 t0 = vault.balances(treasury);

        vm.prank(creator);
        factory.create{value: rem}(_custom(SUP, R6_RIDGE, R_X18, 0)); // sum == 0, only the remainder

        assertEq(vault.dustWei() - dust0, rem, "remainder lands in dustWei");
        assertGe(address(vault).balance, vbal0 + rem, "vault native rose by the remainder");
        assertEq(vault.balances(treasury), t0, "no whole 6-dp unit, treasury unchanged");
    }

    function test_creationFee_creditsTreasury() public {
        uint256 fee6 = 1e6; // 1 USDC, whole 6-dp
        vm.prank(owner);
        factory.setCreationFee(fee6);

        uint256 t0 = vault.balances(treasury);
        vm.prank(creator);
        factory.create{value: _wei(fee6)}(_custom(SUP, R6_RIDGE, R_X18, 0));
        assertEq(vault.balances(treasury) - t0, fee6, "creation fee credited whole to treasury");
    }

    function test_creationFeeDefaultZero_noCredit() public {
        vm.prank(creator);
        factory.create(_custom(SUP, R6_RIDGE, R_X18, 0));
        assertEq(vault.balances(treasury), 0, "default fee 0 credits nothing");
        assertEq(vault.dustWei(), 0, "no remainder, no dust");
    }

    // A force-send leaves value on the factory; step 10 sweeps whatever is there to
    // the treasury so the factory retains no USDC across calls. receive() takes it.
    function test_residual_forceSendSweptToTreasury() public {
        (bool ok,) = payable(address(factory)).call{value: _wei(7)}("");
        assertTrue(ok, "receive accepts value");

        uint256 t0 = vault.balances(treasury);
        vm.prank(creator);
        factory.create(_custom(SUP, R6_RIDGE, R_X18, 0)); // no fee, no dev-buy
        assertEq(vault.balances(treasury) - t0, 7, "force-sent residual swept to treasury");
        assertGe(0, address(factory).balance); // >= form: factory retains no USDC
    }

    function _expectCreateRevert(PeakpumpFactory.CreateParams memory p, bytes4 sel) internal {
        vm.prank(creator);
        vm.expectRevert(sel);
        factory.create(p);
    }

    function test_validateSymbol_empty() public {
        PeakpumpFactory.CreateParams memory p = _custom(SUP, R6_RIDGE, R_X18, 0);
        p.symbol = "";
        _expectCreateRevert(p, PeakpumpFactory.SymbolEmpty.selector);
    }

    function test_validateSymbol_tooLong() public {
        PeakpumpFactory.CreateParams memory p = _custom(SUP, R6_RIDGE, R_X18, 0);
        p.symbol = "ABCDEFGHIJK"; // 11 chars, max is 10
        _expectCreateRevert(p, PeakpumpFactory.SymbolTooLong.selector);
    }

    function test_validateSymbol_badChar() public {
        PeakpumpFactory.CreateParams memory p = _custom(SUP, R6_RIDGE, R_X18, 0);
        p.symbol = "TE-ST"; // hyphen is outside [A-Z0-9]
        _expectCreateRevert(p, PeakpumpFactory.SymbolBadChar.selector);
    }

    function test_validateSymbol_lowercaseIsBadChar() public {
        PeakpumpFactory.CreateParams memory p = _custom(SUP, R6_RIDGE, R_X18, 0);
        p.symbol = "test"; // uppercase-only charset
        _expectCreateRevert(p, PeakpumpFactory.SymbolBadChar.selector);
    }

    function test_validateSymbol_reserved() public {
        PeakpumpFactory.CreateParams memory p = _custom(SUP, R6_RIDGE, R_X18, 0);
        p.symbol = "USDC";
        _expectCreateRevert(p, PeakpumpFactory.SymbolReserved.selector);
    }

    function test_validateSymbol_arcPrefix() public {
        PeakpumpFactory.CreateParams memory p = _custom(SUP, R6_RIDGE, R_X18, 0);
        p.symbol = "ARCX"; // reserved ARC prefix
        _expectCreateRevert(p, PeakpumpFactory.SymbolArcPrefix.selector);
    }

    function test_validateName_empty() public {
        PeakpumpFactory.CreateParams memory p = _custom(SUP, R6_RIDGE, R_X18, 0);
        p.name = "";
        _expectCreateRevert(p, PeakpumpFactory.NameEmpty.selector);
    }

    function test_validateName_tooLong() public {
        PeakpumpFactory.CreateParams memory p = _custom(SUP, R6_RIDGE, R_X18, 0);
        p.name = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"; // 33 bytes, max is 32
        _expectCreateRevert(p, PeakpumpFactory.NameTooLong.selector);
    }

    function test_validateName_controlByte() public {
        PeakpumpFactory.CreateParams memory p = _custom(SUP, R6_RIDGE, R_X18, 0);
        p.name = "ab\x01cd"; // 0x01 is below 0x20
        _expectCreateRevert(p, PeakpumpFactory.NameControlByte.selector);
    }

    function test_validateName_hiddenCodepoint() public {
        PeakpumpFactory.CreateParams memory p = _custom(SUP, R6_RIDGE, R_X18, 0);
        p.name = unicode"a​b"; // zero-width space, UTF-8 E2 80 8B
        _expectCreateRevert(p, PeakpumpFactory.NameHiddenCodepoint.selector);
    }

    // The other two runs _validateName rejects: the U+2066..U+2069 bidi isolates
    // (E2 81 A6..A9), which take the b1 != 0x80 path the zero-width test above skips,
    // and the UTF-8 BOM U+FEFF (EF BB BF). Byte literals, since the check is byte-level.
    function test_validateName_hiddenCodepoint_bidiIsolate() public {
        PeakpumpFactory.CreateParams memory p = _custom(SUP, R6_RIDGE, R_X18, 0);
        p.name = string(hex"4142E281A6"); // "AB" + U+2066 LEFT-TO-RIGHT ISOLATE
        _expectCreateRevert(p, PeakpumpFactory.NameHiddenCodepoint.selector);
    }

    function test_validateName_hiddenCodepoint_bom() public {
        PeakpumpFactory.CreateParams memory p = _custom(SUP, R6_RIDGE, R_X18, 0);
        p.name = string(hex"4142EFBBBF"); // "AB" + U+FEFF BYTE ORDER MARK
        _expectCreateRevert(p, PeakpumpFactory.NameHiddenCodepoint.selector);
    }

    // Every constructor address is non-zero-checked; a zero in any of the five
    // positions reverts before the factory exists.
    function test_constructorRejectsZeroAddress() public {
        vm.expectRevert(PeakpumpFactory.ZeroAddress.selector);
        new PeakpumpFactory(address(0), address(vault), curveImpl, tokenImpl, treasury);
        vm.expectRevert(PeakpumpFactory.ZeroAddress.selector);
        new PeakpumpFactory(owner, address(0), curveImpl, tokenImpl, treasury);
        vm.expectRevert(PeakpumpFactory.ZeroAddress.selector);
        new PeakpumpFactory(owner, address(vault), address(0), tokenImpl, treasury);
        vm.expectRevert(PeakpumpFactory.ZeroAddress.selector);
        new PeakpumpFactory(owner, address(vault), curveImpl, address(0), treasury);
        vm.expectRevert(PeakpumpFactory.ZeroAddress.selector);
        new PeakpumpFactory(owner, address(vault), curveImpl, tokenImpl, address(0));
    }

    // deriveParams runs before any clone, so an out-of-range triple reverts the
    // CurveMath bound error and never deploys a market.
    function test_math3Bounds_revertBeforeClone() public {
        _expectCreateRevert(_custom(1e23, R6_RIDGE, R_X18, 0), CurveMath.SupplyOutOfRange.selector);
        _expectCreateRevert(_custom(SUP, 1e14, R_X18, 0), CurveMath.RaiseOutOfRange.selector);
        _expectCreateRevert(_custom(SUP, R6_RIDGE, 1e18, 0), CurveMath.MultipleOutOfRange.selector);
        assertEq(factory.marketCount(), 0, "no market created on a bound revert");
    }

    function test_antiSnipeTooLong() public {
        PeakpumpFactory.CreateParams memory p = _custom(SUP, R6_RIDGE, R_X18, 0);
        p.antiSnipeBlocks = 301; // max is 300
        p.maxBuyPerAddress6 = 1e6; // paired, so pairing passes and length is the fault
        _expectCreateRevert(p, PeakpumpFactory.AntiSnipeTooLong.selector);
    }

    function test_antiSnipePairing_windowWithoutCap() public {
        PeakpumpFactory.CreateParams memory p = _custom(SUP, R6_RIDGE, R_X18, 0);
        p.antiSnipeBlocks = 100;
        p.maxBuyPerAddress6 = 0; // zero cap with a live window bricks the market
        _expectCreateRevert(p, PeakpumpFactory.AntiSnipePairingInvalid.selector);
    }

    function test_antiSnipePairing_capWithoutWindow() public {
        PeakpumpFactory.CreateParams memory p = _custom(SUP, R6_RIDGE, R_X18, 0);
        p.antiSnipeBlocks = 0;
        p.maxBuyPerAddress6 = 1e6;
        _expectCreateRevert(p, PeakpumpFactory.AntiSnipePairingInvalid.selector);
    }

    function test_setDefaultFees_onlyOwner() public {
        vm.prank(alice);
        vm.expectRevert(PeakpumpFactory.NotOwner.selector);
        factory.setDefaultFees(100, 24, 76);
    }

    function test_setDefaultFees_emitsAndStores() public {
        vm.expectEmit(false, false, false, true);
        emit DefaultFeesUpdated(125, 30, 95, 100, 24, 76);
        vm.prank(owner);
        factory.setDefaultFees(100, 24, 76);
        assertEq(factory.defaultFeeBps(), 100, "feeBps stored");
        assertEq(factory.defaultCreatorBps(), 24, "creatorBps stored");
        assertEq(factory.defaultProtocolBps(), 76, "protocolBps stored");
    }

    function test_setDefaultFees_invalid() public {
        vm.prank(owner);
        vm.expectRevert(PeakpumpFactory.FeeConfigInvalid.selector);
        factory.setDefaultFees(201, 100, 101); // feeBps > 200

        vm.prank(owner);
        vm.expectRevert(PeakpumpFactory.FeeConfigInvalid.selector);
        factory.setDefaultFees(125, 30, 90); // 30 + 90 != 125
    }

    function test_setCreationFee_emitsStoresAndCaps() public {
        vm.expectEmit(false, false, false, true);
        emit CreationFeeUpdated(0, 1_000_000);
        vm.prank(owner);
        factory.setCreationFee(1_000_000);
        assertEq(factory.creationFee6(), 1_000_000, "fee stored");

        vm.prank(owner);
        vm.expectRevert(PeakpumpFactory.CreationFeeTooHigh.selector);
        factory.setCreationFee(5_000_001); // max is 5_000_000

        vm.prank(alice);
        vm.expectRevert(PeakpumpFactory.NotOwner.selector);
        factory.setCreationFee(1);
    }

    function test_setTreasury_emitsStoresAndRejectsZero() public {
        address newT = makeAddr("newTreasury");
        vm.expectEmit(true, true, false, true);
        emit TreasuryUpdated(treasury, newT);
        vm.prank(owner);
        factory.setTreasury(newT);
        assertEq(factory.treasury(), newT, "treasury stored");

        vm.prank(owner);
        vm.expectRevert(PeakpumpFactory.ZeroTreasury.selector);
        factory.setTreasury(address(0));

        vm.prank(alice);
        vm.expectRevert(PeakpumpFactory.NotOwner.selector);
        factory.setTreasury(newT);
    }

    function test_lock_onlyOwnerOneShotAndFreezesSetters() public {
        vm.prank(alice);
        vm.expectRevert(PeakpumpFactory.NotOwner.selector);
        factory.lock();

        vm.expectEmit(false, false, false, true);
        emit Locked();
        vm.prank(owner);
        factory.lock();
        assertTrue(factory.governanceLocked(), "locked");

        vm.prank(owner);
        vm.expectRevert(PeakpumpFactory.AlreadyLocked.selector);
        factory.lock();

        // All three setters are frozen after lock.
        vm.prank(owner);
        vm.expectRevert(PeakpumpFactory.GovernanceLocked.selector);
        factory.setDefaultFees(100, 24, 76);
        vm.prank(owner);
        vm.expectRevert(PeakpumpFactory.GovernanceLocked.selector);
        factory.setCreationFee(1);
        vm.prank(owner);
        vm.expectRevert(PeakpumpFactory.GovernanceLocked.selector);
        factory.setTreasury(alice);
    }

    // Governance lock touches only the setters: creating markets and trading them are
    // unaffected.
    function test_afterLock_createAndTradeStillWork() public {
        vm.prank(owner);
        factory.lock();

        vm.prank(creator);
        (, address curve) = factory.create(_custom(SUP, R6_RIDGE, R_X18, 0));

        uint256 usdcIn6 = 1e6;
        vm.prank(alice);
        Curve(payable(curve)).buy{value: _wei(usdcIn6)}(0, block.timestamp, alice);
        assertGt(PeakToken(Curve(payable(curve)).token()).balanceOf(alice), 0, "trade works post-lock");
    }

    // maxDevBuy6 returns the exact boundary for every preset raise: cand passes the
    // step-9 cap and cand+1 does not. Same `*20 <= Ts` test the on-chain assert uses.
    function test_maxDevBuy6_isExactBoundary() public view {
        _assertMaxDevBuyBoundary(R6_BASECAMP);
        _assertMaxDevBuyBoundary(R6_RIDGE);
        _assertMaxDevBuyBoundary(R6_ALPINE);
    }

    function _assertMaxDevBuyBoundary(uint256 R6) internal view {
        uint256 m = factory.maxDevBuy6(SUP, R6, R_X18, FEE_BPS);
        CurveMath.DerivedParams memory d = CurveMath.deriveParams(SUP, R6, R_X18);
        assertLe(CurveMath.buyQuote(d.x0, d.y0, m, FEE_BPS).tokensOut * 20, d.Ts, "cand passes cap");
        assertGt(CurveMath.buyQuote(d.x0, d.y0, m + 1, FEE_BPS).tokensOut * 20, d.Ts, "cand+1 fails cap");
    }

    // The create-level boundary fuzzed across the whole MATH 3 valid box: for any
    // deriving (S, R6, r), maxDevBuy6 is the exact largest dev-buy -- a real create at
    // cap keeps sold*20 <= Ts and one unit above reverts DevBuyExceedsCap. cap == 0
    // cannot occur in this box (usdcIn6 == 1 always floors to tokensOut == 0, which
    // passes), so the guard is a fuzz-only safety net, asserted never-taken for the
    // presets in _assertCreateBoundary.
    //
    // Reachable-branch exemption: this fuzz cannot reach the cand-- down-walk at
    // PeakpumpFactory.sol:352. The seed double-floors -- netStar floors and the fee
    // gross-up floors, over a floored T = Ts/20 -- so tokensOut(seed)*20 <= 20*T <= Ts
    // always. The seed never overshoots, the up-walk lands on the exact max, and the
    // down-correction is dead for every valid input. Not fabricating an input to hit it.
    function testFuzz_maxDevBuy6IsExact(uint256 rawS, uint256 rawR6, uint256 rawR) public {
        uint256 S = bound(rawS, 1e24, 1e30);
        uint256 R6 = bound(rawR6, 1e9, 1e13);
        uint256 rX18 = bound(rawR, 2e18, 20e18);

        uint256 cap = factory.maxDevBuy6(S, R6, rX18, FEE_BPS);
        if (cap == 0) return;

        uint256 ts = CurveMath.deriveParams(S, R6, rX18).Ts;
        (Curve curve,) = _create(_custom(S, R6, rX18, cap));
        assertLe(uint256(curve.sold()) * 20, ts, "cap: sold*20 <= Ts");

        PeakpumpFactory.CreateParams memory over = _custom(S, R6, rX18, cap + 1);
        vm.prank(creator);
        vm.expectRevert(PeakpumpFactory.DevBuyExceedsCap.selector);
        factory.create{value: _wei(cap + 1)}(over);
    }
}
