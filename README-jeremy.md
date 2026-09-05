# Fork notes — mrchenoz/NoteDiscovery

Fork-specific notes for this branch. Not upstream documentation; upstream's docs
live in `documentation/`. This file exists so known issues and fork-maintenance
context don't have to be rediscovered.

## What this fork adds

An **Excalidraw editor** for `*.excalidraw` vector scenes, alongside upstream's
raster drawing editor. See [documentation/EXCALIDRAW.md](documentation/EXCALIDRAW.md)
for how it works.

| | |
|---|---|
| Branch | `feature/excalidraw-editor` |
| `origin` | `https://github.com/mrchenoz/NoteDiscovery.git` (detached copy since 2026-09-05; jeremy-oz/NoteDiscovery is retired) |
| `upstream` | `https://github.com/gamosoft/notediscovery.git` (fetch only) |

## Local setup

The Excalidraw bundle is **built, not downloaded**, and is not committed. A fresh
checkout needs it once:

```bash
cd scripts/build_excalidraw && npm ci && node build.mjs
```

Without it the app runs fine, but opening a `.excalidraw` file reports that the
editor failed to load. Docker builds it automatically (stage 2b). The other
browser libraries come from `python scripts/vendor_assets.py`, which `run.py` runs
on first start.

---

## Known issues

### Cmd+Z undo not verified end-to-end

Excalidraw's undo/redo is handled by the component itself. The **toolbar undo
button works**, and a DOM probe confirmed the `Cmd+Z` keydown reaches both
`document` and the Excalidraw host untouched by our capture-phase listener — but
Excalidraw doesn't act on Playwright's *synthetic* key events, so automation
can't confirm the shortcut. **Needs one manual check in a real browser.**

If it turns out to be broken, the suspect is the capture-phase listener at the
bottom of `frontend/excalidraw-editor.js`, which calls `stopPropagation()` for
`z`/`y` only when focus is *outside* the canvas.

### elkjs is EPL-2.0 (weak copyleft)

The vendored bundle inlines 145 packages. All permissive except **elkjs 0.9.3**,
which is EPL-2.0 and arrives via `@excalidraw/mermaid-to-excalidraw` (the
"Mermaid to Excalidraw" dialog).

Redistribution in bundled form is permitted — the licence text ships in
`frontend/vendor/excalidraw/THIRD_PARTY_NOTICES.md`, elkjs is unmodified, and its
source is public. The obligation attaches to elkjs, not to NoteDiscovery or your
notes. Full reasoning in [documentation/THIRD_PARTY.md](documentation/THIRD_PARTY.md).

**Relevant if upstreaming:** upstream's `THIRD_PARTY.md` previously stated that
nothing bundled is copyleft. Dropping the mermaid-import feature would remove
elkjs, cytoscape and katex and restore that claim.

### CJK handwriting font excluded by default

Xiaolai is 12 MB, against ~480 KB for every other Excalidraw font combined, so
`build.mjs` skips it. CJK glyphs in a scene fall back to a system font. Pass
`--with-cjk` to include it.

---

## Fixed along the way (don't re-investigate)

- **Opening a scene rewrote its file.** `mount()` set `lastSavedJSON = null`, and
  Excalidraw emits an `onChange` on first render (loading normalises the scene —
  `"boundElements": null` becomes `[]`), so the dedupe guard in `save()` could
  never match and every open wrote the file. Harmless for content, but it churned
  mtime on read, which breaks sort-by-modified and makes Syncthing/Dropbox/git
  vaults re-upload on every view. `mount()` now seeds `lastSavedJSON` with the
  bytes it just read, so the comparison is against what is actually on disk.
  Safe because the server writes the PUT body verbatim. A scene that isn't yet
  canonical still costs exactly one normalising write, then settles.
- **Ctrl+S did nothing in a scene.** Excalidraw swallows the `s` keydown before it
  reaches `app.js`'s bubble-phase window listener. Now handled on the capture
  phase inside `excalidraw-editor.js`, which also stops Excalidraw reading the
  bare `s` as its stroke-colour shortcut.
- **React loaded from a CDN.** Replaced by the vendored bundle; the `importmap` in
  `index.html` is gone, since React is compiled in.

## Keeping up with upstream

```bash
git fetch upstream && git merge upstream/main
```

The feature is deliberately structured to keep this cheap:

- The editor lives in its own file, `frontend/excalidraw-editor.js`. New files
  never conflict.
- `app.js` carries only ~43 lines of wiring.
- `closeMediaViewer()` mirrors upstream's method, so the four navigation teardown
  paths auto-merge instead of conflicting.

Expect conflicts only around `closeMediaViewer()` / `viewMedia()` in `app.js` and
the script tags in `index.html`. Both are mechanical: keep upstream's version and
re-add the `ExcalidrawEditor.teardown()` call / the `excalidraw-editor.js` tag.

Last merged: **upstream v0.31.5** (2026-09-05, one keep-both conflict in `.gitignore`).

After each merge: rebuild the bundle, start `run.py` against a scratch `NOTES_DIR`, and check `POST /api/upload-media` (new scene), `GET`/`PUT /api/media/<scene>` and that `/vendor/excalidraw/excalidraw.js` is served.
