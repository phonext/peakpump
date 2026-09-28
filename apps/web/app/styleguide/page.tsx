import { formatPercent } from "@peakpump/shared/format";
import { Button } from "@peakpump/ui/Button";
import type { ButtonSize, ButtonVariant } from "@peakpump/ui/Button";
import { Chip } from "@peakpump/ui/Chip";
import type { ChipTone } from "@peakpump/ui/Chip";
import { EmptyState } from "@peakpump/ui/EmptyState";
import { Panel } from "@peakpump/ui/Panel";
import { ProgressAscent } from "@peakpump/ui/ProgressAscent";
import { Skeleton } from "@peakpump/ui/Skeleton";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { DialogDemo, FlashDemo, RiseDemo, TabsDemo, ToastDemo, TooltipDemo } from "./Demos";

// A development surface, so it carries a noindex rather than relying on a robots
// file to keep it out of an index.
export const metadata: Metadata = {
  title: "Styleguide",
  robots: { index: false, follow: false },
};

// Read by name through an inline style, which is why globals.css declares the
// theme with @theme static: a token no utility referenced would otherwise never
// reach :root and every swatch below would be empty.
const COLOUR_TOKENS = [
  "--pp-bg",
  "--pp-surface",
  "--pp-surface-2",
  "--pp-hairline",
  "--pp-hairline-top",
  "--pp-text",
  "--pp-text-muted",
  "--pp-text-faint",
  "--pp-accent",
  "--pp-accent-bright",
  "--pp-accent-deep",
  "--pp-accent-contrast",
  "--pp-up",
  "--pp-up-soft",
  "--pp-down",
  "--pp-down-soft",
] as const;

const TYPE_STEPS = [
  { name: "Display", className: "text-display" },
  { name: "Title", className: "text-title" },
  { name: "Heading", className: "text-heading" },
  { name: "Body", className: "text-body" },
  { name: "Small", className: "text-small" },
  { name: "Micro", className: "text-micro" },
] as const;

const SPACE_TOKENS = [
  "--pp-space-1",
  "--pp-space-2",
  "--pp-space-3",
  "--pp-space-4",
  "--pp-space-5",
  "--pp-space-6",
  "--pp-space-7",
] as const;

const BUTTON_VARIANTS: readonly ButtonVariant[] = ["primary", "secondary", "destructive", "ghost"];
const BUTTON_SIZES: readonly ButtonSize[] = ["sm", "md"];
const CHIP_TONES: readonly ChipTone[] = ["neutral", "up", "down", "accent"];

// Styleguide literals, not chain values: a specimen bar needs a number and no
// contract is being read here.
const ASCENT_DEMOS = [0n, 3_333n, 10_000n] as const;

// Every primitive, with the tokens motion.css actually uses for it. Shimmer is the
// one entry with no token to name: DESIGN.md states its 1200ms and its linear
// timing as literals, so the file does too and this row says so rather than
// inventing a token name for them.
const PRIMITIVES = [
  {
    name: "Press",
    duration: "--pp-dur-fast",
    easing: "--pp-ease-out",
    note: "Every control. A 1px translate and a 0.99 scale while the pointer is down.",
  },
  {
    name: "Lift",
    duration: "--pp-dur-fast",
    easing: "--pp-ease-out",
    note: "Hover and focus-visible on an interactive panel. A painted gradient, never a shadow.",
  },
  {
    name: "Sheen",
    duration: "--pp-dur-sheen",
    easing: "--pp-ease-sheen",
    note: "Hover-enter of a primary action, and once on first paint of the header mark.",
  },
  {
    name: "Rise",
    duration: "--pp-dur-slow",
    easing: "--pp-ease-out",
    note: "Dialogs, toasts and arriving rows. Opacity and a 6px translate, staggered to the third sibling.",
  },
  {
    name: "Flash",
    duration: "--pp-dur-flash",
    easing: "--pp-ease-out",
    note: "A number that changed. The digits never move; the tint decays behind them.",
  },
  {
    name: "Shimmer",
    duration: "1200ms, written as a literal",
    easing: "linear, written as a literal",
    note: "Skeletons only, and the one animation in the product that loops.",
  },
] as const;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-heading font-medium text-pp-text">{title}</h2>
      {children}
    </section>
  );
}

function Specimen({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="mono text-small text-pp-text-faint">{label}</p>
      {children}
    </div>
  );
}
// Each primitive on the component it actually ships on, so the row is a
// demonstration rather than an illustration of one.
const PRIMITIVE_DEMOS: Record<(typeof PRIMITIVES)[number]["name"], ReactNode> = {
  Press: <Button>Press and hold</Button>,
  Lift: (
    <Panel interactive title="Interactive panel">
      <p className="text-small text-pp-text-muted">Hover it, or move focus to it.</p>
    </Panel>
  ),
  Sheen: <Button variant="primary">Hover this</Button>,
  Rise: <RiseDemo />,
  Flash: <FlashDemo />,
  Shimmer: <Skeleton width="100%" height={16} />,
};

export default function StyleguidePage() {
  return (
    <div className="flex flex-col gap-7">
      <div className="flex flex-col gap-2">
        <h1 className="text-title font-medium text-pp-text">Styleguide</h1>
        <p className="text-small text-pp-text-muted">
          Every component in every variant, and every motion primitive. This page is not indexed.
        </p>
      </div>

      <Section title="Colour">
        <ul className="flex flex-col gap-2 md:grid md:grid-cols-4">
          {COLOUR_TOKENS.map((token) => (
            <li key={token} className="hairline rounded-pp flex items-center gap-3 p-2">
              <span
                aria-hidden="true"
                className="hairline rounded-pp block h-6 w-6 shrink-0"
                style={{ backgroundColor: `var(${token})` }}
              />
              <span className="mono text-small text-pp-text-muted">{token}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Type">
        <div className="flex flex-col gap-4">
          {TYPE_STEPS.map((step) => (
            <div key={step.name} className="flex flex-col gap-1">
              <p className="mono text-small text-pp-text-faint">{step.name}</p>
              {/* A specimen renders at its own step or it is not a specimen. The
                  mobile floor the document sets governs product surfaces, not this row. */}
              <p className={`${step.className} text-pp-text`}>Progress to the Summit</p>
            </div>
          ))}
          <div className="flex flex-col gap-1">
            <p className="mono text-small text-pp-text-faint">Mono, tabular</p>
            <p className="mono text-body text-pp-text">1,234.567890</p>
          </div>
        </div>
      </Section>

      <Section title="Spacing">
        <div className="flex flex-col gap-2">
          {SPACE_TOKENS.map((token) => (
            <div key={token} className="flex items-center gap-3">
              <span
                aria-hidden="true"
                className="bg-pp-accent block h-2"
                style={{ width: `var(${token})` }}
              />
              <span className="mono text-small text-pp-text-muted">{token}</span>
            </div>
          ))}
        </div>
      </Section>
      <Section title="Button">
        <div className="flex flex-col gap-4">
          {BUTTON_VARIANTS.map((variant) => (
            <Specimen key={variant} label={variant}>
              <div className="flex flex-wrap items-center gap-2">
                {BUTTON_SIZES.map((size) => (
                  <Button key={size} variant={variant} size={size}>
                    {size === "sm" ? "Small" : "Medium"}
                  </Button>
                ))}
                <Button variant={variant} disabled>
                  Disabled
                </Button>
              </div>
            </Specimen>
          ))}
        </div>
      </Section>

      <Section title="Chip">
        <div className="flex flex-wrap items-center gap-2">
          {CHIP_TONES.map((tone) => (
            <Chip key={tone} tone={tone}>
              {tone}
            </Chip>
          ))}
        </div>
      </Section>

      <Section title="Panel">
        <div className="flex flex-col gap-4 md:grid md:grid-cols-2 md:items-start">
          <Specimen label="No header">
            <Panel>
              <p className="text-small text-pp-text-muted">A panel with no title and no action.</p>
            </Panel>
          </Specimen>
          <Specimen label="Title">
            <Panel title="Holders">
              <p className="text-small text-pp-text-muted">A title alone renders the header.</p>
            </Panel>
          </Specimen>
          <Specimen label="Title and action">
            <Panel title="Trades" action={<Chip tone="up">Live</Chip>}>
              <p className="text-small text-pp-text-muted">The action sits opposite the title.</p>
            </Panel>
          </Specimen>
          <Specimen label="Interactive">
            <Panel title="Near the Summit" interactive>
              <p className="text-small text-pp-text-muted">Press and Lift, both on the box.</p>
            </Panel>
          </Specimen>
        </div>
      </Section>
      <Section title="EmptyState">
        <div className="flex flex-col gap-4 md:grid md:grid-cols-3 md:items-start">
          <Specimen label="Title">
            <EmptyState title="No trades yet" />
          </Specimen>
          <Specimen label="Title and detail">
            <EmptyState title="No holders yet" detail="Balances are read from the token contract." />
          </Specimen>
          <Specimen label="With an action">
            <EmptyState
              title="No markets yet"
              detail="Nothing has been created on this deployment."
              action={<Button variant="primary">Create a token</Button>}
            />
          </Specimen>
        </div>
      </Section>

      <Section title="ProgressAscent">
        <div className="flex flex-col gap-3">
          {ASCENT_DEMOS.map((bps) => (
            <ProgressAscent key={bps.toString()} bps={Number(bps)} valueText={formatPercent(bps)} />
          ))}
        </div>
      </Section>

      <Section title="Skeleton">
        <div className="flex flex-col gap-4">
          <Specimen label="Rounded, the default">
            <div className="flex flex-col gap-2">
              <Skeleton width={160} height={20} />
              <Skeleton width={96} height={16} />
            </div>
          </Specimen>
          <Specimen label="Square, for a chart or a full-bleed image">
            <Skeleton width="100%" height={120} radius={false} />
          </Specimen>
          <Specimen label="A card slot, at the width the real card takes">
            <Skeleton width={240} height={132} />
          </Specimen>
        </div>
      </Section>

      <Section title="Tabs">
        <TabsDemo />
      </Section>

      <Section title="Dialog">
        <DialogDemo />
      </Section>

      <Section title="Toast">
        <ToastDemo />
      </Section>

      <Section title="Tooltip">
        <TooltipDemo />
      </Section>
      <Section title="Motion">
        <p className="text-small text-pp-text-muted">
          Six primitives, each on the component it ships on, with the token that sets its
          duration and the token that sets its easing. Nothing else animates anywhere in the
          product, and transform and opacity are the only properties any of them touch.
        </p>
        <div className="flex flex-col gap-4">
          {PRIMITIVES.map((primitive) => (
            <div key={primitive.name} className="hairline rounded-pp flex flex-col gap-3 p-4">
              <div className="flex flex-col gap-1">
                <p className="text-body font-medium text-pp-text">{primitive.name}</p>
                <p className="mono text-small text-pp-text-faint">
                  {primitive.duration} · {primitive.easing}
                </p>
                <p className="text-small text-pp-text-muted">{primitive.note}</p>
              </div>
              {PRIMITIVE_DEMOS[primitive.name]}
            </div>
          ))}
        </div>
        <p className="text-small text-pp-text-muted">
          Under a reduced-motion preference, Press keeps its translate and drops its scale, Lift
          becomes an instant state, and Sheen, Rise, Flash and Shimmer do not run at all.
        </p>
      </Section>
    </div>
  );
}
