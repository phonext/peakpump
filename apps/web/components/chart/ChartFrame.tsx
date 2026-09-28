"use client";

import { Skeleton } from "@peakpump/ui/Skeleton";
import dynamic from "next/dynamic";

// The height both charts draw at, and the height their placeholder reserves. One
// constant for the two is the point: DESIGN.md wants a skeleton shaped like the thing
// it replaces, and a chart arriving taller than its placeholder moves every panel
// below it. It is the figure the app shell already reserved.
export const CHART_HEIGHT = 280;

// The dynamic boundary, and the reason this file is a client component at all: an
// ssr:false import is only legal inside one. lightweight-charts gzips to about 60 kB,
// a quarter of the route's whole first-load budget in DESIGN.md:252, and it reaches for
// the DOM as it initialises, so it is fetched on the client after the page has painted
// and never in the server bundle.
export const ChartFrame = dynamic(
  () => import("@/components/chart/ChartCanvas").then((mod) => mod.ChartCanvas),
  {
    ssr: false,
    loading: () => <Skeleton width="100%" height={CHART_HEIGHT} radius={false} />,
  },
);
