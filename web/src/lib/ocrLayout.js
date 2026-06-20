function validBox(box) {
  return box
    && Number.isFinite(box.x0)
    && Number.isFinite(box.y0)
    && Number.isFinite(box.x1)
    && Number.isFinite(box.y1)
    && box.x1 > box.x0
    && box.y1 > box.y0;
}

function wordText(word) {
  return (word?.text || "").replace(/\s+/g, " ").trim();
}

function isAsciiNoiseCandidate(text) {
  return text && !/[\u3400-\u9fff]/.test(text) && /[A-Za-z]/.test(text);
}

function cleanLineText(line) {
  const words = (line.words || [])
    .map((word) => ({
      text: wordText(word),
      confidence: Number.isFinite(word.confidence) ? word.confidence : 100,
    }))
    .filter((word) => word.text);
  if (!words.length) return (line.text || "").replace(/\s+/g, " ").trim();

  const rawText = words.map((word) => word.text).join(" ");
  const hanCount = (rawText.match(/[\u3400-\u9fff]/g) || []).length;
  const letterCount = (rawText.match(/[A-Za-z]/g) || []).length;
  const chineseDominant = hanCount >= 3 && hanCount > letterCount * 0.7;
  if (!chineseDominant) return rawText;

  const keep = words.map(() => true);
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    const compact = word.text.replace(/[^A-Za-z0-9]/g, "");
    if (/^\d{1,2}$/.test(compact) && word.confidence < 65) {
      keep[index] = false;
      continue;
    }
    if (!isAsciiNoiseCandidate(word.text)) continue;

    const isShort = compact.length <= 3;
    const isMixedGarbage = /[A-Za-z]/.test(compact) && /\d/.test(compact) && compact.length <= 6;
    if (word.confidence < 52 || (isShort && word.confidence < 76) || (isMixedGarbage && word.confidence < 82)) {
      keep[index] = false;
    }
  }

  let runStart = 0;
  while (runStart < words.length) {
    if (!isAsciiNoiseCandidate(words[runStart].text)) {
      runStart += 1;
      continue;
    }
    let runEnd = runStart + 1;
    while (runEnd < words.length && isAsciiNoiseCandidate(words[runEnd].text)) runEnd += 1;
    const run = words.slice(runStart, runEnd);
    const averageConfidence = run.reduce((sum, word) => sum + word.confidence, 0) / run.length;
    const shortRun = run.every((word) => word.text.replace(/[^A-Za-z]/g, "").length <= 3);
    if ((run.length >= 2 && shortRun && averageConfidence < 84) || averageConfidence < 58) {
      for (let index = runStart; index < runEnd; index += 1) keep[index] = false;
    }
    runStart = runEnd;
  }

  const cleaned = words
    .filter((_, index) => keep[index])
    .map((word) => word.text)
    .join(" ")
    .replace(/\s+([，。；：！？、）】》])/g, "$1")
    .replace(/([（【《])\s+/g, "$1")
    .trim();
  return cleaned || rawText;
}

function collectLines(blocks = []) {
  const lines = [];
  blocks.forEach((block, blockIndex) => {
    (block.paragraphs || []).forEach((paragraph, paragraphIndex) => {
      (paragraph.lines || []).forEach((line, lineIndex) => {
        const text = cleanLineText(line);
        if (!text || !validBox(line.bbox)) return;
        lines.push({
          ...line.bbox,
          text,
          paragraphKey: `${blockIndex}-${paragraphIndex}`,
          lineIndex,
        });
      });
    });
  });
  return lines;
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

function filterDecorativeLines(lines, pageHeight) {
  if (!lines.length) return lines;
  const heights = lines
    .map((line) => line.y1 - line.y0)
    .filter((height) => height > 0);
  const bodyHeight = median(heights);
  if (!bodyHeight) return lines;

  return lines.filter((line) => {
    const text = line.text.replace(/\s+/g, " ").trim();
    const lineHeight = line.y1 - line.y0;
    const tinyRelativeToBody = lineHeight < bodyHeight * 0.72;
    const tinyRelativeToPage = Number.isFinite(pageHeight)
      && pageHeight > 0
      && lineHeight < pageHeight * 0.0085;
    if (tinyRelativeToBody || tinyRelativeToPage) return false;

    if (!Number.isFinite(pageHeight) || pageHeight <= 0) return true;
    const centerY = (line.y0 + line.y1) / 2;
    const inPageEdge = centerY < pageHeight * 0.055 || centerY > pageHeight * 0.9;
    if (!inPageEdge) return true;

    const compact = text.replace(/\s/g, "");
    const isolatedPageNumber = /^(?:第)?\d{1,4}(?:页)?$/.test(compact)
      || /^[ivxlcdm]{1,8}$/i.test(compact);
    const footerLike = centerY > pageHeight * 0.92
      && text.length <= 60
      && lineHeight <= bodyHeight * 1.05;
    return !isolatedPageNumber && !footerLike;
  });
}

function clusterCenters(lines, pageWidth, count) {
  const samples = lines
    .filter((line) => {
      const width = line.x1 - line.x0;
      return width >= pageWidth * 0.12 && width <= pageWidth * 0.43;
    })
    .map((line) => (line.x0 + line.x1) / 2)
    .sort((a, b) => a - b);

  if (samples.length < count * 4) return null;

  let centers = Array.from({ length: count }, (_, index) => {
    const position = Math.round(((index + 0.5) / count) * (samples.length - 1));
    return samples[position];
  });

  for (let iteration = 0; iteration < 12; iteration += 1) {
    const groups = Array.from({ length: count }, () => []);
    samples.forEach((sample) => {
      let nearest = 0;
      for (let index = 1; index < centers.length; index += 1) {
        if (Math.abs(sample - centers[index]) < Math.abs(sample - centers[nearest])) {
          nearest = index;
        }
      }
      groups[nearest].push(sample);
    });
    if (groups.some((group) => group.length < 3)) return null;
    centers = groups.map((group) => (
      group.reduce((sum, value) => sum + value, 0) / group.length
    )).sort((a, b) => a - b);
  }

  const minimumGap = count === 3 ? pageWidth * 0.19 : pageWidth * 0.25;
  if (centers.some((center, index) => (
    index > 0 && center - centers[index - 1] < minimumGap
  ))) return null;

  const groupCounts = centers.map(() => 0);
  samples.forEach((sample) => {
    let nearest = 0;
    centers.forEach((center, index) => {
      if (Math.abs(sample - center) < Math.abs(sample - centers[nearest])) nearest = index;
    });
    groupCounts[nearest] += 1;
  });
  const minimumGroupSize = Math.max(3, Math.floor(samples.length * 0.14));
  return groupCounts.every((size) => size >= minimumGroupSize) ? centers : null;
}

function detectColumnCenters(lines, pageWidth) {
  return clusterCenters(lines, pageWidth, 3)
    || clusterCenters(lines, pageWidth, 2)
    || [pageWidth / 2];
}

function nearestColumn(line, centers) {
  const center = (line.x0 + line.x1) / 2;
  let nearest = 0;
  centers.forEach((columnCenter, index) => {
    if (Math.abs(center - columnCenter) < Math.abs(center - centers[nearest])) nearest = index;
  });
  return nearest;
}

function joinLines(lines) {
  if (!lines.length) return "";
  const heights = lines.map((line) => line.y1 - line.y0).sort((a, b) => a - b);
  const medianHeight = heights[Math.floor(heights.length / 2)] || 20;
  let text = "";
  let previous = null;

  lines.forEach((line) => {
    if (!previous) {
      text = line.text;
      previous = line;
      return;
    }
    const verticalGap = line.y0 - previous.y1;
    const paragraphChanged = line.paragraphKey !== previous.paragraphKey;
    const likelyHeading = line.text.length <= 18 && (line.x1 - line.x0) < (previous.x1 - previous.x0) * 0.72;
    const separator = verticalGap > medianHeight * 0.8 || paragraphChanged || likelyHeading
      ? "\n"
      : /[A-Za-z0-9]$/.test(previous.text) && /^[A-Za-z0-9]/.test(line.text)
        ? " "
        : "";
    text += `${separator}${line.text}`;
    previous = line;
  });

  return text.replace(/\n{3,}/g, "\n\n").trim();
}

export function reconstructOcrLayout(blocks, pageWidth, pageHeight) {
  const lines = filterDecorativeLines(collectLines(blocks), pageHeight);
  if (!lines.length || !Number.isFinite(pageWidth) || pageWidth <= 0) return "";

  const centers = detectColumnCenters(lines, pageWidth);
  if (centers.length === 1) {
    return joinLines(lines.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0));
  }

  const wideLines = lines.filter((line) => (line.x1 - line.x0) > pageWidth * 0.58);
  const columnLines = lines.filter((line) => !wideLines.includes(line));
  const sections = [];
  let minimumY = -Infinity;

  wideLines
    .sort((a, b) => a.y0 - b.y0)
    .forEach((wideLine) => {
      const before = columnLines.filter((line) => line.y0 >= minimumY && line.y0 < wideLine.y0);
      if (before.length) sections.push({ type: "columns", lines: before });
      sections.push({ type: "wide", lines: [wideLine] });
      minimumY = wideLine.y1;
    });

  const remaining = columnLines.filter((line) => line.y0 >= minimumY);
  if (remaining.length) sections.push({ type: "columns", lines: remaining });
  if (!sections.length) sections.push({ type: "columns", lines: columnLines });

  return sections.map((section) => {
    if (section.type === "wide") return section.lines[0].text;
    return centers.map((_, columnIndex) => joinLines(
      section.lines
        .filter((line) => nearestColumn(line, centers) === columnIndex)
        .sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0),
    )).filter(Boolean).join("\n\n");
  }).filter(Boolean).join("\n\n").trim();
}
