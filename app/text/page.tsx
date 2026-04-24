"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Masthead from "@/components/Masthead";
import Footer from "@/components/Footer";
import {
  chunkAudioAtSilence,
  renderAudioRowCanvas,
  trimAudioSilence,
} from "@/lib/audioWaveform";
import { renderLetterPdfBlob, type LetterRow } from "@/lib/renderPdf";
import {
  ADDR_OFF,
  DEAR_OFF,
  MARGIN,
  PAGE_W,
  ROWS_OFF,
} from "@/lib/letterConsts";
import {
  audioToWavBlob,
  ensureTtsReady,
  subscribeTts,
  ttsGenerate,
  type TtsStatus,
} from "@/lib/ttsClient";
import styles from "./text.module.css";

interface Fields {
  address1: string;
  address2: string;
  address3: string;
  dear: string;
  text: string;
  conclusion: string;
  signature: string;
}

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 MB";
  if (n >= 1024 * 1024) {
    return `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  }
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

const DEFAULTS: Fields = {
  address1: "Jerome Chaoss",
  address2: "55 Thedsq Road",
  address3: "86322 Jeslamos",
  dear: "Dear friend,",
  text: "I hope this letter finds you well. It has been too long since we last spoke, and I wanted to send a small wave across the distance. The days here move slowly — mornings full of coffee and warm light, afternoons spent reading, evenings that fold quietly into night. Write back when you can. I miss you.",
  conclusion: "With warmth,",
  signature: "Yours truly",
};

type FieldKey = keyof Fields;

interface RowSpec {
  key: FieldKey | string;
  text: string;
  offset: number;
  cut: boolean;
  isSpace?: boolean;
}

function buildRows(fields: Fields): RowSpec[] {
  const rows: RowSpec[] = [];
  const push = (key: string, text: string, offset: number, cut: boolean) =>
    rows.push({ key, text, offset, cut });
  const space = (key: string) =>
    rows.push({ key, text: "", offset: 0, cut: true, isSpace: true });

  if (fields.address1) push("address1", fields.address1, ADDR_OFF, true);
  if (fields.address2) push("address2", fields.address2, ADDR_OFF, true);
  if (fields.address3) push("address3", fields.address3, ADDR_OFF, true);
  if (fields.address1 || fields.address2 || fields.address3) space("space1");

  if (fields.dear) {
    push("dear", fields.dear, DEAR_OFF, true);
    space("space2");
  }
  if (fields.text) {
    push("text", fields.text, ROWS_OFF, false);
    space("space3");
  }
  if (fields.conclusion) push("conclusion", fields.conclusion, ROWS_OFF, true);
  if (fields.signature) push("signature", fields.signature, ROWS_OFF, true);

  return rows;
}

export default function TextPage() {
  const [fields, setFields] = useState<Fields>(DEFAULTS);
  const [toast, setToast] = useState<string | null>(null);
  const [tts, setTts] = useState<TtsStatus>({ phase: "idle", loaded: 0, total: 0 });
  const [isGenerating, setIsGenerating] = useState(false);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  /** Compose progress. `stage: "rendering"` means kokoro's done and we're
   * now running jsPDF (the slow stretch in production builds). */
  const [compose, setCompose] = useState<
    | { stage: "synth"; current: number; total: number; label: string }
    | { stage: "rendering" }
    | null
  >(null);
  // Cache of audio buffers keyed by the field text — so edits that don't
  // change a field don't re-synthesise it.
  const audioCache = useRef<Map<string, Float32Array>>(new Map());
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const pdfUrlRef = useRef<string | null>(null);

  useEffect(() => {
    return subscribeTts((s) => {
      setTts(s);
      if (s.phase === "ready") setHasLoadedOnce(true);
    });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 1800);
    return () => window.clearTimeout(t);
  }, [toast]);

  const update = useCallback(<K extends keyof Fields>(key: K, value: string) => {
    setFields((prev) => ({ ...prev, [key]: value }));
  }, []);

  const rows = useMemo(() => buildRows(fields), [fields]);
  const hasAny = rows.some((r) => !r.isSpace && r.text);

  /** Synthesise (or fetch from cache) one field's audio. */
  const synthesize = useCallback(async (text: string): Promise<Float32Array> => {
    const cached = audioCache.current.get(text);
    if (cached) return cached;
    const { audio } = await ttsGenerate(text);
    audioCache.current.set(text, audio);
    return audio;
  }, []);

  const generatePdf = useCallback(async () => {
    if (!hasAny) {
      setToast("fill in at least one field");
      return;
    }
    // Open the preview tab synchronously while the click's user-gesture
    // context is still valid — most browsers block window.open() called
    // after an await. We'll navigate it to the blob URL once the PDF is
    // ready. Drop `noopener` here: browsers return null from open() when
    // noopener is set, which would prevent the later location set.
    const previewTab =
      typeof window !== "undefined" ? window.open("", "_blank") : null;

    setIsGenerating(true);
    try {
      await ensureTtsReady();

      // Duration-proportional row widths. Matches the Python reference
      // (matplotlib figsize = min(samples/SAMPLE_CONST, 1) * 7 inches at
      // 300 DPI = up to 2100 px wide for ~4.5 s of audio → ~467 px/s).
      const PX_PER_SECOND = 450;
      const RIGHT_MARGIN_PX = 100;
      // Row canvases render at the full MARGIN_PX height so wrapped body
      // rows stack edge-to-edge — the "dense like paper handwriting"
      // look the Python reference pastes at MARGIN * line.
      const rowHeightPx = MARGIN;
      const sampleRate = 24000; // kokoro

      // Non-space rows, indexed so we can report "N of M" during synthesis.
      const workRows = rows.filter((r) => !r.isSpace && r.text);
      const total = workRows.length;

      const letterRows: Array<LetterRow | null> = [];
      let workIdx = 0;
      for (const row of rows) {
        if (row.isSpace || !row.text) {
          letterRows.push(null);
          continue;
        }
        workIdx += 1;
        setCompose({
          stage: "synth",
          current: workIdx,
          total,
          label: String(row.key),
        });
        // Yield to the event loop so the button label actually repaints
        // before we block on the next worker round-trip.
        await new Promise((r) => requestAnimationFrame(() => r(null)));

        const rawAudio = await synthesize(row.text);
        // Trim kokoro's preroll + postroll silence. Raw audio stays
        // cached for read-aloud; only the render-time slice gets trimmed.
        const audio = trimAudioSilence(rawAudio);
        const maxPx = Math.max(100, PAGE_W - row.offset - RIGHT_MARGIN_PX);
        const maxSamplesPerRow = Math.floor((maxPx / PX_PER_SECOND) * sampleRate);

        // Matches the Python reference's two modes per field:
        //   cut=true  → add_text_to_image (truncate to one row)
        //   cut=false → add_cut_text_to_image (wrap to many rows,
        //               word-boundary-aware, capped at 15)
        // Addresses / greeting / conclusion / signature all truncate;
        // only the body wraps.
        const chunks = row.cut
          ? [audio.length > maxSamplesPerRow ? audio.subarray(0, maxSamplesPerRow) : audio]
          : chunkAudioAtSilence(audio, maxSamplesPerRow, sampleRate, 15);

        for (const chunk of chunks) {
          const naturalPx = Math.round((chunk.length / sampleRate) * PX_PER_SECOND);
          const widthPx = Math.max(80, Math.min(naturalPx, maxPx));
          const canvas = renderAudioRowCanvas({
            audio: chunk,
            widthPx,
            heightPx: rowHeightPx,
            fg: "#000000",
            bg: "#ffffff",
          });
          letterRows.push({ canvas, offsetPx: row.offset });
        }
      }

      // Surface the "rendering pdf" stage — jsPDF's encode can take 10–30s
      // on long paragraphs in production builds.
      setCompose({ stage: "rendering" });
      await new Promise((r) => requestAnimationFrame(() => r(null)));

      const blob = renderLetterPdfBlob(letterRows, { title: "Soundscribe letter" });
      // Replace any previous object URL so we don't leak.
      if (pdfUrlRef.current) URL.revokeObjectURL(pdfUrlRef.current);
      const url = URL.createObjectURL(blob);
      pdfUrlRef.current = url;
      setPdfUrl(url);

      // Navigate the pre-opened preview tab to the blob URL. If the tab
      // was blocked/closed, fall back to an anchor click.
      if (previewTab && !previewTab.closed) {
        try {
          previewTab.location.href = url;
          setToast("letter ready");
        } catch {
          setToast("pop-up blocked — use download pdf");
        }
      } else {
        setToast("pop-up blocked — use download pdf");
      }
    } catch (err) {
      console.error(err);
      const msg = err instanceof Error ? err.message : "unknown";
      setToast(`couldn't generate: ${msg}`);
      if (previewTab && !previewTab.closed) previewTab.close();
    } finally {
      setIsGenerating(false);
      setCompose(null);
    }
  }, [rows, hasAny, synthesize]);

  const downloadCurrentPdf = useCallback(() => {
    if (!pdfUrl) return;
    const a = document.createElement("a");
    a.href = pdfUrl;
    a.download = "letter.pdf";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, [pdfUrl]);

  /** Concatenate all non-empty fields into one utterance and play as WAV. */
  const readAloud = useCallback(async () => {
    const pieces = [
      fields.address1,
      fields.address2,
      fields.address3,
      fields.dear,
      fields.text,
      fields.conclusion,
      fields.signature,
    ].filter(Boolean);
    if (!pieces.length) {
      setToast("nothing to read");
      return;
    }
    setIsGenerating(true);
    try {
      await ensureTtsReady();
      // Generate a single utterance (kokoro splits internally on sentences).
      const joined = pieces.join(". ") + ".";
      const { audio, sampleRate } = await ttsGenerate(joined);
      const blob = audioToWavBlob(audio, sampleRate);
      if (audioRef.current) {
        audioRef.current.pause();
        URL.revokeObjectURL(audioRef.current.src);
      } else {
        audioRef.current = new Audio();
      }
      audioRef.current.src = URL.createObjectURL(blob);
      await audioRef.current.play();
    } catch (err) {
      console.error(err);
      const msg = err instanceof Error ? err.message : "unknown";
      setToast(`couldn't play: ${msg}`);
    } finally {
      setIsGenerating(false);
    }
  }, [fields]);

  const stopReading = useCallback(() => {
    audioRef.current?.pause();
  }, []);

  useEffect(() => {
    return () => {
      const el = audioRef.current;
      if (el) {
        el.pause();
        try {
          if (el.src) URL.revokeObjectURL(el.src);
        } catch {
          /* ignore */
        }
      }
      if (pdfUrlRef.current) {
        URL.revokeObjectURL(pdfUrlRef.current);
        pdfUrlRef.current = null;
      }
    };
  }, []);

  const loadingPct =
    tts.phase === "loading" && tts.total > 0
      ? Math.min(100, Math.round((tts.loaded / tts.total) * 100))
      : 0;
  const loadingLabel = (() => {
    if (tts.phase === "loading") {
      if (tts.total > 0) return `preparing voice · ${loadingPct}%`;
      return "preparing voice…";
    }
    if (compose?.stage === "synth") {
      return `composing ${compose.current}/${compose.total} · ${compose.label}`;
    }
    if (compose?.stage === "rendering") {
      return "rendering pdf…";
    }
    if (isGenerating) return "composing…";
    return null;
  })();

  const primaryDisabled = isGenerating || tts.phase === "loading" || !hasAny;

  return (
    <div className="wrap">
      <Masthead />

      <div className={styles.layout}>
        <aside className={styles.panel}>
          <div className="section">
            <div className="section-head">
              <span className="section-num">0</span>
              <span className="section-title">Recipient</span>
            </div>
            <div className={styles.field}>
              <label className={styles.fieldLabel} htmlFor="address1">
                address line 1
              </label>
              <input
                className="nm-input"
                id="address1"
                value={fields.address1}
                onChange={(e) => update("address1", e.target.value)}
              />
            </div>
            <div className={styles.field}>
              <label className={styles.fieldLabel} htmlFor="address2">
                address line 2
              </label>
              <input
                className="nm-input"
                id="address2"
                value={fields.address2}
                onChange={(e) => update("address2", e.target.value)}
              />
            </div>
            <div className={styles.field}>
              <label className={styles.fieldLabel} htmlFor="address3">
                address line 3
              </label>
              <input
                className="nm-input"
                id="address3"
                value={fields.address3}
                onChange={(e) => update("address3", e.target.value)}
              />
            </div>
          </div>

          <div className="section">
            <div className="section-head">
              <span className="section-num">1</span>
              <span className="section-title">Sign-off</span>
            </div>
            <div className={styles.field}>
              <label className={styles.fieldLabel} htmlFor="conclusion">
                conclusion
              </label>
              <input
                className="nm-input"
                id="conclusion"
                value={fields.conclusion}
                onChange={(e) => update("conclusion", e.target.value)}
              />
            </div>
            <div className={styles.field}>
              <label className={styles.fieldLabel} htmlFor="signature">
                signature
              </label>
              <input
                className="nm-input"
                id="signature"
                value={fields.signature}
                onChange={(e) => update("signature", e.target.value)}
              />
            </div>
          </div>

          <p className={styles.note}>
            Each field is spoken by a small neural voice running entirely in
            your browser, then drawn as a waveform. The model downloads once
            (~80&nbsp;MB) and is cached for all future visits.
          </p>
        </aside>

        <section className={styles.panel}>
          <div className="section">
            <div className="section-head">
              <span className="section-num">2</span>
              <span className="section-title">Letter</span>
            </div>
            <p className={styles.intro}>
              Write a letter. Each row of the PDF is the real acoustic
              waveform of that line, read aloud by{" "}
              <strong>kokoro</strong> — no audio leaves your machine.
            </p>
          </div>

          <div className="section">
            <div className={styles.field}>
              <label className={styles.fieldLabel} htmlFor="dear">
                greeting
              </label>
              <input
                className="nm-input"
                id="dear"
                value={fields.dear}
                onChange={(e) => update("dear", e.target.value)}
              />
            </div>
            <div className={styles.field}>
              <label className={styles.fieldLabel} htmlFor="body">
                body
              </label>
              <textarea
                className="nm-textarea"
                id="body"
                value={fields.text}
                onChange={(e) => update("text", e.target.value)}
              />
            </div>
            <div className={styles.actions}>
              <button
                type="button"
                className="nm-btn primary"
                onClick={generatePdf}
                disabled={primaryDisabled}
              >
                {loadingLabel ?? "generate pdf"}
              </button>
              <button
                type="button"
                className="nm-btn"
                onClick={readAloud}
                disabled={isGenerating || tts.phase === "loading" || !hasAny}
              >
                read aloud
              </button>
              <button
                type="button"
                className="nm-btn"
                onClick={stopReading}
              >
                stop
              </button>
            </div>

            {tts.phase === "loading" && (
              <div className={styles.progress} aria-live="polite">
                <div className={styles.progressTrack}>
                  <div
                    className={styles.progressBar}
                    style={{
                      width: tts.total > 0 ? `${loadingPct}%` : "12%",
                    }}
                  />
                </div>
                <div className={styles.progressMeta}>
                  <span className={styles.progressDot} aria-hidden="true" />
                  <span>preparing voice model</span>
                  {tts.total > 0 && (
                    <span className={styles.progressBytes}>
                      {formatBytes(tts.loaded)} / {formatBytes(tts.total)}
                    </span>
                  )}
                </div>
              </div>
            )}

            {tts.phase === "error" && (
              <div className={styles.errorBox} role="alert">
                couldn&rsquo;t load the voice model — check your connection
                and refresh, or try the image tool while we investigate.
              </div>
            )}

            {!hasLoadedOnce && tts.phase !== "loading" && tts.phase !== "error" && (
              <p className={styles.firstTimeNote}>
                first generation downloads the voice model (~80&nbsp;MB).
                only happens once.
              </p>
            )}

            {pdfUrl && (
              <div className={styles.pdfReady} aria-label="letter ready">
                <div className={styles.pdfReadyCopy}>
                  <span className={styles.pdfReadyDot} aria-hidden="true" />
                  <span>your letter is ready — opened in a new tab.</span>
                </div>
                <div className={styles.pdfActions}>
                  <a
                    className="nm-btn"
                    href={pdfUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    open again
                  </a>
                  <button
                    type="button"
                    className="nm-btn primary"
                    onClick={downloadCurrentPdf}
                  >
                    download pdf
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="explore">
            <span className="explore-label">explore more</span>
            <a className="explore-link" href="/image">
              Image tool <span className="arr">→</span>
            </a>
          </div>
        </section>
      </div>

      <Footer />

      <div className={`toast${toast ? " show" : ""}`}>{toast ?? ""}</div>
    </div>
  );
}
