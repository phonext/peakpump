// Anvil bring-up and contract deploy. The suite cannot start anvil or broadcast
// a transaction itself: starting a chain and deploying to it are broadcasting
// commands, which are printed rather than run. What
// belongs here is the shape of the environment the spec assumes, so the printed
// commands are reproducible and the spec's expectations are checkable by hand.
//
// Anvil is asked for the Arc chain id explicitly rather than forking a network:
// a fork would carry a week of mainnet state the suite never reads, and the four
// contracts this run exercises are deployed fresh below. --no-mining and a block
// interval are NOT used: the summit crossing needs mined blocks, and
// antiSnipeBlocks counts them, so an auto-mining anvil is the environment that
// makes those assertions meaningful.
export const ANVIL_COMMAND =
  "anvil --chain-id 5042002 --host 127.0.0.1 --port 8545 --accounts 10 --balance 10000";

// The deployed artefacts are written to deployments/arc-testnet.json, the file
// the app reads for the factory address, so a local run points at the local
// chain through the same code path production uses. Nothing in e2e hardcodes an
// address: the suite reads this file, as reconcile-fees.ts does.
//
// The private key below is anvil's first default account. It is the deployer,
// which makes it the factory owner through PEAKPUMP_OWNER — the owner-only
// setters in Deploy.s.sol run inside the same broadcast and need the
// broadcasting key to be the owner. It is also the treasury, so protocol-side
// fee credits land on an address the spec can read back. The market creator and
// trader is the harness's own signer, anvil's second account, so a claim moves
// credits somewhere other than the deployer's balance.
export const DEPLOY_COMMAND = [
  "cd contracts",
  "PEAKPUMP_OWNER=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 \\",
  "PEAKPUMP_TREASURY=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 \\",
  "GIT_COMMIT=$(git rev-parse --short HEAD) \\",
  "forge script script/Deploy.s.sol \\",
  "  --rpc-url http://127.0.0.1:8545 \\",
  "  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \\",
  "  --with-gas-price 20000000000 \\",
  "  --broadcast",
].join("\n");

// Deploy.s.sol reads deployments/arc-testnet.json relative to contracts/, so the
// local file lands beside the committed one. The suite reads whichever is
// present; a run against anvil gets the local chain's addresses, a run against
// the deployed testnet keeps the committed file.
export const DEPLOYMENTS_PATH = "contracts/deployments/arc-testnet.json";
