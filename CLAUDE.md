# CLAUDE.md

This is a **fork** of [gamosoft/NoteDiscovery](https://github.com/gamosoft/notediscovery)
that adds an Excalidraw editor for `*.excalidraw` vector scenes.

**Read [README-jeremy.md](README-jeremy.md) before working on this repo.** It holds
the fork's known issues, the local setup step that a fresh checkout needs, and how
to merge from upstream. Keep it updated as issues are found or fixed.

Two things that bite immediately:

- **The Excalidraw bundle is built, not committed.** A fresh checkout needs
  `cd scripts/build_excalidraw && npm ci && node build.mjs`, or opening a
  `.excalidraw` file reports that the editor failed to load.
- **`data/` is the local vault and is gitignored**, so nothing in it can be
  recovered with git. Treat it as real user data: never bulk-edit or filter those
  files, and create your own scene to test against rather than modifying one that
  is already there.
