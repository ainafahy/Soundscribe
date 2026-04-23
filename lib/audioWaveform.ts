/**
 * Audio → filled waveform renderer.
 *
 * Takes a Float32Array from kokoro-js (24 kHz mono) and draws it as a dense
 * column of 1-pixel vertical strokes from `baseline - |amp|` to
 * `baseline + |amp|` at every pixel — the "filled" style from the Python
 * reference's `_draw_segment_png`. Samples below a small amplitude floor
 * draw nothing, which is what creates the real word-gap rhythm.
 *
 * Per-field amplitude normalization: each row is scaled by its own max
 * |sample|, so a three-word signature reads as visually dense as a long
 * body paragraph instead of fading into near-silence.
 */

export interface AudioRowRenderOptions {
  audio: Float32Array;
  /** Intrinsic canvas pixel width. Every row is normalized to this width. */
  widthPx: number;
  heightPx: number;
  fg?: string;
  bg?: string;
  /**
   * Minimum pixel amplitude to actually draw. Raised slightly above the
   * Python's 0.5 threshold to kill low-energy preroll/postroll that
   * kokoro sometimes emits on short utterances.
   */
  threshold?: number;
  /** 0..1 — fraction of max |sample| at which amplitude saturates. 1 = no headroom. */
  normalizationCeiling?: number;
}

/**
 * Peak-hold downsampling: for each destination pixel, take the max
 * absolute sample in its window. Preserves bursty transients that pure
 * linear interpolation would flatten.
 */
function peakHoldBuckets(audio: Float32Array, widthPx: number): Float32Array {
  const out = new Float32Array(widthPx);
  if (audio.length === 0 || widthPx <= 0) return out;
  if (audio.length <= widthPx) {
    // upsample with linear interp — more samples than destination pixels needed
    const step = (audio.length - 1) / Math.max(widthPx - 1, 1);
    for (let i = 0; i < widthPx; i++) {
      const idxF = i * step;
      const lo = Math.floor(idxF);
      const hi = Math.min(lo + 1, audio.length - 1);
      const t = idxF - lo;
      out[i] = Math.abs(audio[lo] * (1 - t) + audio[hi] * t);
    }
    return out;
  }
  // downsample — peak hold
  const bucket = audio.length / widthPx;
  for (let i = 0; i < widthPx; i++) {
    const start = Math.floor(i * bucket);
    const end = Math.min(audio.length, Math.floor((i + 1) * bucket));
    let peak = 0;
    for (let j = start; j < end; j++) {
      const a = Math.abs(audio[j]);
      if (a > peak) peak = a;
    }
    out[i] = peak;
  }
  return out;
}

export function renderAudioRowCanvas(opts: AudioRowRenderOptions): HTMLCanvasElement {
  const { audio, widthPx, heightPx } = opts;
  const fg = opts.fg ?? "#000000";
  const bg = opts.bg ?? "#ffffff";
  const threshold = opts.threshold ?? 0.6;
  const ceiling = opts.normalizationCeiling ?? 0.98;

  const canvas = document.createElement("canvas");
  canvas.width = widthPx;
  canvas.height = heightPx;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d context unavailable");

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, widthPx, heightPx);

  if (audio.length === 0 || widthPx < 2) return canvas;

  const peaks = peakHoldBuckets(audio, widthPx);

  // Per-field amplitude normalization — so short fields are as visually
  // dense as long body paragraphs.
  let maxPeak = 0;
  for (let i = 0; i < peaks.length; i++) {
    if (peaks[i] > maxPeak) maxPeak = peaks[i];
  }
  const scale = maxPeak > 0 ? ceiling / maxPeak : 0;

  const baseline = heightPx / 2;
  const maxAmp = heightPx * 0.48;

  const path = new Path2D();
  for (let px = 0; px < widthPx; px++) {
    const amp = peaks[px] * scale * maxAmp;
    if (amp < threshold) continue;
    const x = px + 0.5;
    path.moveTo(x, baseline - amp);
    path.lineTo(x, baseline + amp);
  }

  ctx.strokeStyle = fg;
  ctx.lineWidth = 1;
  ctx.lineCap = "butt";
  ctx.stroke(path);

  return canvas;
}
