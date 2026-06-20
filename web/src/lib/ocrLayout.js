function validBox(box) {
  return box
    && Number.isFinite(box.x0)
    && Number.isFinite(box.y0)
    && Number.isFinite(box.x1)
    && Number.isFinite(box.y1)
    && box.x1 > box.x0
    && box.y1 > box.y0;
}

function collectLines(blocks = []) {
  const lines = [];
  blocks.forEach((block, blockIndex) => {
    (block.paragraphs || []).forEach((paragraph, paragraphIndex) => {
      (paragraph.lines || []).forEach((line, lineIndex) => {
        const text = (line.text || "").replace(/\s+/g, " ").trim();
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

export function reconstructOcrLayout(blocks, pageWidth) {
  const lines = collectLines(blocks);
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

