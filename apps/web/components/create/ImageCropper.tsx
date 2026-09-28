"use client";

import { Button } from "@peakpump/ui/Button";
import { type ChangeEvent, type Dispatch, type PointerEvent, useEffect, useId, useRef, useState } from "react";
import {
  CLIENT_MAX_IMAGE_BYTES,
  imageRejectReason,
  sniffImageType,
  UNDECODABLE_MESSAGE,
  type ImageType,
} from "@/lib/create-image";
import { type CreateAction, type CroppedImage } from "@/lib/create-state";
import { sha256Hex } from "@/lib/sha256";

// The flow's one pipelined control: pick, gate (size, format, SVG lookalike),
// decode, position a square by pointer, export the square, commit. Every gate
// before the export belongs to lib/create-image.ts, which the upload pipeline
// shares, so a file refused here is refused there too. The export re-gates its
// own output because an encoder can answer a WebP request with PNG or with
// bytes over the cap a source file passed. In this phase the bytes stop at the
// reducer — nothing leaves the tab.

const LABEL = "text-small font-medium text-pp-text";

// A label styled as Button's secondary size-sm, because the picker is a button
// in every way except that it has to open a file dialog. The hidden input
// carries the focus: focus-within puts the ring on the label, where the eye
// already is, because an sr-only input's own outline is clipped away.
const PICK =
  "pp-press pp-lift relative inline-flex min-h-[44px] min-w-[44px] cursor-pointer items-center justify-center gap-2 rounded-pp border border-pp-hairline bg-pp-surface-2 px-3 font-sans text-small text-pp-text outline-none focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-pp-accent-bright";

// DESIGN.md's accent token, written as a hex because a canvas stroke cannot
// take a class. The value is the token table's own.
const CROP_STROKE = "#FF6F01";

// One flat veil outside the square, not a gradient: depth in this product
// belongs to the hairline and the two surface steps and to nothing else.
const DIM = "rgba(0, 0, 0, 0.6)";

// The export resolution cap. A 1024px square is the largest rendition any
// consumer of this image asks for, so a larger source is downscaled exactly
// once, here, and never routed through a host optimiser.
const EXPORT_MAX = 1024;

const MIME: Record<ImageType, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

// toBlob answers null only when it cannot encode the requested type at all.
const EXPORT_FAILED_MESSAGE = "The cropped image could not be saved. Try again or pick a different image.";

function squareSide(bitmap: ImageBitmap): number {
  return Math.min(bitmap.width, bitmap.height);
}

function squareCenter(bitmap: ImageBitmap): { x: number; y: number } {
  return { x: bitmap.width / 2, y: bitmap.height / 2 };
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

// A committed image's bytes passed the re-gate on their way in, so the sniff
// always names a format here; the assertion records that fact rather than
// defending against it.
function toPreviewUrl(bytes: Uint8Array): string {
  return URL.createObjectURL(new Blob([bytes], { type: MIME[sniffImageType(bytes)!] }));
}

interface ImageCropperProps {
  image: CroppedImage | null;
  dispatch: Dispatch<CreateAction>;
}

interface DragStart {
  pointerId: number;
  startX: number;
  startY: number;
  centerX: number;
  centerY: number;
}

export function ImageCropper({ image, dispatch }: ImageCropperProps) {
  const [source, setSource] = useState<ImageBitmap | null>(null);
  // Null center is the centered square: the keyboard default, and the only
  // position a pointer never has to find. Only a drag moves it.
  const [center, setCenter] = useState<{ x: number; y: number } | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // The object URL this mount created and still owns, revoked on replace and
  // unmount per the CroppedImage contract in lib/create-state.ts.
  const urlRef = useRef<string | null>(null);
  const dragRef = useRef<DragStart | null>(null);
  const reasonId = useId();

  // Returning to this step from a later one remounts the cropper holding a
  // committed image whose URL died with the previous unmount. The bytes are in
  // state, so the URL is minted again from them, which keeps the state field
  // live for exactly as long as a cropper is on screen to own it. The empty
  // dependency list is deliberate: re-running on the image this dispatch
  // changes would mint a second URL per commit and never stop.
  useEffect(() => {
    if (image === null) return;
    if (urlRef.current !== null) URL.revokeObjectURL(urlRef.current);
    const url = toPreviewUrl(image.bytes);
    urlRef.current = url;
    dispatch({ type: "set-image", image: { ...image, previewUrl: url } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The mount's URL dies with the mount: the bytes in state are the source of
  // truth, and a URL nobody renders is a blob the browser cannot collect.
  useEffect(() => {
    return () => {
      if (urlRef.current !== null) URL.revokeObjectURL(urlRef.current);
    };
  }, []);

  // The bitmap is decoder-backed memory a wide image can hold a lot of, and it
  // is handed back at replace and unmount rather than at collection time so it
  // is not held while the user works on the rest of the form.
  useEffect(() => {
    if (source === null) return;
    return () => {
      source.close();
    };
  }, [source]);

  // Redrawn whole on every source or center change: a 320px canvas repaint
  // costs nothing, and incremental drawing would have to undo the veil.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || source === null) return;
    const ctx = canvas.getContext("2d")!;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio ?? 1;
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);
    const fit = Math.min(rect.width / source.width, rect.height / source.height);
    const fitW = source.width * fit;
    const fitH = source.height * fit;
    const fitX = (rect.width - fitW) / 2;
    const fitY = (rect.height - fitH) / 2;
    ctx.drawImage(source, fitX, fitY, fitW, fitH);
    const side = squareSide(source);
    const square = center ?? squareCenter(source);
    const squareFit = side * fit;
    const sx = fitX + (square.x - side / 2) * fit;
    const sy = fitY + (square.y - side / 2) * fit;
    // One veil over everything, then the image again inside a clip: the four
    // strips outside the square are the same picture with one fill and no
    // geometry to keep in step.
    ctx.fillStyle = DIM;
    ctx.fillRect(0, 0, rect.width, rect.height);
    ctx.save();
    ctx.beginPath();
    ctx.rect(sx, sy, squareFit, squareFit);
    ctx.clip();
    ctx.drawImage(source, fitX, fitY, fitW, fitH);
    ctx.restore();
    ctx.strokeStyle = CROP_STROKE;
    ctx.lineWidth = 2;
    ctx.strokeRect(sx, sy, squareFit, squareFit);
  }, [source, center]);

  async function onPick(event: ChangeEvent<HTMLInputElement>) {
    const input = event.target;
    const file = input.files?.[0];
    // Clearing the value lets a second pick of the same file fire change again
    // after a discard; the File reference stays valid on its own.
    input.value = "";
    if (file === undefined) return;
    setReason(null);
    setBusy(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const gate = imageRejectReason(bytes);
      if (gate !== null) {
        setReason(gate);
        return;
      }
      try {
        const bitmap = await createImageBitmap(new Blob([bytes]));
        setSource(bitmap);
        setCenter(null);
      } catch {
        setReason(UNDECODABLE_MESSAGE);
      }
    } finally {
      setBusy(false);
    }
  }

  function onPointerDown(event: PointerEvent<HTMLCanvasElement>) {
    if (source === null) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const current = center ?? squareCenter(source);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      centerX: current.x,
      centerY: current.y,
    };
  }

  function onPointerMove(event: PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    const drag = dragRef.current;
    if (canvas === null || drag === null || source === null) return;
    if (event.pointerId !== drag.pointerId) return;
    // The canvas letterboxes the image, so a css pixel becomes a source pixel
    // at the fit scale, and the square tracks the pointer exactly.
    const fit = Math.min(canvas.clientWidth / source.width, canvas.clientHeight / source.height);
    const half = squareSide(source) / 2;
    setCenter({
      x: clamp(drag.centerX + (event.clientX - drag.startX) / fit, half, source.width - half),
      y: clamp(drag.centerY + (event.clientY - drag.startY) / fit, half, source.height - half),
    });
  }

  function endDrag() {
    dragRef.current = null;
  }

  async function onConfirm() {
    const bitmap = source;
    if (bitmap === null) return;
    setBusy(true);
    try {
      const side = squareSide(bitmap);
      const square = center ?? squareCenter(bitmap);
      const out = Math.min(side, EXPORT_MAX);
      const offscreen = document.createElement("canvas");
      offscreen.width = out;
      offscreen.height = out;
      const ctx = offscreen.getContext("2d")!;
      ctx.drawImage(bitmap, square.x - side / 2, square.y - side / 2, side, side, 0, 0, out, out);
      const blob = await new Promise<Blob | null>((resolve) => offscreen.toBlob(resolve, "image/webp", 0.9));
      if (blob === null) {
        setReason(EXPORT_FAILED_MESSAGE);
        return;
      }
      const bytes = new Uint8Array(await blob.arrayBuffer());
      // The re-gate: an encoder can hand back PNG for a WebP request, and a
      // re-encode can pass a cap the source file passed.
      const gate = imageRejectReason(bytes);
      if (gate !== null) {
        setReason(gate);
        return;
      }
      const sha256 = await sha256Hex(bytes);
      if (urlRef.current !== null) URL.revokeObjectURL(urlRef.current);
      const url = toPreviewUrl(bytes);
      urlRef.current = url;
      dispatch({ type: "set-image", image: { bytes, sha256, previewUrl: url } });
      // Nulling the source closes the bitmap in the effect above.
      setSource(null);
      setCenter(null);
    } finally {
      setBusy(false);
    }
  }

  function onDiscard() {
    setSource(null);
    setCenter(null);
  }

  function onRemove() {
    if (urlRef.current !== null) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
    dispatch({ type: "set-image", image: null });
  }

  const picker = (text: string) => (
    <label className={PICK}>
      <input
        type="file"
        accept="image/*"
        className="sr-only"
        aria-describedby={reason !== null ? reasonId : undefined}
        onChange={onPick}
      />
      {text}
    </label>
  );

  return (
    <div className="flex flex-col gap-2">
      <span className={LABEL}>Image (optional)</span>
      {source !== null ? (
        <div className="flex flex-col gap-3">
          <canvas
            ref={canvasRef}
            role="img"
            aria-label="Crop preview. The outlined square is the part of the image that will be used."
            className="hairline rounded-pp bg-pp-surface-2 mx-auto block aspect-square w-full max-w-[320px] cursor-grab touch-none active:cursor-grabbing"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          />
          <p className="mx-auto max-w-[320px] text-center text-small text-pp-text-muted">
            Drag to reposition the square.
          </p>
          <div className="flex justify-center gap-2">
            <Button variant="primary" size="sm" onClick={onConfirm} disabled={busy}>
              Use this image
            </Button>
            <Button variant="secondary" size="sm" onClick={onDiscard} disabled={busy}>
              Discard
            </Button>
          </div>
        </div>
      ) : image !== null ? (
        <div className="flex items-center gap-3">
          <img
            src={image.previewUrl}
            width={96}
            height={96}
            alt="The cropped image that will be used for the token"
            className="hairline rounded-pp block h-24 w-24"
          />
          <div className="flex flex-wrap items-center gap-2">
            {picker("Replace")}
            <Button variant="secondary" size="sm" onClick={onRemove}>
              Remove
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-start gap-2">
          {picker("Upload an image")}
          <p className="text-small text-pp-text-muted">
            Square crop. PNG, JPEG or WebP, up to{" "}
            <span className="mono">{CLIENT_MAX_IMAGE_BYTES / (1024 * 1024)}</span> MB.
          </p>
        </div>
      )}
      {/* aria-live rather than the static fields' aria-describedby alone: these
          reasons arrive from an await, after focus has moved to a button. */}
      {reason !== null && (
        <p id={reasonId} aria-live="polite" className="text-small text-pp-down">
          {reason}
        </p>
      )}
    </div>
  );
}
