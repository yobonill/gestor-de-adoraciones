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

export type YouTubeMetadata = {
  title: string;
  artist: string;
};

export async function fetchYouTubeMetadata(videoId: string): Promise<YouTubeMetadata> {
  const videoUrl = canonicalYouTubeUrl(videoId);
  const endpoint = `https://www.youtube.com/oembed?url=${encodeURIComponent(videoUrl)}&format=json`;
  const response = await fetch(endpoint, { method: "GET" });

  if (!response.ok) {
    throw new Error(`YouTube metadata request failed with ${response.status}.`);
  }

  const data = await response.json() as { title?: unknown; author_name?: unknown };
  const title = typeof data.title === "string" ? data.title.trim() : "";
  const artist = typeof data.author_name === "string" ? data.author_name.trim() : "";
  if (!title) throw new Error("YouTube did not return a title.");

  return { title, artist };
}

type YTPlayer = {
  getDuration: () => number;
  destroy: () => void;
};

type YTPlayerEvent = { target: YTPlayer };

type YTNamespace = {
  Player: new (element: HTMLElement, options: {
    videoId: string;
    playerVars?: Record<string, string | number>;
    events?: {
      onReady?: (event: YTPlayerEvent) => void;
      onError?: () => void;
    };
  }) => YTPlayer;
};

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let iframeApiPromise: Promise<YTNamespace> | null = null;

function loadYouTubeIframeApi(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (iframeApiPromise) return iframeApiPromise;

  iframeApiPromise = new Promise<YTNamespace>((resolve, reject) => {
    const existingScript = document.getElementById("youtube-iframe-api");
    const previousReady = window.onYouTubeIframeAPIReady;
    const timeout = window.setTimeout(() => reject(new Error("YouTube player API timeout.")), 10000);

    window.onYouTubeIframeAPIReady = () => {
      previousReady?.();
      if (window.YT?.Player) {
        window.clearTimeout(timeout);
        resolve(window.YT);
      } else {
        window.clearTimeout(timeout);
        reject(new Error("YouTube player API unavailable."));
      }
    };

    if (!existingScript) {
      const script = document.createElement("script");
      script.id = "youtube-iframe-api";
      script.src = "https://www.youtube.com/iframe_api";
      script.async = true;
      script.onerror = () => {
        window.clearTimeout(timeout);
        reject(new Error("Could not load YouTube player API."));
      };
      document.head.appendChild(script);
    }
  }).catch((error) => {
    iframeApiPromise = null;
    throw error;
  });

  return iframeApiPromise;
}

/**
 * Best-effort duration lookup using YouTube's public IFrame Player API.
 * It requires no YouTube Data API key. If YouTube/browser restrictions prevent
 * the lookup, callers should fall back to manual minutes/seconds entry.
 */
export async function fetchYouTubeDuration(videoId: string): Promise<number | null> {
  try {
    const YT = await loadYouTubeIframeApi();
    return await new Promise<number | null>((resolve) => {
      const host = document.createElement("div");
      host.style.position = "fixed";
      host.style.left = "-9999px";
      host.style.top = "-9999px";
      host.style.width = "1px";
      host.style.height = "1px";
      host.style.overflow = "hidden";
      host.setAttribute("aria-hidden", "true");
      document.body.appendChild(host);

      let settled = false;
      let player: YTPlayer | null = null;
      const finish = (value: number | null) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        try { player?.destroy(); } catch { /* noop */ }
        host.remove();
        resolve(value && value > 0 ? Math.round(value) : null);
      };

      const timeout = window.setTimeout(() => finish(null), 9000);
      try {
        player = new YT.Player(host, {
          videoId,
          playerVars: { controls: 0, playsinline: 1 },
          events: {
            onReady: (event) => {
              const first = event.target.getDuration();
              if (first > 0) {
                finish(first);
                return;
              }
              window.setTimeout(() => finish(event.target.getDuration()), 500);
            },
            onError: () => finish(null)
          }
        });
      } catch {
        finish(null);
      }
    });
  } catch {
    return null;
  }
}
