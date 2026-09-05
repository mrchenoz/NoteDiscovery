/**
 * Excalidraw editor: vector sketches stored as *.excalidraw JSON files in the vault.
 *
 * Self-contained on purpose. app.js keeps only a thin forwarding layer (see its
 * EXCALIDRAW EDITOR block), so the React/ESM loading, the scene autosave loop and
 * the mount/unmount lifecycle all live here instead of inside the Alpine component.
 *
 * Entry points take the Alpine component as `app`. The only app.js global reached
 * back into is ErrorHandler, looked up lazily and optional.
 */
(function (global) {
    'use strict';

    /**
     * Vendored by scripts/build_excalidraw — a self-contained ESM bundle with React
     * compiled in, so nothing here is fetched from a CDN and no import map is needed.
     * Loaded lazily on first use; locales and the mermaid-import feature are split
     * into chunks/ that the bundle pulls in on demand. Fonts resolve relative to
     * ASSET_PATH. See documentation/EXCALIDRAW.md to rebuild or bump the version.
     */
    const BASE = '/static/vendor/excalidraw/';
    const ESM_URL = `${BASE}excalidraw.js`;
    const CSS_URL = `${BASE}index.css`;
    const ASSET_PATH = BASE;

    /** Fallback only; the runtime value comes from app.autosaveDelayMs (/api/config). */
    const DEFAULT_AUTOSAVE_DELAY_MS = 1000;

    /**
     * Runtime handles. Deliberately kept OUTSIDE the Alpine component: Alpine
     * deep-wraps component state in reactive proxies, and React's root/API objects
     * misbehave when their internals are read back through a proxy.
     */
    const EXCAL = {
        libPromise: null,   // Promise resolving to this holder once the bundle is loaded
        lib: null,          // vendored bundle (Excalidraw, serializeAsJSON, createElement, createRoot)
        root: null,         // React root currently mounted in the viewer pane
        api: null,          // ExcalidrawImperativeAPI for the mounted scene
        mountedFor: null,   // vault-relative path of the scene the editor is showing
        host: null,         // viewer-pane element the React root is mounted into
        app: null,          // Alpine component that mounted the scene (autosave delay)
        props: null,        // props of the rendered <Excalidraw>, re-rendered on theme change
        autosaveTimeout: null,
        saveInFlight: false,
        saveQueued: false,
        lastSavedJSON: null,
    };

    /** Route through app.js's ErrorHandler when present, else fall back to the console. */
    function reportError(context, error) {
        if (typeof ErrorHandler !== 'undefined' && ErrorHandler && typeof ErrorHandler.handle === 'function') {
            ErrorHandler.handle(context, error);
            return;
        }
        console.error(`[excalidraw] ${context}:`, error);
    }

    function encodePath(path) {
        return path.split('/').map((s) => encodeURIComponent(s)).join('/');
    }

    /**
     * Lazily load React + the Excalidraw ESM bundle (once per session) and inject
     * the editor stylesheet. Resolves to the shared EXCAL holder.
     */
    function ensureLib() {
        if (EXCAL.libPromise) return EXCAL.libPromise;
        if (!document.getElementById('excalidraw-css')) {
            const link = document.createElement('link');
            link.id = 'excalidraw-css';
            link.rel = 'stylesheet';
            link.href = CSS_URL;
            document.head.appendChild(link);
        }
        // Excalidraw fetches fonts and other static assets relative to this base URL
        global.EXCALIDRAW_ASSET_PATH = ASSET_PATH;
        EXCAL.libPromise = import(ESM_URL).then((lib) => {
            EXCAL.lib = lib;
            return EXCAL;
        }).catch((err) => {
            EXCAL.libPromise = null; // allow a retry after a network failure
            throw err;
        });
        return EXCAL.libPromise;
    }

    /** PUT a serialized scene to /api/media/{path}; throws on HTTP failure. */
    async function putScene(path, json) {
        const resp = await fetch(`/api/media/${encodePath(path)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: json,
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    }

    /** Serialize the mounted scene, or null when there is nothing to serialize. */
    function serializeMounted() {
        if (!EXCAL.api || !EXCAL.lib || !EXCAL.mountedFor) return null;
        return EXCAL.lib.serializeAsJSON(
            EXCAL.api.getSceneElements(),
            EXCAL.api.getAppState(),
            EXCAL.api.getFiles(),
            'local'
        );
    }

    /** Debounced autosave; same delay source as note/drawing autosave. */
    function scheduleAutosave() {
        if (!EXCAL.api || !EXCAL.mountedFor) return;
        clearTimeout(EXCAL.autosaveTimeout);
        const delay = (EXCAL.app && EXCAL.app.autosaveDelayMs) ?? DEFAULT_AUTOSAVE_DELAY_MS;
        EXCAL.autosaveTimeout = setTimeout(() => {
            save();
        }, delay);
    }

    function cancelAutosave() {
        if (EXCAL.autosaveTimeout) {
            clearTimeout(EXCAL.autosaveTimeout);
            EXCAL.autosaveTimeout = null;
        }
    }

    /**
     * Serialize the mounted scene and write it to disk. Skips the request when
     * nothing changed since the last successful save; coalesces overlapping calls
     * (Ctrl+S + autosave) like drawingSave() does.
     */
    async function save() {
        if (!EXCAL.api || !EXCAL.mountedFor || !EXCAL.lib) return;
        if (EXCAL.saveInFlight) {
            EXCAL.saveQueued = true;
            return;
        }
        const path = EXCAL.mountedFor;
        let json;
        try {
            json = serializeMounted();
        } catch (error) {
            reportError('save excalidraw scene', error);
            return;
        }
        if (json === null || json === EXCAL.lastSavedJSON) return;
        EXCAL.saveInFlight = true;
        try {
            await putScene(path, json);
            if (EXCAL.mountedFor === path) EXCAL.lastSavedJSON = json;
        } catch (error) {
            reportError('save excalidraw scene', error);
        } finally {
            EXCAL.saveInFlight = false;
            if (EXCAL.saveQueued) {
                EXCAL.saveQueued = false;
                if (EXCAL.mountedFor) save();
            }
        }
    }

    /**
     * Unmount the editor and drop the runtime handles. flush=true serializes any
     * pending changes synchronously first and writes them in the background (used
     * on navigation); flush=false discards them (used when the file was deleted).
     * Handles are detached before the async PUT so a concurrent mount can start a
     * new scene without racing this teardown. Safe no-op when nothing is mounted.
     */
    function teardown({ flush = true } = {}) {
        cancelAutosave();
        const root = EXCAL.root;
        const path = EXCAL.mountedFor;
        let pendingJSON = null;
        if (flush) {
            try {
                pendingJSON = serializeMounted();
            } catch (_) { /* nothing to flush */ }
            if (pendingJSON === EXCAL.lastSavedJSON) pendingJSON = null;
        }
        EXCAL.root = null;
        EXCAL.api = null;
        EXCAL.mountedFor = null;
        EXCAL.host = null;
        EXCAL.app = null;
        EXCAL.props = null;
        EXCAL.lastSavedJSON = null;
        EXCAL.saveQueued = false;
        if (root) {
            try { root.unmount(); } catch (_) { /* ignore */ }
        }
        if (pendingJSON && path) {
            putScene(path, pendingJSON).catch((error) => {
                reportError('save excalidraw scene', error);
            });
        }
    }

    /**
     * Mount the Excalidraw editor for app.currentMedia into the viewer pane.
     * Called from the pane's x-init (first mount) and from viewMedia() (scene→scene
     * switches, where the pane stays in the DOM). Idempotent per scene path; the
     * post-await EXCAL.root check makes concurrent calls mount only once.
     */
    async function mount(app) {
        const path = app.currentMedia;
        if (!path || app.currentMediaType !== 'excalidraw') return;
        if (EXCAL.mountedFor === path && EXCAL.root) return;
        teardown({ flush: true });

        let scene = null;
        let onDiskJSON = null;
        try {
            const resp = await fetch(`/api/media/${encodePath(path)}`);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const text = await resp.text();
            scene = text.trim() ? JSON.parse(text) : null;
            onDiskJSON = text;
        } catch (error) {
            reportError('load excalidraw scene', error);
            return;
        }

        try {
            await ensureLib();
        } catch (error) {
            reportError('load excalidraw editor', error);
            return;
        }

        // The user may have navigated elsewhere (or a concurrent call may have
        // mounted already) while the fetch/import above were in flight.
        if (app.currentMedia !== path || app.currentMediaType !== 'excalidraw') return;
        if (EXCAL.root) return;
        const host = app.$refs.excalidrawHost;
        if (!host) return;

        const appState = { ...(scene && scene.appState ? scene.appState : {}) };
        // serializeAsJSON strips collaborators, but scenes from other tools may
        // carry it as a plain object; Excalidraw expects a Map, so drop it.
        delete appState.collaborators;

        EXCAL.root = EXCAL.lib.createRoot(host);
        EXCAL.mountedFor = path;
        EXCAL.host = host;
        EXCAL.app = app;
        // Baseline is what is actually on disk, not null. Excalidraw emits onChange
        // on first render (loading normalises the scene — "boundElements": null
        // becomes []), which would otherwise autosave a file nobody edited: every
        // open would rewrite it, churning mtime and waking up any sync tool.
        // Comparing against the bytes we just read makes that first save a no-op.
        // Safe because the server writes the PUT body verbatim, so a file we wrote
        // is byte-identical to the string compared in save(); a scene that is not
        // yet canonical costs exactly one normalising write and then settles.
        EXCAL.lastSavedJSON = onDiskJSON;
        // Kept on EXCAL so setTheme() can re-render the same element with one prop
        // changed; React reconciles in place, so the scene and its history survive.
        EXCAL.props = {
            initialData: {
                elements: (scene && Array.isArray(scene.elements)) ? scene.elements : [],
                appState,
                files: (scene && scene.files) ? scene.files : {},
            },
            excalidrawAPI: (api) => { EXCAL.api = api; },
            onChange: () => scheduleAutosave(),
            theme: app.getThemeType() === 'dark' ? 'dark' : 'light',
        };
        EXCAL.root.render(EXCAL.lib.createElement(EXCAL.lib.Excalidraw, EXCAL.props));
    }

    /**
     * Follow an app theme change while a scene is open. `theme` is a controlled
     * prop on <Excalidraw>, so the way to change it is to render the mounted
     * element again with the new value; initialData is only read on first mount,
     * so nothing else is affected. Safe no-op when nothing is mounted.
     */
    function setTheme(themeType) {
        if (!EXCAL.root || !EXCAL.props || !EXCAL.lib) return;
        const theme = themeType === 'dark' ? 'dark' : 'light';
        if (EXCAL.props.theme === theme) return;
        EXCAL.props = { ...EXCAL.props, theme };
        EXCAL.root.render(EXCAL.lib.createElement(EXCAL.lib.Excalidraw, EXCAL.props));
    }

    /**
     * Create a brand-new scene file and open it in the editor. Mirrors
     * createNewDrawing(): the server stores the upload as
     * drawing-{timestamp}.excalidraw next to the .md notes in the target folder.
     */
    async function createNew(app) {
        const targetFolder = app.inferredNewItemTargetFolder();
        app.closeDropdown();
        const scene = JSON.stringify({
            type: 'excalidraw',
            version: 2,
            source: global.location.origin,
            elements: [],
            appState: { viewBackgroundColor: '#ffffff' },
            files: {},
        });
        const file = new File([scene], 'drawing.excalidraw', { type: 'application/json' });
        try {
            // uploadMedia() already does the optimistic note-list add + tree rebuild
            const path = await app.uploadMedia(file, '', {
                nextToNotes: true,
                contentFolder: targetFolder,
            });
            app.viewMedia(path, 'excalidraw');
        } catch (error) {
            reportError('create excalidraw', error);
            await app.loadNotes({ silent: true });
        }
    }

    /** Vault-relative path of the scene currently mounted, or null. */
    function mountedFor() {
        return EXCAL.mountedFor;
    }

    /**
     * Scene-local keyboard shortcuts, owned here so app.js needs no Excalidraw
     * branches in its own keydown handler. Registered once on the capture phase so
     * it runs before app.js's window listener (which is on the bubble phase), and
     * is an immediate no-op whenever no scene is mounted.
     */
    window.addEventListener('keydown', (e) => {
        if (!EXCAL.mountedFor) return;
        if (!(e.ctrlKey || e.metaKey)) return;
        const key = e.key.toLowerCase();

        if (key === 's') {
            // Stopping propagation keeps three other handlers out of it: the
            // browser's save dialog, app.js's saveNote(), and Excalidraw reading a
            // bare "s" as its stroke-colour shortcut.
            e.preventDefault();
            e.stopPropagation();
            save();
            return;
        }

        if (key === 'z' || key === 'y') {
            // Undo/redo belong to the mounted scene. With the canvas focused
            // Excalidraw handles them itself, so the event has to pass through
            // untouched; otherwise swallow it so app.js doesn't drive undo on the
            // note editor hidden behind the scene.
            const inCanvas = EXCAL.host && EXCAL.host.contains(e.target);
            if (!inCanvas) e.stopPropagation();
        }
    }, true);

    global.ExcalidrawEditor = {
        createNew,
        mount,
        save,
        teardown,
        mountedFor,
        setTheme,
    };
})(typeof window !== 'undefined' ? window : globalThis);
