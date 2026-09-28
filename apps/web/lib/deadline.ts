import type { ReadClient } from "@/lib/viem";

// The contract compares block.timestamp <= deadline, using <= and
// not <, because Arc timestamps are non-decreasing rather than strictly increasing
// and two consecutive blocks may share one. Nothing here needs to know that: it
// only has to produce a second in the future, and the comparison is the chain's.
//
// The window presets are this file's own: the deadline rule fixes the parameter and its
// comparison and says nothing about the control. Arc blocks are sub-second, so a
// trade that has not landed inside a minute has met something worth bounding.
export const DEADLINE_PRESETS_MINUTES = [1, 5, 20] as const;
export const DEFAULT_DEADLINE_MINUTES = 5;

// Read from the chain rather than taken from Date.now(). A browser clock running a
// few minutes fast against the chain would send a deadline the very next block has
// already passed, and DeadlineExpired on a correctly-formed trade is the least
// explicable failure this panel could produce.
export async function readChainSeconds(client: ReadClient): Promise<bigint> {
  const block = await client.getBlock({ blockTag: "latest" });
  return block.timestamp;
}

export function deadlineFrom(chainSeconds: bigint, minutes: number): bigint {
  return chainSeconds + BigInt(minutes) * 60n;
}
