import type { MetadataRoute } from "next";
import { PRODUCT_NAME } from "@peakpump/shared/brand";

// The installable-app manifest. Every icon is a rendition of this project's
// own logo (scripts/gen-icons.ts), so no third-party mark reaches a home
// screen. The two colours are the page ground and nothing else: a theme colour
// outside the palette would show on a splash screen the product never designed.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: PRODUCT_NAME,
    short_name: PRODUCT_NAME,
    description:
      "Token launches on a fixed bonding curve, on Arc Testnet. A market climbs through " +
      "ASCENT to the Summit, then trades in PEAK.",
    start_url: "/",
    display: "standalone",
    background_color: "#0A0A0B",
    theme_color: "#0A0A0B",
    icons: [
      { src: "/brand/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/brand/icon-512.png", sizes: "512x512", type: "image/png" },
      // The maskable entry is padded so the launcher's crop stays off the
      // artwork; without it an Android mask clips the figure's edges.
      {
        src: "/brand/icon-512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
