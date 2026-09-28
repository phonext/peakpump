// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {FeeVault} from "../src/FeeVault.sol";
import {PeakToken} from "../src/PeakToken.sol";
import {Curve} from "../src/Curve.sol";
import {PeakpumpFactory} from "../src/PeakpumpFactory.sol";

/// @dev Printed, never broadcast (SPEC 5.6). Deploys the
/// four singletons in the frozen order, wires the factory to the vault, runs the
/// admin setters as confirmations, and writes deployments/arc-testnet.json on the
/// frozen schema. ffi is off, so the git sha comes from GIT_COMMIT rather than a shell
/// call; the deploy timestamp is derived on chain from block.timestamp. lock() is
/// left to a deliberate later run. Gas here is advisory: --with-gas-price on the
/// CLI sets the real transaction fee; the values below state the project policy.
contract Deploy is Script {
    uint256 constant SECS_PER_DAY = 86400;

    struct Deployed {
        address factory;
        address feeVault;
        address curveImpl;
        address tokenImpl;
        uint256 factoryBlock;
        uint256 feeVaultBlock;
        uint256 curveImplBlock;
        uint256 tokenImplBlock;
    }

    function run() external {
        address deployOwner = vm.envAddress("PEAKPUMP_OWNER");
        address treasury = vm.envAddress("PEAKPUMP_TREASURY");
        string memory commit = vm.envString("GIT_COMMIT");
        // Gas policy: floor 20 gwei, ceiling 20_001 gwei, priority 1 gwei.
        // Advisory only; Foundry applies the fee from --with-gas-price below.
        uint256 maxFeePerGas;
        {
            uint256 doubled = block.basefee * 2;
            uint256 floored = doubled < 20 gwei ? 20 gwei : doubled;
            maxFeePerGas = floored > 20_001 gwei ? 20_001 gwei : floored;
        }
        uint256 maxPriorityFeePerGas = 1 gwei;
        console2.log("maxFeePerGas (wei):", maxFeePerGas);
        console2.log("maxPriorityFeePerGas (wei):", maxPriorityFeePerGas);
        console2.log("CLI flag to pass: --with-gas-price", maxFeePerGas);

        // The broadcasting key MUST be PEAKPUMP_OWNER: the three confirmation setters
        // below are onlyOwner and run inside this same broadcast.
        Deployed memory dep;
        vm.startBroadcast();

        FeeVault feeVault = new FeeVault(treasury);
        dep.feeVault = address(feeVault);
        dep.feeVaultBlock = block.number;
        dep.tokenImpl = address(new PeakToken());
        dep.tokenImplBlock = block.number;
        dep.curveImpl = address(new Curve());
        dep.curveImplBlock = block.number;
        PeakpumpFactory factory =
            new PeakpumpFactory(deployOwner, dep.feeVault, dep.curveImpl, dep.tokenImpl, treasury);
        dep.factory = address(factory);
        dep.factoryBlock = block.number;

        feeVault.setFactory(dep.factory);
        // Confirmations over what the constructor already shipped, in the SPEC 5.6
        // order: they prove the owner-only setters answer to the broadcasting key.
        // Both figures are read back rather than restated, because a literal here is
        // a second policy that wins over the constructor's on every deploy, while
        // MATH 6 gives the rate one source of truth; the creation fee has its
        // own setter read-back, which still reverts on a trio that breaks the
        // creator + protocol == total check, or on a creation fee over its cap.
        factory.setDefaultFees(factory.defaultFeeBps(), factory.defaultCreatorBps(), factory.defaultProtocolBps());
        factory.setCreationFee(factory.creationFee6());
        factory.setTreasury(treasury);
        // lock() intentionally omitted; run it only when governance is frozen.

        vm.stopBroadcast();

        _writeDeployments(dep, commit, maxFeePerGas, maxPriorityFeePerGas);
    }
    // Frozen schema, exact key order, addresses as EIP-55 checksummed strings. The
    // two gas fields are appended after the fixed part (SPEC 5.6 keeps the schema
    // fixed). Nested objects are embedded via serializeString on a prior
    // serialize output, the documented forge-std nesting.
    function _writeDeployments(Deployed memory dep, string memory commit, uint256 maxFeePerGas, uint256 maxPri)
        internal
    {
        string memory c = "contractsObj";
        vm.serializeString(c, "PeakpumpFactory", Strings.toChecksumHexString(dep.factory));
        vm.serializeString(c, "FeeVault", Strings.toChecksumHexString(dep.feeVault));
        vm.serializeString(c, "CurveImpl", Strings.toChecksumHexString(dep.curveImpl));
        string memory contractsJson = vm.serializeString(c, "PeakTokenImpl", Strings.toChecksumHexString(dep.tokenImpl));

        string memory b = "blocksObj";
        vm.serializeUint(b, "PeakpumpFactory", dep.factoryBlock);
        vm.serializeUint(b, "FeeVault", dep.feeVaultBlock);
        vm.serializeUint(b, "CurveImpl", dep.curveImplBlock);
        string memory blocksJson = vm.serializeUint(b, "PeakTokenImpl", dep.tokenImplBlock);

        string memory r = "rootObj";
        vm.serializeUint(r, "chainId", block.chainid);
        vm.serializeString(r, "network", "arc-testnet");
        vm.serializeString(r, "deployedAt", _iso8601(block.timestamp));
        vm.serializeString(r, "commit", commit);
        vm.serializeString(r, "solc", "0.8.28");
        vm.serializeString(r, "evmVersion", "cancun");
        vm.serializeUint(r, "optimizerRuns", 200);
        vm.serializeUint(r, "startBlock", _min4(dep.feeVaultBlock, dep.tokenImplBlock, dep.curveImplBlock, dep.factoryBlock));
        vm.serializeString(r, "contracts", contractsJson);
        vm.serializeString(r, "blocks", blocksJson);
        vm.serializeUint(r, "maxFeePerGas", maxFeePerGas);
        string memory out = vm.serializeUint(r, "maxPriorityFeePerGas", maxPri);

        vm.writeJson(out, "deployments/arc-testnet.json");
        console2.log("Wrote deployments/arc-testnet.json (startBlock is the earliest of the four).");
    }
    // block.timestamp -> "YYYY-MM-DDTHH:MM:SSZ" via the Hinnant civil-from-days
    // algorithm, so deployedAt is derived on chain without ffi or a date library.
    function _iso8601(uint256 ts) internal pure returns (string memory) {
        uint256 secs = ts % SECS_PER_DAY;
        uint256 hh = secs / 3600;
        uint256 mm = (secs % 3600) / 60;
        uint256 ss = secs % 60;
        uint256 z = ts / SECS_PER_DAY + 719468;
        uint256 era = z / 146097;
        uint256 doe = z - era * 146097;
        uint256 yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
        uint256 y = yoe + era * 400;
        uint256 doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
        uint256 mp = (5 * doy + 2) / 153;
        uint256 d = doy - (153 * mp + 2) / 5 + 1;
        uint256 m = mp < 10 ? mp + 3 : mp - 9;
        y = m <= 2 ? y + 1 : y;
        return string.concat(
            Strings.toString(y), "-", _pad2(m), "-", _pad2(d), "T", _pad2(hh), ":", _pad2(mm), ":", _pad2(ss), "Z"
        );
    }

    function _pad2(uint256 v) internal pure returns (string memory) {
        return v < 10 ? string.concat("0", Strings.toString(v)) : Strings.toString(v);
    }

    function _min4(uint256 a, uint256 b, uint256 c, uint256 d) internal pure returns (uint256 m) {
        m = a;
        if (b < m) m = b;
        if (c < m) m = c;
        if (d < m) m = d;
    }
}
