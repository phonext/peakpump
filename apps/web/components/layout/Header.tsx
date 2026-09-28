import { PRODUCT_NAME } from "@peakpump/shared/brand";
import { Chip } from "@peakpump/ui/Chip";
import Link from "next/link";
import { CommandPalette } from "@/components/layout/CommandPalette";
import { ConnectWallet } from "@/components/wallet/ConnectWallet";
import { WrongChain } from "@/components/wallet/WrongChain";

// A server component, so the only JavaScript the header ships is the two islands it
// renders. The mark, the wordmark and the chip are static markup.
export function Header() {
  return (
    <header className="border-b border-pp-hairline">
      {/* py-1 rather than the py-3 the rest of the chrome uses, because the mark is
          now the tallest thing in this row: 4 + 60 + 4 is the same 68px that 12 + a
          44px tap target + 12 produced when the mark was 32px, and wrapped at sm
          4 + 60 + 12 + 44 + 4 is the same 124px. The two numbers are coupled, so
          changing either the padding or the mark alone moves the header height. */}
      <div className="mx-auto flex max-w-[1280px] flex-wrap items-center justify-between gap-3 px-4 py-1">
        <Link
          href="/"
          className="pp-press relative inline-flex min-h-[44px] items-center gap-2 rounded-pp px-1 outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pp-accent-bright"
        >
          {/* The brand logo itself, not a drawn stand-in. A plain img rather than
              next/image, so the Vercel transformation budget stays untouched and
              remotePatterns stays empty. The attributes reserve the box before the
              bytes arrive; the classes are what actually sizes it, and the two have
              to stay equal. A length rather than a step, because 60px is not one of
              the seven the theme declares and the step-15 class would compile to
              nothing, which is the whole failure mode this row just came out of. */}
          <img
            src="/brand/logo.png"
            alt=""
            width="60"
            height="60"
            aria-hidden="true"
            className="block h-[60px] w-[60px] object-contain"
          />
          <span className="text-heading font-medium text-pp-text">{PRODUCT_NAME}</span>
          {/* DESIGN.md fires Sheen once on first paint of the header mark. The span is
              the whole clipped layer and is inert, so it neither takes a pointer nor
              reaches the accessibility tree. */}
          <span className="pp-sheen-once" aria-hidden="true" />
        </Link>

        <div className="flex flex-wrap items-center gap-3">
          <Chip tone="accent">Arc Testnet — test tokens only</Chip>
          <CommandPalette />
          {/* Third island: renders nothing unless a connected wallet sits on
              another chain, so the header's height is unchanged for everyone
              else. */}
          <WrongChain />
          <ConnectWallet />
        </div>
      </div>
    </header>
  );
}
