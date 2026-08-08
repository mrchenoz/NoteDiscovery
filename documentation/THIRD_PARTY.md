# Third-Party Browser Libraries

NoteDiscovery serves every JavaScript and CSS library from its own `/static/vendor/`
path instead of a public CDN. This means:

- **The app works offline** — air-gapped networks, LAN-only installs and internet
  outages no longer break the editor. Previously the UI would not render at all
  without internet, because both the Markdown parser and the UI framework were
  remote. Downloadable HTML exports are the exception, see
  [Known gap](#known-gap-downloadable-html-exports).
- **No third-party requests** — your browser never discloses your IP address or
  the page you are on to jsdelivr, cdnjs or unpkg.
- **No supply-chain exposure to CDNs** — a compromised CDN cannot inject code
  into an app that holds all of your notes.
- **Immune to CDN changes** — pinned versions cannot be moved or removed
  upstream.

## What is bundled

| Library | Version | Licence | Purpose |
|---------|---------|---------|---------|
| [Tailwind CSS](https://tailwindcss.com) | 3.4.17 | MIT | UI styling |
| [Alpine.js](https://alpinejs.dev) | 3.14.1 | MIT | UI reactivity |
| [marked](https://marked.js.org) | 12.0.2 | MIT | Markdown parsing |
| [DOMPurify](https://github.com/cure53/DOMPurify) | 3.0.8 | Apache-2.0 | HTML sanitisation (XSS prevention) |
| [MathJax](https://www.mathjax.org) | 3.2.2 | Apache-2.0 | LaTeX math rendering |
| [highlight.js](https://highlightjs.org) | 11.9.0 | BSD-3-Clause | Code syntax highlighting |
| [Mermaid](https://mermaid.js.org) | 11.12.2 | MIT | Diagram rendering |
| [vis-network](https://visjs.github.io/vis-network/docs/network/) | 9.1.9 | Apache-2.0 | Graph view |
| [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) | 1.4.4 | MIT | QR codes for share links |

Total footprint is about 13 MB, dominated by MathJax's web fonts and Mermaid's
per-diagram chunks.

DOMPurify is dual-licensed Apache-2.0 OR MPL-2.0, and vis-network is
dual-licensed Apache-2.0 OR MIT. Both are taken under Apache-2.0.

All of these licences are permissive and compatible with NoteDiscovery's own MIT
licence. None of them is copyleft, and none places any requirement on your notes
or on how you deploy the app.

Apache-2.0 additionally requires redistributing an upstream `NOTICE` file where
one exists. None of the Apache-2.0 libraries above ships one (checked against the
published packages for the exact pinned versions), so the licence texts we
include are sufficient.

One non-library asset is served locally for the same reason:
`frontend/pikapods-run-button.svg` is PikaPods' own deploy button, kept here so
that opening Settings does not fetch an image from them. It is their brand asset
and is used only to link to them.

## The Excalidraw editor

The Excalidraw editor (see [EXCALIDRAW.md](EXCALIDRAW.md)) is served from
`/static/vendor/excalidraw/` for the same reasons, but it gets there differently:
it is **built rather than downloaded**. Its published package externalises every
dependency it has, and React 19 ships as CommonJS with no UMD build, so neither is
loadable in a browser as published — a bundler has to resolve and convert them.
`scripts/build_excalidraw` does that with esbuild.

| Library | Version | Licence | Purpose |
|---------|---------|---------|---------|
| [Excalidraw](https://github.com/excalidraw/excalidraw) | 0.18.0 | MIT | Vector sketch editor |
| [React](https://react.dev) | 19.0.0 | MIT | Required by Excalidraw, compiled into the bundle |

Those two pull in a further ~143 transitive packages that esbuild inlines. The
build writes a complete list, with licence texts, to
`frontend/vendor/excalidraw/THIRD_PARTY_NOTICES.md`, and records the resolved
versions in `MANIFEST.json`. The spread is 100 MIT, 32 ISC, and the remainder
BSD-3-Clause, Apache-2.0, 0BSD, CC0-1.0, Unlicense and dual-licensed permissive
combinations.

**One exception to the "nothing copyleft" statement above:**
[elkjs](https://github.com/kieler/elkjs) 0.9.3 is **EPL-2.0**, a weak copyleft
licence. It arrives only through `@excalidraw/mermaid-to-excalidraw`, which powers
Excalidraw's "Mermaid to Excalidraw" dialog. EPL-2.0 permits redistribution in
binary/bundled form provided the licence text travels with it (it does, in
`THIRD_PARTY_NOTICES.md`) and the source form remains available to recipients —
elkjs is published unmodified on npm and GitHub, and NoteDiscovery does not modify
it. The obligation attaches to elkjs itself, not to NoteDiscovery or to your notes.
If you would rather not ship an EPL-2.0 component at all, dropping the
mermaid-import feature removes elkjs, cytoscape and katex from the bundle.

Total footprint is about 8.6 MB. Xiaolai, Excalidraw's CJK handwriting font, is
excluded by default because it alone is 12 MB, against ~480 KB for every other
font combined; pass `--with-cjk` to include it.

## How the files get there

The libraries are **not committed to this repository**. `scripts/vendor_assets.py`
downloads them from pinned versions, and `scripts/vendor_lock.json` records a
SHA-256 for every artefact so a download that does not match what was pinned is
rejected rather than installed.

- **Docker** — a dedicated build stage runs the script, so the image ships
  complete and the container never needs internet for the UI.
- **Source installs** — `run.py` runs the script automatically on first start.
  It needs internet that one time; afterwards it is a no-op.

The Excalidraw bundle follows the same shape but needs Node rather than Python.
Docker builds it in its own stage (2b), so the image again ships complete. For a
source install, run it once by hand — `cd scripts/build_excalidraw && npm ci &&
node build.mjs`. Until you do, everything except the Excalidraw editor works
normally; opening a `.excalidraw` file reports that the editor failed to load.

Each library is placed in `frontend/vendor/<library>/` together with its upstream
`LICENSE` file, and `frontend/vendor/THIRD_PARTY_NOTICES.md` indexes the lot.
Those files are part of every distributed artefact, which is what the MIT, BSD
and Apache licences ask for.

## Working with it

```bash
# Download anything missing (safe to re-run; skips what is already correct)
python scripts/vendor_assets.py

# Verify without touching the network, e.g. in CI
python scripts/vendor_assets.py --check

# Re-download everything from scratch
python scripts/vendor_assets.py --force
```

To upgrade a library, edit its version in `scripts/vendor_assets.py`, then:

```bash
python scripts/vendor_assets.py --force --update-lock
```

This refreshes the pinned hashes. Review the resulting `vendor_lock.json` diff
before committing it, since it is the record of exactly what users will receive.

## Known gap: downloadable HTML exports

A downloaded export is the one page that still loads from CDNs, deliberately: it
is meant to be a portable single file that renders on a machine with no access to
your NoteDiscovery server, so pointing it at `/static/vendor/` would make it
*less* portable, not more. The trade-off is that an exported file needs internet
to render maths, diagrams and syntax highlighting. Inlining ~13 MB into every
export is the only alternative that would be truly self-contained.

Everything served by the instance itself uses the vendored copies, including
shared links (`/share/<token>`) and the print preview. Both are produced by
`generate_export_html()` in `backend/export.py`, which switches on its
`local_assets` argument. The CDN versions are pinned to match the vendored ones,
so a note renders the same either way.
