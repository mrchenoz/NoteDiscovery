# Excalidraw editor

NoteDiscovery includes an integrated **[Excalidraw](https://excalidraw.com)** whiteboard for hand-drawn-style vector sketches, diagrams, and wireframes. Scenes are stored as ordinary **`.excalidraw` JSON files** in your vault, so they stay fully editable vectors forever — unlike the raster [drawing editor](DRAWING.md), nothing is ever flattened to pixels.

## Creating a sketch

Use the **+ New** menu in the sidebar and choose **New Excalidraw**. The app creates a file named `drawing-{timestamp}.excalidraw` next to your notes (in the folder you pick), then opens it in the Excalidraw editor. You can also set it as the default **+ New** button action in **Settings**.

## Editor overview

The full Excalidraw component runs inside the app pane, so you get the complete Excalidraw feature set:

- **Tools** — Selection, rectangle, diamond, ellipse, arrow, line, freehand draw, text, image, eraser, frames, and the shape library.
- **Undo / redo** — Handled by Excalidraw itself (**Ctrl+Z** / **Ctrl+Shift+Z**), independent of the note editor history.
- **Theme** — The editor follows the app theme (light/dark), including switches made while a scene is open.
- **Saving** — Changes are saved automatically after you stop editing (same debounce as note autosave), and **Ctrl+S** (Cmd+S on Mac) saves immediately. Scenes are serialized with Excalidraw's own `serializeAsJSON`, so the files are interoperable with excalidraw.com and other Excalidraw tools.

## Files on disk

- Any file with the **`.excalidraw`** extension opens in the Excalidraw editor — including files you export from [excalidraw.com](https://excalidraw.com) and drop into your vault.
- New sketches created from the **+ New** menu are named **`drawing-{timestamp}.excalidraw`**, mirroring the raster drawing convention.
- Files are standard Excalidraw scene JSON (`{"type": "excalidraw", "version": 2, "elements": [...], ...}`) — plain text, diff-able, and portable.

## How it loads

The editor is a React component, vendored into `frontend/vendor/excalidraw/` as a self-contained ESM bundle with React compiled in. Nothing is fetched from a CDN at runtime, so the editor works fully offline like the rest of the app. `excalidraw-editor.js` imports the bundle lazily, the first time you open a `.excalidraw` file — the app itself starts without loading any of it.

Code splitting keeps that first load small: the entry chunk is ~750 KB (~180 KB gzipped), while the ~40 UI locales and the Mermaid-import feature load on demand.

### Building the bundle

Unlike the other browser libraries, Excalidraw can't go through `scripts/vendor_assets.py`. Its published build externalises every dependency it has (`jotai`, `roughjs`, `pako`, `@radix-ui/*`, …), and React 19 ships as CommonJS with no UMD build — neither is loadable in a browser as published, so a bundler has to resolve and convert them.

Docker builds it automatically (stage 2b). For a local checkout it needs Node once:

```bash
cd scripts/build_excalidraw
npm ci
node build.mjs                # → frontend/vendor/excalidraw/
node build.mjs --with-cjk     # also ship Xiaolai, the 12 MB CJK handwriting font
```

Versions are pinned in `scripts/build_excalidraw/package.json`; bump there and re-run to upgrade. The build writes `MANIFEST.json` and `THIRD_PARTY_NOTICES.md` alongside the bundle, covering all 145 packages it inlines — see [THIRD_PARTY.md](THIRD_PARTY.md).

Xiaolai is skipped by default purely for size: it is 12 MB against ~480 KB for every other font combined. Without it, CJK glyphs in a scene fall back to a system font.

## Where the code lives

The editor is self-contained in **`frontend/excalidraw-editor.js`** (loaded before `app.js`), which owns the lazy bundle load, the scene autosave loop, the scene keyboard shortcuts and the mount/unmount lifecycle. It exposes `window.ExcalidrawEditor` with `createNew(app)`, `mount(app)`, `save()`, `teardown({flush})`, `mountedFor()` and `setTheme(type)`; `app.js` only forwards to those, so it carries none of the editor's internals.

## API

- **`POST /api/upload-media`** with `next_to_notes=1` and a `.excalidraw` file creates a new scene next to your notes (this is what the **+ New** menu uses).
- **`PUT /api/media/{path}`** with a JSON body updates an existing scene in place; the server validates the body parses as a JSON object. See [API.md](API.md#update-drawing-png-in-place).
- **`GET /api/media/{path}`** serves scenes with `Content-Type: application/json`.

## See also

- [DRAWING.md](DRAWING.md) — The raster (PNG) drawing editor for quick freehand sketches
- [FEATURES.md](FEATURES.md) — Full feature list and keyboard shortcuts
- [API.md](API.md) — Media endpoints
