# Soundscribe

A visual soundwave tool, turn text and images into waveform art, right in your browser.

Live at: https://soundscribe.ainafahy.com

## Lineage

Soundscribe stands on the shoulders of two wonderful humans:

- **Jen Cantwell** (who now goes by [Jen Frankwell](https://jenfrankwell.ink/)) — the Scottish artist whose 2011 piece *Letter Home* sparked everything. Her artwork imagined a migrated bird writing home, its voice rendered as visual waveforms on paper. The original artwork: [Flickr album](https://www.flickr.com/photos/jencantwell/albums/72157628722284255).

- **[@Amustache](https://github.com/Amustache)** — who, inspired by Jen's piece, built [Cantwell](https://github.com/Amustache/Cantwell): a Python CLI tool that converts text-to-speech audio into visual soundwave PDFs. Cantwell is the technical ancestor of Soundscribe.

Soundscribe extends that lineage in two ways:
1. It gives Cantwell's text-to-waveform idea a friendly UI, so anyone can use it without a terminal.
2. It adds a second mode: image-to-waveform, turning any photograph into a dense visual waveform texture.

## What it does

- **🖼️ Image → Waveform** — Upload a photograph, watch it get scanned row-by-row and rewritten as dense horizontal waveforms. Four styles (line / mirror / filled / bars), five presets, live preview as you tweak. Export as PNG, SVG, or PDF.
- **📝 Text → Waveform** — Write a letter. Each field (address, greeting, body, sign-off, signature) becomes its own handwritten-looking row. Vowels swell, consonants snap, punctuation breathes. Export the whole composition as a PDF.

No account, no upload to a server, no cost. Everything happens in your browser.

## Tech

Built with Next.js 16, TypeScript, and the Web Canvas API. Waveform synthesis is a TypeScript port of [@Amustache](https://github.com/Amustache)'s [Cantwell](https://github.com/Amustache/Cantwell) Python CLI, rewritten to run entirely client-side. PDF export uses [jsPDF](https://github.com/parallax/jsPDF). No backend. No tracking. No external requests except loading fonts.

## Local development

```bash
npm install
npm run dev
# → http://localhost:3000
```

Build: `npm run build`. Lint: `npm run lint`.

## License

[MIT](./LICENSE). Use it, fork it, remix it, remake it. If you make something cool with it, I'd love to see — tag me on [Twitter/X](https://twitter.com/ainafahy) or open an issue.

## Credits

- Concept: Jen Cantwell
- Original code for text to soundwave : [@Amustache](https://github.com/Amustache)
- UI design & this implementation + image making : [Aïna Fahy](https://ainafahy.com)
