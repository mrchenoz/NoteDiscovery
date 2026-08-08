#!/usr/bin/env node
/**
 * Bundle the Excalidraw editor into frontend/vendor/excalidraw/.
 *
 * Excalidraw cannot be vendored the way scripts/vendor_assets.py handles the other
 * browser libraries. Its published build externalises every dependency it has
 * (jotai, roughjs, pako, perfect-freehand, @radix-ui/*, …), and React 19 ships as
 * CommonJS with no UMD build, so neither is loadable in a browser as published.
 * A bundler has to resolve and convert them, which is what this script does.
 *
 * Output is a self-contained ESM bundle with React compiled in, so the app needs no
 * import map and makes no CDN request at runtime.
 *
 *   node build.mjs                # bundle into frontend/vendor/excalidraw
 *   node build.mjs --with-cjk     # also ship Xiaolai, the 12 MB CJK handwriting font
 *   node build.mjs --dest DIR     # write somewhere else (used by the Dockerfile)
 *
 * Code splitting keeps the initial download small: the entry chunk is ~750 KB
 * (~180 KB gzipped) and the ~40 UI locales plus the mermaid-import feature
 * (elkjs, cytoscape, katex) load on demand.
 */
import * as esbuild from "esbuild";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");
const require = createRequire(import.meta.url);

const args = process.argv.slice(2);
const withCjk = args.includes("--with-cjk");
const destArg = args.indexOf("--dest");
const DEST = destArg !== -1
    ? path.resolve(args[destArg + 1])
    : path.join(REPO_ROOT, "frontend", "vendor", "excalidraw");

// Excluded by default purely for size: it is 12 MB, against ~480 KB for every other
// font combined. Without it, CJK glyphs in a scene fall back to a system font.
const HEAVY_FONTS = ["Xiaolai"];

const log = (message) => console.log(`[excalidraw] ${message}`);

const dirSize = (dir) => {
    let total = 0;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        total += entry.isDirectory() ? dirSize(full) : fs.statSync(full).size;
    }
    return total;
};
const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

// Resolved from the entry point rather than package.json, which the package's
// "exports" map deliberately does not expose: dist/prod/index.js → package root.
const pkgRoot = path.resolve(require.resolve("@excalidraw/excalidraw"), "..", "..", "..");
const { version } = JSON.parse(fs.readFileSync(path.join(pkgRoot, "package.json"), "utf8"));
const distProd = path.join(pkgRoot, "dist", "prod");

fs.rmSync(DEST, { recursive: true, force: true });
fs.mkdirSync(DEST, { recursive: true });

log(`bundling @excalidraw/excalidraw ${version} → ${path.relative(REPO_ROOT, DEST) || DEST}`);

const result = await esbuild.build({
    entryPoints: [path.join(HERE, "entry.js")],
    bundle: true,
    format: "esm",
    minify: true,
    // Splitting is what keeps the locales and the mermaid stack out of the entry
    // chunk; the bundle pulls them in only when they are actually used.
    splitting: true,
    outdir: DEST,
    entryNames: "excalidraw",
    chunkNames: "chunks/[name]-[hash]",
    define: { "process.env.NODE_ENV": '"production"' },
    metafile: true,
    logLevel: "warning",
});

fs.copyFileSync(path.join(distProd, "index.css"), path.join(DEST, "index.css"));

// Excalidraw resolves fonts against window.EXCALIDRAW_ASSET_PATH at runtime, so the
// directory layout under DEST has to match the published package.
const fontsSrc = path.join(distProd, "fonts");
const fontsDest = path.join(DEST, "fonts");
let skipped = [];
for (const entry of fs.readdirSync(fontsSrc, { withFileTypes: true })) {
    if (!withCjk && HEAVY_FONTS.includes(entry.name)) {
        skipped.push(entry.name);
        continue;
    }
    fs.cpSync(path.join(fontsSrc, entry.name), path.join(fontsDest, entry.name), { recursive: true });
}

// The bundle inlines Excalidraw's whole dependency tree, so attribution has to cover
// everything esbuild actually pulled in, not just the top-level package. The metafile
// lists every input file; map those back to the packages they came from.
const packages = new Map();
for (const input of Object.keys(result.metafile.inputs)) {
    const match = input.match(/^(.*node_modules\/((?:@[^/]+\/)?[^/]+))\//);
    if (!match) continue;
    const [, root, name] = match;
    if (packages.has(name)) continue;
    let meta = {};
    try {
        meta = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    } catch { /* not a package root (nested path); skip */ }
    if (!meta.name) continue;
    const licenseFile = ["LICENSE", "LICENSE.md", "LICENSE.txt", "license", "LICENCE"]
        .map((f) => path.join(root, f))
        .find((f) => fs.existsSync(f));
    packages.set(name, {
        version: meta.version ?? "unknown",
        license: typeof meta.license === "string" ? meta.license : meta.license?.type ?? "see notice",
        text: licenseFile ? fs.readFileSync(licenseFile, "utf8").trim() : null,
    });
}

const sorted = [...packages.entries()].sort(([a], [b]) => a.localeCompare(b));
const notices = [
    "# Third-party notices — Excalidraw bundle",
    "",
    `Generated by scripts/build_excalidraw for @excalidraw/excalidraw ${version}.`,
    "`excalidraw.js` and `chunks/` are a compiled bundle of the packages below.",
    "",
    ...sorted.map(([name, p]) => `- ${name} ${p.version} — ${p.license}`),
    "",
    ...sorted.flatMap(([name, p]) =>
        p.text ? [`## ${name}`, "", "```", p.text, "```", ""] : []
    ),
].join("\n");
fs.writeFileSync(path.join(DEST, "THIRD_PARTY_NOTICES.md"), notices);

fs.writeFileSync(
    path.join(DEST, "MANIFEST.json"),
    JSON.stringify(
        {
            name: "@excalidraw/excalidraw",
            version,
            license: "MIT",
            cjkFonts: withCjk,
            bundledPackages: Object.fromEntries(sorted.map(([n, p]) => [n, p.version])),
        },
        null,
        2
    ) + "\n"
);

const entrySize = fs.statSync(path.join(DEST, "excalidraw.js")).size;
log(`entry ${(entrySize / 1024).toFixed(0)} KB, total ${mb(dirSize(DEST))}`);
if (skipped.length) log(`skipped ${skipped.join(", ")} (pass --with-cjk to include)`);
log("done");
