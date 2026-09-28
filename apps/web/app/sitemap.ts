import type { MetadataRoute } from "next";
import { fetchMarketCurves } from "@/lib/markets";

// The six pages minus /styleguide: the three static routes plus one URL per
// market. Profile URLs are excluded — the set of addresses is unbounded and no
// document defines a canonical list of profiles worth indexing. The market
// list is the indexer's; with it unset the sitemap carries the static three
// and nothing else, which is the same degraded-but-correct state as every
// other indexer consumer.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const curves = await fetchMarketCurves(500);
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: "/", changeFrequency: "hourly", priority: 1 },
    { url: "/create", changeFrequency: "monthly", priority: 0.5 },
    { url: "/brand", changeFrequency: "yearly", priority: 0.3 },
  ];
  if (curves === null) return staticRoutes;
  return [
    ...staticRoutes,
    ...curves.map((curve) => ({
      url: `/token/${curve}`,
      changeFrequency: "hourly" as const,
      priority: 0.8,
    })),
  ];
}
