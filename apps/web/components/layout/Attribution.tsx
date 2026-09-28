import { FOOTER_ATTRIBUTION, TRADINGVIEW_ATTRIBUTION_URL } from "@peakpump/shared/brand";

import { splitAtYear } from "./attribution-year";

export interface AttributionProps {
  className?: string;
}

// Split at the URL the NOTICE requires, so both halves of the visible text are slices
// of the generated constant rather than prose retyped here, and the link's label is
// the URL itself. whitespace-pre-line keeps the internal and trailing newlines that
// are part of that file's text: the notice is never trimmed, reflowed or paraphrased.
// One component, used by the footer and by /brand, because two copies of this split
// would be two chances to reflow it. The year split is in the module beside this file
// for the reason that file gives.

export function Attribution({ className }: AttributionProps) {
  const [before = "", after = ""] = FOOTER_ATTRIBUTION.split(TRADINGVIEW_ATTRIBUTION_URL);
  const year = splitAtYear(before);

  return (
    <p className={className === undefined ? "whitespace-pre-line" : `whitespace-pre-line ${className}`}>
      {year === null ? (
        before
      ) : (
        <>
          {year.head}
          <span className="mono">{year.year}</span>
          {year.tail}
        </>
      )}
      <a
        href={TRADINGVIEW_ATTRIBUTION_URL}
        target="_blank"
        rel="noreferrer"
        // The 44px minimum applies to the target, and vertical padding on an inline box
        // grows the hit area without entering the line box: at the Micro step the line
        // is 14.3px, so 16px either side clears 44 while the notice keeps the exact
        // wrapping the generated text arrived with. An inline-block or a min-height
        // would reflow it instead, and this is the one string in the product that may
        // not be reflowed. It is the only interactive thing in the footer, so the
        // 8px-between-neighbours half of the rule has nothing to violate.
        className="rounded-pp py-4 text-pp-text underline underline-offset-2 outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pp-accent-bright"
      >
        {TRADINGVIEW_ATTRIBUTION_URL}
      </a>
      {after}
    </p>
  );
}
