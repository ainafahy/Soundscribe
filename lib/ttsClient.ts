/**
 * TTS client — main-thread wrapper around the tts.worker singleton.
 *
 * Lazy: the worker spawns on first `ensureReady` / `generate` call.
 * Subsequent callers share the same worker + the same model download.
 */

export type TtsPhase = "idle" | "loading" | "ready" | "error";

export interface TtsFileProgress {
  loaded: number;
  total: number;
}

export interface TtsStatus {
  phase: TtsPhase;
  /** Aggregated bytes downloaded across all model files. */
  loaded: number;
  /** Aggregated bytes expected. May grow as new files become known. */
  total: number;
  /** Currently-downloading file, if any. */
  currentFile?: string;
  /** Present when phase === "error". */
  message?: string;
}

export interface GenerateResult {
  audio: Float32Array;
  sampleRate: number;
}

interface Pending {
  resolve: (res: GenerateResult) => void;
  reject: (err: Error) => void;
}

type WorkerMessage =
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

let worker: Worker | null = null;
let status: TtsStatus = { phase: "idle", loaded: 0, total: 0 };
const listeners = new Set<(s: TtsStatus) => void>();
const pending = new Map<string, Pending>();
const files = new Map<string, TtsFileProgress>();
let readyResolve: (() => void) | null = null;
let readyReject: ((err: Error) => void) | null = null;
let readyPromise: Promise<void> | null = null;
let nextId = 1;

function emit(): void {
  // snapshot so listeners can't mutate our map
  const snapshot: TtsStatus = { ...status };
  listeners.forEach((l) => l(snapshot));
}

function setStatus(next: Partial<TtsStatus>): void {
  status = { ...status, ...next };
  emit();
}

function recomputeBytes(): void {
  let loaded = 0;
  let total = 0;
  for (const fp of files.values()) {
    loaded += fp.loaded;
    total += fp.total;
  }
  setStatus({ loaded, total });
}

function ensureWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("./tts.worker.ts", import.meta.url), {
    type: "module",
  });
  worker.addEventListener("message", (event: MessageEvent<WorkerMessage>) => {
    const msg = event.data;
    switch (msg.type) {
      case "progress": {
        if (
          typeof msg.total === "number" &&
          typeof msg.loaded === "number" &&
          msg.total > 0
        ) {
          files.set(msg.file, { loaded: msg.loaded, total: msg.total });
        }
        if (status.phase === "idle" || status.phase === "error") {
          setStatus({ phase: "loading", message: undefined });
        }
        setStatus({ currentFile: msg.file });
        recomputeBytes();
        break;
      }
      case "ready": {
        setStatus({
          phase: "ready",
          loaded: status.total || status.loaded,
          currentFile: undefined,
          message: undefined,
        });
        readyResolve?.();
        readyResolve = null;
        readyReject = null;
        break;
      }
      case "audio": {
        const p = pending.get(msg.id);
        if (p) {
          pending.delete(msg.id);
          p.resolve({ audio: msg.audio, sampleRate: msg.sampleRate });
        }
        break;
      }
      case "error": {
        const err = new Error(msg.message);
        if (msg.id) {
          const p = pending.get(msg.id);
          if (p) {
            pending.delete(msg.id);
            p.reject(err);
            return;
          }
        }
        // no pending id — this is a model-init error
        setStatus({ phase: "error", message: msg.message });
        readyReject?.(err);
        readyResolve = null;
        readyReject = null;
        // failed init — allow retry on next ensureReady
        readyPromise = null;
        break;
      }
    }
  });
  worker.addEventListener("error", (event) => {
    const message = event.message || "worker error";
    setStatus({ phase: "error", message });
    readyReject?.(new Error(message));
    readyResolve = null;
    readyReject = null;
    readyPromise = null;
  });
  return worker;
}

export function subscribeTts(listener: (s: TtsStatus) => void): () => void {
  listeners.add(listener);
  listener({ ...status });
  return () => {
    listeners.delete(listener);
  };
}

export function getTtsStatus(): TtsStatus {
  return { ...status };
}

export function ensureTtsReady(): Promise<void> {
  if (status.phase === "ready") return Promise.resolve();
  if (readyPromise) return readyPromise;
  const w = ensureWorker();
  readyPromise = new Promise<void>((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  setStatus({ phase: "loading", message: undefined });
  w.postMessage({ type: "init" });
  return readyPromise;
}

export async function ttsGenerate(
  text: string,
  voice: string = "af_heart",
): Promise<GenerateResult> {
  const w = ensureWorker();
  await ensureTtsReady();
  const id = `g${nextId++}`;
  return new Promise<GenerateResult>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ type: "generate", id, text, voice });
  });
}

/**
 * Concatenate multiple Float32Arrays into a single WAV blob.
 * Sample rate must match for all buffers (kokoro's 24000Hz in our case).
 */
export function audioToWavBlob(
  audio: Float32Array,
  sampleRate: number,
): Blob {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = audio.length * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);
  let offset = 44;
  for (let i = 0; i < audio.length; i++) {
    const s = Math.max(-1, Math.min(1, audio[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return new Blob([buffer], { type: "audio/wav" });
}
