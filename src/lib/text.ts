/**
 * Cleans short user-entered text without changing how it is displayed.
 * Useful for names, titles and labels.
 */
export function cleanComparableText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

/**
 * Canonical comparison/search key.
 * - ignores leading/trailing/repeated whitespace
 * - ignores accents/diacritics
 * - ignores letter case by storing the key in uppercase
 *
 * Keep the original display value separately; use this only for matching.
 */
export function normalizeTextKey(value: string): string {
  return cleanComparableText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleUpperCase("es");
}

/** Cleans free-form text while preserving line breaks. */
export function cleanFreeText(value: string): string {
  return value
    .split("\n")
    .map((line) => line.trim().replace(/[ \t]+/g, " "))
    .join("\n")
    .trim();
}

export function sameNormalizedText(a: string, b: string): boolean {
  return normalizeTextKey(a) === normalizeTextKey(b);
}
