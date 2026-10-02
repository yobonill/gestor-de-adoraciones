import { get, onValue, push, ref, remove, set, update } from "firebase/database";
import { db } from "@/lib/firebase";
import { DEFAULT_CONFIG } from "@/lib/defaultConfig";
import { canonicalYouTubeUrl, extractYouTubeVideoId, youtubeThumbnail } from "@/lib/youtube";
import type { AppConfig, FilterGroup, FilterOption, ServiceItem, ServicePlan, ServiceSection, Song, SongVideo } from "@/types";

function clean<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function listFromRealtime<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value.filter(Boolean) as T[];
  if (value && typeof value === "object") return Object.values(value as Record<string, T>).filter(Boolean);
  return [];
}

function normalizeConfig(value: unknown): AppConfig {
  if (!value || typeof value !== "object") return DEFAULT_CONFIG;
  const raw = value as Partial<AppConfig>;
  const filterGroups = listFromRealtime<FilterGroup>(raw.filterGroups).map((group) => ({
    ...group,
    options: listFromRealtime<FilterOption>(group.options)
  }));
  return filterGroups.length ? { filterGroups } : DEFAULT_CONFIG;
}

function normalizeVideo(value: Partial<SongVideo>): SongVideo {
  return {
    id: String(value.id || crypto.randomUUID()),
    youtubeVideoId: String(value.youtubeVideoId || ""),
    youtubeUrl: String(value.youtubeUrl || ""),
    title: String(value.title || ""),
    thumbnailUrl: String(value.thumbnailUrl || ""),
    videoTypeIds: listFromRealtime<string>(value.videoTypeIds),
    status: value.status === "blacklisted" ? "blacklisted" : "usable",
    blacklistReason: value.blacklistReason ? String(value.blacklistReason) : undefined
  };
}

function normalizeSong(id: string, value: Partial<Song>): Song {
  const rawClassifications = value.classifications && typeof value.classifications === "object"
    ? value.classifications
    : {};
  const classifications = Object.fromEntries(
    Object.entries(rawClassifications).map(([groupId, optionIds]) => [groupId, listFromRealtime<string>(optionIds)])
  );

  return {
    id,
    title: String(value.title || ""),
    notes: String(value.notes || ""),
    status: value.status || "pending",
    proposedStatus: value.proposedStatus,
    blacklistReason: value.blacklistReason ? String(value.blacklistReason) : undefined,
    classifications,
    videos: listFromRealtime<Partial<SongVideo>>(value.videos).map(normalizeVideo),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt
  };
}

function normalizeSection(value: Partial<ServiceSection>): ServiceSection {
  return {
    id: String(value.id || crypto.randomUUID()),
    label: String(value.label || "Canciones"),
    date: value.date,
    items: listFromRealtime<ServiceItem>(value.items)
  };
}

function normalizeService(id: string, value: Partial<ServicePlan>): ServicePlan {
  const sections = listFromRealtime<Partial<ServiceSection>>(value.sections).map(normalizeSection);
  return {
    id,
    title: String(value.title || "Culto"),
    kind: value.kind === "weekend" ? "weekend" : "single",
    date: String(value.date || ""),
    sections: sections.length ? sections : [{ id: crypto.randomUUID(), label: "Canciones", items: [] }],
    createdAt: value.createdAt,
    updatedAt: value.updatedAt
  };
}

export function subscribeConfig(callback: (config: AppConfig) => void): () => void {
  return onValue(ref(db, "config"), (snapshot) => callback(normalizeConfig(snapshot.val())));
}

export function subscribeSongs(callback: (songs: Song[]) => void): () => void {
  return onValue(ref(db, "songs"), (snapshot) => {
    const raw = snapshot.val();
    const songs = raw && typeof raw === "object"
      ? Object.entries(raw as Record<string, Partial<Song>>).map(([id, item]) => normalizeSong(id, item))
      : [];
    songs.sort((a, b) => a.title.localeCompare(b.title, "es"));
    callback(songs);
  });
}

export async function getAllSongs(): Promise<Song[]> {
  const snapshot = await get(ref(db, "songs"));
  const raw = snapshot.val();
  if (!raw || typeof raw !== "object") return [];
  return Object.entries(raw as Record<string, Partial<Song>>).map(([id, item]) => normalizeSong(id, item));
}

export async function createSong(song: Omit<Song, "id">): Promise<string> {
  const songs = await getAllSongs();
  const incomingVideoIds = song.videos.map((video) => video.youtubeVideoId);
  const duplicate = songs.find((item) => item.videos.some((video) => incomingVideoIds.includes(video.youtubeVideoId)));
  if (duplicate) throw new Error(`Este video ya está registrado en “${duplicate.title}”.`);

  const newRef = push(ref(db, "songs"));
  await set(newRef, clean(song));
  return newRef.key!;
}

export async function updateSong(song: Song): Promise<void> {
  if (!song.title.trim() || song.videos.length === 0) {
    throw new Error("La canción necesita título y al menos un video válido.");
  }

  const normalizedVideos = song.videos.map((video) => {
    const youtubeVideoId = extractYouTubeVideoId(video.youtubeUrl);
    if (!youtubeVideoId) throw new Error("Uno de los enlaces de YouTube no es válido.");
    return {
      ...video,
      youtubeVideoId,
      youtubeUrl: canonicalYouTubeUrl(youtubeVideoId),
      thumbnailUrl: video.thumbnailUrl || youtubeThumbnail(youtubeVideoId),
      videoTypeIds: video.videoTypeIds || []
    };
  });

  const songs = await getAllSongs();
  const videoIds = normalizedVideos.map((video) => video.youtubeVideoId);
  const duplicate = songs.find((item) => item.id !== song.id && item.videos.some((video) => videoIds.includes(video.youtubeVideoId)));
  if (duplicate) throw new Error(`Uno de los videos ya pertenece a “${duplicate.title}”.`);

  const { id, ...data } = { ...song, videos: normalizedVideos };
  await set(ref(db, `songs/${id}`), clean(data));
}

export async function deleteSong(id: string): Promise<void> {
  await remove(ref(db, `songs/${id}`));
}

export async function reviewSong(song: Song, action: "approve" | "reject"): Promise<void> {
  const now = new Date().toISOString();
  const status = action === "approve"
    ? (song.proposedStatus === "blacklisted" ? "blacklisted" : "approved")
    : "rejected";
  await update(ref(db, `songs/${song.id}`), { status, updatedAt: now });
}

export async function saveConfig(config: AppConfig): Promise<void> {
  await set(ref(db, "config"), clean(config));
}

export function subscribeServices(callback: (services: ServicePlan[]) => void): () => void {
  return onValue(ref(db, "servicePlans"), (snapshot) => {
    const raw = snapshot.val();
    const services = raw && typeof raw === "object"
      ? Object.entries(raw as Record<string, Partial<ServicePlan>>).map(([id, item]) => normalizeService(id, item))
      : [];
    services.sort((a, b) => b.date.localeCompare(a.date));
    callback(services.slice(0, 30));
  });
}

export async function saveService(plan: ServicePlan): Promise<string> {
  const now = new Date().toISOString();
  if (plan.id) {
    const { id, ...data } = plan;
    await set(ref(db, `servicePlans/${id}`), clean({ ...data, updatedAt: now }));
    return id;
  }

  const newRef = push(ref(db, "servicePlans"));
  const { id: _ignored, ...data } = plan;
  await set(newRef, clean({ ...data, createdAt: now, updatedAt: now }));
  return newRef.key!;
}

export async function deleteService(id: string): Promise<void> {
  await remove(ref(db, `servicePlans/${id}`));
}
