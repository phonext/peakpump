// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

// Pull-payment fee accounting in native USDC. Fees are credited to a per-address
// ledger held in 6-decimal units and are never pushed: a party gets its value
// only by calling claim(). Native USDC carries 18 decimals in msg.value; the
// 6-decimal view relates by amount6 = value / 1e12, and any sub-1e12 remainder
// is held in dustWei and never rounded up into a balance, so the vault can never
// owe more than it holds.
contract FeeVault is ReentrancyGuard {
    // Whether a credited amount is a creator share or a protocol share, so the
    // indexer separates the two without inferring it from the recipient.
    enum Reason {
        Creator,
        Protocol
    }

    // 6-decimal claimable balances.
    mapping(address => uint256) public balances;
    // Registered curves may credit. Private per SPEC 5.4: never exposed, written
    // only by the factory, only to true.
    mapping(address => bool) private isRegisteredCurve;

    // Accumulated sub-1e12 remainders, in wei. Converted to treasury units one
    // whole unit at a time as it crosses 1e12.
    uint256 public dustWei;

    address public factory;
    // The only address permitted to call setFactory: recorded at construction
    // so a front-runner cannot claim the one-shot setter and brick the vault.
    address public immutable deployer;
    // Destination for accumulated dust. Immutable: this vault holds no setter,
    // and the protocol share of a trade is credited by naming the recipient in
    // creditPair, so no redirect of an already-recorded credit is expressible.
    address public immutable treasury;

    event FactorySet(address indexed factory);
    event CurveRegistered(address indexed curve);
    event Credited(address indexed to, uint256 amount6, Reason reason);
    event DustCredited(uint256 amount6);
    event Claimed(address indexed to, uint256 amount6);

    error AlreadySet();
    error ZeroAddress();
    error NotDeployer();
    error NotFactory();
    error NotAuthorized();
    error ValueMismatch();
    error NothingToClaim();
    error TransferFailed();

    constructor(address treasury_) {
        if (treasury_ == address(0)) revert ZeroAddress();
        treasury = treasury_;
        deployer = msg.sender;
    }

    modifier onlyCrediter() {
        if (msg.sender != factory && !isRegisteredCurve[msg.sender]) revert NotAuthorized();
        _;
    }

    // One-shot: the factory address is fixed the first time it is set and can
    // never change, which the deploy script does immediately after deployment.
    function setFactory(address factory_) external {
        if (msg.sender != deployer) revert NotDeployer();
        if (factory != address(0)) revert AlreadySet();
        if (factory_ == address(0)) revert ZeroAddress();
        factory = factory_;
        emit FactorySet(factory_);
    }

    function registerCurve(address curve) external {
        if (msg.sender != factory) revert NotFactory();
        isRegisteredCurve[curve] = true;
        emit CurveRegistered(curve);
    }

    // Credit a single party the whole msg.value, flooring to 6-decimal units and
    // holding the remainder as dust. Used by the factory for the creation fee.
    function credit(address to) external payable onlyCrediter {
        _creditNative(to, msg.value, Reason.Protocol);
    }

    // Record a creator share and a protocol share of one fee in a single call,
    // each independently claimable. The value must match the two amounts exactly:
    // fee amounts are already in 6-decimal units, so there is no dust here.
    function creditPair(address a, uint256 amountA6, address b, uint256 amountB6) external payable onlyCrediter {
        if (msg.value != (amountA6 + amountB6) * 1e12) revert ValueMismatch();
        if (amountA6 == 0 && amountB6 == 0) return;
        if (amountA6 != 0) {
            balances[a] += amountA6;
            emit Credited(a, amountA6, Reason.Creator);
        }
        if (amountB6 != 0) {
            balances[b] += amountB6;
            emit Credited(b, amountB6, Reason.Protocol);
        }
    }

    // Pull the caller's whole balance. The balance is zeroed before the transfer,
    // and a failed transfer reverts the whole call so the balance is restored and
    // remains claimable later: a blocklisted recipient bricks only its own claim.
    function claim() external nonReentrant {
        uint256 amount6 = balances[msg.sender];
        if (amount6 == 0) revert NothingToClaim();
        balances[msg.sender] = 0;
        (bool ok,) = msg.sender.call{value: amount6 * 1e12}("");
        if (!ok) revert TransferFailed();
        emit Claimed(msg.sender, amount6);
    }

    // A bare native transfer accrues to the protocol so the balance invariant
    // (native balance == sum of balances * 1e12 + dustWei) always holds.
    receive() external payable {
        _creditNative(treasury, msg.value, Reason.Protocol);
    }

    function _creditNative(address to, uint256 value, Reason reason) internal {
        uint256 amount6 = value / 1e12;
        if (amount6 != 0) {
            balances[to] += amount6;
            emit Credited(to, amount6, reason);
        }
        uint256 remainder = value % 1e12;
        if (remainder != 0) {
            dustWei += remainder;
            if (dustWei >= 1e12) {
                uint256 units = dustWei / 1e12;
                dustWei -= units * 1e12;
                balances[treasury] += units;
                emit DustCredited(units);
            }
        }
    }
}
