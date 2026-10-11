import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { AppConfig, Song, SongVideo } from "@/types";
import { createSong } from "@/lib/database";
import { canonicalYouTubeUrl, extractYouTubeVideoId, fetchYouTubeDuration, fetchYouTubeMetadata, youtubeThumbnail } from "@/lib/youtube";
import { canonicalArtistName, uniqueArtists } from "@/lib/artists";
import { ArtistAutocomplete } from "./ArtistAutocomplete";
import { FilterChips } from "./FilterChips";
import { DurationInput } from "./DurationInput";
import { SongDetailsModal } from "./SongDetailsModal";
import { formatDuration } from "@/lib/duration";
import { ensurePrimaryVideo, getPrimaryUsableVideo, markPrimaryVideo, updateVideoStatus } from "@/lib/videos";

type Metadata = {
  videoId: string;
  canonicalUrl: string;
  thumbnailUrl: string;
};

type Draft = {
  url: string;
  metadata: Metadata | null;
  title: string;
  artist: string;
  lyrics: string;
  notes: string;
  classifications: Record<string, string[]>;
  videos: SongVideo[];
  proposedStatus: "approved" | "blacklisted";
  blacklistReason: string;
  // Legacy fields kept only so old local drafts can migrate cleanly.
  durationSeconds?: number;
  videoTypes?: string[];
};

type MessageKind = "info" | "warning" | "success";

const DRAFT_STORAGE_KEY = "gestor-de-adoraciones:add-song-draft:v1";

const EMPTY_DRAFT: Draft = {
  url: "",
  metadata: null,
  title: "",
  artist: "",
  lyrics: "",
  notes: "",
  classifications: {},
  videos: [],
  proposedStatus: "approved",
  blacklistReason: ""
};

function draftVideoFromMetadata(metadata: Metadata, durationSeconds = 0, videoTypeIds: string[] = []): SongVideo {
  return {
    id: crypto.randomUUID(),
    youtubeVideoId: metadata.videoId,
    youtubeUrl: metadata.canonicalUrl,
    title: "",
    thumbnailUrl: metadata.thumbnailUrl,
    videoTypeIds,
    status: "usable",
    isPrimary: true,
    durationSeconds
  };
}

function normalizeStoredVideo(value: Partial<SongVideo>): SongVideo | null {
  const videoId = value.youtubeVideoId || extractYouTubeVideoId(value.youtubeUrl || "");
  if (!videoId) return null;
  return {
    id: String(value.id || crypto.randomUUID()),
    youtubeVideoId: videoId,
    youtubeUrl: canonicalYouTubeUrl(videoId),
    title: String(value.title || ""),
    thumbnailUrl: String(value.thumbnailUrl || youtubeThumbnail(videoId)),
    videoTypeIds: Array.isArray(value.videoTypeIds) ? value.videoTypeIds : [],
    status: value.status === "blacklisted" ? "blacklisted" : "usable",
    isPrimary: Boolean(value.isPrimary),
    durationSeconds: typeof value.durationSeconds === "number" ? value.durationSeconds : 0,
    blacklistReason: typeof value.blacklistReason === "string" ? value.blacklistReason : undefined
  };
}

function loadDraft(): Draft {
  try {
    const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return EMPTY_DRAFT;
    const stored = JSON.parse(raw) as Partial<Draft>;
    const metadata = stored.metadata && typeof stored.metadata.videoId === "string" ? stored.metadata : null;
    const storedVideos = Array.isArray(stored.videos)
      ? ensurePrimaryVideo(stored.videos.map((video) => normalizeStoredVideo(video)).filter((video): video is SongVideo => Boolean(video)))
      : [];
    const migratedVideos = storedVideos.length
      ? storedVideos
      : metadata
        ? [draftVideoFromMetadata(
            metadata,
            typeof stored.durationSeconds === "number" ? stored.durationSeconds : 0,
            Array.isArray(stored.videoTypes) ? stored.videoTypes : []
          )]
        : [];

    return {
      url: typeof stored.url === "string" ? stored.url : "",
      metadata,
      title: typeof stored.title === "string" ? stored.title : "",
      artist: typeof stored.artist === "string" ? stored.artist : "",
      lyrics: typeof stored.lyrics === "string" ? stored.lyrics : "",
      notes: typeof stored.notes === "string" ? stored.notes : "",
      classifications: stored.classifications && typeof stored.classifications === "object" ? stored.classifications : {},
      videos: migratedVideos,
      proposedStatus: stored.proposedStatus === "blacklisted" ? "blacklisted" : "approved",
      blacklistReason: typeof stored.blacklistReason === "string" ? stored.blacklistReason : ""
    };
  } catch {
    return EMPTY_DRAFT;
  }
}

export function AddSongPanel({ config, songs }: { config: AppConfig; songs: Song[] }) {
  const initialDraft = useMemo(loadDraft, []);
  const [url, setUrl] = useState(initialDraft.url);
  const [metadata, setMetadata] = useState<Metadata | null>(initialDraft.metadata);
  const [title, setTitle] = useState(initialDraft.title);
  const [artist, setArtist] = useState(initialDraft.artist);
  const [lyrics, setLyrics] = useState(initialDraft.lyrics);
  const [notes, setNotes] = useState(initialDraft.notes);
  const [classifications, setClassifications] = useState<Record<string, string[]>>(initialDraft.classifications);
  const [videos, setVideos] = useState<SongVideo[]>(initialDraft.videos);
  const [proposedStatus, setProposedStatus] = useState<"approved" | "blacklisted">(initialDraft.proposedStatus);
  const [blacklistReason, setBlacklistReason] = useState(initialDraft.blacklistReason);
  const [newVideoUrl, setNewVideoUrl] = useState("");
  const [addingVideo, setAddingVideo] = useState(false);
  const [videoMessage, setVideoMessage] = useState("");
  const [message, setMessage] = useState("");
  const [messageKind, setMessageKind] = useState<MessageKind>("info");
  const [toastMessage, setToastMessage] = useState("");
  const [toastKind, setToastKind] = useState<MessageKind>("info");
  const [detailsSong, setDetailsSong] = useState<Song | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const inspectSequenceRef = useRef(0);
  const [busy, setBusy] = useState(false);
  const [inspecting, setInspecting] = useState(false);
  const [invalidGroups, setInvalidGroups] = useState<string[]>([]);
  const [invalidDurationVideoIds, setInvalidDurationVideoIds] = useState<string[]>([]);
  const [invalidTypeVideoIds, setInvalidTypeVideoIds] = useState<string[]>([]);
  const [titleInvalid, setTitleInvalid] = useState(false);
  const [artistInvalid, setArtistInvalid] = useState(false);
  const [blacklistReasonInvalid, setBlacklistReasonInvalid] = useState(false);

  const artists = useMemo(() => uniqueArtists(songs.map((song) => song.artist)), [songs]);
  const videoTypeGroup = useMemo(() => config.filterGroups.find((g) => g.id === "video-type"), [config]);
  const songGroups = useMemo(() => config.filterGroups.filter((g) => g.id !== "video-type"), [config]);
  const duplicate = useMemo(
    () => metadata ? songs.find((song) => song.videos.some((video) => video.youtubeVideoId === metadata.videoId)) || null : null,
    [metadata, songs]
  );
  const primaryVideo = getPrimaryUsableVideo(videos) || videos[0] || null;
  const primaryVideoIndex = primaryVideo ? videos.findIndex((video) => video.id === primaryVideo.id) : -1;

  useEffect(() => {
    const draft: Draft = { url, metadata, title, artist, lyrics, notes, classifications, videos, proposedStatus, blacklistReason };
    localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
  }, [url, metadata, title, artist, lyrics, notes, classifications, videos, proposedStatus, blacklistReason]);

  useEffect(() => () => {
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
  }, []);

  function showMessage(text: string, kind: MessageKind = "info") {
    setMessage(text);
    setMessageKind(kind);
    setToastMessage(text);
    setToastKind(kind);
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => {
      setToastMessage("");
      toastTimerRef.current = null;
    }, kind === "warning" ? 7000 : 5000);
  }

  function dismissToast() {
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = null;
    setToastMessage("");
  }

  function patchVideo(index: number, patch: Partial<SongVideo>) {
    setVideos((current) => ensurePrimaryVideo(current.map((video, i) => i === index ? { ...video, ...patch } : video)));
  }

  function setVideoStatus(index: number, status: SongVideo["status"]) {
    setVideos((current) => updateVideoStatus(current, current[index]?.id || "", status));
  }

  function setPrimaryVideo(videoId: string) {
    setVideos((current) => markPrimaryVideo(current, videoId));
  }

  function removeVideo(index: number) {
    setVideos((current) => ensurePrimaryVideo(current.filter((_, i) => i !== index)));
  }

  function clearDraft(showFeedback = true) {
    inspectSequenceRef.current += 1;
    setUrl("");
    setMetadata(null);
    setTitle("");
    setArtist("");
    setLyrics("");
    setNotes("");
    setClassifications({});
    setVideos([]);
    setProposedStatus("approved");
    setBlacklistReason("");
    setNewVideoUrl("");
    setVideoMessage("");
    setInvalidGroups([]);
    setInvalidDurationVideoIds([]);
    setInvalidTypeVideoIds([]);
    setTitleInvalid(false);
    setArtistInvalid(false);
    setBlacklistReasonInvalid(false);
    localStorage.removeItem(DRAFT_STORAGE_KEY);
    if (showFeedback) showMessage("Formulario limpiado.", "info");
  }

  async function inspectLink() {
    setMessage("");
    setInvalidGroups([]);
    setInvalidDurationVideoIds([]);
    setInvalidTypeVideoIds([]);
    const videoId = extractYouTubeVideoId(url);
    if (!videoId) {
      setMetadata(null);
      setVideos([]);
      showMessage("Enlace de YouTube inválido.", "warning");
      return;
    }

    const canonicalUrl = canonicalYouTubeUrl(videoId);
    const nextMetadata: Metadata = { videoId, canonicalUrl, thumbnailUrl: youtubeThumbnail(videoId) };
    setUrl(canonicalUrl);
    setMetadata(nextMetadata);

    const existing = songs.find((song) => song.videos.some((video) => video.youtubeVideoId === videoId)) || null;
    if (existing) {
      setVideos([]);
      if (existing.status === "rejected") {
        const reason = existing.rejectionReason?.trim() ? ` Motivo: ${existing.rejectionReason}` : "";
        showMessage(`Este video fue rechazado anteriormente (${existing.title}).${reason}`, "warning");
      } else {
        const reason = existing.blacklistReason?.trim() ? ` Motivo: ${existing.blacklistReason}` : "";
        const statusLabel = existing.status === "blacklisted" ? "blacklist" : existing.status === "approved" ? "aprobado" : existing.status;
        showMessage(`Este video ya está registrado como ${statusLabel}. ${existing.title}.${reason}`, "warning");
      }
      return;
    }

    const firstVideo = draftVideoFromMetadata(nextMetadata);
    setVideos([firstVideo]);
    setInspecting(true);
    const requestId = ++inspectSequenceRef.current;
    const durationPromise = fetchYouTubeDuration(videoId);

    try {
      const youtube = await fetchYouTubeMetadata(videoId);
      if (requestId !== inspectSequenceRef.current) return;
      setTitle(youtube.title);
      setTitleInvalid(false);
      if (youtube.artist) {
        setArtist(canonicalArtistName(youtube.artist, artists));
        setArtistInvalid(false);
        showMessage("Título y artista/canal obtenidos de YouTube. Buscando duración…", "success");
      } else {
        showMessage("Se obtuvo el título, pero YouTube no devolvió el artista/canal. Escríbelo manualmente. Buscando duración…", "warning");
      }
    } catch {
      if (requestId !== inspectSequenceRef.current) return;
      showMessage("No se pudo obtener el nombre ni el artista de YouTube. Escríbelos manualmente. Buscando duración…", "warning");
    } finally {
      if (requestId === inspectSequenceRef.current) setInspecting(false);
    }

    void durationPromise.then((duration) => {
      if (requestId !== inspectSequenceRef.current) return;
      if (duration) {
        setVideos((current) => ensurePrimaryVideo(current.map((video) => video.id === firstVideo.id ? { ...video, durationSeconds: duration } : video)));
        setInvalidDurationVideoIds((current) => current.filter((id) => id !== firstVideo.id));
        showMessage(`Duración obtenida de YouTube: ${formatDuration(duration)}. Puedes modificarla si es necesario.`, "success");
      } else {
        showMessage("No se pudo obtener la duración de YouTube. Agrégala manualmente en minutos y segundos.", "warning");
      }
    });
  }

  async function addVideo() {
    setVideoMessage("");
    const videoId = extractYouTubeVideoId(newVideoUrl);
    if (!videoId) {
      setVideoMessage("Enlace de YouTube inválido.");
      return;
    }

    const externalDuplicate = songs.find((song) => song.videos.some((video) => video.youtubeVideoId === videoId));
    if (externalDuplicate) {
      setVideoMessage(`Ese video ya pertenece a “${externalDuplicate.title}”.`);
      return;
    }
    if (videos.some((video) => video.youtubeVideoId === videoId)) {
      setVideoMessage("Ese video ya está agregado a esta canción.");
      return;
    }

    setAddingVideo(true);
    try {
      const durationSeconds = await fetchYouTubeDuration(videoId) || 0;
      const nextVideo: SongVideo = {
        id: crypto.randomUUID(),
        youtubeVideoId: videoId,
        youtubeUrl: canonicalYouTubeUrl(videoId),
        title: title.trim(),
        thumbnailUrl: youtubeThumbnail(videoId),
        videoTypeIds: [],
        status: "usable",
        isPrimary: false,
        durationSeconds
      };
      setVideos((current) => ensurePrimaryVideo([...current, nextVideo]));
      setNewVideoUrl("");
      setVideoMessage(durationSeconds
        ? `Video agregado. Duración detectada: ${formatDuration(durationSeconds)}.`
        : "Video agregado. No se pudo detectar la duración; agrégala manualmente.");
    } finally {
      setAddingVideo(false);
    }
  }

  function validate(): boolean {
    const missingGroups: string[] = [];
    for (const group of songGroups) {
      const hasActiveOptions = group.options.some((option) => option.active);
      if (hasActiveOptions && !(classifications[group.id] || []).length) missingGroups.push(group.id);
    }

    const requiresVideoType = Boolean(videoTypeGroup?.options.some((option) => option.active));
    const missingVideoTypeIds = requiresVideoType ? videos.filter((video) => !(video.videoTypeIds || []).length).map((video) => video.id) : [];
    const missingDurationIds = videos.filter((video) => !video.durationSeconds || video.durationSeconds <= 0).map((video) => video.id);
    const missingTitle = !title.trim();
    const missingArtist = !artist.trim();
    const missingVideos = videos.length === 0;
    const missingUsableVideo = proposedStatus === "approved" && videos.length > 0 && !videos.some((video) => video.status === "usable");
    const missingBlacklistReason = proposedStatus === "blacklisted" && !blacklistReason.trim();

    setInvalidGroups(missingGroups);
    setInvalidDurationVideoIds(missingDurationIds);
    setInvalidTypeVideoIds(missingVideoTypeIds);
    setTitleInvalid(missingTitle);
    setArtistInvalid(missingArtist);
    setBlacklistReasonInvalid(missingBlacklistReason);

    const problems: string[] = [];
    if (missingTitle) problems.push("escribe el nombre de la canción");
    if (missingArtist) problems.push("escribe o selecciona el artista");
    if (missingVideos) problems.push("agrega al menos un video");
    if (missingDurationIds.length) problems.push("agrega la duración de todos los videos");
    if (missingVideoTypeIds.length) problems.push(`selecciona ${videoTypeGroup?.label || "el tipo de video"} para todos los videos`);
    if (missingGroups.length) {
      const labels = config.filterGroups.filter((group) => missingGroups.includes(group.id)).map((group) => group.label);
      problems.push(`selecciona al menos una opción en: ${labels.join(", ")}`);
    }
    if (missingUsableVideo) problems.push("deja al menos una versión marcada como usable");
    if (missingBlacklistReason) problems.push("indica el motivo por el que no es apta");

    if (problems.length) {
      showMessage(`No se puede agregar todavía. Falta: ${problems.join("; ")}.`, "warning");
      return false;
    }
    return true;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!metadata) {
      showMessage("Primero revisa el enlace de YouTube.", "warning");
      return;
    }
    if (duplicate) {
      showMessage("No se puede enviar un video que ya existe en el sistema.", "warning");
      return;
    }
    if (!validate()) return;

    setBusy(true);
    setMessage("");
    const now = new Date().toISOString();
    try {
      const canonicalArtist = canonicalArtistName(artist, artists);
      await createSong({
        title: title.trim(),
        artist: canonicalArtist,
        lyrics,
        notes: notes.trim(),
        status: "pending",
        proposedStatus,
        blacklistReason: proposedStatus === "blacklisted" ? blacklistReason.trim() : "",
        classifications,
        videos: videos.map((video) => ({ ...video, title: title.trim() })),
        createdAt: now,
        updatedAt: now
      });
      showMessage("Enviada. Quedó pendiente de aprobación.", "success");
      clearDraft(false);
    } catch (error) {
      showMessage(error instanceof Error ? error.message : "No se pudo enviar la canción.", "warning");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel-stack">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Nueva canción</span>
          <h2>Agregar desde YouTube</h2>
        </div>
        <div className="heading-actions">
          <span className="muted">Tu borrador se conserva al cambiar de pestaña.</span>
          <button className="secondary" type="button" onClick={() => clearDraft(true)}>Limpiar</button>
        </div>
      </div>

      <div className="url-row">
        <input
          value={url}
          onChange={(e) => {
            inspectSequenceRef.current += 1;
            setUrl(e.target.value);
            setMetadata(null);
            setTitle("");
            setArtist("");
            setVideos([]);
            setTitleInvalid(false);
            setArtistInvalid(false);
            setInvalidDurationVideoIds([]);
            setInvalidTypeVideoIds([]);
            setMessage("");
          }}
          disabled={inspecting}
          placeholder="Pega un enlace de YouTube"
        />
        <button className="primary" type="button" onClick={() => void inspectLink()} disabled={!url.trim() || inspecting}>
          {inspecting ? "Buscando…" : "Revisar"}
        </button>
      </div>

      {message && <div className={`notice ${messageKind === "warning" ? "warning" : ""} ${messageKind === "success" ? "success" : ""}`}>{message}</div>}

      {duplicate && metadata && (
        <div className="duplicate-actions-card">
          <div>
            <strong>{duplicate.title}</strong>
            <div className="song-artist">{duplicate.artist}</div>
            {duplicate.status === "rejected" && <p><strong>Motivo del rechazo:</strong> {duplicate.rejectionReason || "Sin motivo registrado."}</p>}
          </div>
          <div className="card-actions">
            <button type="button" className="secondary" onClick={() => setDetailsSong(duplicate)}>Ver detalles</button>
            <a className="primary primary-link" href={metadata.canonicalUrl} target="_blank" rel="noreferrer">▶ Abrir video</a>
          </div>
        </div>
      )}

      {toastMessage && (
        <div className={`app-toast ${toastKind}`} role={toastKind === "warning" ? "alert" : "status"} aria-live={toastKind === "warning" ? "assertive" : "polite"}>
          <div className="app-toast-icon" aria-hidden="true">{toastKind === "warning" ? "!" : toastKind === "success" ? "✓" : "i"}</div>
          <div className="app-toast-text">{toastMessage}</div>
          <button type="button" className="app-toast-close" onClick={dismissToast} aria-label="Cerrar mensaje">×</button>
        </div>
      )}

      {metadata && !duplicate && primaryVideo && (
        <form onSubmit={submit} className="form-stack" noValidate>
          <div className="video-preview">
            <img src={primaryVideo.thumbnailUrl} alt="Miniatura del video" width={240} height={135} />
            <div className="grow">
              <label className="field-label" htmlFor="song-title">Título de la canción</label>
              <input id="song-title" value={title} onChange={(e) => { setTitle(e.target.value); if (e.target.value.trim()) setTitleInvalid(false); }} className={titleInvalid ? "input-invalid" : ""} placeholder="Escribe el nombre de la canción" />
              {titleInvalid && <div className="field-error">El nombre de la canción es obligatorio.</div>}

              <label className="field-label artist-label" htmlFor="song-artist">Artista</label>
              <ArtistAutocomplete id="song-artist" value={artist} artists={artists} invalid={artistInvalid} onChange={(value) => { setArtist(value); if (value.trim()) setArtistInvalid(false); }} />
              {artistInvalid && <div className="field-error">El artista es obligatorio.</div>}

              <div className="duration-editor-block">
                <label className="field-label">Duración del video</label>
                <DurationInput
                  value={primaryVideo.durationSeconds}
                  onChange={(value) => {
                    if (primaryVideoIndex >= 0) patchVideo(primaryVideoIndex, { durationSeconds: value });
                    if (value > 0) setInvalidDurationVideoIds((current) => current.filter((id) => id !== primaryVideo.id));
                  }}
                  invalid={invalidDurationVideoIds.includes(primaryVideo.id)}
                  idPrefix="new-song-duration"
                />
                <div className="field-help">Se intenta obtener automáticamente de YouTube. Si falla o no es correcta, puedes escribir minutos y segundos manualmente.</div>
                {invalidDurationVideoIds.includes(primaryVideo.id) && <div className="field-error">La duración es obligatoria. Si YouTube no pudo obtenerla, agrégala manualmente.</div>}
              </div>

              <a href={primaryVideo.youtubeUrl} target="_blank" rel="noreferrer" className="text-link">Abrir video en YouTube ↗</a>
            </div>
          </div>

          {songGroups.map((group) => (
            <FilterChips key={group.id} group={group} selected={classifications[group.id] || []} invalid={invalidGroups.includes(group.id)} onChange={(value) => {
              setClassifications((current) => ({ ...current, [group.id]: value }));
              if (value.length) setInvalidGroups((current) => current.filter((id) => id !== group.id));
            }} />
          ))}

          <div className="divider" />
          <h3>Versiones / videos</h3>
          <div className="video-edit-list">
            {videos.map((video, index) => (
              <div className="video-edit" key={video.id}>
                <div className="video-edit-row">
                  <div className="grow">
                    <div className="field-label">Video {index + 1} {video.isPrimary && <span className="status-badge">★ Principal</span>}</div>
                    <a href={video.youtubeUrl} target="_blank" rel="noreferrer" className="text-link">{video.youtubeUrl}</a>
                  </div>
                  {videos.length > 1 && <button type="button" className="icon-button danger-text" title="Quitar video" onClick={() => removeVideo(index)}>×</button>}
                </div>

                {video.id !== primaryVideo?.id && (
                  <>
                    <label className="field-label">Duración</label>
                    <DurationInput
                      value={video.durationSeconds}
                      onChange={(value) => {
                        patchVideo(index, { durationSeconds: value });
                        if (value > 0) setInvalidDurationVideoIds((current) => current.filter((id) => id !== video.id));
                      }}
                      invalid={invalidDurationVideoIds.includes(video.id)}
                      idPrefix={`new-video-${video.id}`}
                      compact
                    />
                    {invalidDurationVideoIds.includes(video.id) && <div className="field-error">Agrega la duración del video.</div>}
                  </>
                )}

                {videoTypeGroup && <FilterChips
                  group={videoTypeGroup}
                  selected={video.videoTypeIds || []}
                  invalid={invalidTypeVideoIds.includes(video.id)}
                  onChange={(value) => {
                    patchVideo(index, { videoTypeIds: value });
                    if (value.length) setInvalidTypeVideoIds((current) => current.filter((id) => id !== video.id));
                  }}
                />}

                <div className="filter-group">
                  <div className="field-label">Estado del video</div>
                  <div className="chips compact">
                    <button type="button" className={`chip ${video.status === "usable" ? "selected" : ""}`} onClick={() => setVideoStatus(index, "usable")}>Usable</button>
                    <button type="button" className={`chip danger-chip ${video.status === "blacklisted" ? "selected" : ""}`} onClick={() => setVideoStatus(index, "blacklisted")}>No usar esta versión</button>
                  </div>
                </div>
                {video.status === "usable" && (
                  <div className="filter-group">
                    <div className="field-label">Video predeterminado</div>
                    <div className="chips compact">
                      <button type="button" className={`chip ${video.isPrimary ? "selected" : ""}`} onClick={() => setPrimaryVideo(video.id)}>{video.isPrimary ? "★ Principal" : "Hacer principal"}</button>
                    </div>
                  </div>
                )}
                {video.status === "blacklisted" && <textarea value={video.blacklistReason || ""} onChange={(e) => patchVideo(index, { blacklistReason: e.target.value })} placeholder="Motivo para no usar esta versión…" />}
              </div>
            ))}
          </div>

          <div className="inline-add">
            <input value={newVideoUrl} onChange={(e) => setNewVideoUrl(e.target.value)} placeholder="Agregar otra versión de YouTube" />
            <button type="button" className="secondary" onClick={() => void addVideo()} disabled={!newVideoUrl.trim() || addingVideo}>{addingVideo ? "Revisando…" : "+ Video"}</button>
          </div>
          {videoMessage && <div className="notice">{videoMessage}</div>}

          <div className="filter-group">
            <div className="field-label">Estado propuesto</div>
            <div className="chips">
              <button type="button" className={`chip ${proposedStatus === "approved" ? "selected" : ""}`} onClick={() => setProposedStatus("approved")}>Apta para usar</button>
              <button type="button" className={`chip danger-chip ${proposedStatus === "blacklisted" ? "selected" : ""}`} onClick={() => setProposedStatus("blacklisted")}>No apta / blacklist</button>
            </div>
          </div>

          {proposedStatus === "blacklisted" && (
            <div>
              <label className="field-label" htmlFor="blacklist-reason">Motivo</label>
              <textarea id="blacklist-reason" value={blacklistReason} onChange={(e) => { setBlacklistReason(e.target.value); if (e.target.value.trim()) setBlacklistReasonInvalid(false); }} className={blacklistReasonInvalid ? "input-invalid" : ""} placeholder="Por qué no debe usarse esta canción…" />
              {blacklistReasonInvalid && <div className="field-error">El motivo es obligatorio para una canción no apta.</div>}
            </div>
          )}

          <div>
            <label className="field-label" htmlFor="notes">Notas</label>
            <textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Observaciones útiles para futuras búsquedas o cultos…" />
          </div>

          <div>
            <label className="field-label" htmlFor="lyrics">Letra de la canción</label>
            <textarea id="lyrics" className="lyrics-input" value={lyrics} onChange={(e) => setLyrics(e.target.value)} placeholder="Pega aquí la letra. Luego podrás buscar palabras o frases aunque cambien mayúsculas o acentos…" />
          </div>

          <button className="primary wide" disabled={busy}>{busy ? "Guardando…" : "Guardar y enviar para aprobación"}</button>
        </form>
      )}

      {detailsSong && <SongDetailsModal song={detailsSong} config={config} onClose={() => setDetailsSong(null)} />}
    </div>
  );
}
