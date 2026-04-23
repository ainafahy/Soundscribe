import { VERSION } from "@/lib/version";

export default function Footer() {
  return (
    <footer className="site-footer" aria-label="credits">
      <div className="site-footer-credits">
        Concept by{" "}
        <a
          href="https://jenfrankwell.ink/"
          target="_blank"
          rel="noopener noreferrer"
        >
          Jen Cantwell
        </a>
        . Original Python tool by{" "}
        <a
          href="https://github.com/Amustache/Cantwell"
          target="_blank"
          rel="noopener noreferrer"
        >
          @Amustache
        </a>
        . Ported & designed by{" "}
        <a
          href="https://ainafahy.com"
          target="_blank"
          rel="noopener noreferrer"
        >
          Aïna Fahy
        </a>
        .{" "}
        <a
          href="https://github.com/ainafahy/Soundscribe"
          target="_blank"
          rel="noopener noreferrer"
        >
          Source on GitHub
        </a>
        . MIT licensed · inspired by asciinator.app in spirit.
      </div>
      <div className="site-footer-version" title={`Soundscribe ${VERSION}`}>
        {VERSION}
      </div>
    </footer>
  );
}
