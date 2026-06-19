import {
  isUnreliableRecognizedText,
  normalizeRecognizedText,
} from "./textQuality";

const HEADING_PATTERN = /^(第[一二三四五六七八九十百零\d]+[章节篇部卷]|chapter\s+\d+|序言|前言|目录|结语|附录)/i;
const UNRELIABLE_PAGE_MESSAGE = "本页以图片为主，未识别到可靠文字。请切换到“原始版面”查看。";
export const PENDING_PAGE_MESSAGE = "暂未完成识别。";

function prepareRecognizedText(text) {
  const normalized = normalizeRecognizedText(text);
  return isUnreliableRecognizedText(normalized) ? UNRELIABLE_PAGE_MESSAGE : normalized;
}

function cleanSpeechText(text) {
  return text
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\.{4,}\s*\d*/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function reflowDisplayText(text) {
  const reflowed = text
    .replace(/\r/g, "")
    .split(/\n{2,}/)
    .map((block) => block
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .join(" "))
    .filter(Boolean)
    .join("\n\n")
    .trim();
  return normalizeRecognizedText(reflowed);
}

function splitLongBlock(block, maxLength = 1000) {
  const sentences = block.split(/(?<=[。！？.!?；;])\s*/);
  const chunks = [];
  let buffer = "";

  for (const sentence of sentences) {
    if (buffer && buffer.length + sentence.length > maxLength) {
      chunks.push(buffer.trim());
      buffer = "";
    }
    buffer += sentence;
  }
  if (buffer.trim()) chunks.push(buffer.trim());
  return chunks;
}

export function makeSegments(rawText) {
  const pageParts = rawText
    .replace(/\r/g, "")
    .split(/(?=^第 \d+ 页\s*$)/gm)
    .map((part) => part.trim())
    .filter(Boolean);

  if (pageParts.length > 1) {
    return pageParts.map((page, index) => {
      const pageMatch = page.match(/^第 (\d+) 页\s*\n*/);
      const pageNumber = pageMatch?.[1] || index + 1;
      const pageBody = page.replace(/^第 \d+ 页\s*\n*/, "").trim();
      if (pageBody === PENDING_PAGE_MESSAGE) {
        return {
          title: `第 ${pageNumber} 页`,
          text: "",
          displayText: PENDING_PAGE_MESSAGE,
          pending: true,
        };
      }
      const displayText = prepareRecognizedText(
        pageBody,
      );
      return {
        title: `第 ${pageNumber} 页`,
        text: cleanSpeechText(displayText),
        displayText: reflowDisplayText(displayText),
      };
    });
  }

  const text = cleanSpeechText(normalizeRecognizedText(rawText));
  const blocks = text.split(/\n{2,}/).filter(Boolean);
  const groups = [];
  let current = { title: "开始阅读", body: [] };

  for (const block of blocks) {
    const firstLine = block.split("\n")[0].trim();
    const looksLikeHeading = firstLine.length <= 32 && HEADING_PATTERN.test(firstLine);
    if (looksLikeHeading) {
      if (current.body.join("").trim()) groups.push(current);
      current = { title: firstLine, body: [] };
      const remainder = block.slice(firstLine.length).trim();
      if (remainder) current.body.push(remainder);
    } else {
      current.body.push(block);
    }
  }
  if (current.body.length) groups.push(current);

  const segments = [];
  for (const group of groups) {
    const chunks = splitLongBlock(group.body.join("\n\n"));
    chunks.forEach((chunk, index) => {
      segments.push({
        title: chunks.length > 1 ? `${group.title} · ${index + 1}` : group.title,
        text: chunk,
        displayText: chunk,
      });
    });
  }

  if (!segments.length && text) {
    return splitLongBlock(text).map((chunk, index) => ({
      title: `片段 ${index + 1}`,
      text: chunk,
      displayText: chunk,
    }));
  }
  return segments.length ? segments : [{
    title: "空白文档",
    text: "没有识别到可朗读的文字。",
    displayText: "没有识别到可朗读的文字。",
  }];
}

export function makeDocumentPreview(segments = []) {
  const candidate = segments.find((segment) => {
    const text = segment?.text?.trim() || "";
    return text
      && text !== UNRELIABLE_PAGE_MESSAGE
      && segment?.displayText !== PENDING_PAGE_MESSAGE
      && text !== "没有识别到可朗读的文字。";
  });
  if (!candidate) return "暂无可靠文字，可打开原始版面查看。";
  const preview = normalizeRecognizedText(candidate.text)
    .replace(/\s*\n+\s*/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  return `${preview.slice(0, 110)}${preview.length > 110 ? "…" : ""}`;
}

export function makeSentences(text) {
  const sentences = text
    .replace(/\n+/g, " ")
    .split(/(?<=[。！？.!?；;])\s*/)
    .map((item) => item.trim())
    .filter(Boolean);

  const safe = [];
  for (const sentence of sentences) {
    if (sentence.length <= 220) {
      safe.push(sentence);
      continue;
    }
    for (let index = 0; index < sentence.length; index += 200) {
      safe.push(sentence.slice(index, index + 200));
    }
  }
  return safe.length ? safe : [text];
}
