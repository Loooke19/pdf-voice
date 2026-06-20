import * as pdfjsLib from "pdfjs-dist";
import {
  isSuspiciousText,
  isUnreliableRecognizedText,
  normalizeRecognizedText,
} from "./textQuality";
import { pageHasIllustration } from "./pdfVisuals";
import { PENDING_PAGE_MESSAGE } from "./segments";
import { reconstructOcrLayout } from "./ocrLayout";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

const ILLUSTRATION_NOTICE = "【此处为配图，请查看原始版面】";
const OCR_BASE = `${import.meta.env.BASE_URL}ocr`;
const PDF_RANGE_CHUNK_SIZE = 1024 * 1024;

function localOcrOptions(logger) {
  return {
    logger,
    workerPath: `${OCR_BASE}/worker.min.js`,
    corePath: `${OCR_BASE}/core`,
    langPath: `${OCR_BASE}/lang`,
    gzip: true,
  };
}

async function extractPageText(page) {
  const content = await page.getTextContent();
  let previousY = null;
  let text = "";
  for (const item of content.items) {
    const y = item.transform?.[5];
    if (previousY !== null && y !== previousY) text += "\n";
    text += `${item.str || ""} `;
    previousY = y;
  }
  return text.replace(/[ \t]+\n/g, "\n").replace(/[ \t]{2,}/g, " ").trim();
}

async function renderPage(page) {
  const viewport = page.getViewport({ scale: 2.25 });
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  await page.render({ canvasContext: context, viewport }).promise;
  return canvas;
}

class BlobRangeTransport extends pdfjsLib.PDFDataRangeTransport {
  constructor(file, initialData) {
    super(file.size, initialData, false, file.name);
    this.file = file;
    this.aborted = false;
    this.transportReady();
  }

  async requestDataRange(begin, end) {
    if (this.aborted) return;
    try {
      const chunk = new Uint8Array(await this.file.slice(begin, end).arrayBuffer());
      if (!this.aborted) this.onDataRange(begin, chunk);
    } catch {
      if (!this.aborted) this.onDataRange(begin, null);
    }
  }

  abort() {
    this.aborted = true;
  }
}

async function openLocalPdf(file) {
  const initialEnd = Math.min(file.size, PDF_RANGE_CHUNK_SIZE);
  const initialData = new Uint8Array(await file.slice(0, initialEnd).arrayBuffer());
  const range = new BlobRangeTransport(file, initialData);
  const task = pdfjsLib.getDocument({
    range,
    length: file.size,
    rangeChunkSize: PDF_RANGE_CHUNK_SIZE,
    disableStream: true,
    disableAutoFetch: true,
  });
  try {
    return await task.promise;
  } catch (error) {
    range.abort();
    throw error;
  }
}

function normalizeOcrText(text) {
  const normalized = normalizeRecognizedText(text);
  return normalizeTableOfContents(normalized);
}

function readOcrText(result, canvas) {
  const layoutText = reconstructOcrLayout(result.data.blocks, canvas.width, canvas.height);
  const sourceText = Array.isArray(result.data.blocks)
    ? layoutText
    : result.data.text;
  return normalizeOcrText(sourceText);
}

function normalizeTocPageNumber(raw) {
  const value = raw.replace(/\s/g, "").replace(/^[.…·。]+/, "");
  if (/^(I|l|L|1)$/.test(value)) return "1";
  if (/^(II)$/.test(value)) return "II";
  if (/^(III)$/.test(value)) return "III";
  if (/^(pp|Pp|PP|Z|2)$/.test(value)) return "2";
  if (/^(B|3)$/.test(value)) return "3";
  if (/^(A|4)$/.test(value)) return "4";
  if (/^(S|s|5)$/.test(value)) return "5";
  if (/^(G|6)$/.test(value)) return "6";
  if (/^(T|了|7)$/.test(value)) return "7";
  if (/^(8)$/.test(value)) return "8";
  return /^\d+$/.test(value) ? value : "";
}

function normalizeTableOfContents(text) {
  const lines = text.split("\n").map((line) => line.trimEnd());
  const numberedLines = lines.filter((line) => /^\s*\d+(?:\.\d+)?\s+/.test(line)).length;
  const tocSignals = numberedLines >= 8 || lines.some((line) => /目\s*次/.test(line));
  if (!tocSignals) return text;

  return lines
    .map((line) => {
      let value = line
        .replace(/^\s*[B8]\s*次\s*$/i, "目    次")
        .replace(/^\s*[了丁]\s*(?=\d+\s)/, "")
        .trim();

      if (!value) return "";

      const entry = value.match(/^((?:\d+(?:\.\d+)?)|前言|引言)\s*(.*)$/);
      if (!entry) return value;

      const prefix = entry[1];
      let body = entry[2]
        .replace(/[.…·。]{2,}/g, " ")
        .replace(/\s+/g, " ")
        .trim();

      const endToken = body.match(/(?:\s|\.)(II|III|pp|PP|Pp|[IlLZBASsGT了]|\d+)\s*$/);
      let pageNumber = "";
      if (endToken) {
        pageNumber = normalizeTocPageNumber(endToken[1]);
        if (pageNumber) body = body.slice(0, endToken.index).replace(/[.…·。\s]+$/, "").trim();
      }

      body = body
        .replace(/[”"'`]+(?=[\u3400-\u9fff])/g, "")
        .replace(/。(?=\s*(?:cloud|ease|software|indicator|measure)\b)/i, " ")
        .trim();

      const indent = prefix.includes(".") ? "  " : "";
      return `${indent}${prefix}  ${body}${pageNumber ? `\t${pageNumber}` : ""}`;
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function restorePageTexts(text = "", pageCount = 0) {
  const pages = Array(pageCount).fill("");
  text
    .replace(/\r/g, "")
    .split(/(?=^第 \d+ 页\s*$)/gm)
    .map((part) => part.trim())
    .filter(Boolean)
    .forEach((page) => {
      const match = page.match(/^第 (\d+) 页\s*\n*/);
      if (!match) return;
      const pageNumber = Number(match[1]);
      const pageText = page.replace(/^第 \d+ 页\s*\n*/, "").trim();
      if (pageNumber >= 1 && pageNumber <= pageCount && pageText !== PENDING_PAGE_MESSAGE) {
        pages[pageNumber - 1] = pageText.replace(`\n\n${ILLUSTRATION_NOTICE}`, "").trim();
      }
    });
  return pages;
}

export async function processPdf(file, {
  onProgress,
  onCheckpoint,
  signal,
  forceOcr = false,
  initialText = "",
  initialOcrPages = 0,
  initialIllustrationPages = [],
}) {
  let lastProgress = 0;
  const report = (next) => {
    const value = Math.max(lastProgress, Math.min(100, next.value));
    lastProgress = value;
    onProgress({ ...next, value });
  };
  const isInterrupted = () => Boolean(signal?.aborted);
  const makeResult = (pages, totalPageCount, ocrPages, illustrationPages, interrupted = false) => {
    const completedPages = pages.filter((pageText) => pageText?.replace(/\s/g, "").length).length;
    const text = Array.from({ length: totalPageCount }, (_, index) => pages[index] || "")
      .map((pageText, index) => {
        if (!pageText) return `第 ${index + 1} 页\n\n${PENDING_PAGE_MESSAGE}`;
        const notice = illustrationPages.has(index + 1)
          && !isUnreliableRecognizedText(pageText)
          && !pageText.includes(ILLUSTRATION_NOTICE)
          ? `\n\n${ILLUSTRATION_NOTICE}`
          : "";
        return `第 ${index + 1} 页\n\n${pageText}${notice}`;
      })
      .join("\n\n")
      .replace(/\n{4,}/g, "\n\n")
      .trim();
    return {
      text,
      pageCount: totalPageCount,
      completedPages,
      ocrPages,
      illustrationPages: [...illustrationPages],
      interrupted,
    };
  };
  const checkpoint = async (pages, totalPageCount, ocrPages, illustrationPages, interrupted = false) => {
    const result = makeResult(pages, totalPageCount, ocrPages, illustrationPages, interrupted);
    await onCheckpoint?.(result);
    return result;
  };

  report({ value: 2, label: "正在打开 PDF", detail: file.name });
  const illustrationPages = new Set(initialIllustrationPages);
  let pdf;
  if (isInterrupted()) return makeResult([], 0, initialOcrPages, illustrationPages, true);
  try {
    pdf = await openLocalPdf(file);
  } catch (error) {
    throw error;
  }
  let cleanedUp = false;
  const cleanup = async () => {
    if (cleanedUp) return;
    cleanedUp = true;
    await pdf.destroy();
  };

  try {
    const pages = forceOcr
    ? Array(pdf.numPages).fill("")
    : restorePageTexts(initialText, pdf.numPages);
  const pagesNeedingOcr = [];
  await checkpoint(pages, pdf.numPages, initialOcrPages, illustrationPages);
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    if (isInterrupted()) {
      const interrupted = await checkpoint(
        pages,
        pdf.numPages,
        initialOcrPages,
        illustrationPages,
        true,
      );
      await cleanup();
      return interrupted;
    }
    if (!forceOcr && pages[pageNumber - 1]) continue;
    const page = await pdf.getPage(pageNumber);
    const text = await extractPageText(page);
    if (await pageHasIllustration(page, text)) illustrationPages.add(pageNumber);
    pages[pageNumber - 1] = normalizeRecognizedText(text);
    if (forceOcr || isSuspiciousText(text)) {
      pagesNeedingOcr.push(pageNumber);
      pages[pageNumber - 1] = "";
    } else {
      await checkpoint(pages, pdf.numPages, initialOcrPages, illustrationPages);
    }
    report({
      value: 4 + (pageNumber / pdf.numPages) * 56,
      label: "正在提取文字",
      detail: `第 ${pageNumber} / ${pdf.numPages} 页`,
    });
  }

  if (pagesNeedingOcr.length) {
    report({
      value: 61,
      label: "正在准备本地 OCR",
      detail: forceOcr
        ? `将按原页面重新识别 ${pagesNeedingOcr.length} 页`
        : `发现 ${pagesNeedingOcr.length} 个扫描页或异常文本页`,
    });
    const { createWorker } = await import("tesseract.js");
    let worker;
    let activeOcrIndex = 0;
    let terminated = false;
    const terminate = async () => {
      if (terminated || !worker) return;
      terminated = true;
      await worker.terminate();
    };
    const abortWorker = () => { void terminate(); };
    signal?.addEventListener("abort", abortWorker, { once: true });

    try {
      worker = await createWorker(["chi_sim", "eng"], 1, localOcrOptions(
        (message) => {
          if (message.status === "recognizing text") {
            report({
              value: 64
                + ((activeOcrIndex + message.progress) / pagesNeedingOcr.length) * 31,
              label: "正在识别扫描页",
              detail: `第 ${activeOcrIndex + 1} / ${pagesNeedingOcr.length} 个扫描页`,
            });
          }
        },
      ));
      await worker.setParameters({ preserve_interword_spaces: "1" });

      for (let index = 0; index < pagesNeedingOcr.length; index += 1) {
        activeOcrIndex = index;
        if (isInterrupted()) {
          const interrupted = await checkpoint(
            pages,
            pdf.numPages,
            initialOcrPages + index,
            illustrationPages,
            true,
          );
          await cleanup();
          return interrupted;
        }

        const pageNumber = pagesNeedingOcr[index];
        const page = await pdf.getPage(pageNumber);
        const canvas = await renderPage(page);
        const result = await worker.recognize(canvas, {}, { text: true, blocks: true });
        const recognizedText = readOcrText(result, canvas);
        pages[pageNumber - 1] = isUnreliableRecognizedText(
          recognizedText,
          result.data.confidence,
        )
          ? ILLUSTRATION_NOTICE
          : recognizedText;
        await checkpoint(
          pages,
          pdf.numPages,
          initialOcrPages + index + 1,
          illustrationPages,
        );
        report({
          value: 64 + ((index + 1) / pagesNeedingOcr.length) * 31,
          label: "正在识别扫描页",
          detail: `第 ${pageNumber} 页 · ${index + 1} / ${pagesNeedingOcr.length}`,
        });
        await new Promise((resolve) => window.setTimeout(resolve, 20));
      }
    } catch (error) {
      if (isInterrupted()) {
        const interrupted = await checkpoint(
          pages,
          pdf.numPages,
          initialOcrPages + activeOcrIndex,
          illustrationPages,
          true,
        );
        await cleanup();
        return interrupted;
      }
      throw error;
    } finally {
      signal?.removeEventListener("abort", abortWorker);
      await terminate();
    }
  }

  const result = makeResult(
    pages,
    pdf.numPages,
    initialOcrPages + pagesNeedingOcr.length,
    illustrationPages,
  );

  if (result.completedPages === 0) {
    throw new Error("没有识别到可读文字。请确认 PDF 未加密，或尝试更清晰的扫描文件。");
  }

  report({ value: 100, label: "转换完成", detail: "正在保存到当前设备" });
  await cleanup();
  return result;
  } catch (error) {
    await cleanup();
    throw error;
  }
}

export async function recognizePdfPage(file, pageNumber, { onProgress, signal }) {
  const report = (value, label, detail) => onProgress?.({ value, label, detail });
  const isInterrupted = () => Boolean(signal?.aborted);

  report(4, "正在打开 PDF", file.name);
  if (isInterrupted()) return { interrupted: true };

  const pdf = await openLocalPdf(file);
  if (pageNumber < 1 || pageNumber > pdf.numPages) {
    throw new Error("当前页不存在，无法重新识别。");
  }

  report(18, "正在准备当前页", `第 ${pageNumber} / ${pdf.numPages} 页`);
  const page = await pdf.getPage(pageNumber);
  const extractedText = await extractPageText(page);
  const hasIllustration = await pageHasIllustration(page, extractedText);
  const canvas = await renderPage(page);
  if (isInterrupted()) return { interrupted: true };

  report(32, "正在准备本地 OCR", `仅重新识别第 ${pageNumber} 页`);
  const { createWorker } = await import("tesseract.js");
  let worker;
  let terminated = false;
  const terminate = async () => {
    if (terminated || !worker) return;
    terminated = true;
    await worker.terminate();
  };
  const abortWorker = () => { void terminate(); };
  signal?.addEventListener("abort", abortWorker, { once: true });

  try {
    worker = await createWorker(["chi_sim", "eng"], 1, localOcrOptions(
      (message) => {
        if (message.status === "recognizing text") {
          report(
            36 + message.progress * 58,
            "正在识别当前页",
            `第 ${pageNumber} 页`,
          );
        }
      },
    ));
    await worker.setParameters({ preserve_interword_spaces: "1" });
    if (isInterrupted()) return { interrupted: true };

    const result = await worker.recognize(canvas, {}, { text: true, blocks: true });
    const recognizedText = readOcrText(result, canvas);
    const pageText = isUnreliableRecognizedText(recognizedText, result.data.confidence)
      ? ILLUSTRATION_NOTICE
      : recognizedText;

    report(100, "当前页识别完成", `第 ${pageNumber} 页`);
    return {
      interrupted: false,
      pageNumber,
      pageCount: pdf.numPages,
      pageText,
      hasIllustration,
    };
  } finally {
    signal?.removeEventListener("abort", abortWorker);
    await terminate();
  }
}
