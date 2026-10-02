export function extractYouTubeVideoId(input: string): string | null {
  try {
    const value = input.trim();
    if (/^[A-Za-z0-9_-]{11}$/.test(value)) return value;

    const url = new URL(value);
    const host = url.hostname.replace(/^www\./, "");

    if (host === "youtu.be") {
      const id = url.pathname.split("/").filter(Boolean)[0];
      return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
    }

    if (host.endsWith("youtube.com")) {
      const watchId = url.searchParams.get("v");
      if (watchId && /^[A-Za-z0-9_-]{11}$/.test(watchId)) return watchId;

      const parts = url.pathname.split("/").filter(Boolean);
      if (["shorts", "embed", "live"].includes(parts[0]) && parts[1]) {
        return /^[A-Za-z0-9_-]{11}$/.test(parts[1]) ? parts[1] : null;
      }
    }
  } catch {
    return null;
  }

  return null;
}

export function canonicalYouTubeUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

export function youtubeThumbnail(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}
