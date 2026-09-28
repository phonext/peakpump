import { formatAddress } from "@peakpump/shared/format";
import { Skeleton } from "@peakpump/ui/Skeleton";
import type { Address } from "viem";
import { addressUrl } from "@/lib/explorer";

// Three panels print an address and all three want the same three states: the read has
// not landed, there is no explorer to link to, or there is. No "use client" — the page
// renders it on the server, and the two islands that use it carry it into their own
// bundle.
//
// A block box at the 44px DESIGN.md requires of a target, rather than the inline padding
// components/layout/Attribution.tsx uses inside a sentence: an address sits on its own
// line here, so the height can be exact and the skeleton can reserve it exactly.
const BOX = "flex min-h-[44px] items-center";
const FIGURE = "mono text-body text-pp-text-muted break-all md:text-small";

export function AddressLink({ label, address }: { label: string; address?: Address }) {
  const href = address === undefined ? undefined : addressUrl(address);

  return (
    <div className="flex flex-col gap-1">
      <p className="text-small text-pp-text-muted">{label}</p>
      {address === undefined ? (
        <span className={BOX}>
          <Skeleton width={110} height={20} />
        </span>
      ) : href === undefined ? (
        <p className={`${BOX} ${FIGURE}`}>{formatAddress(address)}</p>
      ) : (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className={`${BOX} ${FIGURE} rounded-pp underline underline-offset-2 outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pp-accent-bright`}
        >
          {formatAddress(address)}
        </a>
      )}
    </div>
  );
}
