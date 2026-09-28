import type { NextConfig } from "next";
import { arcTestnet } from "@peakpump/shared/chain";

// A year, and immutable, because none of the files this applies to is ever
// edited in place: the mark, the texture and the icon renditions are replaced
// by a differently named file when they change, and the two App Router icon
// routes carry a content hash in their link's query. Without this the texture
// — which is on every route — costs a conditional request per navigation: the
// files under public are served with max-age=0, and a metadata route rather
// than a file under public prerenders its own max-age=0, must-revalidate. Both
// are overridden and not merely appended to, because these rules are set in
// the router phase before anything renders and every writer downstream leaves
// a Cache-Control that is already present alone.
const IMMUTABLE = [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }];

// The RPC host list is read from the chain definition rather than restated here
// so a host change in packages/shared/src/chain.ts reaches the policy without a
// second edit. Origins only: the policy never grants a path or a query.
const RPC_ORIGINS = arcTestnet.rpcUrls.default.http.map((url) => new URL(url).origin);

// The indexer is the one origin the browser reads JSON from. R2's public origin
// is an <img> source, and the upload's presigned PUT besides. Both are read at
// config time and are absent from the policy entirely when the variable is empty,
// which is what an untouched .env.example produces.
//
// R2's origin appears in both directives because the upload is a presigned PUT
// the browser issues directly to the bucket: img-src governs only <img> loads and
// would leave that PUT forbidden. Upstash is read server side and never from the
// browser, but the policy is built from what the deployment is configured to
// reach, and a stale build or a client-side eager connect is enough to make the
// fetch happen, so the origin is named rather than discovered by a refused
// request. Neither is a grant to a path or a query; origins only.
function originOf(name: string): string | null {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

const CONNECT_ORIGINS = [
  ...RPC_ORIGINS,
  originOf("NEXT_PUBLIC_INDEXER_URL"),
  originOf("R2_PUBLIC_BASE_URL"),
  originOf("UPSTASH_REDIS_REST_URL"),
].filter(Boolean);

const R2_ORIGIN = originOf("R2_PUBLIC_BASE_URL");

// Every directive that is not listed falls back to default-src 'self', which is
// why font-src and worker-src need no entry of their own.
//
// script-src 'unsafe-inline' is a residual, reported for acceptance rather than
// hidden: this app is statically rendered by design and a header-based
// policy carries no per-request nonce, so the inline bootstrap and flight-data
// scripts Next emits during hydration have no hash the policy could pin. A
// nonce would force dynamic rendering and cost the first-load budget the policy
// exists to protect.
//
// 'unsafe-eval' is dev-only and never ships. Two framework call sites need it in
// development and nothing else does: react-server-dom-turbopack probes eval with
// (0, eval)("null") to decide whether it can register module globals, and the
// Turbopack chunk runtime eval()s the base64 source map it was handed so a dev
// stack trace points at source rather than at a bundled position. The probe is
// wrapped in try/catch, so a dev without it renders the page and logs the
// complaint instead of failing. No app chunk and no production chunk calls eval,
// so the dev branch costs the shipped policy nothing.
const SCRIPT_SRC =
  process.env.NODE_ENV === "development"
    ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
    : "script-src 'self' 'unsafe-inline'";

const CSP = [
  "default-src 'self'",
  `connect-src 'self' ${CONNECT_ORIGINS.join(" ")}`,
  `img-src 'self' data:${R2_ORIGIN ? ` ${R2_ORIGIN}` : ""}`,
  // 'unsafe-inline' is required, not a residual: eleven call sites set a length
  // at runtime that no static stylesheet can express — the chart canvases size
  // themselves to a measured box, the virtualised lists pad to their overscan,
  // and every Skeleton must declare the height of the box it stands in for
  // (DESIGN.md:175). Without it the browser leaves the style attribute in the
  // DOM and refuses to parse it, so a skeleton renders at 0px, reserves
  // nothing, and the page grows the moment its query settles.
  "style-src 'self' 'unsafe-inline'",
  SCRIPT_SRC,
  "base-uri 'self'",
  "object-src 'none'",
  "frame-src 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
].join("; ");

const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: CSP },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), usb=(), payment=()" },
  // Prefetching a host the policy forbids connecting to is a wasted request and
  // a leak of the next route's intent, so the resolver is turned off entirely.
  { key: "X-DNS-Prefetch-Control", value: "off" },
];

// All three workspace packages are consumed as raw TypeScript source — none ships a
// dist — so Next must transpile them. No webpack config: Turbopack is the default
// in Next 16 and a webpack block would silently opt this app out of it.
const nextConfig: NextConfig = {
  transpilePackages: ["@peakpump/shared", "@peakpump/ui", "@peakpump/contracts-abi"],
  typedRoutes: true,
  // The image optimiser is never reached: TokenImage renders a plain <img> and an
  // inline SVG fallback. Leaving remotePatterns empty keeps it that way by
  // configuration as well as by convention.
  images: {
    remotePatterns: [],
  },
  async headers() {
    return [
      { source: "/:path*", headers: SECURITY_HEADERS },
      { source: "/brand/logo.png", headers: IMMUTABLE },
      { source: "/texture.svg", headers: IMMUTABLE },
      // The metadata-route icons are addressed by a hashed query, and the two
      // manifest renditions under public/brand are never edited in place.
      { source: "/icon.png", headers: IMMUTABLE },
      { source: "/apple-icon.png", headers: IMMUTABLE },
      { source: "/brand/icon-192.png", headers: IMMUTABLE },
      { source: "/brand/icon-512.png", headers: IMMUTABLE },
    ];
  },
};

export default nextConfig;
