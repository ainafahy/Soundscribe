/// <reference lib="webworker" />

/**
 * TTS Web Worker — owns the KokoroTTS singleton for the page's lifetime.
 *
 * Main thread posts:
 *   { type: "init" }
 *   { type: "generate", id, text, voice?, speed? }
 *
 * Worker posts back:
 *   { type: "progress", file, loaded, total, progress }
 *   { type: "ready" }
 *   { type: "audio", id, audio: Float32Array, sampleRate }   // audio.buffer is transferred
 *   { type: "error", id?, message }
 */

import { KokoroTTS } from "kokoro-js";

const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";

let ttsInstance: KokoroTTS | null = null;
let initPromise: Promise<KokoroTTS> | null = null;

type WorkerIn =
  | { type: "init" }
  | { type: "generate"; id: string; text: string; voice?: string; speed?: number };

type WorkerOut =
  | {
      type: "progress";
      file: string;
      name?: string;
      status?: string;
      loaded?: number;
      total?: number;
      progress?: number;
    }
  | { type: "ready" }
  | { type: "audio"; id: string; audio: Float32Array; sampleRate: number }
  | { type: "error"; id?: string; message: string };

const post = (msg: WorkerOut, transfer?: Transferable[]): void => {
  if (transfer && transfer.length) {
    (self as unknown as Worker).postMessage(msg, transfer);
  } else {
    (self as unknown as Worker).postMessage(msg);
  }
};

/**
 * Split text into pieces small enough that each produces less than
 * ~2.73 s of audio (kokoro's per-generate cap). We split on sentence
 * boundaries first, then further split any still-long sentence on commas.
 * Empirically a piece of <= ~90 characters (roughly ~13 words) stays
 * under the cap for normal English speech.
 */
function splitForTts(text: string): string[] {
  const CHUNK_LIMIT = 90;
  const trimmed = text.trim();
  if (!trimmed) return [];
  // First split on sentence-ish boundaries.
  const sentences: string[] = [];
  const re = /[^.!?…]+[.!?…]?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(trimmed)) !== null) {
    const s = m[0].trim();
    if (s) sentences.push(s);
  }
  if (sentences.length === 0) sentences.push(trimmed);

  // For any sentence longer than CHUNK_LIMIT, further split on commas/semicolons.
  const out: string[] = [];
  for (const s of sentences) {
    if (s.length <= CHUNK_LIMIT) {
      out.push(s);
      continue;
    }
    const sub = s.split(/,\s+|;\s+/).map((p) => p.trim()).filter(Boolean);
    let buf = "";
    for (const part of sub) {
      if (!buf) {
        buf = part;
      } else if ((buf + ", " + part).length <= CHUNK_LIMIT) {
        buf += ", " + part;
      } else {
        out.push(buf);
        buf = part;
      }
    }
    if (buf) out.push(buf);
  }
  return out;
}

async function loadWith(
  device: "webgpu" | "wasm",
  dtype: "q8" | "fp16" | "fp32",
  progress: (p: Record<string, unknown>) => void,
): Promise<KokoroTTS> {
  return KokoroTTS.from_pretrained(MODEL_ID, {
    dtype,
    device,
    progress_callback: progress,
  });
}

async function ensureReady(): Promise<KokoroTTS> {
  if (ttsInstance) return ttsInstance;
  if (initPromise) return initPromise;

  const onProgress = (p: Record<string, unknown>) => {
    const status = p.status as string | undefined;
    if (status !== "progress" && status !== "download" && status !== "ready") return;
    post({
      type: "progress",
      status,
      file: (p.file as string) ?? "",
      name: p.name as string | undefined,
      loaded: p.loaded as number | undefined,
      total: p.total as number | undefined,
      progress: p.progress as number | undefined,
    });
  };

  initPromise = (async () => {
    // Prefer WebGPU — on this model it's roughly an order of magnitude
    // faster than wasm for long paragraphs. WebGPU in a worker requires
    // `navigator.gpu` to exist AND `requestAdapter()` to return a real
    // adapter (some browsers expose the API surface but refuse adapters
    // in workers). We check both before trying.
    let tts: KokoroTTS | null = null;
    const hasGpu =
      typeof navigator !== "undefined" &&
      "gpu" in navigator &&
      typeof (navigator as unknown as { gpu: { requestAdapter: () => Promise<unknown> } })
        .gpu?.requestAdapter === "function";
    if (hasGpu) {
      try {
        const adapter = await (
          navigator as unknown as { gpu: { requestAdapter: () => Promise<unknown> } }
        ).gpu.requestAdapter();
        if (adapter) {
          try {
            // fp16 on webgpu: still ~160MB (vs ~80MB q8) but noticeably
            // better pronunciation quality than q8 and runs fast on the
            // GPU. If fp16 init fails (older adapters) we fall through
            // to the wasm q8 path below.
            tts = await loadWith("webgpu", "fp16", onProgress);
          } catch (err) {
            console.warn("[tts] webgpu init failed, falling back to wasm:", err);
          }
        }
      } catch (err) {
        console.warn("[tts] webgpu adapter request failed, using wasm:", err);
      }
    }
    if (!tts) {
      tts = await loadWith("wasm", "q8", onProgress);
    }
    ttsInstance = tts;
    post({ type: "ready" });
    return tts;
  })();
  return initPromise;
}

self.addEventListener("message", async (event: MessageEvent<WorkerIn>) => {
  const msg = event.data;
  try {
    if (msg.type === "init") {
      await ensureReady();
      return;
    }
    if (msg.type === "generate") {
      const tts = await ensureReady();
      // Kokoro's generate() caps output at ~65536 samples (2.73 s of audio);
      // anything longer is zero-padded past that point. Split the input on
      // sentence boundaries and call generate() per chunk, then concatenate.
      const chunks: Float32Array[] = [];
      let sampleRate = 24000;
      const voice = (msg.voice ?? "af_heart") as Parameters<typeof tts.generate>[1] extends undefined
        ? never
        : NonNullable<Parameters<typeof tts.generate>[1]>["voice"];
      const speed = msg.speed ?? 1;
      const parts = splitForTts(msg.text);
      for (const part of parts) {
        const audio = await tts.generate(part, { voice, speed });
        const data = audio.audio as Float32Array;
        chunks.push(data);
        sampleRate = audio.sampling_rate;
      }
      const total = chunks.reduce((n, a) => n + a.length, 0);
      const combined = new Float32Array(total);
      let offset = 0;
      for (const c of chunks) {
        combined.set(c, offset);
        offset += c.length;
      }
      post(
        {
          type: "audio",
          id: msg.id,
          audio: combined,
          sampleRate,
        },
        [combined.buffer],
      );
      return;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    post({
      type: "error",
      id: msg.type === "generate" ? msg.id : undefined,
      message,
    });
  }
});
