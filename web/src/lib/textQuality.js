export function isSuspiciousText(text) {
  const compact = text.replace(/\s/g, "");
  if (compact.length < 24) return true;

  const hanCount = (compact.match(/[\u3400-\u9fff]/g) || []).length;
  const latinCount = (compact.match(/[A-Za-z]/g) || []).length;
  const upperCount = (compact.match(/[A-Z]/g) || []).length;
  const symbolCount = (compact.match(/[!#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/g) || []).length;
  const replacementCount = (compact.match(/[\uFFFD\u0000]/g) || []).length;
  const symbolClusters = (compact.match(/[!#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]{3,}/g) || []).length;
  const total = compact.length;
  const hanRatio = hanCount / total;
  const latinRatio = latinCount / total;
  const upperRatio = upperCount / total;
  const symbolRatio = symbolCount / total;

  if (replacementCount > 0 || symbolRatio > 0.14 || symbolClusters >= 2) return true;
  return hanRatio > 0.08 && latinRatio > 0.12 && upperRatio > 0.06 && symbolRatio > 0.035;
}

export function normalizeRecognizedText(text = "") {
  return text
    .replace(/\r/g, "")
    .replace(/(?<=[\u3400-\u9fff])[ \t]+(?=[\u3400-\u9fff])/g, "")
    .replace(/(?<=[，。；：！？、）】》])[ \t]+(?=[\u3400-\u9fff])/g, "")
    .replace(/[ \t]+([，。；：！？、）】》])/g, "$1")
    .replace(/([（【《])[ \t]+/g, "$1")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export function isUnreliableRecognizedText(text = "", confidence = null) {
  const normalized = normalizeRecognizedText(text);
  const compact = normalized.replace(/\s/g, "");
  if (!compact) return true;
  if (Number.isFinite(confidence) && confidence < 42) return true;

  const hanCount = (compact.match(/[\u3400-\u9fff]/g) || []).length;
  const latinCount = (compact.match(/[A-Za-z]/g) || []).length;
  const upperCount = (compact.match(/[A-Z]/g) || []).length;
  const symbolCount = (compact.match(/[!#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/g) || []).length;
  const replacementCount = (compact.match(/[\uFFFD\u0000]/g) || []).length;
  const latinTokens = normalized.match(/[A-Za-z]+/g) || [];
  const shortLatinRatio = latinTokens.length
    ? latinTokens.filter((token) => token.length <= 2).length / latinTokens.length
    : 0;
  const total = compact.length;
  const hanRatio = hanCount / total;
  const latinRatio = latinCount / total;
  const upperRatio = upperCount / total;
  const symbolRatio = symbolCount / total;

  if (replacementCount > 0 || symbolRatio > 0.16) return true;
  if (latinTokens.length >= 5 && shortLatinRatio > 0.58 && latinRatio > 0.22) return true;
  return latinRatio > 0.38 && upperRatio > 0.24 && hanRatio < 0.28;
}
