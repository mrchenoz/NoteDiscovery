// Public surface of the vendored bundle, consumed by frontend/excalidraw-editor.js.
//
// createElement/createRoot are re-exported from the very React instance Excalidraw
// is compiled against. Loading React separately would give the page a second copy,
// and two Reacts in one tree breaks hooks.
export { Excalidraw, serializeAsJSON } from "@excalidraw/excalidraw";
export { createElement } from "react";
export { createRoot } from "react-dom/client";
