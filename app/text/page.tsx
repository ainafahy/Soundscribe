"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Masthead from "@/components/Masthead";
import Footer from "@/components/Footer";
import { renderTextRowCanvas, textSamples } from "@/lib/textWaveform";
import { renderLetterPdfBlob, type LetterRow } from "@/lib/renderPdf";
import {
  ADDR_OFF,
  DEAR_OFF,
  MARGIN,
  PAGE_W,
  ROWS_OFF,
  SAMPLE_CONST,
} from "@/lib/letterConsts";
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

const DEFAULTS: Fields = {
  address1: "Jearom Chaoss",
  address2: "Chemin of Thedsq 55",
  address3: "86322 Jeslamos",
  dear: "Salut mon cher,",
  text: "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Nullam consectetur vel velit eget ultricies. In et lacinia nisi, ac cursus ipsum. Pellentesque efficitur at tellus feugiat consequat. Phasellus orci sem, pharetra non malesuada sed, aliquet vitae arcu.",
  conclusion: "Best regards,",
  signature: "Me, myself and I",
};

interface RowSpec {
  key: keyof Fields | string;
  text: string;
  offset: number;
  limit: number;
  cut: boolean;
  isSpace?: boolean;
}

function buildRows(fields: Fields): RowSpec[] {
  const rows: RowSpec[] = [];
  const push = (
    key: string,
    text: string,
    offset: number,
    limit: number,
    cut: boolean,
  ) => rows.push({ key, text, offset, limit, cut });
  const space = (key: string) =>
    rows.push({ key, text: "", offset: 0, limit: 0, cut: true, isSpace: true });

  if (fields.address1) push("address1", fields.address1, ADDR_OFF, Math.floor(SAMPLE_CONST / 4), true);
  if (fields.address2) push("address2", fields.address2, ADDR_OFF, Math.floor(SAMPLE_CONST / 4), true);
  if (fields.address3) push("address3", fields.address3, ADDR_OFF, Math.floor(SAMPLE_CONST / 4), true);
  if (fields.address1 || fields.address2 || fields.address3) space("space1");

  if (fields.dear) {
    push("dear", fields.dear, DEAR_OFF, SAMPLE_CONST, true);
    space("space2");
  }
  if (fields.text) {
    push("text", fields.text, ROWS_OFF, SAMPLE_CONST, false);
    space("space3");
  }
  if (fields.conclusion) push("conclusion", fields.conclusion, ROWS_OFF, SAMPLE_CONST, true);
  if (fields.signature) push("signature", fields.signature, ROWS_OFF, SAMPLE_CONST, true);

  return rows;
}

/** Build an on-screen preview of the letter. The PDF is the real deal — this
 *  just gives immediate visual feedback at screen resolution. */
function PreviewSheet({ rows }: { rows: RowSpec[] }) {
  const canvasRefs = useRef<Array<HTMLCanvasElement | null>>([]);

  useEffect(() => {
    rows.forEach((row, idx) => {
      const canvas = canvasRefs.current[idx];
      if (!canvas) return;
      if (row.isSpace || !row.text) {
        const ctx = canvas.getContext("2d");
        if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
        return;
      }
      const samples = textSamples(row.text, { maxSamples: row.limit, cut: row.cut });
      // The canvas's display width (after its row's padding-left offset) is
      // the width we want to render at. 2x for crisp lines on high-DPI.
      const displayW = Math.max(120, Math.round(canvas.clientWidth || 400));
      const dpr = typeof window !== "undefined" ? Math.min(window.devicePixelRatio || 1, 2) : 1;
      const widthPx = Math.round(displayW * dpr);
      const heightPx = Math.round(48 * dpr);
      const drawn = renderTextRowCanvas({
        samples,
        widthPx,
        heightPx,
        fg: "#111111",
        bg: "#ffffff",
      });
      canvas.width = drawn.width;
      canvas.height = drawn.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(drawn, 0, 0);
    });
  }, [rows]);

  return (
    <div className={styles.sheet} aria-hidden="true">
      {rows.map((row, idx) => {
        if (row.isSpace) {
          return <div key={`${row.key}-${idx}`} className={styles.rowEmpty} />;
        }
        // Push non-address rows based on their offset ratio
        const pad = (row.offset / PAGE_W) * 100;
        return (
          <div key={`${row.key}-${idx}`} className={styles.row}>
            <div style={{ paddingLeft: `${pad}%` }} className={styles.rowInner}>
              <canvas
                ref={(el) => {
                  canvasRefs.current[idx] = el;
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function TextPage() {
  const [fields, setFields] = useState<Fields>(DEFAULTS);
  const [toast, setToast] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 1600);
    return () => window.clearTimeout(t);
  }, [toast]);

  const update = useCallback(<K extends keyof Fields>(key: K, value: string) => {
    setFields((prev) => ({ ...prev, [key]: value }));
  }, []);

  const rows = useMemo(() => buildRows(fields), [fields]);
  const hasAny = rows.some((r) => !r.isSpace && r.text);

  const downloadBlob = useCallback((blob: Blob, name: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 500);
  }, []);

  const generatePdf = useCallback(async () => {
    if (!hasAny) {
      setToast("fill in at least one field");
      return;
    }
    setIsGenerating(true);
    try {
      // yield so the UI repaints "generating…" before the heavy canvas work
      await new Promise((r) => requestAnimationFrame(() => r(null)));

      const rowHeightPx = Math.round(MARGIN * 0.55); // ~82px per row at 300 DPI — leaves breathing room
      const letterRows: Array<LetterRow | null> = rows.map((row) => {
        if (row.isSpace || !row.text) return null;
        const samples = textSamples(row.text, { maxSamples: row.limit, cut: row.cut });
        const availablePx = PAGE_W - row.offset - 100;
        // Sample density: ~1 sample per 0.4px looks right at 300 DPI.
        const widthPx = Math.min(availablePx, Math.round(samples.length / 0.4));
        const canvas = renderTextRowCanvas({
          samples,
          widthPx: Math.max(200, widthPx),
          heightPx: rowHeightPx,
          fg: "#000000",
          bg: "#ffffff",
        });
        return { canvas, offsetPx: row.offset };
      });

      const blob = renderLetterPdfBlob(letterRows, { title: "Soundscribe letter" });
      downloadBlob(blob, "letter.pdf");
      setToast("letter.pdf saved");
    } catch (err) {
      console.error(err);
      setToast("couldn't generate pdf");
    } finally {
      setIsGenerating(false);
    }
  }, [rows, hasAny, downloadBlob]);

  const speak = useCallback(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      setToast("speech not supported in this browser");
      return;
    }
    window.speechSynthesis.cancel();
    const pieces = [
      fields.address1,
      fields.address2,
      fields.address3,
      fields.dear,
      fields.text,
      fields.conclusion,
      fields.signature,
    ]
      .filter(Boolean)
      .join(". ");
    if (!pieces.trim()) {
      setToast("nothing to read");
      return;
    }
    const utter = new SpeechSynthesisUtterance(pieces);
    utter.rate = 0.95;
    utter.pitch = 1.0;
    window.speechSynthesis.speak(utter);
    setToast("reading aloud");
  }, [fields]);

  const stopSpeaking = useCallback(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
  }, []);

  useEffect(() => {
    return () => stopSpeaking();
  }, [stopSpeaking]);

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
              <label className={styles.fieldLabel} htmlFor="address1">address line 1</label>
              <input
                className="nm-input"
                id="address1"
                value={fields.address1}
                onChange={(e) => update("address1", e.target.value)}
              />
            </div>
            <div className={styles.field}>
              <label className={styles.fieldLabel} htmlFor="address2">address line 2</label>
              <input
                className="nm-input"
                id="address2"
                value={fields.address2}
                onChange={(e) => update("address2", e.target.value)}
              />
            </div>
            <div className={styles.field}>
              <label className={styles.fieldLabel} htmlFor="address3">address line 3</label>
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
              <label className={styles.fieldLabel} htmlFor="conclusion">conclusion</label>
              <input
                className="nm-input"
                id="conclusion"
                value={fields.conclusion}
                onChange={(e) => update("conclusion", e.target.value)}
              />
            </div>
            <div className={styles.field}>
              <label className={styles.fieldLabel} htmlFor="signature">signature</label>
              <input
                className="nm-input"
                id="signature"
                value={fields.signature}
                onChange={(e) => update("signature", e.target.value)}
              />
            </div>
          </div>

          <p className={styles.note}>
            Waveforms are synthesised from the text itself — no audio is sent
            anywhere. Optionally use your browser&rsquo;s voice to hear the
            letter while you write it.
          </p>
        </aside>

        <section className={styles.panel}>
          <div className="section">
            <div className="section-head">
              <span className="section-num">2</span>
              <span className="section-title">Letter</span>
            </div>
            <p className={styles.intro}>
              Each field becomes its own row of waveform. Vowels swell,
              consonants snap, punctuation breathes. Export the whole
              assembly as a PDF&nbsp;letter.
            </p>
          </div>

          <div className="section">
            <div className={styles.field}>
              <label className={styles.fieldLabel} htmlFor="dear">greeting</label>
              <input
                className="nm-input"
                id="dear"
                value={fields.dear}
                onChange={(e) => update("dear", e.target.value)}
              />
            </div>
            <div className={styles.field}>
              <label className={styles.fieldLabel} htmlFor="body">body</label>
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
                disabled={isGenerating || !hasAny}
              >
                {isGenerating ? "composing…" : "generate pdf"}
              </button>
              <button type="button" className="nm-btn" onClick={speak}>
                read aloud
              </button>
              <button type="button" className="nm-btn" onClick={stopSpeaking}>
                stop
              </button>
            </div>
          </div>

          <div className={styles.letterFrame} aria-label="letter preview">
            <PreviewSheet rows={rows} />
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
