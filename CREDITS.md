# Credits

Soundscribe is a browser-native port of ideas and code by several people.
Here is what came from where.

## What's Jen Cantwell's

The **concept** — rendering written language as visual waveforms on paper,
letter-by-letter. Jen (who now goes by Jen Frankwell) made *Letter Home*
in 2010, a Scottish artwork imagining a migrated bird writing home, its
voice rendered as soundwaves on a folded letter. The original piece is
documented here:

- Artist site: [jenfrankwell.ink](https://jenfrankwell.ink/)
- Original *Letter Home* album: [Flickr](https://www.flickr.com/photos/jencantwell/albums/72157628722284255)

Without Jen's artwork there is no Soundscribe.

## What's @Amustache's

The **original code** — @Amustache built [Cantwell](https://github.com/Amustache/Cantwell),
a Python CLI that turns text-to-speech audio into a visual soundwave PDF
using `gTTS`, `pydub`, `matplotlib`, and `Pillow`. The core contributions
we drew from:

- `src/soundletter/soundletter.py` — the `process()` function that walks a
  dictionary of letter fields and paints each one onto a single A4 page
  at 300 DPI using matplotlib.
- `src/soundletter/helpers.py` — the `create_samples()` / `create_and_paste_image()`
  pipeline that builds each row from an MP3 sample array.
- `src/soundletter/consts.py` — page size (2480 × 3508), DPI (300), margin (150),
  and the per-field horizontal offsets `ADDR_OFF=1800`, `DEAR_OFF=200`,
  `ROWS_OFF=200`. These offsets live on in `lib/letterConsts.ts`.
- `webapp.py` — a later Flask wrapper that added a browser UI with a
  neumorphic aesthetic, an image-to-waveform mode (`_segments_from_image`,
  `_carrier_sized`, `render_png`, `render_svg`), presets, pill/slider
  controls, and live rendering via `/api/waves`. The IMAGE_PAGE and
  TEXT_FORM HTML templates are the reference for the Soundscribe UI.

## What's new in Soundscribe

The **port** — all of that algorithm and UI rewritten in TypeScript +
Next.js, running entirely client-side with zero backend. The visual
language is preserved; the plumbing is not.

- `lib/waveform.ts` mirrors `_segments_from_image` and `_carrier_sized`
  using typed arrays (`Float32Array`, `Float64Array`) and a Mulberry32
  seeded PRNG instead of `numpy.random.default_rng`.
- `lib/imageSource.ts` replaces PIL's `Image.open().convert("L")` with
  Canvas-based resize and Rec. 601 luminance extraction.
- `lib/renderPng.ts` replaces `PIL.ImageDraw` with `Canvas2D` — the four
  styles (line / mirror / filled / bars) and the per-segment gradient
  lerp all match the Python output.
- `lib/renderSvg.ts` emits the same `<svg>` structure as `render_svg` in
  Python, down to gradient defs and the post-rotate transform.
- `lib/renderPdf.ts` replaces `Pillow`'s PDF export and `matplotlib`'s
  page layout with `jspdf` (pinned at 4.2.1 for reproducibility).
- `lib/textWaveform.ts` is new. The Python version depended on Google
  TTS — unreliable to capture in-browser and network-dependent. The
  Soundscribe text tool synthesises waveforms from the text *itself*:
  each character class gets its own envelope, duration, and sub-carrier,
  so dense paragraphs feel textured while addresses stay terse. Seeded
  deterministically from an FNV-1a hash of the text, so the same
  greeting always produces the same line.
- The whole UI (`app/page.tsx`, `app/image/`, `app/text/`, the shared
  Masthead / Footer / PillGroup components, the module CSS) is a React
  rewrite of the original Flask templates, preserving the exact design
  tokens (colors, shadows, radii) and the layout.

## License

All of it, new and old, is MIT-licensed. Use it, fork it, remix it.

## Thanks

- **Jen Cantwell** for dreaming up the gesture.
- **@Amustache** for putting code under it.
- **asciinator.app** for modelling the tool-maker's spirit of doing a
  silly, lovely, useful thing really well.
