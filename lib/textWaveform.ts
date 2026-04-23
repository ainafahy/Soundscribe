/**
 * Synthetic "text-to-waveform" generator.
 *
 * Rather than actually routing speechSynthesis through MediaRecorder
 * (unreliable across browsers), we generate a deterministic sample array
 * where each character class carries its own envelope, duration, and
 * sub-carrier. Result: dense paragraphs read as dense texture; addresses
 * feel terse; punctuation breathes.
 *
 * Output values are in [-1, 1]. Caller scales into pixel offsets.
 */

import { mulberry32, type Rng } from "./rng";

const VOWELS = new Set([
  "a", "e", "i", "o", "u", "y",
  "à", "á", "â", "ã", "ä", "å",
  "è", "é", "ê", "ë",
  "ì", "í", "î", "ï",
  "ò", "ó", "ô", "õ", "ö",
  "ù", "ú", "û", "ü",
]);

const HARD_CONSONANTS = new Set(["b", "c", "d", "g", "k", "p", "q", "t"]);
// soft / liquid consonants roll rather than spike
const SOFT_CONSONANTS = new Set(["f", "h", "j", "l", "m", "n", "r", "s", "v", "w", "x", "z"]);
const SENTENCE_END = new Set([".", "!", "?"]);
const SOFT_PUNCT = new Set([",", ";", ":"]);

type Shape = "rise" | "spike" | "roll" | "flat" | "silence" | "tail";

interface CharSpec {
  /** number of samples this character contributes */
  duration: number;
  /** peak amplitude in [0,1] */
  peak: number;
  /** envelope shape */
  shape: Shape;
  /** sub-carrier density (roughly cycles per sample × 100) */
  carrierRate: number;
  /** noise mix (0 = pure sine, 1 = pure noise) */
  noise: number;
}

/** A 32-bit non-cryptographic string hash for deterministic seeding. */
function hashString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function specFor(ch: string, rng: Rng): CharSpec {
  const lower = ch.toLowerCase();

  if (lower === " " || lower === "\t") {
    return { duration: 12, peak: 0.05, shape: "silence", carrierRate: 0, noise: 0 };
  }
  if (lower === "\n") {
    return { duration: 24, peak: 0, shape: "silence", carrierRate: 0, noise: 0 };
  }
  if (SENTENCE_END.has(lower)) {
    return { duration: 34, peak: 0.6, shape: "tail", carrierRate: 4, noise: 0.15 };
  }
  if (SOFT_PUNCT.has(lower)) {
    return { duration: 10, peak: 0.22, shape: "flat", carrierRate: 8, noise: 0.1 };
  }
  if (lower === "-" || lower === "—" || lower === "–" || lower === "_") {
    return { duration: 14, peak: 0.18, shape: "flat", carrierRate: 5, noise: 0.05 };
  }
  if (lower === "'" || lower === "\"" || lower === "’" || lower === "“" || lower === "”") {
    return { duration: 6, peak: 0.2, shape: "spike", carrierRate: 18, noise: 0.4 };
  }
  if (VOWELS.has(lower)) {
    // Vowels are the lyrical crests — longer, tall, rounded. Slight
    // variance per-instance for texture.
    const jitter = rng() * 0.18 - 0.09;
    // 'o' and 'u' get a bit more weight than 'a'/'e'/'i' — feels right
    const bonus = lower === "o" || lower === "u" ? 0.08 : 0;
    return {
      duration: 22 + Math.floor(rng() * 7),
      peak: Math.min(1, 0.82 + jitter + bonus),
      shape: "rise",
      carrierRate: 3.5,
      noise: 0.08,
    };
  }
  if (HARD_CONSONANTS.has(lower)) {
    const jitter = rng() * 0.12 - 0.04;
    return {
      duration: 13 + Math.floor(rng() * 4),
      peak: 0.62 + jitter,
      shape: "spike",
      carrierRate: 22,
      noise: 0.55,
    };
  }
  if (SOFT_CONSONANTS.has(lower)) {
    const jitter = rng() * 0.14 - 0.05;
    // 'm' 'n' 'l' 'r' sustain — raise floor a touch
    const rolled = lower === "m" || lower === "n" || lower === "l" || lower === "r";
    return {
      duration: 16 + Math.floor(rng() * 5),
      peak: (rolled ? 0.55 : 0.42) + jitter,
      shape: "roll",
      carrierRate: rolled ? 6 : 10,
      noise: 0.3,
    };
  }
  if (/[0-9]/.test(lower)) {
    // digits ladder 0→9: 0 is soft, 9 is loud
    const n = Number(lower);
    return {
      duration: 16,
      peak: 0.35 + n * 0.06,
      shape: "roll",
      carrierRate: 9 + n * 0.5,
      noise: 0.35,
    };
  }
  // anything else — whispered filler
  return { duration: 10, peak: 0.18, shape: "flat", carrierRate: 6, noise: 0.2 };
}

/** Shape envelopes in [0, 1] for a given t in [0, 1]. */
function envelopeAt(shape: Shape, t: number): number {
  switch (shape) {
    case "rise":
      // smooth rise-peak-fall; flat-ish top
      return Math.sin(Math.PI * t) ** 0.8;
    case "spike":
      // sharp attack, exponential decay
      if (t < 0.08) return t / 0.08;
      return Math.exp(-(t - 0.08) * 5.5);
    case "roll":
      // double hill — two humps
      return 0.5 + 0.5 * Math.sin(Math.PI * (t * 1.6 - 0.3)) * Math.sin(Math.PI * t);
    case "tail":
      // sudden swell then long decay
      if (t < 0.12) return t / 0.12;
      return Math.exp(-(t - 0.12) * 2.6);
    case "silence":
      return 0;
    case "flat":
    default:
      return 1;
  }
}

interface TextSampleOptions {
  /** Extra samples to flush at end. Default 16. */
  tailSamples?: number;
  /** Target length cap — if provided, samples are truncated. */
  maxSamples?: number;
  /** If true and text exceeds maxSamples, clip. Otherwise scale. */
  cut?: boolean;
}

export function textSamples(
  text: string,
  opts: TextSampleOptions = {},
): Float32Array {
  const trimmed = text.trim();
  if (!trimmed) return new Float32Array(0);

  const rng = mulberry32(hashString(trimmed) ^ 0x9e3779b9);

  // Pre-compute specs so we can build a samples array of known length.
  const specs: CharSpec[] = [];
  let totalLen = 0;
  for (const ch of trimmed) {
    const spec = specFor(ch, rng);
    specs.push(spec);
    totalLen += spec.duration;
  }

  const tail = Math.max(0, opts.tailSamples ?? 16);
  totalLen += tail;

  const samples = new Float32Array(totalLen);

  let cursor = 0;
  // phase carried between characters so the carrier feels continuous
  let phase = 0;

  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i];
    const d = spec.duration;
    const start = cursor;

    // taper into the character at the start of a word (previous char was space / newline)
    const prev = trimmed[i - 1];
    const isWordStart = !prev || /\s/.test(prev);
    // taper out if the next char is space / newline / sentence end
    const next = trimmed[i + 1];
    const isWordEnd = !next || /\s/.test(next) || SENTENCE_END.has((next || "").toLowerCase());

    for (let k = 0; k < d; k++) {
      const t = d === 1 ? 0 : k / (d - 1);
      const env = envelopeAt(spec.shape, t) * spec.peak;

      // Word-boundary taper — soften the first and last ~3 samples of each word
      let wordEdge = 1;
      if (isWordStart && k < 3) wordEdge *= (k + 1) / 4;
      if (isWordEnd && k > d - 4) wordEdge *= Math.max(0.1, (d - k) / 4);

      // Carrier: sine + noise blend
      const freqStep = (spec.carrierRate / 100) * 2 * Math.PI;
      phase += freqStep;
      const sine = Math.sin(phase);
      const noise = rng() * 2 - 1;
      const carrier = sine * (1 - spec.noise) + noise * spec.noise;

      samples[start + k] = env * wordEdge * carrier;
    }

    cursor += d;
  }

  // tail fade-out — handful of decaying noise samples so the row doesn't end cold
  for (let k = 0; k < tail; k++) {
    const t = k / Math.max(tail - 1, 1);
    const env = (1 - t) ** 2 * 0.15;
    const noise = rng() * 2 - 1;
    samples[cursor + k] = env * noise;
  }

  // Apply maxSamples cap if requested (cut=true truncates, cut=false scales).
  if (opts.maxSamples && samples.length > opts.maxSamples) {
    if (opts.cut) {
      return samples.subarray(0, opts.maxSamples);
    }
    // resample down to maxSamples with linear interpolation
    const out = new Float32Array(opts.maxSamples);
    const step = (samples.length - 1) / (opts.maxSamples - 1);
    for (let i = 0; i < opts.maxSamples; i++) {
      const idxF = i * step;
      const lo = Math.floor(idxF);
      const hi = Math.min(lo + 1, samples.length - 1);
      const t = idxF - lo;
      out[i] = samples[lo] * (1 - t) + samples[hi] * t;
    }
    return out;
  }

  return samples;
}

/** Render text-derived samples into a Canvas, plotted as a simple line. */
export interface TextRowRenderOptions {
  samples: Float32Array;
  widthPx: number;
  heightPx: number;
  fg?: string;
  bg?: string;
  thickness?: number;
}

export function renderTextRowCanvas(
  opts: TextRowRenderOptions,
): HTMLCanvasElement {
  const { samples, widthPx, heightPx } = opts;
  const fg = opts.fg ?? "#111111";
  const bg = opts.bg ?? "#ffffff";
  const thickness = opts.thickness ?? 1.1;

  const canvas = document.createElement("canvas");
  canvas.width = widthPx;
  canvas.height = heightPx;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d context unavailable");

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, widthPx, heightPx);

  if (samples.length === 0) return canvas;

  const baseline = heightPx / 2;
  const amp = heightPx * 0.48;
  const step = widthPx / Math.max(samples.length - 1, 1);

  ctx.strokeStyle = fg;
  ctx.lineWidth = thickness;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(0, baseline + samples[0] * amp);
  for (let i = 1; i < samples.length; i++) {
    const x = i * step;
    const y = baseline + samples[i] * amp;
    ctx.lineTo(x, y);
  }
  ctx.stroke();

  return canvas;
}
