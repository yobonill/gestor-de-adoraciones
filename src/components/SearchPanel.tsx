import { useMemo, useState } from "react";
import type { AppConfig, Song, SongVideo } from "@/types";
import { deleteSong, updateSong } from "@/lib/database";
import { requireAdminCode } from "@/lib/adminCode";
import { songMatchesFilters } from "@/lib/filters";
import { canonicalYouTubeUrl, extractYouTubeVideoId, youtubeThumbnail } from "@/lib/youtube";
import { FilterChips } from "./FilterChips";

function cloneSong(song: Song): Song {
  return JSON.parse(JSON.stringify(song)) as Song;
}

export function SearchPanel({ config, songs }: { config: AppConfig; songs: Song[] }) {
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<Record<string, string[]>>({});
  const [editing, setEditing] = useState<Song | null>(null);
  const [showBlacklisted, setShowBlacklisted] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const results = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("es");
    return songs.filter((song) => {
      if (!["approved", "blacklisted"].includes(song.status)) return false;
      if (song.status === "blacklisted" && !showBlacklisted) return false;
      const textMatch = !q || song.title.toLocaleLowerCase("es").includes(q) || song.videos.some((video) => video.youtubeUrl.toLocaleLowerCase("es").includes(q));
      return textMatch && songMatchesFilters(song, filters);
    });
  }, [songs, query, filters, showBlacklisted]);

  function optionLabel(groupId: string, optionId: string) {
    return config.filterGroups.find((g) => g.id === groupId)?.options.find((o) => o.id === optionId)?.label || optionId;
  }

  async function saveEdit() {
    if (!editing) return;
    setBusy(true);
    setMessage("");
    try {
      await requireAdminCode();
      await updateSong({ ...editing, updatedAt: new Date().toISOString() });
      setEditing(null);
      setMessage("Canción actualizada.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo actualizar.");
    } finally {
      setBusy(false);
    }
  }

  async function removeSong(song: Song) {
    if (!window.confirm(`¿Eliminar definitivamente “${song.title}”?`)) return;
    setBusy(true);
    setMessage("");
    try {
      await requireAdminCode();
      await deleteSong(song.id);
      setMessage("Canción eliminada.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo eliminar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel-stack">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Catálogo</span>
          <h2>Buscar canciones</h2>
        </div>
        <span className="muted">Combina varios filtros para reducir la lista.</span>
      </div>

      <input className="search-input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar por nombre o enlace…" />

      <div className="filters-card">
        {config.filterGroups.map((group) => (
          <FilterChips key={group.id} group={group} selected={filters[group.id] || []} onChange={(value) => setFilters((current) => ({ ...current, [group.id]: value }))} forceMultiSelect />
        ))}
        <label className="toggle-label" style={{ marginTop: 10 }}>
          <input type="checkbox" checked={showBlacklisted} onChange={(e) => setShowBlacklisted(e.target.checked)} />
          Mostrar canciones en blacklist
        </label>
        {(Object.values(filters) as string[][]).some((items) => items.length > 0) && <button className="ghost" type="button" onClick={() => setFilters({})}>Limpiar filtros</button>}
      </div>

      {message && <div className="notice">{message}</div>}
      <div className="result-count">{results.length} resultado{results.length === 1 ? "" : "s"}</div>

      <div className="song-grid">
        {results.map((song) => (
          <article className="song-card" key={song.id}>
            {song.videos[0]?.thumbnailUrl && <img className="song-thumb" src={song.videos[0].thumbnailUrl} alt="" width={320} height={180} />}
            <div className="song-card-body">
              <div className="pending-title-row"><h3>{song.title}</h3>{song.status === "blacklisted" && <span className="status-badge danger">Blacklist</span>}</div>
              {song.status === "blacklisted" && song.blacklistReason && <p className="card-note"><strong>Motivo:</strong> {song.blacklistReason}</p>}
              <div className="tag-row">
                {(Object.entries(song.classifications) as [string, string[]][]).flatMap(([groupId, ids]) => ids.map((id) => <span className="tag" key={`${groupId}-${id}`}>{optionLabel(groupId, id)}</span>))}
              </div>
              {song.notes && <p className="card-note">{song.notes}</p>}
              <div className="video-links">
                {song.videos.filter((video) => video.status === "usable").map((video) => (
                  <a key={video.id} href={video.youtubeUrl} target="_blank" rel="noreferrer" className="secondary-button">▶ {video.videoTypeIds[0] ? optionLabel("video-type", video.videoTypeIds[0]) : "YouTube"}</a>
                ))}
              </div>
              <div className="card-actions">
                <button type="button" className="ghost" onClick={() => setEditing(cloneSong(song))}>Editar</button>
                <button type="button" className="ghost danger-text" onClick={() => void removeSong(song)} disabled={busy}>Eliminar</button>
              </div>
            </div>
          </article>
        ))}
      </div>

      {editing && <EditSongModal song={editing} allSongs={songs} config={config} onChange={setEditing} onClose={() => setEditing(null)} onSave={() => void saveEdit()} busy={busy} />}
    </div>
  );
}

function EditSongModal({ song, allSongs, config, onChange, onClose, onSave, busy }: {
  song: Song;
  allSongs: Song[];
  config: AppConfig;
  onChange: (song: Song) => void;
  onClose: () => void;
  onSave: () => void;
  busy: boolean;
}) {
  const [newVideoUrl, setNewVideoUrl] = useState("");
  const [videoMessage, setVideoMessage] = useState("");
  const videoTypeGroup = config.filterGroups.find((g) => g.id === "video-type");

  function patch(patchValue: Partial<Song>) {
    onChange({ ...song, ...patchValue });
  }

  function patchVideo(index: number, value: Partial<SongVideo>) {
    patch({ videos: song.videos.map((video, i) => i === index ? { ...video, ...value } : video) });
  }

  function addVideo() {
    setVideoMessage("");
    const videoId = extractYouTubeVideoId(newVideoUrl);
    if (!videoId) {
      setVideoMessage("Enlace de YouTube inválido.");
      return;
    }
    const duplicate = allSongs.find((item) => item.id !== song.id && item.videos.some((video) => video.youtubeVideoId === videoId));
    if (duplicate) {
      setVideoMessage(`Ese video ya pertenece a “${duplicate.title}”.`);
      return;
    }
    if (song.videos.some((video) => video.youtubeVideoId === videoId)) {
      setVideoMessage("Ese video ya está agregado a esta canción.");
      return;
    }
    patch({
      videos: [...song.videos, {
        id: crypto.randomUUID(),
        youtubeVideoId: videoId,
        youtubeUrl: canonicalYouTubeUrl(videoId),
        title: song.title,
        thumbnailUrl: youtubeThumbnail(videoId),
        videoTypeIds: [],
        status: "usable"
      }]
    });
    setNewVideoUrl("");
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Editar canción</h2>
          <button type="button" className="icon-button" onClick={onClose}>×</button>
        </div>

        <label className="field-label">Título</label>
        <input value={song.title} onChange={(e) => patch({ title: e.target.value })} />

        {config.filterGroups.filter((group) => group.id !== "video-type").map((group) => (
          <FilterChips key={group.id} group={group} selected={song.classifications[group.id] || []} onChange={(value) => patch({ classifications: { ...song.classifications, [group.id]: value } })} />
        ))}

        <div className="filter-group">
          <div className="field-label">Estado</div>
          <div className="chips">
            <button type="button" className={`chip ${song.status === "approved" ? "selected" : ""}`} onClick={() => patch({ status: "approved" })}>Apta</button>
            <button type="button" className={`chip danger-chip ${song.status === "blacklisted" ? "selected" : ""}`} onClick={() => patch({ status: "blacklisted" })}>No apta / blacklist</button>
          </div>
        </div>

        {song.status === "blacklisted" && <><label className="field-label">Motivo del blacklist</label><textarea value={song.blacklistReason || ""} onChange={(e) => patch({ blacklistReason: e.target.value })} /></>}

        <label className="field-label">Notas</label>
        <textarea value={song.notes} onChange={(e) => patch({ notes: e.target.value })} />

        <div className="divider" />
        <h3>Versiones / videos</h3>
        <div className="video-edit-list">
          {song.videos.map((video, index) => (
            <div className="video-edit" key={video.id}>
              <div className="video-edit-row">
                <input value={video.youtubeUrl} onChange={(e) => {
                  const youtubeVideoId = extractYouTubeVideoId(e.target.value) || video.youtubeVideoId;
                  patchVideo(index, { youtubeUrl: e.target.value, youtubeVideoId, thumbnailUrl: youtubeThumbnail(youtubeVideoId) });
                }} />
                <button type="button" className="icon-button danger-text" title="Quitar video" onClick={() => patch({ videos: song.videos.filter((_, i) => i !== index) })}>×</button>
              </div>
              {videoTypeGroup && <FilterChips group={videoTypeGroup} selected={video.videoTypeIds || []} onChange={(value) => patchVideo(index, { videoTypeIds: value })} />}
              <div className="filter-group">
                <div className="field-label">Estado del video</div>
                <div className="chips compact">
                  <button type="button" className={`chip ${video.status === "usable" ? "selected" : ""}`} onClick={() => patchVideo(index, { status: "usable" })}>Usable</button>
                  <button type="button" className={`chip danger-chip ${video.status === "blacklisted" ? "selected" : ""}`} onClick={() => patchVideo(index, { status: "blacklisted" })}>No usar esta versión</button>
                </div>
              </div>
              {video.status === "blacklisted" && <textarea value={video.blacklistReason || ""} onChange={(e) => patchVideo(index, { blacklistReason: e.target.value })} placeholder="Motivo…" />}
            </div>
          ))}
        </div>

        <div className="inline-add">
          <input value={newVideoUrl} onChange={(e) => setNewVideoUrl(e.target.value)} placeholder="Agregar otra versión de YouTube" />
          <button type="button" className="secondary" onClick={addVideo} disabled={!newVideoUrl.trim()}>+ Video</button>
        </div>
        {videoMessage && <div className="notice warning">{videoMessage}</div>}

        <div className="modal-actions">
          <button className="secondary" type="button" onClick={onClose}>Cancelar</button>
          <button className="primary" type="button" onClick={onSave} disabled={busy || !song.title.trim() || song.videos.length === 0}>{busy ? "Guardando…" : "Guardar"}</button>
        </div>
      </div>
    </div>
  );
}
