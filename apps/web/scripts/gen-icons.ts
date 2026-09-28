import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

// Emits every icon this app ships from public/brand/icon.png and nothing else.
// The source is pinned to that one file, so no Arc or Circle mark can
// reach an icon, and every size below is a rendition of the same artwork rather
// than a drawing of it. Output is deterministic: same bytes in, same bytes out,
// so regeneration never shows up as a diff.

const here = dirname(fileURLToPath(import.meta.url));
const web = resolve(here, "..");
const sourcePath = resolve(web, "public", "brand", "icon.png");

// The page ground, so a transparent region of the figure reads as the product's
// own dark surface rather than as whatever backdrop the host composites it on.
const GROUND = "#0A0A0B";

// A maskable icon is cropped to a shape the launcher draws, so the artwork needs
// a margin or its edges get cut. 20 percent padding leaves the figure inside the
// central 60 percent of the square, which is the safe zone Android documents.
const MASKABLE_PADDING = 0.2;

type Target = {
  size: number;
  out: string;
  // A maskable rendition shrinks the artwork rather than the canvas.
  maskable?: boolean;
};

const TARGETS: readonly Target[] = [
  // The two App Router conventions. icon.png is the favicon and the manifest's
  // 512 entry; apple-icon.png is the touch icon iOS looks for.
  { size: 512, out: resolve(web, "app", "icon.png") },
  { size: 180, out: resolve(web, "app", "apple-icon.png") },
  // The browser tab icon. ICO has no sharp writer, so the PNG is wrapped below.
  { size: 32, out: resolve(web, "app", "favicon.ico") },
  // The manifest's 192 entry has no App Router convention of its own, so it
  // lives beside the logo it is made from and is served immutable like it.
  { size: 192, out: resolve(web, "public", "brand", "icon-192.png") },
  { size: 512, out: resolve(web, "public", "brand", "icon-512.png") },
  { size: 512, out: resolve(web, "public", "brand", "icon-512-maskable.png"), maskable: true },
];

// An ICO holding one PNG. Browsers read this as a Vista-style icon, and a single
// 32px entry is all a tab needs; a multi-resolution file would only duplicate
// the PNG bytes already shipped as app/icon.png.
function ico(png: Buffer, size: number): Buffer {
  const dir = 6; // ICONDIR: 2 reserved, 2 type, 2 count
  const entry = 16; // one ICONDIRENTRY
  const offset = dir; // the single image starts right after the directory
  const body = Buffer.alloc(dir + entry);
  body.writeUInt16LE(1, 4); // type 1 is an icon, not a cursor
  body.writeUInt16LE(1, 2); // one image
  // Width and height are single bytes, so 256 and above are stored as 0.
  body.writeUInt8(size >= 256 ? 0 : size, offset + 0);
  body.writeUInt8(size >= 256 ? 0 : size, offset + 1);
  body.writeUInt8(0, offset + 2); // colour count; 0 means 32bpp, so no palette
  body.writeUInt8(0, offset + 3); // reserved, always 0
  body.writeUInt16LE(1, offset + 4); // colour planes
  body.writeUInt16LE(32, offset + 6); // bits per pixel
  body.writeUInt32LE(png.length, offset + 8); // the PNG's byte length
  body.writeUInt32LE(dir + entry, offset + 12); // where that PNG begins
  return Buffer.concat([body, png]);
}

async function render(source: Buffer, target: Target): Promise<Buffer> {
  if (target.maskable) {
    const inner = Math.round(target.size * (1 - MASKABLE_PADDING));
    const offset = Math.round((target.size - inner) / 2);
    // The base is solid ground, not the artwork: compositing onto a
    // full-bleed copy would leave the unpadded figure showing in the margin,
    // and the padding would exist only where the two happened not to overlap.
    return sharp({
      create: {
        width: target.size,
        height: target.size,
        channels: 3,
        background: GROUND,
      },
    })
      .composite([
        {
          input: await sharp(source)
            .resize(inner, inner, { fit: "contain", background: GROUND })
            .flatten({ background: GROUND })
            .png()
            .toBuffer(),
          left: offset,
          top: offset,
        },
      ])
      .flatten({ background: GROUND })
      // Composite promotes the canvas to RGBA even though every pixel is
      // opaque; dropping the channel keeps this rendition byte-consistent
      // with the non-maskable ones.
      .removeAlpha()
      .png()
      .toBuffer();
  }

  const pipeline = sharp(source)
    .flatten({ background: GROUND })
    .resize(target.size, target.size, { fit: "contain", background: GROUND });

  if (target.out.endsWith(".ico")) {
    // The image decoder Next runs over app/favicon.ico requires the PNG inside
    // the container to be RGBA. An opaque RGB payload is a legal icon but it is
    // refused, so the channel flatten removed goes back in at full opacity.
    pipeline.ensureAlpha();
  }

  const png = await pipeline.png().toBuffer();

  return target.out.endsWith(".ico") ? ico(png, target.size) : png;
}

async function main(): Promise<void> {
  const source = await readFile(sourcePath);

  for (const target of TARGETS) {
    const buffer = await render(source, target);
    await mkdir(dirname(target.out), { recursive: true });
    await writeFile(target.out, buffer);
    process.stdout.write(
      `wrote ${target.out.slice(web.length + 1)} (${target.size}x${target.size}${
        target.maskable ? ", maskable" : ""
      }, ${buffer.length} bytes)\n`,
    );
  }
}

void main();
