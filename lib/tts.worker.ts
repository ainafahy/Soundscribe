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

async function ensureReady(): Promise<KokoroTTS> {
  if (ttsInstance) return ttsInstance;
  if (initPromise) return initPromise;

  initPromise = KokoroTTS.from_pretrained(MODEL_ID, {
    dtype: "q8",
    device: "wasm",
    progress_callback: (p: Record<string, unknown>) => {
      // transformers.js emits several shapes — passthrough the interesting ones.
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
    },
  }).then((tts) => {
    ttsInstance = tts;
    post({ type: "ready" });
    return tts;
  });
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
      const audio = await tts.generate(msg.text, {
        voice: (msg.voice ?? "af_heart") as Parameters<typeof tts.generate>[1] extends undefined
          ? never
          : NonNullable<Parameters<typeof tts.generate>[1]>["voice"],
        speed: msg.speed ?? 1,
      });
      const buf = audio.audio as Float32Array;
      // Transfer the underlying buffer for zero-copy handoff to main.
      post(
        {
          type: "audio",
          id: msg.id,
          audio: buf,
          sampleRate: audio.sampling_rate,
        },
        [buf.buffer],
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
