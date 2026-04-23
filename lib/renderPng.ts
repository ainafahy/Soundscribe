import type { Segment, Style } from "./waveform";
import { hexToRgb, lerpColor, rgbEq, rgbToCss, type RGB } from "./colors";

export interface PngRenderOptions {
  segments: Segment[];
  drawW: number;
  drawH: number;
  bg: string;
  fg: string;
  fg2: string;
  style: Style;
  thick: number;
}

function fgGradient(
  ctx: CanvasRenderingContext2D,
  fg: RGB,
  fg2: RGB,
  canvasW: number,
  canvasH: number,
  vertical: boolean,
): CanvasGradient {
  const grad = vertical
    ? ctx.createLinearGradient(0, 0, 0, canvasH)
    : ctx.createLinearGradient(0, 0, canvasW, 0);
  grad.addColorStop(0, rgbToCss(fg));
  grad.addColorStop(1, rgbToCss(fg2));
  return grad;
}

/**
 * Draw one segment using the same logic as the Python PIL renderer.
 * The caller supplies a ready 2D context scaled to drawW x drawH.
 */
function drawSegment(
  ctx: CanvasRenderingContext2D,
  seg: Segment,
  style: Style,
  fg: RGB,
  fg2: RGB,
  thickness: number,
  canvasW: number,
  canvasH: number,
): void {
  const { x, y, baseline, vertical, offsets } = seg;
  const n = x.length;
  if (n < 2) return;

  const gradient = !rgbEq(fg, fg2);
  const tAt = (i: number) =>
    vertical
      ? y[i] / Math.max(canvasH - 1, 1)
      : x[i] / Math.max(canvasW - 1, 1);
  const colorAt = (i: number): string => {
    if (!gradient) return rgbToCss(fg);
    return rgbToCss(lerpColor(fg, fg2, tAt(i)));
  };

  if (style === "filled") {
    ctx.lineWidth = 1;
    ctx.lineCap = "butt";
    for (let i = 0; i < n; i++) {
      const amp = Math.abs(offsets[i]);
      if (amp < 0.5) continue;
      ctx.strokeStyle = colorAt(i);
      ctx.beginPath();
      if (vertical) {
        ctx.moveTo(baseline - amp, y[i]);
        ctx.lineTo(baseline + amp, y[i]);
      } else {
        ctx.moveTo(x[i], baseline - amp);
        ctx.lineTo(x[i], baseline + amp);
      }
      ctx.stroke();
    }
    return;
  }

  if (style === "bars") {
    const step = Math.max(1, thickness + 1);
    ctx.lineWidth = thickness;
    ctx.lineCap = "round";
    for (let i = 0; i < n; i += step) {
      const amp = Math.abs(offsets[i]);
      if (amp < 1.0) continue;
      ctx.strokeStyle = colorAt(i);
      ctx.beginPath();
      if (vertical) {
        ctx.moveTo(baseline - amp, y[i]);
        ctx.lineTo(baseline + amp, y[i]);
      } else {
        ctx.moveTo(x[i], baseline - amp);
        ctx.lineTo(x[i], baseline + amp);
      }
      ctx.stroke();
    }
    return;
  }

  // line / mirror — polyline(s)
  ctx.lineWidth = thickness;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  const drawPoly = (xs: ArrayLike<number>, ys: ArrayLike<number>) => {
    if (!gradient) {
      ctx.strokeStyle = rgbToCss(fg);
      ctx.beginPath();
      ctx.moveTo(xs[0], ys[0]);
      for (let i = 1; i < n; i++) ctx.lineTo(xs[i], ys[i]);
      ctx.stroke();
      return;
    }
    // per-segment gradient steps to match PIL
    for (let i = 0; i < n - 1; i++) {
      const t = vertical
        ? (ys[i] + ys[i + 1]) / 2 / Math.max(canvasH - 1, 1)
        : (xs[i] + xs[i + 1]) / 2 / Math.max(canvasW - 1, 1);
      ctx.strokeStyle = rgbToCss(lerpColor(fg, fg2, t));
      ctx.beginPath();
      ctx.moveTo(xs[i], ys[i]);
      ctx.lineTo(xs[i + 1], ys[i + 1]);
      ctx.stroke();
    }
  };

  drawPoly(x, y);
  if (style === "mirror") {
    if (vertical) {
      const mirror = new Float64Array(n);
      for (let i = 0; i < n; i++) mirror[i] = 2 * baseline - x[i];
      drawPoly(mirror, y);
    } else {
      const mirror = new Float64Array(n);
      for (let i = 0; i < n; i++) mirror[i] = 2 * baseline - y[i];
      drawPoly(x, mirror);
    }
  }
}

/**
 * Render the waveform into the given canvas, resizing it to drawW x drawH.
 * Does NOT apply device-pixel-ratio scaling — the caller handles sizing.
 */
export function renderPngToCanvas(
  canvas: HTMLCanvasElement,
  opts: PngRenderOptions,
): void {
  canvas.width = opts.drawW;
  canvas.height = opts.drawH;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d context unavailable");
  const bg = hexToRgb(opts.bg, [255, 255, 255]);
  const fg = hexToRgb(opts.fg, [0, 0, 0]);
  const fg2 = hexToRgb(opts.fg2, fg);
  ctx.fillStyle = rgbToCss(bg);
  ctx.fillRect(0, 0, opts.drawW, opts.drawH);
  for (const seg of opts.segments) {
    drawSegment(ctx, seg, opts.style, fg, fg2, opts.thick, opts.drawW, opts.drawH);
  }
  // (fgGradient kept reserved for future full-canvas gradient; unused here.)
  void fgGradient;
}

/** Convenience — export the current canvas as a PNG Blob. */
export async function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("canvas.toBlob returned null"))),
      "image/png",
    );
  });
}
