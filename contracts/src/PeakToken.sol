// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {ERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";

// The market token. Deployed as an EIP-1167 clone of this implementation, so it
// must extend the upgradeable ERC20: a clone runs no constructor, and plain
// ERC20 stores name and symbol in its constructor, so a clone of plain ERC20
// would report an empty name while the directly-tested implementation still
// looked correct. name and symbol therefore live in initialize, not a ctor.
contract PeakToken is Initializable, ERC20Upgradeable {
    // The curve that owns this market. Set once at initialize; the only address
    // pullFrom will move tokens to, and the only address allowed to call it.
    address public curve;

    error NotCurve();

    constructor() {
        _disableInitializers();
    }

    // initialize carries no factory gate. The factory clones and initializes in
    // a single transaction, so there is no gap for anyone to front-run; and an
    // unregistered clone has zero blast radius, being rejected by
    // FeeVault.onlyCrediter, never registered by the indexer, and attached to no
    // curve. The msg.sender == curve gate on pullFrom is the real access
    // control.
    function initialize(string calldata name_, string calldata symbol_, address curve_, uint256 supply)
        external
        initializer
    {
        __ERC20_init(name_, symbol_);
        curve = curve_;
        _mint(curve_, supply);
    }

    /// @notice Move `amount` tokens from `from` to the curve without an ERC-20
    /// approval. This is the entire sell-side transfer path, and the no-approve
    /// design is only safe while all four of these hold:
    /// 1. Curve.sell always passes its own `msg.sender` as `from`, so a caller
    ///    can only ever move its own tokens.
    /// 2. Curve.sell never accepts a `from` parameter, so no caller can name a
    ///    victim.
    /// 3. Curve never exposes a function that executes arbitrary calldata, so no
    ///    caller can make the curve call pullFrom on its behalf.
    /// 4. No predeployed contract on the Arc network can present an arbitrary
    ///    address as msg.sender to this function. The evidence that the Arc
    ///    CallFrom / Multicall3From precompiles cannot do this is in
    ///    docs/SPEC.md section 7, and it is proved on chain in
    ///    contracts/test/fork/ArcFork.t.sol.
    /// If any of the four ever stops holding, this guard alone is not sufficient
    /// and the whole design must be revisited.
    function pullFrom(address from, uint256 amount) external {
        if (msg.sender != curve) revert NotCurve();
        _transfer(from, curve, amount);
    }
}
