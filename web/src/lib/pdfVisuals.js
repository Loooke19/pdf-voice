import { OPS } from "pdfjs-dist";

const IMAGE_AREA_THRESHOLD = 36_000;
const IMAGE_SIDE_THRESHOLD = 120;

function isLargeImage(width, height) {
  return Number.isFinite(width)
    && Number.isFinite(height)
    && width >= IMAGE_SIDE_THRESHOLD
    && height >= IMAGE_SIDE_THRESHOLD
    && width * height >= IMAGE_AREA_THRESHOLD;
}

export async function pageHasIllustration(page, text = "") {
  if (text.replace(/\s/g, "").length < 60) return false;
  const operators = await page.getOperatorList();

  for (let index = 0; index < operators.fnArray.length; index += 1) {
    const operation = operators.fnArray[index];
    const args = operators.argsArray[index] || [];

    if (operation === OPS.paintImageXObject && isLargeImage(args[1], args[2])) {
      return true;
    }
    if (operation === OPS.paintInlineImageXObject) {
      const image = args[0];
      if (isLargeImage(image?.width, image?.height)) return true;
    }
    if (operation === OPS.paintImageXObjectRepeat) {
      const renderedWidth = Math.abs(args[1] || 0);
      const renderedHeight = Math.abs(args[2] || 0);
      if (renderedWidth * renderedHeight >= IMAGE_AREA_THRESHOLD) return true;
    }
  }
  return false;
}
