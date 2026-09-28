import { PRODUCT_NAME } from "@peakpump/shared/brand";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";
import { Onboarding } from "@/components/layout/Onboarding";
import { Providers } from "./providers";
import { jetbrainsMono, spaceGrotesk } from "./fonts";
import "./globals.css";

export const metadata: Metadata = {
  // A template rather than one string, so a page sets only its own half.
  title: { default: PRODUCT_NAME, template: `%s · ${PRODUCT_NAME}` },
  description:
    "Token launches on a fixed bonding curve, on Arc Testnet. A market climbs through " +
    "ASCENT to the Summit, then trades in PEAK.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Without cover, env(safe-area-inset-*) is zero on every device and the two places
  // that read it — the toast and the dialog sheet — reserve nothing, so DESIGN.md's
  // "respect the safe area insets" is unreachable by any amount of CSS.
  viewportFit: "cover",
  // No maximumScale and no userScalable: DESIGN.md requires the page to stay
  // pinch-zoomable, and either of those takes that away. The zoom-jump on input focus
  // is prevented by the type scale instead, since every input in the product sits at
  // the Body step, 16px, which is the size iOS stops scaling a focused field at.
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${spaceGrotesk.variable} ${jetbrainsMono.variable}`}>
      <body>
        {/* Fixed, inert and first in the document, so the content that follows paints
            over it without either one needing a z-index. */}
        <div className="pp-texture" aria-hidden="true" />
        <Providers>
          {/* The horizontal insets are the other half of viewportFit cover: in landscape
              on a notched phone the notch eats a 44px strip that the chrome's own px-4
              cannot clear. Both resolve to zero everywhere else, so this changes no
              other device. */}
          <div className="relative flex min-h-dvh flex-col pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]">
            <Header />
            <main className="mx-auto w-full max-w-[1280px] flex-1 px-4 py-6">{children}</main>
            <Footer />
          </div>
          <Onboarding />
        </Providers>
      </body>
    </html>
  );
}
