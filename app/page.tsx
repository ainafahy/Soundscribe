import Image from "next/image";
import Link from "next/link";
import Masthead from "@/components/Masthead";
import Footer from "@/components/Footer";
import styles from "./home.module.css";

export default function Home() {
  return (
    <div className="wrap">
      <Masthead />

      <section className={styles.hero}>
        <p className={styles.lede}>
          Soundscribe turns photographs and written words into waveforms.
          No backend. No uploads. No tracking. Play around and send me
          feedback ! &lt;3
        </p>
      </section>

      <section className={styles.cards}>
        <Link href="/image" className={styles.card}>
          <div className={styles.cardGlyph} aria-hidden="true">
            <Image
              src="/image-2.png"
              alt=""
              width={1172}
              height={634}
              className={styles.cardImage}
              priority
            />
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
            <Image
              src="/text-2.png"
              alt=""
              width={874}
              height={524}
              className={styles.cardImage}
            />
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
