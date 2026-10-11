import { get, onValue, push, ref, remove, set, update } from "firebase/database";
import { db } from "@/lib/firebase";
import { DEFAULT_CONFIG } from "@/lib/defaultConfig";
import { canonicalYouTubeUrl, extractYouTubeVideoId, youtubeThumbnail } from "@/lib/youtube";
import { canonicalArtistName, uniqueArtists } from "@/lib/artists";
import { cleanComparableText, cleanFreeText, normalizeTextKey } from "@/lib/text";
import { sanitizeDurationSeconds } from "@/lib/duration";
import { ensurePrimaryVideo } from "@/lib/videos";
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
    isPrimary: Boolean(value.isPrimary),
    durationSeconds: sanitizeDurationSeconds(value.durationSeconds),
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

  const title = String(value.title || "");
  const artist = String(value.artist || "");
  const lyrics = String(value.lyrics || "");

  return {
    id,
    title,
    artist,
    lyrics,
    search: {
      title: value.search?.title ? String(value.search.title) : normalizeTextKey(title),
      artist: value.search?.artist ? String(value.search.artist) : normalizeTextKey(artist),
      lyrics: value.search?.lyrics ? String(value.search.lyrics) : normalizeTextKey(lyrics)
    },
    notes: String(value.notes || ""),
    status: value.status || "pending",
    proposedStatus: value.proposedStatus,
    blacklistReason: value.blacklistReason ? String(value.blacklistReason) : undefined,
    rejectionReason: value.rejectionReason ? String(value.rejectionReason) : undefined,
    classifications,
    videos: ensurePrimaryVideo(listFromRealtime<Partial<SongVideo>>(value.videos).map(normalizeVideo)),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt
  };
}

function normalizeServiceItem(value: Partial<ServiceItem>): ServiceItem {
  return {
    songId: String(value.songId || ""),
    songTitle: String(value.songTitle || ""),
    songArtist: value.songArtist ? String(value.songArtist) : undefined,
    videoId: String(value.videoId || ""),
    videoTitle: String(value.videoTitle || ""),
    youtubeUrl: String(value.youtubeUrl || ""),
    videoTypeLabel: value.videoTypeLabel ? String(value.videoTypeLabel) : undefined,
    durationSeconds: sanitizeDurationSeconds(value.durationSeconds)
  };
}

function normalizeSection(value: Partial<ServiceSection>): ServiceSection {
  return {
    id: String(value.id || crypto.randomUUID()),
    label: String(value.label || "Canciones"),
    date: value.date,
    items: listFromRealtime<Partial<ServiceItem>>(value.items).map(normalizeServiceItem)
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

export async function getAllServices(): Promise<ServicePlan[]> {
  const snapshot = await get(ref(db, "servicePlans"));
  const raw = snapshot.val();
  if (!raw || typeof raw !== "object") return [];
  const services = Object.entries(raw as Record<string, Partial<ServicePlan>>).map(([id, item]) => normalizeService(id, item));
  services.sort((a, b) => b.date.localeCompare(a.date));
  return services;
}

function normalizeSongForStorage(song: Omit<Song, "id">, canonicalArtist: string): Omit<Song, "id"> {
  const title = cleanComparableText(song.title);
  const artist = cleanComparableText(canonicalArtist);
  const lyrics = cleanFreeText(song.lyrics || "");
  return {
    ...song,
    title,
    artist,
    lyrics,
    search: {
      title: normalizeTextKey(title),
      artist: normalizeTextKey(artist),
      lyrics: normalizeTextKey(lyrics)
    },
    notes: cleanFreeText(song.notes || ""),
    blacklistReason: song.blacklistReason ? cleanFreeText(song.blacklistReason) : undefined,
    rejectionReason: song.rejectionReason ? cleanFreeText(song.rejectionReason) : undefined,
    videos: ensurePrimaryVideo(song.videos).map((video) => ({
      ...video,
      title: cleanComparableText(video.title || title),
      durationSeconds: sanitizeDurationSeconds(video.durationSeconds),
      blacklistReason: video.blacklistReason ? cleanFreeText(video.blacklistReason) : undefined
    }))
  };
}

function validateNormalizedConfig(config: AppConfig): AppConfig {
  const seenGroups = new Set<string>();
  const filterGroups = config.filterGroups.map((group) => {
    const label = cleanComparableText(group.label);
    const groupKey = normalizeTextKey(label);
    if (!groupKey) throw new Error("Todos los grupos de filtros necesitan un nombre.");
    if (seenGroups.has(groupKey)) throw new Error(`Ya existe un grupo llamado “${label}”.`);
    seenGroups.add(groupKey);

    const seenOptions = new Set<string>();
    const options = group.options.map((option) => {
      const optionLabel = cleanComparableText(option.label);
      const optionKey = normalizeTextKey(optionLabel);
      if (!optionKey) throw new Error(`Hay una opción sin nombre dentro de “${label}”.`);
      if (seenOptions.has(optionKey)) throw new Error(`“${label}” tiene opciones duplicadas: “${optionLabel}”.`);
      seenOptions.add(optionKey);
      return { ...option, label: optionLabel };
    });

    return { ...group, label, options };
  });

  return { filterGroups };
}

export async function createSong(song: Omit<Song, "id">): Promise<string> {
  const songs = await getAllSongs();
  if (!song.title.trim() || !song.artist.trim()) {
    throw new Error("La canción necesita título y artista.");
  }
  const incomingVideoIds = song.videos.map((video) => video.youtubeVideoId);
  const duplicate = songs.find((item) => item.videos.some((video) => incomingVideoIds.includes(video.youtubeVideoId)));
  if (duplicate) throw new Error(`Este video ya está registrado en “${duplicate.title}”.`);

  const canonicalArtist = canonicalArtistName(song.artist, uniqueArtists(songs.map((item) => item.artist)));
  const normalizedSong = normalizeSongForStorage(song, canonicalArtist);
  const newRef = push(ref(db, "songs"));
  await set(newRef, clean(normalizedSong));
  return newRef.key!;
}

export async function updateSong(song: Song): Promise<void> {
  if (!song.title.trim() || !song.artist.trim() || song.videos.length === 0) {
    throw new Error("La canción necesita título, artista y al menos un video válido.");
  }

  const normalizedVideos = ensurePrimaryVideo(song.videos.map((video) => {
    const youtubeVideoId = extractYouTubeVideoId(video.youtubeUrl);
    if (!youtubeVideoId) throw new Error("Uno de los enlaces de YouTube no es válido.");
    return {
      ...video,
      youtubeVideoId,
      youtubeUrl: canonicalYouTubeUrl(youtubeVideoId),
      thumbnailUrl: video.thumbnailUrl || youtubeThumbnail(youtubeVideoId),
      videoTypeIds: video.videoTypeIds || [],
      durationSeconds: sanitizeDurationSeconds(video.durationSeconds)
    };
  }));

  const songs = await getAllSongs();
  const canonicalArtist = canonicalArtistName(song.artist, uniqueArtists(songs.filter((item) => item.id !== song.id).map((item) => item.artist)));
  const videoIds = normalizedVideos.map((video) => video.youtubeVideoId);
  const duplicate = songs.find((item) => item.id !== song.id && item.videos.some((video) => videoIds.includes(video.youtubeVideoId)));
  if (duplicate) throw new Error(`Uno de los videos ya pertenece a “${duplicate.title}”.`);

  const { id, ...data } = { ...song, videos: normalizedVideos };
  const normalizedSong = normalizeSongForStorage(data, canonicalArtist);
  await set(ref(db, `songs/${id}`), clean(normalizedSong));
}

export async function deleteSong(id: string): Promise<void> {
  await remove(ref(db, `songs/${id}`));
}

export async function reviewSong(song: Song, action: "approve" | "reject", rejectionReason = ""): Promise<void> {
  const now = new Date().toISOString();
  const status = action === "approve"
    ? (song.proposedStatus === "blacklisted" ? "blacklisted" : "approved")
    : "rejected";
  await update(ref(db, `songs/${song.id}`), clean({
    status,
    updatedAt: now,
    rejectionReason: action === "reject" ? cleanFreeText(rejectionReason) : ""
  }));
}

export async function saveConfig(config: AppConfig): Promise<void> {
  await set(ref(db, "config"), clean(validateNormalizedConfig(config)));
}

export function subscribeServices(callback: (services: ServicePlan[]) => void): () => void {
  return onValue(ref(db, "servicePlans"), (snapshot) => {
    const raw = snapshot.val();
    const services = raw && typeof raw === "object"
      ? Object.entries(raw as Record<string, Partial<ServicePlan>>).map(([id, item]) => normalizeService(id, item))
      : [];
    services.sort((a, b) => b.date.localeCompare(a.date));
    callback(services);
  });
}

export async function saveService(plan: ServicePlan): Promise<string> {
  const now = new Date().toISOString();
  const normalizedPlan: ServicePlan = {
    ...plan,
    title: cleanComparableText(plan.title),
    sections: plan.sections.map((section) => ({
      ...section,
      label: cleanComparableText(section.label),
      items: section.items.map((item) => ({ ...item, durationSeconds: sanitizeDurationSeconds(item.durationSeconds) }))
    }))
  };
  if (normalizedPlan.id) {
    const { id, ...data } = normalizedPlan;
    await set(ref(db, `servicePlans/${id}`), clean({ ...data, updatedAt: now }));
    return id;
  }

  const newRef = push(ref(db, "servicePlans"));
  const { id: _ignored, ...data } = normalizedPlan;
  await set(newRef, clean({ ...data, createdAt: now, updatedAt: now }));
  return newRef.key!;
}

export async function deleteService(id: string): Promise<void> {
  await remove(ref(db, `servicePlans/${id}`));
}
