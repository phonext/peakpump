import type { CandleInterval } from "@/lib/graphql";

// The three thresholds a market's history is graded on, in the seconds the
// bucketStart grid counts in. A day is 288 five-minute buckets and a week is 168
// hourly ones, both inside the 300 points the frame holds with room for the
// carry-forward; past a week even 1h overflows it and only a daily bucket still
// fits the market's own span.
const DAY = 86_400n;
const WEEK = 7n * DAY;

// The interval the strip opens on, from how long the market has been trading. The
// four tabs stay live and a reader's own pick is never reapplied, so a market that
// ages past a threshold mid-session keeps the interval it opened on: this chooses
// the first frame, not the current one.
export function defaultInterval(ageSeconds: bigint): CandleInterval {
  if (ageSeconds < DAY) return "5m";
  if (ageSeconds < WEEK) return "1h";
  return "1d";
}
