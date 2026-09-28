import { publicClient } from "@/lib/viem";

// The one place a signature verification reaches the chain, so tests can mock
// this module and never touch an RPC. The EOA path is ecrecover and the smart
// account path is a fixed isValidSignature call on the signing address, plus
// the ERC-6492 unwrapping that deploys viem's UniversalSignatureValidator
// through Multicall3 when it meets a counterfactual signature. Both answers are
// a boolean, and neither carries a chain value back.
export async function verifySiweSignature(message: string, signature: `0x${string}`): Promise<boolean> {
  return await publicClient.verifySiweMessage({ message, signature });
}
