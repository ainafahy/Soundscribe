import { mulberry32, uniform, type Rng } from "./rng";
import type { LoadedImage } from "./imageSource";

export type Mode = "rows" | "grid";
export type Style = "line" | "mirror" | "filled" | "bars";
export type Noise = "noise" | "sine" | "chirp";
export type Rotation = 0 | 90 | 180 | 270;

export interface WaveformParams {
  mode: Mode;
  style: Style;
  noise: Noise;
  rows: number;
  cols: number;
  amp: number;
  freq: number;
  thick: number;
  rotation: Rotation;
  invert: boolean;
  fg: string;
  fg2: string;
  bg: string;
}

export interface Segment {
  x: Float64Array;
  y: Float64Array;
  baseline: number;
  vertical: boolean;
  offsets: Float64Array;
}

export interface SegmentsResult {
  segments: Segment[];
  finalW: number;
  finalH: number;
  drawW: number;
  drawH: number;
}

/** Port of `_carrier_sized`. */
function carrierSized(
  length: number,
  noiseType: Noise,
  frequency: number,
  rng: Rng,
): Float64Array {
  const out = new Float64Array(length);
  const L = Math.max(length, 1);

  if (noiseType === "sine") {
    for (let i = 0; i < length; i++) {
      out[i] = Math.sin((2 * Math.PI * frequency * i) / L);
    }
    return out;
  }

  if (noiseType === "chirp") {
    for (let i = 0; i < length; i++) {
      const fi = frequency * 0.2 + (frequency * i) / L;
      out[i] = Math.sin((2 * Math.PI * fi * i) / L);
    }
    return out;
  }

  // noise — density from frequency
  const density = Math.max(0.01, Math.min(1.0, frequency / 200.0));
  const nSamples = Math.max(2, Math.round(length * density));
  const raw = new Float64Array(nSamples);
  for (let i = 0; i < nSamples; i++) raw[i] = uniform(rng, -1.0, 1.0);

  if (nSamples >= length) {
    for (let i = 0; i < length; i++) out[i] = raw[i];
    return out;
  }
  // linear interpolation across the full length
  const step = (length - 1) / (nSamples - 1);
  for (let i = 0; i < length; i++) {
    const idxF = i / step;
    const lo = Math.floor(idxF);
    const hi = Math.min(lo + 1, nSamples - 1);
    const t = idxF - lo;
    out[i] = raw[lo] * (1 - t) + raw[hi] * t;
  }
  return out;
}

function reverseInPlace(a: Float64Array): Float64Array {
  for (let i = 0, j = a.length - 1; i < j; i++, j--) {
    const tmp = a[i];
    a[i] = a[j];
    a[j] = tmp;
  }
  return a;
}

/**
 * Build a 2D darkness source array suited for this rotation.
 * Rows in the returned source == the "band" axis, columns == the "scan" axis.
 *
 * Supports 0, 90, 180, 270. (Diagonals 45/135 from the Python version are
 * intentionally omitted — the Soundscribe UI doesn't expose them.)
 */
function prepSource(
  darkness: Float32Array,
  w: number,
  h: number,
  invert: boolean,
  rotation: Rotation,
): {
  source: Float32Array;
  bandTotal: number;
  scanTotal: number;
  drawW: number;
  drawH: number;
  vertical: boolean;
  reverse: boolean;
} {
  // Apply invert at read time via a helper closure over the original buffer.
  const read = (row: number, col: number) => {
    const v = darkness[row * w + col];
    return invert ? v : 1 - v;
  };

  if (rotation === 90 || rotation === 270) {
    // transpose: source rows = original cols, source cols = original rows
    const bandTotal = w;
    const scanTotal = h;
    const source = new Float32Array(bandTotal * scanTotal);
    for (let r = 0; r < bandTotal; r++) {
      for (let c = 0; c < scanTotal; c++) {
        source[r * scanTotal + c] = read(c, r);
      }
    }
    return {
      source,
      bandTotal,
      scanTotal,
      drawW: w,
      drawH: h,
      vertical: true,
      reverse: rotation === 270,
    };
  }

  // 0 or 180 — source is the darkness grid directly (possibly inverted)
  const bandTotal = h;
  const scanTotal = w;
  const source = new Float32Array(bandTotal * scanTotal);
  for (let r = 0; r < bandTotal; r++) {
    for (let c = 0; c < scanTotal; c++) {
      source[r * scanTotal + c] = read(r, c);
    }
  }
  return {
    source,
    bandTotal,
    scanTotal,
    drawW: w,
    drawH: h,
    vertical: false,
    reverse: rotation === 180,
  };
}

function makeSegment(
  scan: Float64Array,
  band: Float64Array,
  baseline: number,
  offsets: Float64Array,
  vertical: boolean,
): Segment {
  if (vertical) {
    return { x: band, y: scan, baseline, vertical: true, offsets };
  }
  return { x: scan, y: band, baseline, vertical: false, offsets };
}

export function segmentsFromImage(
  src: LoadedImage,
  p: Pick<
    WaveformParams,
    "mode" | "rows" | "cols" | "noise" | "amp" | "freq" | "invert" | "rotation"
  >,
): SegmentsResult {
  const { source, bandTotal, scanTotal, drawW, drawH, vertical, reverse } =
    prepSource(src.darkness, src.drawWidth, src.drawHeight, p.invert, p.rotation);

  const bandSize = bandTotal / p.rows;
  const rng = mulberry32(42);
  const segments: Segment[] = [];

  for (let i = 0; i < p.rows; i++) {
    const bStart = Math.round(i * bandSize);
    const bEnd = Math.round((i + 1) * bandSize);
    if (bEnd <= bStart) continue;
    const bandCenter = (bStart + bEnd) / 2.0;

    if (p.mode === "grid") {
      const cellLen = scanTotal / p.cols;
      for (let j = 0; j < p.cols; j++) {
        const cs = Math.round(j * cellLen);
        const ce = Math.round((j + 1) * cellLen);
        if (ce <= cs) continue;
        const cellWidth = ce - cs;
        const pad = Math.max(1, Math.floor(cellWidth * 0.15));
        const ws = cs + pad;
        const we = ce - pad;
        if (we - ws < 2) continue;
        const wlen = we - ws;

        // Envelope: mean down each column in the cell, restricted to [ws..we).
        const envelope = new Float64Array(wlen);
        for (let k = 0; k < wlen; k++) {
          let sum = 0;
          const col = ws + k;
          for (let r = bStart; r < bEnd; r++) {
            sum += source[r * scanTotal + col];
          }
          envelope[k] = sum / (bEnd - bStart);
        }

        let carrier = carrierSized(wlen, p.noise, p.freq, rng);
        if (reverse) {
          reverseInPlace(carrier);
          reverseInPlace(envelope);
        }

        const maxAmp = (bandSize / 2.0) * p.amp * 0.8;
        const offsets = new Float64Array(wlen);
        const scanCoords = new Float64Array(wlen);
        const bandCoords = new Float64Array(wlen);
        for (let k = 0; k < wlen; k++) {
          const o = carrier[k] * envelope[k] * maxAmp;
          offsets[k] = o;
          scanCoords[k] = k + ws;
          bandCoords[k] = bandCenter + o;
        }
        segments.push(makeSegment(scanCoords, bandCoords, bandCenter, offsets, vertical));
      }
    } else {
      // rows mode — full-width envelope
      const envelope = new Float64Array(scanTotal);
      for (let k = 0; k < scanTotal; k++) {
        let sum = 0;
        for (let r = bStart; r < bEnd; r++) {
          sum += source[r * scanTotal + k];
        }
        envelope[k] = sum / (bEnd - bStart);
      }

      let carrier = carrierSized(scanTotal, p.noise, p.freq, rng);
      if (reverse) {
        reverseInPlace(carrier);
        reverseInPlace(envelope);
      }

      const maxAmp = (bandSize / 2.0) * p.amp;
      const offsets = new Float64Array(scanTotal);
      const scanCoords = new Float64Array(scanTotal);
      const bandCoords = new Float64Array(scanTotal);
      for (let k = 0; k < scanTotal; k++) {
        const o = carrier[k] * envelope[k] * maxAmp;
        offsets[k] = o;
        scanCoords[k] = k;
        bandCoords[k] = bandCenter + o;
      }
      segments.push(makeSegment(scanCoords, bandCoords, bandCenter, offsets, vertical));
    }
  }

  return {
    segments,
    finalW: src.drawWidth,
    finalH: src.drawHeight,
    drawW,
    drawH,
  };
}

/**
 * Build a standalone set of segments (not from an image) for the text tool.
 * Each sample in `samples` (in [-1, 1]) drives one scan-column's offset
 * inside a single band sized `height`.
 */
export function segmentFromSamples(
  samples: Float32Array,
  height: number,
  amp: number,
): Segment {
  const n = samples.length;
  const baseline = height / 2;
  const maxAmp = (height / 2) * amp;
  const scanCoords = new Float64Array(n);
  const bandCoords = new Float64Array(n);
  const offsets = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const o = samples[i] * maxAmp;
    offsets[i] = o;
    scanCoords[i] = i;
    bandCoords[i] = baseline + o;
  }
  return {
    x: scanCoords,
    y: bandCoords,
    baseline,
    vertical: false,
    offsets,
  };
}
