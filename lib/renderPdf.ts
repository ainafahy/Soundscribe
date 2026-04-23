import jsPDF from "jspdf";
import { renderPngToCanvas, type PngRenderOptions } from "./renderPng";

/**
 * Render the waveform onto a single PDF page sized to its aspect ratio.
 * Matches the Python version's "PNG saved as PDF" behaviour.
 */
export function renderWaveformPdfBlob(opts: PngRenderOptions): Blob {
  const canvas = document.createElement("canvas");
  renderPngToCanvas(canvas, opts);
  const dataUrl = canvas.toDataURL("image/png");

  const aspect = opts.drawW / opts.drawH;
  // A4-ish — pick the larger side as 297mm, scale the other by aspect.
  const longSide = 297;
  const pageW = aspect >= 1 ? longSide : longSide * aspect;
  const pageH = aspect >= 1 ? longSide / aspect : longSide;

  const pdf = new jsPDF({
    unit: "mm",
    format: [pageW, pageH],
    orientation: aspect >= 1 ? "landscape" : "portrait",
  });
  pdf.addImage(dataUrl, "PNG", 0, 0, pageW, pageH, undefined, "FAST");
  return pdf.output("blob");
}

export interface LetterRow {
  /** Pre-rendered waveform as a canvas. */
  canvas: HTMLCanvasElement;
  /** Left offset in pixels at 300 DPI. */
  offsetPx: number;
}

/**
 * Render a multi-row "sound letter" PDF — one A4 portrait page at 300 DPI.
 * Each row is placed at its offsetPx (horizontal) and its line index (vertical).
 * Matches the Python letter layout: PAGE_SIZE = (2480, 3508), MARGIN = 150.
 */
export function renderLetterPdfBlob(
  rows: Array<LetterRow | null>,
  opts: { title?: string } = {},
): Blob {
  const PAGE_W_PX = 2480;
  const PAGE_H_PX = 3508;
  const MARGIN_PX = 150; // int(300 * 0.5) from Python consts — one row of vertical step
  const PAGE_W_MM = 210;
  const PAGE_H_MM = 297;

  const canvas = document.createElement("canvas");
  canvas.width = PAGE_W_PX;
  canvas.height = PAGE_H_PX;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d context unavailable");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, PAGE_W_PX, PAGE_H_PX);

  let line = 1;
  for (const row of rows) {
    if (!row) {
      line++;
      continue;
    }
    const y = MARGIN_PX * line;
    if (y + row.canvas.height > PAGE_H_PX) break;
    ctx.drawImage(row.canvas, row.offsetPx, y);
    line++;
  }

  const dataUrl = canvas.toDataURL("image/png");
  const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  pdf.addImage(dataUrl, "PNG", 0, 0, PAGE_W_MM, PAGE_H_MM, undefined, "FAST");
  if (opts.title) pdf.setProperties({ title: opts.title });
  return pdf.output("blob");
}
