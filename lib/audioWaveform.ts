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

/**
 * Trim leading and trailing silence. Kokoro emits ~120–180ms of silence
 * at the start of every utterance (and a smaller tail). If we leave it
 * in, those samples render as empty pixels at the canvas's left edge —
 * which visually shifts the speech to the right of the row and, for
 * rows with a large left offset (ADDR_OFF=1800), makes addresses look
 * crammed into the far-right corner of the page. Trimming makes the
 * canvas's left edge coincide with the first audible sample, so the
 * row's on-page `offsetPx` really does act as a left margin.
 *
 * The threshold is deliberately small — kokoro's silence is close to
 * machine-zero, and real speech hits 0.05+ within the first ms of voicing.
 */
export function trimAudioSilence(audio: Float32Array, threshold = 0.015): Float32Array {
  let start = 0;
  while (start < audio.length && Math.abs(audio[start]) < threshold) start++;
  let end = audio.length;
  while (end > start && Math.abs(audio[end - 1]) < threshold) end--;
  if (start === 0 && end === audio.length) return audio;
  // Keep a tiny runway of 1 ms so extreme attack transients don't get clipped.
  const runway = Math.min(24, start);
  return audio.subarray(start - runway, end);
}

/**
 * Split long audio into chunks sized to fit one row each, so that a
 * wrapped field reads as a justified paragraph — all rows the same
 * width, last row naturally shorter.
 *
 * Every chunk except the last has `maxSamplesPerRow` samples (hard cut)
 * so the caller can render every wrapped row at the same target pixel
 * width regardless of where the audio happens to fall.
 *
 * A small concession to visual quality: if there's a silence gap inside
 * the *last 5%* of a chunk's sample window we snap the cut to that gap,
 * avoiding a mid-word slice. Because the window is tiny, chunk sizes
 * stay within a 5% spread — close enough to uniform to render justified.
 *
 * Mirrors the Python reference's `add_cut_text_to_image` behaviour
 * (multi-row wrapping with a per-field row cap — Python uses 12).
 */
export function chunkAudioUniform(
  audio: Float32Array,
  maxSamplesPerRow: number,
  sampleRate: number,
  maxChunks: number = 15,
  options: { silenceThreshold?: number; minSilenceMs?: number; windowFraction?: number } = {},
): Float32Array[] {
  const silenceThreshold = options.silenceThreshold ?? 0.01;
  const minSilenceMs = options.minSilenceMs ?? 30;
  const windowFraction = options.windowFraction ?? 0.05;
  const minSilenceSamples = Math.max(1, Math.floor((minSilenceMs / 1000) * sampleRate));
  if (audio.length <= maxSamplesPerRow) return [audio];

  const chunks: Float32Array[] = [];
  let cursor = 0;

  while (cursor < audio.length && chunks.length < maxChunks) {
    const remaining = audio.length - cursor;
    if (remaining <= maxSamplesPerRow || chunks.length === maxChunks - 1) {
      const take = Math.min(remaining, maxSamplesPerRow);
      chunks.push(audio.subarray(cursor, cursor + take));
      break;
    }

    let bestCut = cursor + maxSamplesPerRow;
    const windowStart = cursor + Math.floor(maxSamplesPerRow * (1 - windowFraction));
    const windowEnd = cursor + maxSamplesPerRow;
    let bestSilenceLen = 0;
    let silenceStart = -1;

    for (let i = windowStart; i <= windowEnd; i++) {
      const val = i < audio.length ? Math.abs(audio[i]) : 0;
      if (val < silenceThreshold) {
        if (silenceStart === -1) silenceStart = i;
      } else if (silenceStart !== -1) {
        const len = i - silenceStart;
        if (len >= minSilenceSamples && len > bestSilenceLen) {
          bestSilenceLen = len;
          bestCut = silenceStart + Math.floor(len / 2);
        }
        silenceStart = -1;
      }
    }
    if (silenceStart !== -1) {
      const len = windowEnd - silenceStart;
      if (len >= minSilenceSamples && len > bestSilenceLen) {
        bestCut = silenceStart + Math.floor(len / 2);
      }
    }

    chunks.push(audio.subarray(cursor, bestCut));
    cursor = bestCut;
  }

  return chunks;
}

export interface AudioRowRenderOptions {
  audio: Float32Array;
  /** Intrinsic canvas pixel width. Every row is normalized to this width. */
  widthPx: number;
  heightPx: number;
  fg?: string;
  bg?: string;
  /** Minimum pixel amplitude to draw. Lower = denser ink. */
  threshold?: number;
  /** 0..1 — fraction of max |sample| at which amplitude saturates. 1 = no headroom. */
  normalizationCeiling?: number;
  /**
   * Gamma-style compression applied to normalized amplitude before drawing.
   * < 1 boosts quiet samples, leaves peaks untouched. 1 = no compression.
   * The kokoro TTS audio has a wide dynamic range (short peaks, lots of
   * near-silence between syllables). A value around 0.55–0.7 pulls the
   * valleys up so each row reads as a dense continuous line — the look of
   * Jen Cantwell's original Letter Home.
   */
  compression?: number;
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
  // Default to transparent bg so adjacent row canvases can overlap
  // without one's white background wiping the other's ink.
  const bg = opts.bg;
  const threshold = opts.threshold ?? 0.15;
  const ceiling = opts.normalizationCeiling ?? 0.98;
  const compression = opts.compression ?? 0.5;

  const canvas = document.createElement("canvas");
  canvas.width = widthPx;
  canvas.height = heightPx;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d context unavailable");

  if (bg && bg !== "transparent") {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, widthPx, heightPx);
  }

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
    const normalized = peaks[px] * scale;
    // Gamma-compress toward the ceiling so valleys between syllables
    // still render as visible ink. Peaks are untouched (1^γ = 1).
    const compressed = Math.pow(normalized, compression);
    const amp = compressed * maxAmp;
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
