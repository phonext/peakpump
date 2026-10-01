import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import deployment from "../deployments/arc-testnet.json";

// The literals in config.yaml are the one place this package repeats facts
// from the deployment record; this test is what keeps them from drifting.
// Parsing is a set of regexes rather than a YAML dependency.
const config = readFileSync(
  fileURLToPath(new URL("../config.yaml", import.meta.url)),
  "utf8",
);

// Splits config.yaml's global contracts section into per-contract chunks. The
// slice at "chains:" keeps the deeper-indented per-chain contract entries out
// of the last chunk, and the "  - name:" anchor keeps the per-chain entries
// from ever starting a chunk of their own.
function contractSections(): string[] {
  return config
    .slice(0, config.search(/^chains:/m))
    .split(/^(?=  - name:)/m)
    .filter((section) => /^  - name:/.test(section));
}

function contractAddress(name: string): string | undefined {
  return config.match(
    new RegExp(`^ {6}- name: ${name}\\n {8}address: "([^"]+)"`, "m"),
  )?.[1];
}

function literal(key: string): string {
  // The optional "- " covers list items (the chain id only appears as
  // "- id: 5042002" under chains).
  const match = config.match(new RegExp(`^\\s*(?:- )?${key}:\\s*"?([^"\\n]+)"?`, "m"));
  if (match === null) throw new Error(`config.yaml has no ${key} line`);
  return match[1]!;
}

describe("config single-source", () => {
  it("starts at the deployment record's start block, never zero", () => {
    const startBlock = Number(literal("start_block"));
    expect(startBlock).toBe(deployment.startBlock);
    expect(startBlock).not.toBe(0);
  });

  it("pins the chain id, the HyperSync endpoint and both static addresses", () => {
    expect(Number(literal("id"))).toBe(deployment.chainId);
    expect(literal("url")).toBe("https://arc-testnet.hypersync.xyz");

    expect(contractAddress("PeakpumpFactory")).toBe(deployment.contracts.PeakpumpFactory);
    expect(contractAddress("FeeVault")).toBe(deployment.contracts.FeeVault);
  });

  it("subscribes Transfer only through the dynamically registered PeakToken contract", () => {
    // A topic-only Transfer subscription under any other contract would ingest
    // the chain-wide native-USDC emitter and double count every payout.
    const blocks = contractSections().map((section) => ({
      name: section.match(/^  - name:\s*(\S+)/)?.[1] ?? "",
      hasTransfer: section.includes("event: Transfer"),
    }));

    expect(blocks.map((block) => block.name)).toEqual(
      ["PeakpumpFactory", "FeeVault", "Curve", "PeakToken"],
    );
    expect(blocks.filter((block) => block.hasTransfer).map((block) => block.name)).toEqual([
      "PeakToken",
    ]);
  });

  it("disables reorg handling and confirmation waiting", () => {
    expect(config).toMatch(/rollback_on_reorg:\s*false/);
    expect(config).toMatch(/max_reorg_depth:\s*0/);
    expect(config).toMatch(/block_lag:\s*0/);
  });
});
