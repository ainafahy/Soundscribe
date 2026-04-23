import Link from "next/link";
import Masthead from "@/components/Masthead";
import Footer from "@/components/Footer";
import styles from "./home.module.css";

export default function Home() {
  return (
    <div className="wrap">
      <Masthead />

      <section className={styles.hero}>
        <p className={styles.eyebrow}>a visual soundwave tool</p>
        <h1 className={styles.title}>
          Make a wave
          <span className={styles.titleBreak}> from anything.</span>
        </h1>
        <p className={styles.lede}>
          Soundscribe turns photographs and written words into waveforms.
          No backend. No uploads. No tracking. Play around and send me
          feedback ! &lt;3
        </p>
      </section>

      <section className={styles.cards}>
        <Link href="/image" className={styles.card}>
          <div className={styles.cardGlyph} aria-hidden="true">
            <svg viewBox="0 0 120 64" className={styles.cardWave}>
              <path
                d="M 0 32 C 8 10, 14 54, 22 32 S 34 10, 42 32 S 54 54, 62 32 S 74 10, 82 32 S 94 54, 102 32 S 114 10, 120 32"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </div>
          <div className={styles.cardCopy}>
            <span className={styles.cardKicker}>01 · image</span>
            <h2 className={styles.cardTitle}>Image &rarr; Waveform</h2>
            <p className={styles.cardDesc}>
              Drop any photograph. Soundscribe scans its pixels row by row
              and rewrites them as dense, amplitude-modulated lines.
              Export as PNG, SVG, or PDF.
            </p>
            <span className={styles.cardCta}>
              open the image tool <span className={styles.arr}>&rarr;</span>
            </span>
          </div>
        </Link>

        <Link href="/text" className={styles.card}>
          <div className={styles.cardGlyph} aria-hidden="true">
            <svg viewBox="0 0 120 64" className={styles.cardWave}>
              <g fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
                <path d="M 4 18 L 116 18" opacity="0.35" />
                <path d="M 4 32 C 18 20, 30 44, 44 32 S 66 18, 80 32 S 104 42, 116 32" />
                <path d="M 4 48 L 68 48" opacity="0.35" />
              </g>
            </svg>
          </div>
          <div className={styles.cardCopy}>
            <span className={styles.cardKicker}>02 · text</span>
            <h2 className={styles.cardTitle}>Text &rarr; Waveform</h2>
            <p className={styles.cardDesc}>
              Write a letter. Each field — address, greeting, body,
              signature — becomes its own handwritten-looking row of
              waveform. Export the whole thing as a PDF letter.
            </p>
            <span className={styles.cardCta}>
              open the text tool <span className={styles.arr}>&rarr;</span>
            </span>
          </div>
        </Link>
      </section>

      <Footer />
    </div>
  );
}
