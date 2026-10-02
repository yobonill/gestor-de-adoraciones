import { cleanComparableText, normalizeTextKey } from "@/lib/text";

export function cleanArtistName(value: string): string {
  return cleanComparableText(value);
}

function artistKey(value: string): string {
  return normalizeTextKey(value);
}

export function uniqueArtists(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const cleaned = cleanArtistName(value);
    if (!cleaned) continue;
    const key = artistKey(cleaned);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(cleaned);
  }

  return result.sort((a, b) => a.localeCompare(b, "es", { sensitivity: "base" }));
}

export function canonicalArtistName(value: string, existingArtists: string[]): string {
  const cleaned = cleanArtistName(value);
  if (!cleaned) return "";
  const key = artistKey(cleaned);
  return existingArtists.find((artist) => artistKey(artist) === key) || cleaned;
}

export function artistMatches(a: string, b: string): boolean {
  return artistKey(a) === artistKey(b);
}
