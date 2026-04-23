"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from "react";
import Masthead from "@/components/Masthead";
import Footer from "@/components/Footer";
import PillGroup from "@/components/PillGroup";
import {
  loadImageFromFile,
  type LoadedImage,
} from "@/lib/imageSource";
import {
  segmentsFromImage,
  type Mode,
  type Noise,
  type Rotation,
  type Style,
  type WaveformParams,
} from "@/lib/waveform";
import { canvasToPngBlob, renderPngToCanvas } from "@/lib/renderPng";
import { renderSvg } from "@/lib/renderSvg";
import { renderWaveformPdfBlob } from "@/lib/renderPdf";
import styles from "./image.module.css";

const DEFAULTS: WaveformParams = {
  mode: "rows",
  style: "filled",
  noise: "noise",
  rows: 50,
  cols: 30,
  freq: 200,
  amp: 2.0,
  thick: 4,
  rotation: 0,
  invert: false,
  fg: "#000000",
  fg2: "#000000",
  bg: "#ffffff",
};

const PRESETS: Record<string, Partial<WaveformParams>> = {
  organic: {
    mode: "rows",
    style: "filled",
    noise: "noise",
    rows: 30,
    freq: 180,
    amp: 1.4,
    thick: 1,
    fg: "#000000",
    fg2: "#000000",
    bg: "#ffffff",
    rotation: 0,
    invert: false,
  },
  bars: {
    mode: "rows",
    style: "bars",
    noise: "noise",
    rows: 30,
    freq: 180,
    amp: 1.5,
    thick: 3,
    fg: "#d47575",
    fg2: "#d47575",
    bg: "#ffffff",
    rotation: 0,
    invert: false,
  },
  spectrum: {
    mode: "rows",
    style: "mirror",
    noise: "noise",
    rows: 60,
    freq: 120,
    amp: 1.3,
    thick: 1,
    fg: "#ffffff",
    fg2: "#89cff0",
    bg: "#ffffff",
    rotation: 0,
    invert: false,
  },
  geometric: {
    mode: "rows",
    style: "line",
    noise: "sine",
    rows: 30,
    freq: 60,
    amp: 1.1,
    thick: 2,
    fg: "#111111",
    fg2: "#111111",
    bg: "#ffffff",
    rotation: 0,
    invert: false,
  },
  grid: {
    mode: "grid",
    style: "filled",
    noise: "noise",
    rows: 16,
    cols: 22,
    freq: 200,
    amp: 1.3,
    thick: 1,
    fg: "#000000",
    fg2: "#000000",
    bg: "#ffffff",
    rotation: 0,
    invert: false,
  },
};

function paramsToSearch(p: WaveformParams): string {
  const q = new URLSearchParams();
  q.set("mode", p.mode);
  q.set("style", p.style);
  q.set("noise", p.noise);
  q.set("rows", String(p.rows));
  q.set("cols", String(p.cols));
  q.set("freq", String(p.freq));
  q.set("amp", p.amp.toFixed(2));
  q.set("thick", String(p.thick));
  q.set("rotation", String(p.rotation));
  q.set("invert", p.invert ? "1" : "0");
  q.set("fg", p.fg);
  q.set("fg2", p.fg2);
  q.set("bg", p.bg);
  return q.toString();
}

function paramsFromSearch(search: string): Partial<WaveformParams> {
  const q = new URLSearchParams(search);
  const out: Partial<WaveformParams> = {};
  const mode = q.get("mode");
  if (mode === "rows" || mode === "grid") out.mode = mode;
  const style = q.get("style");
  if (style === "line" || style === "mirror" || style === "filled" || style === "bars")
    out.style = style;
  const noise = q.get("noise");
  if (noise === "noise" || noise === "sine" || noise === "chirp") out.noise = noise;
  const num = (name: string, lo: number, hi: number): number | undefined => {
    const v = Number(q.get(name));
    if (!Number.isFinite(v)) return undefined;
    return Math.max(lo, Math.min(hi, v));
  };
  const rows = num("rows", 5, 150);
  if (rows !== undefined) out.rows = Math.round(rows);
  const cols = num("cols", 2, 80);
  if (cols !== undefined) out.cols = Math.round(cols);
  const freq = num("freq", 2, 200);
  if (freq !== undefined) out.freq = freq;
  const amp = num("amp", 0.2, 2);
  if (amp !== undefined) out.amp = amp;
  const thick = num("thick", 1, 8);
  if (thick !== undefined) out.thick = Math.round(thick);
  const rot = q.get("rotation");
  if (rot === "0" || rot === "90" || rot === "180" || rot === "270")
    out.rotation = Number(rot) as Rotation;
  const inv = q.get("invert");
  if (inv === "0" || inv === "1") out.invert = inv === "1";
  const fg = q.get("fg");
  if (fg && /^#[0-9a-fA-F]{6}$/.test(fg)) out.fg = fg;
  const fg2 = q.get("fg2");
  if (fg2 && /^#[0-9a-fA-F]{6}$/.test(fg2)) out.fg2 = fg2;
  const bg = q.get("bg");
  if (bg && /^#[0-9a-fA-F]{6}$/.test(bg)) out.bg = bg;
  return out;
}

export default function ImagePage() {
  const [loaded, setLoaded] = useState<LoadedImage | null>(null);
  const [sourceName, setSourceName] = useState<string>("upload image");
  const [isDragging, setIsDragging] = useState(false);
  const [isRendering, setIsRendering] = useState(false);
  const [params, setParams] = useState<WaveformParams>(DEFAULTS);
  const [toast, setToast] = useState<string | null>(null);

  const previewRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const renderTimer = useRef<number | null>(null);
  const renderSeq = useRef(0);

  // Hydrate params from URL on mount.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const fromUrl = paramsFromSearch(window.location.search);
    if (Object.keys(fromUrl).length) {
      setParams((prev) => ({ ...prev, ...fromUrl }));
    }
  }, []);

  // Sync URL whenever params change.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const qs = paramsToSearch(params);
    const next = `${window.location.pathname}?${qs}`;
    window.history.replaceState(null, "", next);
  }, [params]);

  const update = useCallback(<K extends keyof WaveformParams>(key: K, value: WaveformParams[K]) => {
    setParams((prev) => ({ ...prev, [key]: value }));
  }, []);

  const applyPreset = useCallback((name: keyof typeof PRESETS) => {
    setParams((prev) => ({ ...prev, ...PRESETS[name] }));
  }, []);

  const handleFile = useCallback(async (file: File) => {
    if (!/image\/(png|jpeg|jpg)/.test(file.type) && !/\.(png|jpe?g)$/i.test(file.name)) {
      setToast("unsupported file type");
      return;
    }
    setSourceName(file.name);
    try {
      const img = await loadImageFromFile(file);
      setLoaded(img);
    } catch (err) {
      console.error(err);
      setToast("couldn't read that image");
    }
  }, []);

  const onFileInputChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) void handleFile(file);
    },
    [handleFile],
  );

  const onDrop = useCallback(
    (e: DragEvent<HTMLLabelElement>) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files?.[0];
      if (file) void handleFile(file);
    },
    [handleFile],
  );

  const onDragOver = useCallback((e: DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const onDragLeave = useCallback((e: DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  // Debounced render on param or image change.
  useEffect(() => {
    if (!loaded) return;
    if (renderTimer.current) window.clearTimeout(renderTimer.current);
    renderTimer.current = window.setTimeout(() => {
      const seq = ++renderSeq.current;
      setIsRendering(true);
      // Yield to the event loop so the busy class paints before we block.
      window.requestAnimationFrame(() => {
        if (seq !== renderSeq.current) return;
        try {
          const result = segmentsFromImage(loaded, params);
          const canvas = previewRef.current;
          if (!canvas) return;
          renderPngToCanvas(canvas, {
            segments: result.segments,
            drawW: result.drawW,
            drawH: result.drawH,
            bg: params.bg,
            fg: params.fg,
            fg2: params.fg2,
            style: params.style,
            thick: params.thick,
          });
        } catch (err) {
          console.error(err);
          setToast("render failed");
        } finally {
          setIsRendering(false);
        }
      });
    }, 160);
    return () => {
      if (renderTimer.current) window.clearTimeout(renderTimer.current);
    };
  }, [loaded, params]);

  // Download helpers
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

  const downloadPng = useCallback(async () => {
    if (!loaded) return;
    const canvas = previewRef.current;
    if (!canvas) return;
    const blob = await canvasToPngBlob(canvas);
    downloadBlob(blob, "waves.png");
  }, [loaded, downloadBlob]);

  const downloadSvg = useCallback(() => {
    if (!loaded) return;
    const result = segmentsFromImage(loaded, params);
    const svg = renderSvg({
      segments: result.segments,
      finalW: result.finalW,
      finalH: result.finalH,
      drawW: result.drawW,
      drawH: result.drawH,
      bg: params.bg,
      fg: params.fg,
      fg2: params.fg2,
      style: params.style,
      thick: params.thick,
      rotation: params.rotation,
    });
    downloadBlob(new Blob([svg], { type: "image/svg+xml" }), "waves.svg");
  }, [loaded, params, downloadBlob]);

  const downloadPdf = useCallback(() => {
    if (!loaded) return;
    const result = segmentsFromImage(loaded, params);
    const blob = renderWaveformPdfBlob({
      segments: result.segments,
      drawW: result.drawW,
      drawH: result.drawH,
      bg: params.bg,
      fg: params.fg,
      fg2: params.fg2,
      style: params.style,
      thick: params.thick,
    });
    downloadBlob(blob, "waves.pdf");
  }, [loaded, params, downloadBlob]);

  const copyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setToast("link copied · re-upload to resume");
    } catch {
      setToast("copy failed");
    }
  }, []);

  // Toast auto-hide
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 1600);
    return () => window.clearTimeout(t);
  }, [toast]);

  const hasImage = !!loaded;
  const thumbUrl = loaded?.thumbnailDataUrl;
  const sub = useMemo(() => {
    if (!loaded) return "drop or browse · png · jpg";
    return `${loaded.width} × ${loaded.height}`;
  }, [loaded]);

  return (
    <div className="wrap">
      <Masthead />

      <div className={styles.layout}>
        <aside className={styles.controls}>
          {/* Source */}
          <div className="section">
            <div className="section-head">
              <span className="section-num">0</span>
              <span className="section-title">Source</span>
            </div>
            <label
              className={`${styles.drop}${isDragging ? ` ${styles.drag}` : ""}`}
              onDrop={onDrop}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDragEnter={onDragOver}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/jpg"
                onChange={onFileInputChange}
              />
              <div className={styles.srcThumb}>
                {thumbUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={thumbUrl} alt="" />
                ) : (
                  <span className={styles.srcIcon}>+</span>
                )}
              </div>
              <div className={styles.srcText}>
                <div className={styles.srcTitle}>{sourceName}</div>
                <div className={styles.srcSub}>
                  {hasImage ? (
                    <>
                      {sub} · <span className={styles.replace}>replace</span>
                    </>
                  ) : (
                    sub
                  )}
                </div>
              </div>
            </label>
          </div>

          {/* Presets */}
          <div className="section">
            <div className="section-head">
              <span className="section-num">1</span>
              <span className="section-title">Presets</span>
              <button
                type="button"
                className="small-action"
                onClick={() => setParams(DEFAULTS)}
              >
                reset
              </button>
            </div>
            <div className="presets">
              {Object.keys(PRESETS).map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => applyPreset(name)}
                >
                  {name}
                </button>
              ))}
            </div>
          </div>

          {/* Layout */}
          <div className="section">
            <div className="section-head">
              <span className="section-num">2</span>
              <span className="section-title">Layout</span>
            </div>
            <div className="field">
              <div className="field-label">
                <span>mode</span>
              </div>
              <PillGroup<Mode>
                value={params.mode}
                options={[
                  { value: "rows", label: "rows" },
                  { value: "grid", label: "grid" },
                ]}
                onChange={(v) => update("mode", v)}
                ariaLabel="mode"
              />
            </div>
            <div className="field">
              <div className="field-label">
                <span>rows</span>
                <span className="val">{params.rows}</span>
              </div>
              <div className="slider-wrap">
                <input
                  type="range"
                  min={5}
                  max={150}
                  value={params.rows}
                  onChange={(e) => update("rows", Number(e.target.value))}
                />
              </div>
            </div>
            {params.mode === "grid" && (
              <div className="field">
                <div className="field-label">
                  <span>cols</span>
                  <span className="val">{params.cols}</span>
                </div>
                <div className="slider-wrap">
                  <input
                    type="range"
                    min={2}
                    max={80}
                    value={params.cols}
                    onChange={(e) => update("cols", Number(e.target.value))}
                  />
                </div>
              </div>
            )}
            <div className="field">
              <div className="field-label">
                <span>orientation</span>
              </div>
              <PillGroup<"0" | "90">
                value={params.rotation === 90 ? "90" : "0"}
                options={[
                  { value: "0", label: "horiz" },
                  { value: "90", label: "vert" },
                ]}
                onChange={(v) => update("rotation", Number(v) as Rotation)}
                ariaLabel="orientation"
              />
            </div>
          </div>

          {/* Waveform */}
          <div className="section">
            <div className="section-head">
              <span className="section-num">3</span>
              <span className="section-title">Waveform</span>
            </div>
            <div className="field">
              <div className="field-label">
                <span>style</span>
              </div>
              <PillGroup<Style>
                value={params.style}
                options={[
                  { value: "line", label: "line" },
                  { value: "mirror", label: "mirror" },
                  { value: "filled", label: "filled" },
                  { value: "bars", label: "bars" },
                ]}
                onChange={(v) => update("style", v)}
                ariaLabel="style"
              />
            </div>
            <div className="field">
              <div className="field-label">
                <span>carrier</span>
              </div>
              <PillGroup<Noise>
                value={params.noise}
                options={[
                  { value: "noise", label: "noise" },
                  { value: "sine", label: "sine" },
                  { value: "chirp", label: "chirp" },
                ]}
                onChange={(v) => update("noise", v)}
                ariaLabel="carrier"
              />
            </div>
            <div className="field">
              <div className="field-label">
                <span>frequency</span>
                <span className="val">{params.freq}</span>
              </div>
              <div className="slider-wrap">
                <input
                  type="range"
                  min={2}
                  max={200}
                  value={params.freq}
                  onChange={(e) => update("freq", Number(e.target.value))}
                />
              </div>
            </div>
            <div className="field">
              <div className="field-label">
                <span>amplitude</span>
                <span className="val">{params.amp.toFixed(1)}</span>
              </div>
              <div className="slider-wrap">
                <input
                  type="range"
                  min={0.2}
                  max={2}
                  step={0.1}
                  value={params.amp}
                  onChange={(e) => update("amp", Number(e.target.value))}
                />
              </div>
            </div>
          </div>

          {/* Appearance */}
          <div className="section">
            <div className="section-head">
              <span className="section-num">4</span>
              <span className="section-title">Appearance</span>
            </div>
            <div className="field">
              <div className="field-label">
                <span>thickness</span>
                <span className="val">{params.thick}</span>
              </div>
              <div className="slider-wrap">
                <input
                  type="range"
                  min={1}
                  max={8}
                  value={params.thick}
                  onChange={(e) => update("thick", Number(e.target.value))}
                />
              </div>
            </div>
            <div className="field">
              <div className="color-row">
                <label className="color-chip">
                  <input
                    type="color"
                    value={params.fg}
                    onChange={(e) => update("fg", e.target.value)}
                  />
                  start
                </label>
                <label className="color-chip">
                  <input
                    type="color"
                    value={params.fg2}
                    onChange={(e) => update("fg2", e.target.value)}
                  />
                  end
                </label>
                <label className="color-chip">
                  <input
                    type="color"
                    value={params.bg}
                    onChange={(e) => update("bg", e.target.value)}
                  />
                  bg
                </label>
              </div>
            </div>
            <div className="field">
              <div className="field-label">
                <span>contrast</span>
              </div>
              <PillGroup<"0" | "1">
                value={params.invert ? "1" : "0"}
                options={[
                  { value: "0", label: "dark → big" },
                  { value: "1", label: "light → big" },
                ]}
                onChange={(v) => update("invert", v === "1")}
                ariaLabel="contrast"
              />
            </div>
          </div>

          {/* Export */}
          <div className="section">
            <div className="section-head">
              <span className="section-num">5</span>
              <span className="section-title">Export</span>
            </div>
            <div className="dl-row">
              <button
                type="button"
                className="primary"
                disabled={!hasImage}
                onClick={downloadPng}
              >
                png
              </button>
              <button type="button" disabled={!hasImage} onClick={downloadSvg}>
                svg
              </button>
              <button type="button" disabled={!hasImage} onClick={downloadPdf}>
                pdf
              </button>
            </div>
            <div className="dl-row" style={{ marginTop: "0.55rem" }}>
              <button type="button" disabled={!hasImage} onClick={copyLink}>
                copy share link
              </button>
            </div>
          </div>
        </aside>

        <section className={styles.canvasArea}>
          <div
            className={`${styles.previewFrame}${hasImage ? ` ${styles.hasImage}` : ""}${
              isRendering ? ` ${styles.busy}` : ""
            }`}
          >
            {hasImage ? (
              <canvas
                ref={previewRef}
                className={styles.previewCanvas}
                aria-label="waveform preview"
              />
            ) : (
              <div className={styles.placeholder}>
                awaiting signal
                <small>drop an image into the source panel to begin</small>
              </div>
            )}
          </div>

          <div className="explore">
            <span className="explore-label">explore more</span>
            <a className="explore-link" href="/text">
              Sound letter inspiration <span className="arr">→</span>
            </a>
          </div>
        </section>
      </div>

      <Footer />

      <div className={`toast${toast ? " show" : ""}`}>{toast ?? ""}</div>
    </div>
  );
}
