import type { SongVideo } from "@/types";

export function ensurePrimaryVideo(videos: SongVideo[]): SongVideo[] {
  const usable = videos.filter((video) => video.status === "usable");
  if (!usable.length) {
    return videos.map((video) => video.isPrimary ? { ...video, isPrimary: false } : video);
  }

  const explicitPrimary = usable.find((video) => video.isPrimary);
  const primaryId = explicitPrimary?.id || usable[0].id;
  return videos.map((video) => ({
    ...video,
    isPrimary: video.status === "usable" && video.id === primaryId
  }));
}

export function getPrimaryUsableVideo(videos: SongVideo[]): SongVideo | undefined {
  const usable = videos.filter((video) => video.status === "usable");
  return usable.find((video) => video.isPrimary) || usable[0];
}

export function markPrimaryVideo(videos: SongVideo[], videoId: string): SongVideo[] {
  const target = videos.find((video) => video.id === videoId);
  if (!target || target.status !== "usable") return ensurePrimaryVideo(videos);
  return videos.map((video) => ({
    ...video,
    isPrimary: video.status === "usable" && video.id === videoId
  }));
}

export function updateVideoStatus(videos: SongVideo[], videoId: string, status: SongVideo["status"]): SongVideo[] {
  return ensurePrimaryVideo(videos.map((video) => video.id === videoId
    ? {
        ...video,
        status,
        isPrimary: status === "usable" ? video.isPrimary : false,
        blacklistReason: status === "usable" ? undefined : video.blacklistReason
      }
    : video));
}

export function usableVideosMatchingTypes(videos: SongVideo[], selectedTypeIds: string[] = []): SongVideo[] {
  const usable = videos.filter((video) => video.status === "usable");
  if (!selectedTypeIds.length) return usable;
  return usable.filter((video) => selectedTypeIds.some((id) => (video.videoTypeIds || []).includes(id)));
}

export function preferredUsableVideo(videos: SongVideo[], selectedTypeIds: string[] = []): SongVideo | undefined {
  const matches = usableVideosMatchingTypes(videos, selectedTypeIds);
  if (!matches.length) return undefined;
  return matches.find((video) => video.isPrimary) || matches[0];
}
