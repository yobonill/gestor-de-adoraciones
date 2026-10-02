import { type FormEvent, useMemo, useState } from "react";
import type { AppConfig, Song } from "@/types";
import { createSong } from "@/lib/database";
import { canonicalYouTubeUrl, extractYouTubeVideoId, youtubeThumbnail } from "@/lib/youtube";
import { FilterChips } from "./FilterChips";

type Metadata = {
  videoId: string;
  canonicalUrl: string;
  thumbnailUrl: string;
  duplicate: Song | null;
};

export function AddSongPanel({ config, songs, onSubmitted }: { config: AppConfig; songs: Song[]; onSubmitted: () => void }) {
  const [url, setUrl] = useState("");
  const [metadata, setMetadata] = useState<Metadata | null>(null);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [classifications, setClassifications] = useState<Record<string, string[]>>({});
  const [videoTypes, setVideoTypes] = useState<string[]>([]);
  const [proposedStatus, setProposedStatus] = useState<"approved" | "blacklisted">("approved");
  const [blacklistReason, setBlacklistReason] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const videoTypeGroup = useMemo(() => config.filterGroups.find((g) => g.id === "video-type"), [config]);
  const songGroups = useMemo(() => config.filterGroups.filter((g) => g.id !== "video-type"), [config]);

  function inspectLink() {
    setMessage("");
    const videoId = extractYouTubeVideoId(url);
    if (!videoId) {
      setMetadata(null);
      setMessage("Enlace de YouTube inválido.");
      return;
    }

    const duplicate = songs.find((song) => song.videos.some((video) => video.youtubeVideoId === videoId)) || null;
    const canonicalUrl = canonicalYouTubeUrl(videoId);
    setUrl(canonicalUrl);
    setMetadata({
      videoId,
      canonicalUrl,
      thumbnailUrl: youtubeThumbnail(videoId),
      duplicate
    });

    if (duplicate) {
      const reason = duplicate.blacklistReason ? ` Motivo: ${duplicate.blacklistReason}` : "";
      setMessage(`Este video ya está registrado como ${duplicate.status}. ${duplicate.title}.${reason}`);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!metadata) {
      setMessage("Primero revisa el enlace de YouTube.");
      return;
    }
    if (metadata.duplicate) {
      setMessage("No se puede enviar un video que ya existe en el sistema.");
      return;
    }
    if (proposedStatus === "blacklisted" && !blacklistReason.trim()) {
      setMessage("Indica por qué la canción no es apta.");
      return;
    }

    setBusy(true);
    setMessage("");
    const now = new Date().toISOString();
    try {
      await createSong({
        title: title.trim(),
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
      setMessage("Enviada. Quedó pendiente de aprobación.");
      window.setTimeout(onSubmitted, 700);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo enviar la canción.");
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
        <span className="muted">Todo envío queda pendiente hasta ser aprobado.</span>
      </div>

      <div className="url-row">
        <input value={url} onChange={(e) => { setUrl(e.target.value); setMetadata(null); }} placeholder="Pega un enlace de YouTube" />
        <button className="primary" type="button" onClick={inspectLink} disabled={!url.trim()}>Revisar</button>
      </div>

      {message && <div className={`notice ${metadata?.duplicate ? "warning" : ""}`}>{message}</div>}

      {metadata && !metadata.duplicate && (
        <form onSubmit={submit} className="form-stack">
          <div className="video-preview">
            <img src={metadata.thumbnailUrl} alt="Miniatura del video" width={240} height={135} />
            <div className="grow">
              <label className="field-label" htmlFor="song-title">Título de la canción</label>
              <input id="song-title" value={title} onChange={(e) => setTitle(e.target.value)} required placeholder="Escribe el nombre de la canción" />
              <a href={metadata.canonicalUrl} target="_blank" rel="noreferrer" className="text-link">Abrir video en YouTube ↗</a>
            </div>
          </div>

          {songGroups.map((group) => (
            <FilterChips
              key={group.id}
              group={group}
              selected={classifications[group.id] || []}
              onChange={(value) => setClassifications((current) => ({ ...current, [group.id]: value }))}
            />
          ))}

          {videoTypeGroup && <FilterChips group={videoTypeGroup} selected={videoTypes} onChange={setVideoTypes} />}

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
              <textarea id="blacklist-reason" value={blacklistReason} onChange={(e) => setBlacklistReason(e.target.value)} required placeholder="Por qué no debe usarse esta canción…" />
            </div>
          )}

          <div>
            <label className="field-label" htmlFor="notes">Notas</label>
            <textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Observaciones útiles para futuras búsquedas o cultos…" />
          </div>

          <button className="primary wide" disabled={busy || !title.trim()}>{busy ? "Enviando…" : "Enviar para aprobación"}</button>
        </form>
      )}
    </div>
  );
}
