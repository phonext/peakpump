import { FOOTER_TESTNET, FOOTER_TRADEMARK } from "@peakpump/shared/brand";
import { Panel } from "@peakpump/ui/Panel";
import type { Metadata } from "next";
import { Attribution } from "@/components/layout/Attribution";

export const metadata: Metadata = { title: "Brand" };

export default function BrandPage() {
  return (
    <div className="flex max-w-[720px] flex-col gap-6">
      <h1 className="text-title font-medium text-pp-text">Brand and attribution</h1>

      <Panel as="section" title="Trademark">
        <div className="flex flex-col gap-3 text-body text-pp-text-muted">
          {/* The line itself comes from the constant, so the page and the footer of
              every page carry the same characters. */}
          <p>{FOOTER_TRADEMARK}</p>
          <p>
            The word Arc is written here as a bare proper noun and nothing else. It is never
            possessive and never plural, and the phrases used instead are the Arc network and
            USDC on Arc.
          </p>
          <p>
            No Circle mark is reproduced anywhere in this product. The name appears as plain
            text, and it is not used as the favicon, the app icon or an avatar.
          </p>
        </div>
      </Panel>

      <Panel as="section" title="Chart attribution">
        <div className="flex flex-col gap-3 text-body text-pp-text-muted">
          <p>
            The price chart is drawn with lightweight-charts. The notice below is transcribed
            from the NOTICE file of the installed version at build time, with the link that
            file requires.
          </p>
          <Attribution className="text-small text-pp-text-muted" />
        </div>
      </Panel>

      <Panel as="section" title="Palette provenance">
        <div className="flex flex-col gap-4">
          {/* A plain img at the size it is displayed. next/image is not used anywhere in
              this product, and this file is not the favicon: the app icons are renditions
              of this same logo.png, composed by scripts/gen-icons.ts at its fixed sizes. */}
          <img
            src="/brand/logo.png"
            alt="The peakpump mark: a pale blue-grey fill on a near-black outline, with an orange accent."
            width={256}
            height={256}
            className="hairline rounded-pp"
          />
          <div className="flex flex-col gap-3 text-body text-pp-text-muted">
            <p>
              The palette is sampled from this image: the near-black outline, the pale
              blue-grey fill, and the orange accent.
            </p>
            <p>
              It is the provenance of the colours and nothing more. It is never an icon, never
              an avatar, and never a token image.
            </p>
          </div>
        </div>
      </Panel>

      <Panel as="section" title="Testnet">
        <p className="text-body text-pp-text-muted">{FOOTER_TESTNET}</p>
      </Panel>
    </div>
  );
}
