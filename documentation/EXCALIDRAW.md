# Excalidraw editor

NoteDiscovery includes an integrated **[Excalidraw](https://excalidraw.com)** whiteboard for hand-drawn-style vector sketches, diagrams, and wireframes. Scenes are stored as ordinary **`.excalidraw` JSON files** in your vault, so they stay fully editable vectors forever — unlike the raster [drawing editor](DRAWING.md), nothing is ever flattened to pixels.

## Creating a sketch

Use the **+ New** menu in the sidebar and choose **New Excalidraw**. The app creates a file named `drawing-{timestamp}.excalidraw` next to your notes (in the folder you pick), then opens it in the Excalidraw editor. You can also set it as the default **+ New** button action in **Settings**.

## Editor overview

The full Excalidraw component runs inside the app pane, so you get the complete Excalidraw feature set:

- **Tools** — Selection, rectangle, diamond, ellipse, arrow, line, freehand draw, text, image, eraser, frames, and the shape library.
- **Undo / redo** — Handled by Excalidraw itself (**Ctrl+Z** / **Ctrl+Shift+Z**), independent of the note editor history.
- **Theme** — The editor follows the app theme (light/dark) at the time it opens.
- **Saving** — Changes are saved automatically after you stop editing (same debounce as note autosave), and **Ctrl+S** (Cmd+S on Mac) saves immediately. Scenes are serialized with Excalidraw's own `serializeAsJSON`, so the files are interoperable with excalidraw.com and other Excalidraw tools.

## Files on disk

- Any file with the **`.excalidraw`** extension opens in the Excalidraw editor — including files you export from [excalidraw.com](https://excalidraw.com) and drop into your vault.
- New sketches created from the **+ New** menu are named **`drawing-{timestamp}.excalidraw`**, mirroring the raster drawing convention.
- Files are standard Excalidraw scene JSON (`{"type": "excalidraw", "version": 2, "elements": [...], ...}`) — plain text, diff-able, and portable.

## How it loads (CDN dependency)

The Excalidraw editor is a React component. NoteDiscovery stays build-free by loading React and the Excalidraw ESM bundle **lazily from CDN (esm.sh / unpkg) the first time you open a `.excalidraw` file** — the app itself starts without loading any of it. This matches how the app already loads its other frontend libraries, but it does mean the Excalidraw editor needs internet access on first use per session. Viewing notes and all other features remain fully offline.

The pinned versions live in two places that must stay in sync:

- `frontend/index.html` — the `importmap` pinning `react` / `react-dom`
- `frontend/excalidraw-editor.js` — `ESM_URL`, `CSS_URL`, `ASSET_PATH`

## Where the code lives

The editor is self-contained in **`frontend/excalidraw-editor.js`** (loaded before `app.js`), which owns the lazy React/ESM loading, the scene autosave loop, and the mount/unmount lifecycle. It exposes `window.ExcalidrawEditor` with `createNew(app)`, `mount(app)`, `save()`, `teardown({flush})` and `mountedFor()`; `app.js` only forwards to those, so it carries none of the editor's internals.

## API

- **`POST /api/upload-media`** with `next_to_notes=1` and a `.excalidraw` file creates a new scene next to your notes (this is what the **+ New** menu uses).
- **`PUT /api/media/{path}`** with a JSON body updates an existing scene in place; the server validates the body parses as a JSON object. See [API.md](API.md#update-drawing-png-in-place).
- **`GET /api/media/{path}`** serves scenes with `Content-Type: application/json`.

## See also

- [DRAWING.md](DRAWING.md) — The raster (PNG) drawing editor for quick freehand sketches
- [FEATURES.md](FEATURES.md) — Full feature list and keyboard shortcuts
- [API.md](API.md) — Media endpoints
