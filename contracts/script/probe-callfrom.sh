#!/bin/sh
# Probes the Arc predeploys this design depends on. Read-only, no key needed.
set -e
: "${ARC_RPC_URL:?set ARC_RPC_URL}"
probe() {
  printf '%-16s %s code -> ' "$1" "$2"
  cast code "$2" --rpc-url "$ARC_RPC_URL" | head -c 20 ; echo
}
probe "USDC ERC20"     0x3600000000000000000000000000000000000000
probe "Multicall3From" 0x522fAf9A91c41c443c66765030741e4AaCe147D0
probe "Memo"           0x5294E9927c3306DcBaDb03fe70b92e01cCede505
probe "Multicall3"     0xcA11bde05977b3631167028862bE2a173976CA11
probe "CREATE2"        0x4e59b44847b379578588920cA78FbF26c0B4956C
# The CallFrom precompile is a precompile: empty code here is EXPECTED and is
# not evidence of absence. Do not treat 0x as a failure.
probe "CallFrom?"      0x1800000000000000000000000000000000000003
printf 'chain-id  -> ' ; cast chain-id     --rpc-url "$ARC_RPC_URL"
printf 'block     -> ' ; cast block-number --rpc-url "$ARC_RPC_URL"
printf 'gas-price -> ' ; cast gas-price    --rpc-url "$ARC_RPC_URL"
printf 'usdc dec  -> ' ; cast call 0x3600000000000000000000000000000000000000 \
                          "decimals()(uint8)" --rpc-url "$ARC_RPC_URL"
