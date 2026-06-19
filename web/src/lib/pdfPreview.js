import * as pdfjsLib from "pdfjs-dist";
import { pageHasIllustration } from "./pdfVisuals";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

const documentCache = new WeakMap();

async function getPdfDocument(file) {
  if (!documentCache.has(file)) {
    documentCache.set(
      file,
      file.arrayBuffer()
        .then((buffer) => pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise)
        .catch((error) => {
          documentCache.delete(file);
          throw error;
        }),
    );
  }
  return documentCache.get(file);
}

export async function renderPdfPage(file, pageNumber, availableWidth) {
  const pdf = await getPdfDocument(file);
  const safePageNumber = Math.min(Math.max(1, pageNumber), pdf.numPages);
  const page = await pdf.getPage(safePageNumber);
  const baseViewport = page.getViewport({ scale: 1 });
  const cssScale = Math.max(0.1, availableWidth / baseViewport.width);
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  const viewport = page.getViewport({ scale: cssScale * pixelRatio });
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { alpha: false });

  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);

  const task = page.render({ canvasContext: context, viewport });
  await task.promise;
  page.cleanup();
  return {
    canvas,
    cssWidth: Math.round(viewport.width / pixelRatio),
    cssHeight: Math.round(viewport.height / pixelRatio),
  };
}

export async function detectPdfPageIllustration(file, pageNumber, text = "") {
  const pdf = await getPdfDocument(file);
  const safePageNumber = Math.min(Math.max(1, pageNumber), pdf.numPages);
  const page = await pdf.getPage(safePageNumber);
  const result = await pageHasIllustration(page, text);
  page.cleanup();
  return result;
}
