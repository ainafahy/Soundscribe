# Soundscribe

A visual soundwave tool — turn text and images into waveform art, right in your browser.

Live at: https://soundscribe.ainafahy.com

## Lineage

Soundscribe stands on the shoulders of two wonderful humans:

- **Jen Cantwell** (who now goes by [Jen Frankwell](https://jenfrankwell.ink/)) — the Scottish artist whose 2010 piece *Letter Home* sparked everything. Her artwork imagined a migrated bird writing home, its voice rendered as visual waveforms on paper. The original artwork: [Flickr album](https://www.flickr.com/photos/jencantwell/albums/72157628722284255).

- **[@Amustache](https://github.com/Amustache)** — who, inspired by Jen's piece, built [Cantwell](https://github.com/Amustache/Cantwell): a Python CLI tool that converts text-to-speech audio into visual soundwave PDFs. Cantwell is the technical ancestor of Soundscribe.

Soundscribe extends that lineage in two ways:
1. It gives Cantwell's text-to-waveform idea a friendly UI, so anyone can use it without a terminal.
2. It adds a second mode: image-to-waveform, turning any photograph into a dense visual waveform texture.

## What it does

- **📝 Text → Waveform** — Write a letter, hear it spoken by your browser, watch it become a visual soundwave.
- **🖼️ Image → Waveform** — Upload a photograph, watch it get scanned and rewritten as dense horizontal waveforms.

Export as PNG, SVG, or PDF. No account, no upload to a server, no cost. Everything happens in your browser.

## Tech

Built with Next.js, TypeScript, and the Web Canvas + Web Speech APIs. No backend. No tracking. Runs entirely client-side.

## License

[MIT](./LICENSE). Use it, fork it, remix it, remake it. If you make something cool with it, I'd love to see — tag me on [Twitter/X](https://twitter.com/ainafahy) or open an issue.

## Credits

- Concept: Jen Cantwell
- Original code: [@Amustache](https://github.com/Amustache)
- UI design & this implementation: [Aïna Fahy](https://ainafahy.com)
- Inspired in tool-making spirit by [asciinator.app](https://asciinator.app/)
