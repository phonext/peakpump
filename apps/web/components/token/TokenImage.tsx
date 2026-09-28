"use client";

import { useState } from "react";
import { hashAddress } from "@/lib/hash";

// Three sizes, because those are the three places an image appears: a table row, a
// token page and the brand sample. A free number would mean a fourth layout nobody
// designed.
export type TokenImageSize = 64 | 256 | 512;

export interface TokenImageProps {
  // The curve address, which is what the identicon is derived from. Two tokens with
  // the same name still draw differently.
  address: string;
  src?: string;
  alt: string;
  size?: TokenImageSize;
  className?: string;
}

// Ground then ink, both from globals.css tokens. A standalone .svg file cannot read a
// custom property, but this markup is in the document, so the tokens resolve here and
// no hex literal is repeated.
const PALETTE = [
  ["var(--pp-accent)", "var(--pp-accent-deep)"],
  ["var(--pp-accent-bright)", "var(--pp-accent)"],
  ["var(--pp-up)", "var(--pp-up-soft)"],
  ["var(--pp-down)", "var(--pp-down-soft)"],
  ["var(--pp-surface-2)", "var(--pp-accent)"],
  ["var(--pp-hairline-top)", "var(--pp-accent-bright)"],
] as const;

const GRID = 4;

interface IdenticonProps {
  address: string;
  alt: string;
  size: TokenImageSize;
  className?: string;
}

function Identicon({ address, alt, size, className }: IdenticonProps) {
  const hash = hashAddress(address);
  // The fallback satisfies noUncheckedIndexedAccess; a modulo cannot leave the array.
  const [ground, ink] = PALETTE[hash % PALETTE.length] ?? PALETTE[0];
  // Eight bits fill the left two columns and mirror into the right two, which is what
  // makes the result read as a figure rather than as noise.
  const bits = (hash >>> 8) & 0xff;

  const cells: number[] = [];
  for (let index = 0; index < GRID * GRID; index += 1) cells.push(index);

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${GRID} ${GRID}`}
      role="img"
      aria-label={alt}
      // The cells are whole units on a 4-unit grid, so a scaled-up edge stays an edge
      // instead of a half-pixel blur.
      shapeRendering="crispEdges"
      className={className}
    >
      <rect width={GRID} height={GRID} fill={ground} />
      {cells.map((index) => {
        const row = Math.floor(index / GRID);
        const column = index % GRID;
        const bit = row * 2 + (column < 2 ? column : GRID - 1 - column);
        return ((bits >>> bit) & 1) === 0 ? null : (
          <rect key={index} x={column} y={row} width={1} height={1} fill={ink} />
        );
      })}
    </svg>
  );
}

// A plain img, never next/image: the transformation budget stays untouched and
// next.config.ts keeps remotePatterns empty, so no creator-supplied host is trusted.
// width and height are always set, so the box exists before the bytes arrive.
export function TokenImage({ address, src, alt, size = 64, className }: TokenImageProps) {
  const [failed, setFailed] = useState(false);

  if (src === undefined || failed) {
    return <Identicon address={address} alt={alt} size={size} className={className} />;
  }

  return (
    <img
      src={src}
      alt={alt}
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      // A failed load falls through to the identicon, so the broken-image glyph the
      // browser would otherwise draw is unreachable.
      onError={() => setFailed(true)}
      className={className}
    />
  );
}
