import { formatAddress } from "@peakpump/shared/format";
import type { Address } from "viem";
import { addressUrl } from "@/lib/explorer";

// The inline counterpart of components/token/AddressLink.tsx. That one is a labelled
// block a panel reserves space for; this one is an address that already sits inside a
// line of figures and must not disturb it. Callers pass the class string their span
// already carried, so the anchor inherits the line's tone and type step rather than
// restating them, and components/token/TradesList.tsx and HoldersList.tsx keep the
// fixed row heights their arithmetic virtualiser depends on.
//
// py-4 is the trick components/trade/TradeStatus.tsx uses: vertical padding on an
// inline box does not enter the line box, so the target grows toward the 44px
// DESIGN.md asks of it without moving the line it is in.
const ANCHOR =
  "rounded-pp py-4 underline underline-offset-2 outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pp-accent-bright";

export function InlineAddressLink({
  address,
  className,
}: {
  address: Address;
  className: string;
}) {
  const url = addressUrl(address);

  return (
    <span className={className}>
      {url === undefined ? (
        formatAddress(address)
      ) : (
        <a href={url} target="_blank" rel="noreferrer" className={ANCHOR}>
          {formatAddress(address)}
        </a>
      )}
    </span>
  );
}
