"use client";

import Link from "next/link";

// The only error level the app was missing. Each of the six page routes
// carries its own error.tsx and the root error.tsx catches everything thrown
// beneath the layout, but neither covers the root layout itself: this file is
// what a visitor sees when that layout fails to render, which is why it emits
// its own document instead of inheriting one. No boundary is added to the
// app/token and app/profile segment directories — neither has a page or layout
// of its own, so a boundary there would wrap nothing.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <head>
        {/* globals.css and the font variables are not on the page here, so the
            tokens are restated by the linked stylesheet. */}
        <link rel="stylesheet" href="/global-error.css" />
      </head>
      <body>
        <div className="panel">
          <h1>The page did not load</h1>
          <p>
            Its frame failed to render and nothing on it was read or written. Reloading
            builds it again.
          </p>
          <button onClick={reset}>Reload</button>
          {error.digest === undefined ? null : (
            <p className="digest">{error.digest}</p>
          )}
          <p className="digest">
            <Link href="/">Back to the market list</Link>
          </p>
        </div>
      </body>
    </html>
  );
}
