import type { MetadataRoute } from "next";

// /styleguide is a development surface and carries a noindex of its own; this
// keeps it out of crawlers that read robots but not the meta tag. Nothing else
// is excluded: the API routes answer JSON a crawler cannot index, and every
// remaining page is public by design.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", disallow: ["/styleguide"] },
  };
}
