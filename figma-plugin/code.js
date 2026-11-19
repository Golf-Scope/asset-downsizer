// Asset Downsizer — Figma side.
// Exports the selected layers at a high scale (2x–4x) and hands the PNG bytes to the panel,
// which shrinks them back to 1x with a Lanczos filter (sharper than Figma's own 1x export).

figma.showUI(__html__, { width: 380, height: 560, themeColors: false });

function exportable(node) {
  return node && "exportAsync" in node;
}

function sendSelection() {
  const items = figma.currentPage.selection.filter(exportable).map((n) => ({
    id: n.id,
    name: n.name,
    width: Math.round(n.width),
    height: Math.round(n.height),
  }));
  figma.ui.postMessage({ type: "selection", items });
}

// Small previews of the selected layers (about 64px on the long side at 2x), sent one at a time after the list.
// A newer selection stops the older batch.
const MAX_PREVIEWS = 30;
let previewSeq = 0, previewTimer = null;
function schedulePreviews() {
  const seq = ++previewSeq;
  clearTimeout(previewTimer);
  previewTimer = setTimeout(async () => {
    const nodes = figma.currentPage.selection.filter(exportable).slice(0, MAX_PREVIEWS);
    for (const n of nodes) {
      if (seq !== previewSeq) return;
      try {
        const longSide = Math.max(n.width, n.height) || 1;
        const scale = Math.min(2, Math.max(0.01, 128 / longSide));
        const bytes = await n.exportAsync({ format: "PNG", constraint: { type: "SCALE", value: scale } });
        if (seq !== previewSeq) return;
        figma.ui.postMessage({ type: "preview", id: n.id, bytes });
      } catch (e) { /* no preview for this layer; the name still shows */ }
    }
  }, 120);
}

function onSelectionChange() { sendSelection(); schedulePreviews(); }
figma.on("selectionchange", onSelectionChange);
onSelectionChange();

let currentRun = null;

figma.ui.onmessage = async (msg) => {
  if (msg.type === "deselect") {
    figma.currentPage.selection = figma.currentPage.selection.filter((n) => n.id !== msg.id);
  } else if (msg.type === "cancel") {
    currentRun = null;
  } else if (msg.type === "export") {
    const scale = Number(msg.scale) || 4;
    const run = msg.gen; currentRun = run;
    for (const id of msg.ids) {
      if (currentRun !== run) return; // cancelled or replaced by a newer run
      const node = await figma.getNodeByIdAsync(id);
      if (!exportable(node)) {
        figma.ui.postMessage({ type: "export-error", id, gen: run, message: "This layer can't be resized" });
        continue;
      }
      try {
        const bytes = await node.exportAsync({ format: "PNG", constraint: { type: "SCALE", value: scale } });
        figma.ui.postMessage({
          type: "exported",
          id,
          gen: run,
          name: node.name,
          width: Math.round(node.width),
          height: Math.round(node.height),
          bytes,
        });
      } catch (e) {
        figma.ui.postMessage({ type: "export-error", id, gen: run, message: "Couldn't get this layer from Figma" });
      }
    }
    if (currentRun === run) figma.ui.postMessage({ type: "export-done", gen: run });
  } else if (msg.type === "notify") {
    figma.notify(String(msg.text));
  }
};
