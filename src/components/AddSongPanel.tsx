import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { AppConfig, Song } from "@/types";
import { createSong } from "@/lib/database";
import { canonicalYouTubeUrl, extractYouTubeVideoId, fetchYouTubeMetadata, youtubeThumbnail } from "@/lib/youtube";
import { canonicalArtistName, uniqueArtists } from "@/lib/artists";
import { ArtistAutocomplete } from "./ArtistAutocomplete";
import { FilterChips } from "./FilterChips";

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
  notes: string;
  classifications: Record<string, string[]>;
  videoTypes: string[];
  proposedStatus: "approved" | "blacklisted";
  blacklistReason: string;
};

type MessageKind = "info" | "warning" | "success";

const DRAFT_STORAGE_KEY = "gestor-de-adoraciones:add-song-draft:v1";

const EMPTY_DRAFT: Draft = {
  url: "",
  metadata: null,
  title: "",
  artist: "",
  notes: "",
  classifications: {},
  videoTypes: [],
  proposedStatus: "approved",
  blacklistReason: ""
};

function loadDraft(): Draft {
  try {
    const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return EMPTY_DRAFT;
    const stored = JSON.parse(raw) as Partial<Draft>;
    return {
      url: typeof stored.url === "string" ? stored.url : "",
      metadata: stored.metadata && typeof stored.metadata.videoId === "string" ? stored.metadata : null,
      title: typeof stored.title === "string" ? stored.title : "",
      artist: typeof stored.artist === "string" ? stored.artist : "",
      notes: typeof stored.notes === "string" ? stored.notes : "",
      classifications: stored.classifications && typeof stored.classifications === "object" ? stored.classifications : {},
      videoTypes: Array.isArray(stored.videoTypes) ? stored.videoTypes : [],
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
  const [notes, setNotes] = useState(initialDraft.notes);
  const [classifications, setClassifications] = useState<Record<string, string[]>>(initialDraft.classifications);
  const [videoTypes, setVideoTypes] = useState<string[]>(initialDraft.videoTypes);
  const [proposedStatus, setProposedStatus] = useState<"approved" | "blacklisted">(initialDraft.proposedStatus);
  const [blacklistReason, setBlacklistReason] = useState(initialDraft.blacklistReason);
  const [message, setMessage] = useState("");
  const [messageKind, setMessageKind] = useState<MessageKind>("info");
  const [toastMessage, setToastMessage] = useState("");
  const [toastKind, setToastKind] = useState<MessageKind>("info");
  const toastTimerRef = useRef<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [inspecting, setInspecting] = useState(false);
  const [invalidGroups, setInvalidGroups] = useState<string[]>([]);
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

  useEffect(() => {
    const draft: Draft = { url, metadata, title, artist, notes, classifications, videoTypes, proposedStatus, blacklistReason };
    localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
  }, [url, metadata, title, artist, notes, classifications, videoTypes, proposedStatus, blacklistReason]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    };
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

  function clearDraft(showFeedback = true) {
    setUrl("");
    setMetadata(null);
    setTitle("");
    setArtist("");
    setNotes("");
    setClassifications({});
    setVideoTypes([]);
    setProposedStatus("approved");
    setBlacklistReason("");
    setInvalidGroups([]);
    setTitleInvalid(false);
    setArtistInvalid(false);
    setBlacklistReasonInvalid(false);
    localStorage.removeItem(DRAFT_STORAGE_KEY);
    if (showFeedback) showMessage("Formulario limpiado.", "info");
  }

  async function inspectLink() {
    setMessage("");
    setInvalidGroups([]);
    const videoId = extractYouTubeVideoId(url);
    if (!videoId) {
      setMetadata(null);
      showMessage("Enlace de YouTube inválido.", "warning");
      return;
    }

    const canonicalUrl = canonicalYouTubeUrl(videoId);
    const nextMetadata: Metadata = {
      videoId,
      canonicalUrl,
      thumbnailUrl: youtubeThumbnail(videoId)
    };

    setUrl(canonicalUrl);
    setMetadata(nextMetadata);

    const existing = songs.find((song) => song.videos.some((video) => video.youtubeVideoId === videoId)) || null;
    if (existing) {
      const reason = existing.blacklistReason ? ` Motivo: ${existing.blacklistReason}` : "";
      if (existing.status === "rejected") {
        showMessage(`Este video fue rechazado anteriormente (${existing.title}). Puedes verlo o eliminarlo en Config > Rechazados. Al eliminarlo podrás registrarlo nuevamente.`, "warning");
      } else {
        const statusLabel = existing.status === "blacklisted" ? "blacklist" : existing.status === "approved" ? "aprobado" : existing.status;
        showMessage(`Este video ya está registrado como ${statusLabel}. ${existing.title}.${reason}`, "warning");
      }
      return;
    }

    setInspecting(true);
    try {
      const youtube = await fetchYouTubeMetadata(videoId);
      setTitle(youtube.title);
      setTitleInvalid(false);

      if (youtube.artist) {
        setArtist(canonicalArtistName(youtube.artist, artists));
        setArtistInvalid(false);
        showMessage("Título y artista/canal obtenidos de YouTube. Puedes modificarlos si es necesario.", "success");
      } else {
        showMessage("Se obtuvo el título, pero YouTube no devolvió el artista/canal. Escríbelo manualmente.", "warning");
      }
    } catch {
      showMessage("No se pudo obtener el nombre ni el artista de YouTube. Escríbelos manualmente.", "warning");
    } finally {
      setInspecting(false);
    }
  }

  function validate(): boolean {
    const missingGroups: string[] = [];

    for (const group of songGroups) {
      const hasActiveOptions = group.options.some((option) => option.active);
      if (hasActiveOptions && !(classifications[group.id] || []).length) missingGroups.push(group.id);
    }

    if (videoTypeGroup?.options.some((option) => option.active) && videoTypes.length === 0) {
      missingGroups.push(videoTypeGroup.id);
    }

    const missingTitle = !title.trim();
    const missingArtist = !artist.trim();
    const missingBlacklistReason = proposedStatus === "blacklisted" && !blacklistReason.trim();

    setInvalidGroups(missingGroups);
    setTitleInvalid(missingTitle);
    setArtistInvalid(missingArtist);
    setBlacklistReasonInvalid(missingBlacklistReason);

    const problems: string[] = [];
    if (missingTitle) problems.push("escribe el nombre de la canción");
    if (missingArtist) problems.push("escribe o selecciona el artista");
    if (missingGroups.length) {
      const labels = config.filterGroups.filter((group) => missingGroups.includes(group.id)).map((group) => group.label);
      problems.push(`selecciona al menos una opción en: ${labels.join(", ")}`);
    }
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
        notes: notes.trim(),
        status: "pending",
        proposedStatus,
        blacklistReason: proposedStatus === "blacklisted" ? blacklistReason.trim() : "",
        classifications,
        videos: [{
          id: crypto.randomUUID(),
          youtubeVideoId: metadata.videoId,
          youtubeUrl: metadata.canonicalUrl,
          title: title.trim(),
          thumbnailUrl: metadata.thumbnailUrl,
          videoTypeIds: videoTypes,
          status: "usable"
        }],
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
            setUrl(e.target.value);
            setMetadata(null);
            setTitle("");
            setArtist("");
            setTitleInvalid(false);
            setArtistInvalid(false);
            setMessage("");
          }}
          disabled={inspecting}
          placeholder="Pega un enlace de YouTube"
        />
        <button className="primary" type="button" onClick={inspectLink} disabled={!url.trim() || inspecting}>
          {inspecting ? "Buscando…" : "Revisar"}
        </button>
      </div>

      {message && <div className={`notice ${messageKind === "warning" ? "warning" : ""} ${messageKind === "success" ? "success" : ""}`}>{message}</div>}

      {toastMessage && (
        <div
          className={`app-toast ${toastKind}`}
          role={toastKind === "warning" ? "alert" : "status"}
          aria-live={toastKind === "warning" ? "assertive" : "polite"}
        >
          <div className="app-toast-icon" aria-hidden="true">
            {toastKind === "warning" ? "!" : toastKind === "success" ? "✓" : "i"}
          </div>
          <div className="app-toast-text">{toastMessage}</div>
          <button type="button" className="app-toast-close" onClick={dismissToast} aria-label="Cerrar mensaje">×</button>
        </div>
      )}

      {metadata && !duplicate && (
        <form onSubmit={submit} className="form-stack" noValidate>
          <div className="video-preview">
            <img src={metadata.thumbnailUrl} alt="Miniatura del video" width={240} height={135} />
            <div className="grow">
              <label className="field-label" htmlFor="song-title">Título de la canción</label>
              <input
                id="song-title"
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  if (e.target.value.trim()) setTitleInvalid(false);
                }}
                className={titleInvalid ? "input-invalid" : ""}
                placeholder="Escribe el nombre de la canción"
              />
              {titleInvalid && <div className="field-error">El nombre de la canción es obligatorio.</div>}

              <label className="field-label artist-label" htmlFor="song-artist">Artista</label>
              <ArtistAutocomplete
                id="song-artist"
                value={artist}
                artists={artists}
                invalid={artistInvalid}
                onChange={(value) => {
                  setArtist(value);
                  if (value.trim()) setArtistInvalid(false);
                }}
              />
              {artistInvalid && <div className="field-error">El artista es obligatorio.</div>}
              <a href={metadata.canonicalUrl} target="_blank" rel="noreferrer" className="text-link">Abrir video en YouTube ↗</a>
            </div>
          </div>

          {songGroups.map((group) => (
            <FilterChips
              key={group.id}
              group={group}
              selected={classifications[group.id] || []}
              invalid={invalidGroups.includes(group.id)}
              onChange={(value) => {
                setClassifications((current) => ({ ...current, [group.id]: value }));
                if (value.length) setInvalidGroups((current) => current.filter((id) => id !== group.id));
              }}
            />
          ))}

          {videoTypeGroup && (
            <FilterChips
              group={videoTypeGroup}
              selected={videoTypes}
              invalid={invalidGroups.includes(videoTypeGroup.id)}
              onChange={(value) => {
                setVideoTypes(value);
                if (value.length) setInvalidGroups((current) => current.filter((id) => id !== videoTypeGroup.id));
              }}
            />
          )}

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
              <textarea
                id="blacklist-reason"
                value={blacklistReason}
                onChange={(e) => {
                  setBlacklistReason(e.target.value);
                  if (e.target.value.trim()) setBlacklistReasonInvalid(false);
                }}
                className={blacklistReasonInvalid ? "input-invalid" : ""}
                placeholder="Por qué no debe usarse esta canción…"
              />
              {blacklistReasonInvalid && <div className="field-error">El motivo es obligatorio para una canción no apta.</div>}
            </div>
          )}

          <div>
            <label className="field-label" htmlFor="notes">Notas</label>
            <textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Observaciones útiles para futuras búsquedas o cultos…" />
          </div>

          <button className="primary wide" disabled={busy}>{busy ? "Guardando…" : "Guardar y enviar para aprobación"}</button>
        </form>
      )}
    </div>
  );
}
