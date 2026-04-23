export const MAX_WORKING_WIDTH = 1400;

export interface LoadedImage {
  width: number;
  height: number;
  drawWidth: number;
  drawHeight: number;
  /** Row-major darkness: 0 = white, 1 = black. Length = drawWidth * drawHeight. */
  darkness: Float32Array;
  /** A data URL (png) of the resized grayscale source — handy for thumbnails / previews. */
  thumbnailDataUrl: string;
}

function canvasFromImage(img: HTMLImageElement | ImageBitmap): {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  w: number;
  h: number;
} {
  const srcW = "naturalWidth" in img ? img.naturalWidth : img.width;
  const srcH = "naturalHeight" in img ? img.naturalHeight : img.height;
  let w = srcW;
  let h = srcH;
  if (w > MAX_WORKING_WIDTH) {
    h = Math.round((h * MAX_WORKING_WIDTH) / w);
    w = MAX_WORKING_WIDTH;
  }
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("2d context unavailable");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, w, h);
  return { canvas, ctx, w, h };
}

/**
 * Build a LoadedImage synchronously from an already-drawn canvas.
 * Resizes to MAX_WORKING_WIDTH if needed. No async, no ImageBitmap —
 * safe to call inside a useState initializer.
 */
export function loadImageFromCanvas(input: HTMLCanvasElement): LoadedImage {
  const srcW = input.width;
  const srcH = input.height;
  let drawW = srcW;
  let drawH = srcH;
  let workCanvas = input;
  if (drawW > MAX_WORKING_WIDTH) {
    drawH = Math.round((drawH * MAX_WORKING_WIDTH) / drawW);
    drawW = MAX_WORKING_WIDTH;
    workCanvas = document.createElement("canvas");
    workCanvas.width = drawW;
    workCanvas.height = drawH;
    const wctx = workCanvas.getContext("2d");
    if (!wctx) throw new Error("2d context unavailable");
    wctx.imageSmoothingEnabled = true;
    wctx.imageSmoothingQuality = "high";
    wctx.drawImage(input, 0, 0, drawW, drawH);
  }
  const ctx = workCanvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("2d context unavailable");
  const pixelData = ctx.getImageData(0, 0, drawW, drawH);
  const lum = extractDarkness(pixelData);
  return {
    width: srcW,
    height: srcH,
    drawWidth: drawW,
    drawHeight: drawH,
    darkness: lum,
    thumbnailDataUrl: workCanvas.toDataURL("image/png"),
  };
}

function extractDarkness(imageData: ImageData): Float32Array {
  const { data, width, height } = imageData;
  const out = new Float32Array(width * height);
  // PIL's "L" mode uses Rec. 601 luma (approximately this), so we match that.
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    out[j] = lum;
  }
  return out;
}

export async function loadImageFromElement(
  img: HTMLImageElement | ImageBitmap,
): Promise<LoadedImage> {
  const { canvas, ctx, w, h } = canvasFromImage(img);
  const pixelData = ctx.getImageData(0, 0, w, h);
  const lum = extractDarkness(pixelData);
  const srcW = "naturalWidth" in img ? img.naturalWidth : img.width;
  const srcH = "naturalHeight" in img ? img.naturalHeight : img.height;
  return {
    width: srcW,
    height: srcH,
    drawWidth: w,
    drawHeight: h,
    darkness: lum,
    thumbnailDataUrl: canvas.toDataURL("image/png"),
  };
}

export async function loadImageFromFile(file: File): Promise<LoadedImage> {
  const bitmap = await createImageBitmap(file);
  try {
    return await loadImageFromElement(bitmap);
  } finally {
    bitmap.close();
  }
}

export async function loadImageFromUrl(url: string): Promise<LoadedImage> {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = url;
  await img.decode();
  return loadImageFromElement(img);
}
