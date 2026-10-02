import type { Song } from "@/types";

export function songMatchesFilters(song: Song, filters: Record<string, string[]>): boolean {
  return Object.entries(filters).every(([groupId, selected]) => {
    if (!selected.length) return true;
    const values = groupId === "video-type"
      ? song.videos.flatMap((video) => video.videoTypeIds || [])
      : (song.classifications[groupId] || []);
    return selected.some((value) => values.includes(value));
  });
}
