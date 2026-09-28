# peakpump visual authority

This document is the only visual authority in the repository. A visual review
reads it and nothing else to decide whether a screen is correct. Every
value here is binding; where a component and this document disagree, this
document wins.

## Typefaces

Two families, no others. Text is set in a grotesk. Every number, in any
position, is set in the monospace so digits align in a column and do not reflow
as a value changes.

| Role | Family | Fallback stack |
| --- | --- | --- |
| Text | Space Grotesk | "Space Grotesk", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif |
| Numbers | JetBrains Mono | "JetBrains Mono", ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace |

Both families are self-hosted with next/font/local and subset to the Latin
range the product uses. Neither family is fetched from a third-party font host
at runtime. JetBrains Mono carries tabular figures and sets every price,
balance, percentage, supply figure, fee, block number and countdown; a number
never appears in the grotesk.

## Colour palette

The palette is sampled from apps/web/public/brand/icon.png and logo.png: the
near-black of the mark outline, the pale blue-grey of the fill, and the orange
of the accent. The surface is dark-first because the candlestick chart and the
orange accent read best on a dark ground. Values are given as CSS variable
names and values.

Surfaces and lines:

| Variable | Value | Use |
| --- | --- | --- |
| --pp-bg | #0A0A0B | page ground |
| --pp-surface | #131414 | cards, panels |
| --pp-surface-2 | #1F2022 | raised rows, inputs |
| --pp-hairline | #393B3E | 1px border |
| --pp-hairline-top | #585B5F | lighter top edge of the hairline |

Text:

| Variable | Value | Use |
| --- | --- | --- |
| --pp-text | #E3ECF6 | primary text |
| --pp-text-muted | #92989E | secondary text, labels |
| --pp-text-faint | #82878D | disabled, placeholder |

Brand accent, from the mark:

| Variable | Value | Use |
| --- | --- | --- |
| --pp-accent | #FF6F01 | primary action, brand mark |
| --pp-accent-bright | #FF8101 | hover, focus highlight |
| --pp-accent-deep | #CC5901 | pressed state |
| --pp-accent-contrast | #1A0C00 | text on an accent fill |

Trading semantics, from the candles:

| Variable | Value | Use |
| --- | --- | --- |
| --pp-up | #23AD5E | price up, buy, ASCENT progress |
| --pp-up-soft | #14371F | up background tint |
| --pp-down | #E65959 | price down, sell |
| --pp-down-soft | #3A1717 | down background tint |

Green means up and red means down everywhere. The accent orange is never used
to signal up or down.

## Radius, border, elevation

One corner radius for the whole system: --pp-radius is 10px. Every rounded
corner uses it. There is no second radius.

One border treatment: a 1px hairline in --pp-hairline whose top edge is one step
lighter, --pp-hairline-top. This top-lighter hairline is the only way an element
is separated from its ground or lifted above it.

There are no box shadows anywhere in the product. There is no backdrop-blur
anywhere in the product. Depth comes from the hairline and the two surface
steps, never from a shadow or a blur.

## Type scale

Exactly six sizes. No size outside this table exists.

| Step | Size | Line height | Weight | Letter spacing | Use |
| --- | --- | --- | --- | --- | --- |
| Display | 2.5rem (40px) | 1.15 | 700 | -0.02em | the single largest number on a screen |
| Title | 1.75rem (28px) | 1.15 | 600 | -0.02em | page title |
| Heading | 1.25rem (20px) | 1.3 | 600 | 0 | section heading |
| Body | 1rem (16px) | 1.5 | 450 | 0 | running text |
| Small | 0.8125rem (13px) | 1.4 | 500 | 0 | labels, table cells |
| Micro | 0.75rem (12px) | 1.4 | 500 | 0 | captions, legal, attribution |

Line height tightens as size grows: 1.5 for body, 1.4 for small and micro, and
1.15 to 1.25 for every step above 24px, because a large glyph's leading is
carried by its own ascenders and a loose one opens gaps a reader sees as
separate lines. Letter spacing closes by 0.02em on those same large steps for
the same reason, and opens by 0.04em on small uppercase labels and on chips,
where the extra air keeps a short capitals string from reading as a solid bar.

Weight is above the family's nominal regular on every step. Light text on a
dark ground loses apparent weight, and both families ship a wght axis that
admits it, so body copy sits at 450 rather than 400 and the steps above it at
600 and 700. Body stays lighter than the labels around it so the size steps
keep their hierarchy.

No text anywhere renders below 12px.

## Spacing scale

Exactly seven steps on a 4px base. No spacing value outside this table exists.

| Token | Value |
| --- | --- |
| --pp-space-1 | 4px |
| --pp-space-2 | 8px |
| --pp-space-3 | 12px |
| --pp-space-4 | 16px |
| --pp-space-5 | 24px |
| --pp-space-6 | 32px |
| --pp-space-7 | 48px |

## Motion

One motion token set: four durations and three easings, no others.

| Token | Value | Use |
| --- | --- | --- |
| --pp-dur-fast | 120ms | hover, focus, press, small state change |
| --pp-dur-slow | 240ms | a panel or row entering and leaving |
| --pp-dur-sheen | 520ms | one specular sweep across a control |
| --pp-dur-flash | 700ms | the decay of a value-change tint |

| Token | Value | Use |
| --- | --- | --- |
| --pp-ease-out | cubic-bezier(0.2, 0, 0, 1) | an element entering or settling |
| --pp-ease-in-out | cubic-bezier(0.4, 0, 0.2, 1) | an element moving between two states |
| --pp-ease-sheen | cubic-bezier(0.4, 0, 0.6, 1) | a specular sweep crossing a control |

Animation touches transform and opacity only. No animation changes width,
height, top, left, colour, background, background-position, filter or any other
property that triggers layout or repaints its own box. Every animation in this
product must be able to run entirely on the compositor.

Motion here is mechanical, not celebratory. It reads as light catching the lens
of the mark: a control acknowledges a press, an edge catches the light once, a
panel settles into place, a number confirms that it changed. Nothing bounces,
overshoots, springs, parallaxes, follows the cursor, loops for decoration or
draws attention to itself. The summit transition is the only celebratory
animation in the product. Ordinary buys, sells and page loads are quiet.

Exactly six motion primitives exist. Every animated element in the product is
one of these six, and an animation that is not one of them is a defect.

1. Press. On :active, transform: translateY(1px) scale(0.99) over
   --pp-dur-fast with --pp-ease-out, released on pointer-up. Every button, tab,
   clickable row and clickable card carries Press, and no other press
   treatment exists.
2. Lift. An inset overlay layer carrying the --pp-hairline-top edge and a
   radial bloom of --pp-accent at 12 percent maximum alpha, whose opacity moves
   from 0 to 1 over --pp-dur-fast with --pp-ease-out on hover and on
   :focus-visible. The bloom is a painted gradient confined to the element's
   own box and never extends past its border: it is not a box shadow and not a
   blur, and the no-shadow, no-blur rule in Radius, border, elevation stands
   unchanged. Lift is the only hover treatment in the product, and a border
   colour is never animated.
3. Sheen. A single band of --pp-accent-bright at 14 percent maximum alpha, one
   third of the control's width, clipped by the control, crossing it once with
   transform: translateX from -140 percent to 240 percent over --pp-dur-sheen
   with --pp-ease-sheen. Sheen fires on hover-enter of a primary action, once on
   first paint of the header mark, and as one composed part of the summit
   transition. It never loops, never fires on a destructive or a secondary
   control, and at most one Sheen runs on a screen at a time.
4. Rise. On mount, opacity 0 to 1 with transform: translateY(6px) to 0 over
   --pp-dur-slow with --pp-ease-out. The element occupies its final box before
   the animation begins, so nothing shifts and cumulative layout shift stays at
   zero. At most three siblings stagger, 40ms apart; a fourth and later sibling
   appears with no delay. Rise runs once per mount, never on scroll, and never
   inside a virtualised list whose rows are recycled.
5. Flash. When a live number changes, a tint layer behind the digits at
   --pp-up-soft or --pp-down-soft moves from 0.35 opacity to 0 over
   --pp-dur-flash with --pp-ease-out. The digits themselves never move, never
   roll, never count and never blur. The true value is on screen in the same
   frame it arrives, and no intermediate value is ever displayed, because an
   intermediate number is a price that was never real.
6. Shimmer. Skeletons only: a band crossing a fixed-size box with transform:
   translateX, 1200ms, linear, looping until content arrives and stopping on the
   first frame that it does. The box declares its final width and height.

Under @media (prefers-reduced-motion: reduce), Press keeps the 1px translate and
drops the scale, Lift becomes an instant state with no transition, and Sheen,
Rise, Flash and Shimmer do not run at all: a skeleton renders as a still
--pp-surface-2 block and a changed number simply changes.

No animation library ships in this product. Framer Motion, Motion, GSAP, Lottie,
Rive, react-spring and every equivalent are forbidden, as is any animated SVG,
animated gradient background, decorative canvas and decorative video. The six
primitives are implemented once in CSS and add no runtime JavaScript beyond the
single hook that detects a value change for Flash. Total added first-load
JavaScript for motion stays under 1 kB gzipped and the route budgets in the
Performance section are unchanged by it.

A transform is never applied to an ancestor of the sticky mobile trade bar, of a
sheet, of a dialog or of any portalled layer, because a transformed ancestor
creates a new containing block and breaks fixed and sticky positioning. A
control that clips its own content carries its focus ring outside the clipped
layer, so a ring is never cut off. Every overlay layer used by Lift, Sheen or
Flash is pointer-events: none and aria-hidden. will-change appears only on an
element while it is actually being interacted with, and never in a base class.

Where any other document in this repository describes motion differently, this
section wins.

## Layout

The token page is a three-column layout at 280 / fluid / 360: a 280px left
column, a fluid centre that takes the remaining width, and a 360px right column.
Below the layout breakpoint the three columns stack in that order.

The home page is a horizontal rail above a dense table. The rail runs across the
top and the table fills the page below it. The home page is never a grid of
equal cards.

## Responsive

A responsive section, which is not optional and which the visual review enforces:
three breakpoints only, named sm (up to 767), md (768 to 1279) and lg (1280
and up), and no fourth. Mobile first: every component is written for sm and
widened, never written wide and squeezed. The token page collapses from
280 / fluid / 360 to a single column at sm, in this stacking order: token
identity, then the trade panel, then the chart, then progress to summit, then
trades, then holders, then comments. The trade panel is above the chart on
mobile and never below it, because trading is the purpose of the page and a
chart is decoration. At sm the trade panel is a sticky bottom bar showing the
live price and one primary control that opens the full panel as a sheet; the
sheet never covers the number the user is about to act on. The home page rail
becomes a horizontally scrollable strip with snap points and a visible edge
fade, and the dense table drops to the three columns that matter, name, price
and progress, with the rest reachable by opening the row. Tables never scroll
horizontally at sm: a row becomes a stacked block instead. Every interactive
target is at least 44 by 44 CSS pixels with at least 8 pixels between
neighbours. Text never goes below the second step of the type scale on mobile
and numbers never below the third. Respect the safe area insets so a sticky bar
clears the home indicator, and set the viewport so the page cannot zoom-jump on
input focus while remaining pinch-zoomable. Test every page at 360 by 640, at
390 by 844, at 768 by 1024 and at 1440 by 900, in both orientations for the two
phone sizes. Nothing may be reachable only by hover: every hover affordance has
a tap equivalent.

## Performance

Every skeleton, image and dynamically imported block declares fixed width and
height before it loads, so no element shifts as content arrives and cumulative
layout shift stays at zero.

A live number lives in the smallest client component that can render it. The
rest of the page around it stays static, so a changing number never re-renders a
section it does not belong to.

Long lists are virtualised. The dense home table and any trade history render
only the rows currently in view.

The token route's first-load JavaScript stays under 250 kB gzipped, and its
largest contentful paint stays under 2.5 seconds on a throttled connection.

No performance measure may cache, stale-serve or locally recompute a number a
user could trade on. Prices, quotes, balances and fees that a trade depends on
always come fresh from a contract quote at the moment of the trade. Caching,
memoisation and precomputation are allowed only for values no one can trade on.

## Copy

Sentences are short and declarative, verb first, and state real numbers rather
than adjectives. There are no exclamation marks. There are no emoji in any
string.

These words never appear in product copy: seamlessly, effortlessly, unlock,
leverage, robust, elevate, game-changing, revolutionary, dive in, let's, we're
excited.

The word Arc is never written as a possessive or a plural. Circle brand policy
forbids both forms. Write "the Arc network" or "USDC on Arc".

The product is named peakpump everywhere, lower case. No legacy project name and
no fire-themed vocabulary appears in any string: kindling, blazing, flashpoint,
ember, blaze, inferno, bondfire and BondToken are banned in copy as they are in
code.

## Attribution

This block appears in the footer on every page, set in the Micro size, as
three blocks in this order. The exact wording is fixed elsewhere and
this document does not restate it differently.

1. "Arc is a trademark of Circle Internet Group, Inc. peakpump is an
   independent project, not affiliated with, endorsed by, or sponsored by
   Circle."
2. "Testnet only. Tokens and balances shown here have no monetary value.
   Nothing here is an offer, a solicitation, or financial advice."
3. The TradingView attribution required by the lightweight-charts NOTICE
   file, transcribed verbatim from node_modules/lightweight-charts/NOTICE at
   the installed version, with the visible clickable link that file
   requires. It is never paraphrased and never copied from any document,
   including this one.

## Worked copy examples

Each pair shows a generic version and the version this product uses instead.

Announcing the launch.
Generic: "We're excited to launch peakpump. Dive in and unlock seamless
trading!"
This product: "peakpump is live. Create a token or trade one on the curve."

A token reaching the Summit.
Generic: "Congratulations, the token has graduated to a robust new phase!"
This product: "GOAT reached the Summit at 14:02. Trading continues in PEAK."

Describing the curve on a marketing surface.
Generic: "Leverage our revolutionary, game-changing bonding curve to
effortlessly elevate your gains."
This product: "Price rises as supply sells. 42.1 percent of supply has sold."
