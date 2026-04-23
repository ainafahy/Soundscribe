import type { Segment, Style } from "./waveform";
import { hexToRgb, rgbEq, rgbToHex } from "./colors";

export interface SvgRenderOptions {
  segments: Segment[];
  finalW: number;
  finalH: number;
  drawW: number;
  drawH: number;
  bg: string;
  fg: string;
  fg2: string;
  style: Style;
  thick: number;
  /** 90 or 270 makes gradient vertical. */
  rotation: number;
}

function fmt(v: number): string {
  // two decimal places, no trailing zeros
  return v.toFixed(2).replace(/\.?0+$/, "");
}

function ptsStr(xs: ArrayLike<number>, ys: ArrayLike<number>): string {
  const out: string[] = [];
  for (let i = 0; i < xs.length; i++) {
    out.push(`${fmt(xs[i])},${fmt(ys[i])}`);
  }
  return out.join(" ");
}

function svgSegment(
  seg: Segment,
  style: Style,
  fg: string,
  thickness: number,
  gradient: boolean,
): string {
  const { x, y, baseline, vertical, offsets } = seg;
  const n = x.length;
  if (n < 2) return "";
  const stroke = gradient ? "url(#grad)" : fg;

  if (style === "filled") {
    const parts: string[] = [];
    for (let i = 0; i < n; i++) {
      const amp = Math.abs(offsets[i]);
      if (amp < 0.5) continue;
      if (vertical) {
        parts.push(
          `<line x1="${fmt(baseline - amp)}" y1="${fmt(y[i])}" x2="${fmt(
            baseline + amp,
          )}" y2="${fmt(y[i])}" stroke="${stroke}" stroke-width="1"/>`,
        );
      } else {
        parts.push(
          `<line x1="${fmt(x[i])}" y1="${fmt(baseline - amp)}" x2="${fmt(
            x[i],
          )}" y2="${fmt(baseline + amp)}" stroke="${stroke}" stroke-width="1"/>`,
        );
      }
    }
    return parts.join("");
  }

  if (style === "bars") {
    const step = Math.max(1, thickness + 1);
    const parts: string[] = [];
    for (let i = 0; i < n; i += step) {
      const amp = Math.abs(offsets[i]);
      if (amp < 1.0) continue;
      if (vertical) {
        parts.push(
          `<line x1="${fmt(baseline - amp)}" y1="${fmt(y[i])}" x2="${fmt(
            baseline + amp,
          )}" y2="${fmt(y[i])}" stroke="${stroke}" stroke-width="${thickness}" stroke-linecap="round"/>`,
        );
      } else {
        parts.push(
          `<line x1="${fmt(x[i])}" y1="${fmt(baseline - amp)}" x2="${fmt(
            x[i],
          )}" y2="${fmt(baseline + amp)}" stroke="${stroke}" stroke-width="${thickness}" stroke-linecap="round"/>`,
        );
      }
    }
    return parts.join("");
  }

  // line / mirror
  const parts: string[] = [
    `<polyline points="${ptsStr(x, y)}" fill="none" stroke="${stroke}" stroke-width="${thickness}" stroke-linejoin="round" stroke-linecap="round"/>`,
  ];
  if (style === "mirror") {
    if (vertical) {
      const mirror = new Float64Array(n);
      for (let i = 0; i < n; i++) mirror[i] = 2 * baseline - x[i];
      parts.push(
        `<polyline points="${ptsStr(mirror, y)}" fill="none" stroke="${stroke}" stroke-width="${thickness}" stroke-linejoin="round" stroke-linecap="round"/>`,
      );
    } else {
      const mirror = new Float64Array(n);
      for (let i = 0; i < n; i++) mirror[i] = 2 * baseline - y[i];
      parts.push(
        `<polyline points="${ptsStr(x, mirror)}" fill="none" stroke="${stroke}" stroke-width="${thickness}" stroke-linejoin="round" stroke-linecap="round"/>`,
      );
    }
  }
  return parts.join("");
}

export function renderSvg(opts: SvgRenderOptions): string {
  const bg = rgbToHex(hexToRgb(opts.bg, [255, 255, 255]));
  const fg = hexToRgb(opts.fg, [0, 0, 0]);
  const fg2 = hexToRgb(opts.fg2, fg);
  const gradient = !rgbEq(fg, fg2);
  const verticalGrad = opts.rotation === 90 || opts.rotation === 270;

  const body = opts.segments
    .map((s) => svgSegment(s, opts.style, rgbToHex(fg), opts.thick, gradient))
    .join("");

  let gradientDef = "";
  if (gradient) {
    const [x1, y1, x2, y2] = verticalGrad ? [0, 0, 0, 1] : [0, 0, 1, 0];
    gradientDef =
      `<defs><linearGradient id="grad" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">` +
      `<stop offset="0%" stop-color="${rgbToHex(fg)}"/>` +
      `<stop offset="100%" stop-color="${rgbToHex(fg2)}"/>` +
      `</linearGradient></defs>`;
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${opts.finalW}" height="${opts.finalH}" ` +
    `viewBox="0 0 ${opts.finalW} ${opts.finalH}" style="background:${bg}">` +
    `${gradientDef}${body}</svg>`
  );
}
