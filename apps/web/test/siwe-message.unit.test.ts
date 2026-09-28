import { describe, expect, it } from "vitest";
import type { Address } from "viem";
import {
  SIWE_CHAIN_ID_CLIENT,
  SIWE_STATEMENT_CLIENT,
  buildSiweMessage,
} from "@/lib/siwe-client";
import { SIWE_CHAIN_ID, SIWE_STATEMENT } from "@/lib/auth";

// The client half cannot import lib/auth (it is a server module: prisma and
// Auth.js would land in the browser bundle), so its two constants are restated
// there. These pins are what keeps the pair from drifting apart silently: if
// lib/auth's statement or chain id changes, this file fails until the client
// copy changes with it.

const ADDRESS = "0x14791697260e4d9b2e1935d29070c67e501a406d" as Address;

describe("the restated constants", () => {
  it("carries lib/auth's statement word for word", () => {
    expect(SIWE_STATEMENT_CLIENT).toBe(SIWE_STATEMENT);
  });

  it("carries lib/auth's chain id, the Arc Testnet one", () => {
    expect(SIWE_CHAIN_ID_CLIENT).toBe(SIWE_CHAIN_ID);
    expect(SIWE_CHAIN_ID_CLIENT).toBe(5_042_002);
  });
});

describe("buildSiweMessage", () => {
  const message = buildSiweMessage({
    address: ADDRESS,
    nonce: "abcdefgh1234",
    // The host with no scheme: EIP-4361's domain field, and the form the
    // server compares against NEXTAUTH_URL's host.
    domain: "peakpump.test",
    uri: "https://peakpump.test",
  });

  it("states the domain and the URI the server will check", () => {
    expect(message).toContain("peakpump.test wants you to sign in with your Ethereum account:");
    expect(message).toContain("URI: https://peakpump.test");
  });

  it("binds the nonce", () => {
    expect(message).toContain("Nonce: abcdefgh1234");
    expect(buildSiweMessage({ address: ADDRESS, nonce: "othernonce", domain: "other.host", uri: "https://other.host" })).toContain(
      "Nonce: othernonce",
    );
  });

  it("carries the statement, the chain id and the version", () => {
    expect(message).toContain(`\n${SIWE_STATEMENT}\n`);
    expect(message).toContain("Chain ID: 5042002");
    expect(message).toContain("Version: 1");
  });
});
