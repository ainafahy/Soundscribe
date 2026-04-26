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
  chunkAudioUniform,
  compressLongSilences,
  renderAudioRowCanvas,
  trimAudioSilence,
} from "@/lib/audioWaveform";
import { renderLetterPdfBlob, type LetterRow } from "@/lib/renderPdf";
import {
  ADDR_OFF,
  DEAR_OFF,
  PAGE_W,
  ROWS_OFF,
} from "@/lib/letterConsts";
import {
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
  address1: "Aïna Fahy",
  address2: "22 Lovely Road",
  address3: "00420 Happy City",
  dear: "My dear lover,",
  text: "I hope this letter finds you well. It has been too long since we last spoke, and I wanted to send a small wave across the distance. The days here move slowly, mornings full of coffee and warm light, afternoons spent designing things and finding new hobbies, evenings that fold quietly into night, the days are lonely without you. I hope you remember me the way I do, not in bursts, but in the ordinary quiet of afternoons. Write back when you can. I miss you. (PS: I love you)",
  conclusion: "With Love,",
  signature: "Yours truly <3",
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
    setIsGenerating(true);
    try {
      await ensureTtsReady();

      // Duration-proportional row widths. Matches the Python reference
      // (matplotlib figsize = min(samples/SAMPLE_CONST, 1) * 7 inches at
      // 300 DPI = up to 2100 px wide for ~4.5 s of audio → ~467 px/s).
      const PX_PER_SECOND = 450;
      const RIGHT_MARGIN_PX = 100;
      // Canvas height matches the PDF line-step (100 px) so rows pack
      // edge-to-edge with no overlap. Ink reaches max ±48 px from the
      // baseline (= heightPx × 0.48), filling 96 / 100 px vertically.
      // Tighter than the previous 150-px config — same letter content
      // packs into ~2/3 of the vertical space, reading like a real
      // dense paragraph instead of a sparse list of lines.
      const rowHeightPx = 100;
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
        // Trim kokoro's preroll + postroll silence, then collapse long
        // mid-utterance pauses (sentence breaks etc.) to a small breath.
        // Raw audio stays cached for read-aloud — only the render-time
        // slice is processed.
        const audio = compressLongSilences(
          trimAudioSilence(rawAudio),
          sampleRate,
          60,
        );
        const maxPx = Math.max(100, PAGE_W - row.offset - RIGHT_MARGIN_PX);
        const maxSamplesPerRow = Math.floor((maxPx / PX_PER_SECOND) * sampleRate);

        // Matches the Python reference's two modes per field:
        //   cut=true  → add_text_to_image (truncate to one row)
        //   cut=false → add_cut_text_to_image (wrap to many rows,
        //               justified to uniform width, capped at 15)
        // Addresses / greeting / conclusion / signature all truncate;
        // only the body wraps.
        const chunks = row.cut
          ? [audio.length > maxSamplesPerRow ? audio.subarray(0, maxSamplesPerRow) : audio]
          : chunkAudioUniform(audio, maxSamplesPerRow, sampleRate, 15);

        for (let ci = 0; ci < chunks.length; ci++) {
          const chunk = chunks[ci];
          const isLast = ci === chunks.length - 1;
          // For wrapped fields: every row except the last is justified
          // to maxPx so the paragraph reads as a uniform block. The
          // last row uses its natural (shorter) width — the "ragged
          // last line" of a paragraph. Single-row fields also use
          // natural width.
          let widthPx: number;
          if (chunks.length > 1 && !isLast) {
            widthPx = maxPx;
          } else {
            const naturalPx = Math.round((chunk.length / sampleRate) * PX_PER_SECOND);
            widthPx = Math.max(80, Math.min(naturalPx, maxPx));
          }
          const canvas = renderAudioRowCanvas({
            audio: chunk,
            widthPx,
            heightPx: rowHeightPx,
            fg: "#000000",
            // Transparent bg — composite canvas in renderLetterPdfBlob
            // is already white. Adjacent rows can overlap without one
            // wiping the other.
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
      setToast("letter ready");
    } catch (err) {
      console.error(err);
      const msg = err instanceof Error ? err.message : "unknown";
      setToast(`couldn't generate: ${msg}`);
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

  useEffect(() => {
    return () => {
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
  const isBusy = isGenerating || tts.phase === "loading";
  const busyLabel = (() => {
    if (tts.phase === "loading") return "preparing voice";
    if (compose?.stage === "synth") return "composing letter";
    if (compose?.stage === "rendering") return "rendering pdf";
    if (isGenerating) return "composing letter";
    return null;
  })();

  const composingHeadline = (() => {
    if (compose?.stage === "rendering") return "rendering your letter";
    return "writing your letter";
  })();
  const composingSubline = (() => {
    if (compose?.stage === "synth") {
      return `voicing line ${compose.current} of ${compose.total}`;
    }
    if (compose?.stage === "rendering") {
      return "drawing the pdf — almost there";
    }
    return "listening to each line";
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
              <a
                href="https://huggingface.co/hexgrad/Kokoro-82M"
                target="_blank"
                rel="noopener noreferrer"
                className={styles.introLink}
              >
                kokoro
              </a>
              .
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
                aria-label={busyLabel ?? "generate pdf"}
              >
                {isBusy ? (
                  <span className={styles.btnSpinner} aria-hidden="true" />
                ) : (
                  "generate pdf"
                )}
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

          </div>

          <div
            className={`${styles.previewFrame}${pdfUrl && !isGenerating ? ` ${styles.previewFrameReady}` : ""}`}
            aria-label="letter preview"
          >
            {isGenerating ? (
              <div className={styles.composing} aria-live="polite">
                <div className={styles.composingWave} aria-hidden="true">
                  {Array.from({ length: 36 }).map((_, i) => (
                    <span
                      key={i}
                      style={{ animationDelay: `${(i * 53) % 1100}ms` }}
                    />
                  ))}
                </div>
                <div className={styles.composingHeadline}>{composingHeadline}</div>
                <small>{composingSubline}</small>
              </div>
            ) : pdfUrl ? (
              <iframe
                key={pdfUrl}
                src={pdfUrl}
                className={styles.previewIframe}
                title="generated letter"
              />
            ) : (
              <div className={styles.placeholder}>
                awaiting letter
                <small>write your message and click generate pdf</small>
              </div>
            )}
          </div>

          {pdfUrl && (
            <div className={styles.downloadRow}>
              <button
                type="button"
                className="nm-btn primary"
                onClick={downloadCurrentPdf}
              >
                download pdf
              </button>
            </div>
          )}
        </section>
      </div>

      <div className="explore">
        <span className="explore-label">explore more</span>
        <a className="explore-link" href="/image">
          Image tool <span className="arr">→</span>
        </a>
      </div>

      <Footer />

      <div className={`toast${toast ? " show" : ""}`}>{toast ?? ""}</div>
    </div>
  );
}
