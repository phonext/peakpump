import { FOOTER_ATTRIBUTION, FOOTER_BLOCKS } from "@peakpump/shared/brand";
import { Attribution } from "./Attribution";

// Server component. The three blocks come from the array in the order the document
// fixes, at the Micro step the Attribution section specifies, on every page. The
// identity check is on the constant rather than on an index, so reordering the array
// upstream cannot silently turn the notice into a paragraph of plain text.
export function Footer() {
  return (
    <footer className="border-t border-pp-hairline">
      <div className="mx-auto flex max-w-[1280px] flex-col gap-3 px-4 py-6 text-micro text-pp-text-muted">
        {FOOTER_BLOCKS.map((block) =>
          block === FOOTER_ATTRIBUTION ? <Attribution key={block} /> : <p key={block}>{block}</p>,
        )}
      </div>
    </footer>
  );
}
