/**
 * Synthetic "text-to-waveform" generator.
 *
 * Each word renders as a distinct "blob": a strong word-level envelope
 * (quick ramp up → hold → quick ramp down) modulated by per-character
 * rhythm (vowels swell, consonants snap, etc). Between words sits real
 * near-zero silence so the row reads with visible rhythm — not a
 * continuous seismograph smear.
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
const SOFT_CONSONANTS = new Set(["f", "h", "j", "l", "m", "n", "r", "s", "v", "w", "x", "z"]);

type Shape = "rise" | "spike" | "roll" | "flat";

interface CharSpec {
  duration: number;
  peak: number;
  shape: Shape;
  carrierRate: number;
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

/** Per-character shape and density. Vowels swell, consonants bite. */
function specFor(ch: string, rng: Rng): CharSpec {
  const lower = ch.toLowerCase();

  if (VOWELS.has(lower)) {
    const jitter = rng() * 0.14 - 0.06;
    const bonus = lower === "o" || lower === "u" ? 0.06 : 0;
    return {
      duration: 20 + Math.floor(rng() * 6),
      peak: Math.min(1, 0.88 + jitter + bonus),
      shape: "rise",
      carrierRate: 3.2,
      noise: 0.07,
    };
  }
  if (HARD_CONSONANTS.has(lower)) {
    const jitter = rng() * 0.1 - 0.03;
    return {
      duration: 12 + Math.floor(rng() * 4),
      peak: 0.8 + jitter,
      shape: "spike",
      carrierRate: 22,
      noise: 0.55,
    };
  }
  if (SOFT_CONSONANTS.has(lower)) {
    const jitter = rng() * 0.12 - 0.04;
    const rolled = lower === "m" || lower === "n" || lower === "l" || lower === "r";
    return {
      duration: 15 + Math.floor(rng() * 4),
      peak: (rolled ? 0.82 : 0.7) + jitter,
      shape: "roll",
      carrierRate: rolled ? 6 : 10,
      noise: 0.3,
    };
  }
  if (/[0-9]/.test(lower)) {
    const n = Number(lower);
    return {
      duration: 14,
      peak: 0.55 + n * 0.045,
      shape: "roll",
      carrierRate: 9 + n * 0.5,
      noise: 0.35,
    };
  }
  // accented / symbol fall-through — treat as soft consonant
  return {
    duration: 14,
    peak: 0.6,
    shape: "roll",
    carrierRate: 9,
    noise: 0.25,
  };
}

/** Character envelope in [0, 1] across the character's local t in [0, 1]. */
function envelopeAt(shape: Shape, t: number): number {
  switch (shape) {
    case "rise":
      return Math.sin(Math.PI * t) ** 0.7;
    case "spike":
      if (t < 0.08) return t / 0.08;
      return Math.exp(-(t - 0.08) * 4.5);
    case "roll":
      // two gentle humps
      return 0.55 + 0.45 * Math.sin(Math.PI * (t * 1.6 - 0.3)) * Math.sin(Math.PI * t);
    case "flat":
    default:
      return 1;
  }
}

/**
 * Word-level envelope: quick ramp-up, long held-high plateau, quick
 * ramp-down. This is what gives each word its "blob" shape.
 */
function wordEnvelope(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 0;
  const RAMP = 0.12;
  if (t < RAMP) return (t / RAMP) ** 0.65;
  if (t > 1 - RAMP) return ((1 - t) / RAMP) ** 0.65;
  return 1;
}

/** Character used inside a word (letters, digits, intra-word apostrophes). */
function isWordChar(ch: string): boolean {
  if (!ch) return false;
  const code = ch.charCodeAt(0);
  if (code >= 48 && code <= 57) return true; // 0-9
  if (code >= 65 && code <= 90) return true; // A-Z
  if (code >= 97 && code <= 122) return true; // a-z
  if (code >= 0xc0 && code <= 0x17f) return true; // Latin-1 supplement + Extended-A
  if (ch === "'" || ch === "\u2019" || ch === "\u02bc") return true; // intra-word apostrophes
  return false;
}

/** Map a separator char to a gap sample count. Bigger char = bigger breath. */
function gapFor(ch: string): number {
  if (ch === " " || ch === "\t") return 32;
  if (ch === "\n") return 70;
  if (ch === "," || ch === ";" || ch === ":") return 56;
  if (ch === "." || ch === "!" || ch === "?") return 110;
  if (ch === "-" || ch === "\u2013" || ch === "\u2014") return 26;
  if (ch === "(" || ch === ")" || ch === "[" || ch === "]" || ch === "\"" || ch === "\u201c" || ch === "\u201d") return 20;
  return 18;
}

interface Token {
  kind: "word" | "gap";
  text?: string;
  gap?: number;
}

function tokenize(text: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (isWordChar(ch)) {
      let word = "";
      while (i < text.length && isWordChar(text[i])) {
        word += text[i];
        i++;
      }
      out.push({ kind: "word", text: word });
    } else {
      // Merge consecutive separators into ONE gap, sized to the biggest char in the run.
      let maxGap = 0;
      while (i < text.length && !isWordChar(text[i])) {
        const g = gapFor(text[i]);
        if (g > maxGap) maxGap = g;
        i++;
      }
      if (maxGap > 0) out.push({ kind: "gap", gap: maxGap });
    }
  }
  return out;
}

const MIN_WORD_SAMPLES = 22;
const SILENCE_FLOOR = 0.012; // near-zero breath noise during gaps

export interface TextSampleOptions {
  /** Target length cap — if provided, samples are truncated or resampled. */
  maxSamples?: number;
  /** If true and text exceeds maxSamples, clip. Otherwise resample. */
  cut?: boolean;
}

export function textSamples(
  text: string,
  opts: TextSampleOptions = {},
): Float32Array {
  const trimmed = text.trim();
  if (!trimmed) return new Float32Array(0);

  const seed = hashString(trimmed);
  // Two deterministic streams — one for planning durations, one for rendering —
  // so the two passes stay in sync across runs.
  const planRng = mulberry32(seed ^ 0x9e3779b9);
  const renderRng = mulberry32(seed ^ 0x1f83d9ab);

  const tokens = tokenize(trimmed);
  if (tokens.length === 0) return new Float32Array(0);

  // Plan pass — compute total length and each word's sample length
  interface WordPlan {
    specs: CharSpec[];
    length: number;
  }
  const wordPlans: WordPlan[] = [];
  let totalLen = 0;
  for (const tok of tokens) {
    if (tok.kind === "gap") {
      totalLen += tok.gap!;
      continue;
    }
    const specs: CharSpec[] = [];
    let len = 0;
    for (const ch of tok.text!) {
      const s = specFor(ch, planRng);
      specs.push(s);
      len += s.duration;
    }
    len = Math.max(MIN_WORD_SAMPLES, len);
    wordPlans.push({ specs, length: len });
    totalLen += len;
  }

  const samples = new Float32Array(totalLen);
  let cursor = 0;
  let phase = 0; // shared carrier phase — keeps adjacent words from sounding identical
  let wi = 0;

  for (const tok of tokens) {
    if (tok.kind === "gap") {
      const g = tok.gap!;
      for (let k = 0; k < g; k++) {
        samples[cursor + k] = (renderRng() * 2 - 1) * SILENCE_FLOOR;
      }
      cursor += g;
      continue;
    }
    const plan = wordPlans[wi++];
    const wordLen = plan.length;

    // If MIN_WORD_SAMPLES padded the length, stretch each char's local duration proportionally.
    const specSum = plan.specs.reduce((acc, s) => acc + s.duration, 0);
    const stretch = wordLen / Math.max(specSum, 1);

    let local = 0;
    for (const spec of plan.specs) {
      const d = Math.max(1, Math.round(spec.duration * stretch));
      for (let k = 0; k < d; k++) {
        const absPos = local + k;
        if (absPos >= wordLen) break;
        const wordT = absPos / Math.max(wordLen - 1, 1);
        const wEnv = wordEnvelope(wordT);
        const charT = d === 1 ? 0 : k / (d - 1);
        const cEnv = envelopeAt(spec.shape, charT) * spec.peak;
        const freqStep = (spec.carrierRate / 100) * 2 * Math.PI;
        phase += freqStep;
        const sine = Math.sin(phase);
        const noise = renderRng() * 2 - 1;
        const carrier = sine * (1 - spec.noise) + noise * spec.noise;
        samples[cursor + absPos] = wEnv * cEnv * carrier * 0.97;
      }
      local += d;
    }
    // if rounding left a tail < wordLen unfilled, leave it at 0 (reads as micro-breath)
    cursor += wordLen;
  }

  if (opts.maxSamples && samples.length > opts.maxSamples) {
    if (opts.cut) return samples.subarray(0, opts.maxSamples);
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

/**
 * Render text-derived samples into a Canvas using the *filled* style —
 * a 1-pixel vertical line at every x from baseline-|amp| to baseline+|amp|.
 * This is what gives the output its dense ink feel, matching the Python
 * `_draw_segment_png` filled-style behaviour.
 *
 * Amplitudes below a small floor draw nothing — so the near-silence
 * between words becomes a real, visible gap.
 */
export interface TextRowRenderOptions {
  samples: Float32Array;
  widthPx: number;
  heightPx: number;
  fg?: string;
  bg?: string;
}

export function renderTextRowCanvas(opts: TextRowRenderOptions): HTMLCanvasElement {
  const { samples, widthPx, heightPx } = opts;
  const fg = opts.fg ?? "#000000";
  const bg = opts.bg ?? "#ffffff";

  const canvas = document.createElement("canvas");
  canvas.width = widthPx;
  canvas.height = heightPx;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d context unavailable");

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, widthPx, heightPx);

  if (samples.length === 0 || widthPx < 2) return canvas;

  const baseline = heightPx / 2;
  const maxAmp = heightPx * 0.48;
  const step = (samples.length - 1) / Math.max(widthPx - 1, 1);

  const path = new Path2D();
  for (let px = 0; px < widthPx; px++) {
    const idxF = px * step;
    const lo = Math.floor(idxF);
    const hi = Math.min(lo + 1, samples.length - 1);
    const t = idxF - lo;
    const sample = samples[lo] * (1 - t) + samples[hi] * t;
    const amp = Math.abs(sample) * maxAmp;
    if (amp < 0.5) continue;
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
