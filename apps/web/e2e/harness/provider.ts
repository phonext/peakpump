// The injected signer. wagmi's `injected()` connector drives whatever sits behind
// window.ethereum, so this provider IS the wallet for a run: no MetaMask, no
// extension, no QR code, and the same key on every machine.
//
// The private key never reaches the browser. The page calls a function Playwright
// exposes on window, the signing happens in Node with a viem wallet client aimed
// at anvil, and only the hash comes back. That is the whole bridge: one exposed
// function, no string-encoding handshake, no promise map kept in two places.
import { createWalletClient, http, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "@peakpump/shared/chain";
import type { Page } from "@playwright/test";

// Anvil's second default account. The first is the deployer, which makes it the
// factory owner and the treasury; keeping the signer separate means the market's
// creator, its fee recipients and its owner are three distinct addresses, so the
// claim step moves creator credits somewhere other than the deployer's own
// balance and the anti-snipe window caps an address the deploy never touched.
// Anvil funds every default account, so no anvil-side transfer is needed.
const ANVIL_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;
const ANVIL_RPC = "http://127.0.0.1:8545";

const account = privateKeyToAccount(ANVIL_KEY);
export const signerAddress: Address = account.address;

const walletClient = createWalletClient({
  chain: arcTestnet,
  account,
  transport: http(ANVIL_RPC),
});

// The window.ethereum the page sees. Only the methods wagmi's injected connector
// calls during connect and during a trade: eth_requestAccounts to connect,
// eth_accounts to restore a session, eth_chainId to agree on the chain. Signing
// is the bridge's job, so the provider holds no key of its own.
const PROVIDER_SOURCE = `
window.ethereum = {
  isMetaMask: false,
  request: async (args) => window.__peakpumpWallet(args),
  on: () => {},
  removeListener: () => {},
};
`;

// The Node side of the bridge. Playwright marshals arguments and return values,
// so a thrown error arrives in the page as a rejected promise, which is what a
// wallet declining a request looks like to wagmi.
async function walletRequest(args: { method: string; params?: unknown[] }): Promise<unknown> {
  switch (args.method) {
    case "eth_requestAccounts":
    case "eth_accounts":
      return [signerAddress];
    case "eth_chainId":
      return `0x${arcTestnet.id.toString(16)}`;
    case "eth_sendRawTransaction":
      return walletClient.sendRawTransaction({
        serializedTransaction: args.params![0] as `0x${string}`,
      });
    default:
      throw new Error(`the injected provider does not implement ${args.method}`);
  }
}

// Must run before the page's own scripts, hence addInitScript: the provider has
// to be in place before wagmi probes window.ethereum during hydration.
export async function installWallet(page: Page): Promise<void> {
  await page.exposeFunction("__peakpumpWallet", walletRequest);
  await page.addInitScript(PROVIDER_SOURCE);
}
