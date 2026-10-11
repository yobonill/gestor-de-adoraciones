import { type FormEvent, useEffect, useMemo, useState } from "react";
import type { AppBackup, AppConfig, FilterGroup, Song, SongVideo } from "@/types";
import { deleteSong, getAllServices, reviewSong, saveConfig, updateSong } from "@/lib/database";
import { clearAdminCode, getAdminCode, setAdminCode, verifyAdminCode } from "@/lib/adminCode";
import { uniqueArtists } from "@/lib/artists";
import { extractYouTubeVideoId, fetchYouTubeDuration, youtubeThumbnail } from "@/lib/youtube";
import { formatDuration } from "@/lib/duration";
import { ArtistAutocomplete } from "./ArtistAutocomplete";
import { FilterChips } from "./FilterChips";
import { DurationInput } from "./DurationInput";
import { ensurePrimaryVideo, getPrimaryUsableVideo, markPrimaryVideo, updateVideoStatus } from "@/lib/videos";

function cloneConfig(config: AppConfig): AppConfig {
  return JSON.parse(JSON.stringify(config)) as AppConfig;
}

function cloneSong(song: Song): Song {
  return JSON.parse(JSON.stringify(song)) as Song;
}

function moveItem<T>(items: T[], index: number, direction: -1 | 1): T[] {
  const target = index + direction;
  if (target < 0 || target >= items.length) return items;
  const next = [...items];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function ConfigPanel({ config, songs }: { config: AppConfig; songs: Song[] }) {
  const [code, setCode] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [draft, setDraft] = useState<AppConfig>(() => cloneConfig(config));
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [editingPending, setEditingPending] = useState<Song | null>(null);
  const [rejectingSong, setRejectingSong] = useState<Song | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [editingBlockedVideo, setEditingBlockedVideo] = useState<{ song: Song; videoId: string } | null>(null);

  const pending = useMemo(() => songs.filter((song) => song.status === "pending"), [songs]);
  const rejected = useMemo(() => songs.filter((song) => song.status === "rejected"), [songs]);
  const blockedVideos = useMemo(() => songs.flatMap((song) => song.videos.filter((video) => video.status === "blacklisted").map((video) => ({ song, video }))), [songs]);

  function optionLabel(groupId: string, optionId: string) {
    return config.filterGroups.find((group) => group.id === groupId)?.options.find((option) => option.id === optionId)?.label || optionId;
  }

  useEffect(() => setDraft(cloneConfig(config)), [config]);

  useEffect(() => {
    const cached = getAdminCode();
    if (cached && verifyAdminCode(cached)) {
      setCode(cached);
      setUnlocked(true);
    }
  }, []);

  function verify(value = code, showMessage = true) {
    const valid = verifyAdminCode(value);
    if (!valid) {
      setUnlocked(false);
      if (showMessage) setMessage("Código incorrecto.");
      return false;
    }
    setAdminCode(value);
    setUnlocked(true);
    if (showMessage) setMessage("Panel administrativo desbloqueado.");
    return true;
  }

  async function review(song: Song, action: "approve" | "reject", reason = "") {
    if (!verifyAdminCode(code)) {
      setUnlocked(false);
      setMessage("Código incorrecto.");
      return;
    }
    if (action === "reject" && !reason.trim()) {
      setMessage("Escribe el motivo del rechazo.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      await reviewSong(song, action, reason);
      setMessage(action === "approve" ? "Envío aprobado." : "Envío rechazado con su motivo registrado.");
      if (action === "reject") {
        setRejectingSong(null);
        setRejectReason("");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo procesar.");
    } finally {
      setBusy(false);
    }
  }

  async function savePendingEdit(song: Song, approveAfter: boolean) {
    if (!verifyAdminCode(code)) {
      setUnlocked(false);
      setMessage("Código incorrecto.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const updatedSong = { ...song, status: "pending" as const, updatedAt: new Date().toISOString() };
      await updateSong(updatedSong);
      if (approveAfter) {
        await reviewSong(updatedSong, "approve");
        setMessage(updatedSong.proposedStatus === "blacklisted" ? "Cambios guardados y canción enviada al blacklist." : "Cambios guardados y canción aprobada.");
      } else {
        setMessage("Cambios guardados. La canción sigue pendiente de aprobación.");
      }
      setEditingPending(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudieron guardar los cambios.");
    } finally {
      setBusy(false);
    }
  }

  async function removeRejected(song: Song) {
    if (!verifyAdminCode(code)) {
      setUnlocked(false);
      setMessage("Código incorrecto.");
      return;
    }
    if (!window.confirm(`¿Eliminar definitivamente “${song.title}”? Después podrá volver a registrarse usando el mismo enlace.`)) return;
    setBusy(true);
    setMessage("");
    try {
      await deleteSong(song.id);
      setMessage("Canción rechazada eliminada. El enlace ya puede registrarse nuevamente.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo eliminar.");
    } finally {
      setBusy(false);
    }
  }

  async function saveBlockedVideoEdit(song: Song, videoId: string, updatedVideo: SongVideo) {
    if (!verifyAdminCode(code)) {
      setUnlocked(false);
      setMessage("Código incorrecto.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const updatedSong: Song = {
        ...song,
        videos: song.videos.map((video) => video.id === videoId ? updatedVideo : video),
        updatedAt: new Date().toISOString()
      };
      await updateSong(updatedSong);
      setEditingBlockedVideo(null);
      setMessage(updatedVideo.status === "blacklisted" ? "Video actualizado." : "Video marcado como usable y removido de la lista No usar.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo actualizar el video.");
    } finally {
      setBusy(false);
    }
  }

  async function persistConfig() {
    if (!verifyAdminCode(code)) {
      setUnlocked(false);
      setMessage("Código incorrecto.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      await saveConfig(draft);
      setMessage("Configuración guardada.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo guardar.");
    } finally {
      setBusy(false);
    }
  }

  async function exportBackup() {
    setBusy(true);
    setMessage("");
    try {
      const servicePlans = await getAllServices();
      const backup: AppBackup = {
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        config,
        songs,
        servicePlans
      };
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `gestor-de-adoraciones-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setMessage(`Backup exportado: ${songs.length} canciones y ${servicePlans.length} cultos.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo exportar el backup.");
    } finally {
      setBusy(false);
    }
  }

  function patchGroup(index: number, patch: Partial<FilterGroup>) {
    setDraft((current) => ({ ...current, filterGroups: current.filterGroups.map((group, i) => i === index ? { ...group, ...patch } : group) }));
  }

  function addOption(groupIndex: number) {
    const label = window.prompt("Nombre de la nueva opción:")?.trim();
    if (!label) return;
    const option = { id: crypto.randomUUID(), label, active: true };
    patchGroup(groupIndex, { options: [...draft.filterGroups[groupIndex].options, option] });
  }

  function addGroup() {
    const label = window.prompt("Nombre del nuevo grupo de filtros:")?.trim();
    if (!label) return;
    setDraft((current) => ({ ...current, filterGroups: [...current.filterGroups, { id: crypto.randomUUID(), label, multiSelect: true, options: [] }] }));
  }

  function submitCode(event: FormEvent) {
    event.preventDefault();
    verify();
  }

  if (!unlocked) {
    return (
      <div className="admin-lock">
        <span className="eyebrow">Administración</span>
        <h2>Configuración y aprobaciones</h2>
        <p>Introduce el código fijo de aprobación. No hay cuentas ni inicio de sesión.</p>
        <form onSubmit={submitCode} className="code-form">
          <input type="password" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Código de aprobación" autoComplete="off" />
          <button className="primary" disabled={!code.trim()}>Entrar</button>
        </form>
        {message && <div className="notice warning">{message}</div>}
      </div>
    );
  }

  return (
    <div className="panel-stack">
      <div className="section-heading">
        <div><span className="eyebrow">Administración</span><h2>Aprobaciones y configuración</h2></div>
        <button className="ghost" type="button" onClick={() => { setUnlocked(false); setCode(""); clearAdminCode(); }}>Bloquear</button>
      </div>

      {message && <div className="notice">{message}</div>}

      <section className="admin-section">
        <div className="subheading-row">
          <div><h3>Pendientes de aprobación</h3><p className="muted">Nada entra al catálogo aprobado sin pasar por aquí.</p></div>
          <span className="count-badge">{pending.length}</span>
        </div>

        {pending.length === 0 ? <div className="empty-state">No hay envíos pendientes.</div> : (
          <div className="pending-list">
            {pending.map((song) => (
              <article className="pending-card" key={song.id}>
                <div className="grow">
                  <div className="pending-title-row">
                    <h4>{song.title}</h4>
                    <span className={`status-badge ${song.proposedStatus === "blacklisted" ? "danger" : ""}`}>{song.proposedStatus === "blacklisted" ? "Propuesto: blacklist" : "Propuesto: apta"}</span>
                  </div>
                  <div className="song-artist">{song.artist || "Artista sin registrar"}</div>
                  <div className="tag-row">
                    {(Object.entries(song.classifications) as [string, string[]][]).flatMap(([groupId, ids]) => ids.map((id) => <span className="tag" key={`${groupId}-${id}`}>{optionLabel(groupId, id)}</span>))}
                    {song.videos.flatMap((video) => video.videoTypeIds.map((id) => <span className="tag" key={`${video.id}-${id}`}>{optionLabel("video-type", id)}</span>))}
                  </div>
                  {(() => { const primary = getPrimaryUsableVideo(song.videos) || song.videos[0]; return primary ? <a className="text-link" href={primary.youtubeUrl} target="_blank" rel="noreferrer">Abrir YouTube ↗</a> : null; })()}
                  {song.blacklistReason && <p><strong>Motivo:</strong> {song.blacklistReason}</p>}
                  {song.notes && <p className="card-note">{song.notes}</p>}
                </div>
                <div className="pending-actions">
                  <button className="secondary" type="button" disabled={busy} onClick={() => setEditingPending(cloneSong(song))}>Revisar / Editar</button>
                  <button className="primary" type="button" disabled={busy} onClick={() => void review(song, "approve")}>Aprobar</button>
                  <button className="ghost danger-text" type="button" disabled={busy} onClick={() => { setRejectingSong(song); setRejectReason(song.rejectionReason || ""); }}>Rechazar</button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="admin-section">
        <div className="subheading-row">
          <div><h3>Rechazados</h3><p className="muted">El motivo queda visible para saber por qué se rechazó y decidir si debe eliminarse.</p></div>
          <span className="count-badge">{rejected.length}</span>
        </div>

        {rejected.length === 0 ? <div className="empty-state">No hay canciones rechazadas.</div> : (
          <div className="pending-list">
            {rejected.map((song) => (
              <article className="pending-card" key={song.id}>
                <div className="grow">
                  <div className="pending-title-row"><h4>{song.title}</h4><span className="status-badge danger">Rechazada</span></div>
                  <div className="song-artist">{song.artist || "Artista sin registrar"}</div>
                  <p className="rejection-reason"><strong>Motivo del rechazo:</strong> {song.rejectionReason?.trim() || "Sin motivo registrado."}</p>
                  {song.notes && <p className="card-note">{song.notes}</p>}
                </div>
                <div className="pending-actions">
                  {song.videos.map((video, index) => <a key={video.id} className="secondary-button" href={video.youtubeUrl} target="_blank" rel="noreferrer">{song.videos.length > 1 ? `▶ Ver video ${index + 1}` : "▶ Ver video"}</a>)}
                  <button className="ghost danger-text" type="button" disabled={busy} onClick={() => void removeRejected(song)}>Eliminar definitivamente</button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="admin-section">
        <div className="subheading-row">
          <div><h3>Videos marcados como “No usar”</h3><p className="muted">Versiones individuales que se conservaron en una canción, pero fueron marcadas para no utilizarse.</p></div>
          <span className="count-badge">{blockedVideos.length}</span>
        </div>

        {blockedVideos.length === 0 ? <div className="empty-state">No hay videos marcados como “No usar”.</div> : (
          <div className="blocked-video-list">
            {blockedVideos.map(({ song, video }) => (
              <article className="blocked-video-card" key={`${song.id}-${video.id}`}>
                {video.thumbnailUrl && <img src={video.thumbnailUrl} alt={`Miniatura de ${song.title}`} />}
                <div className="blocked-video-info">
                  <div className="pending-title-row"><h4>{song.title}</h4><span className="status-badge danger">No usar</span></div>
                  <div className="song-artist">{song.artist || "Artista sin registrar"}</div>
                  <div className="tag-row">
                    {(video.videoTypeIds || []).map((id) => <span className="tag" key={id}>{optionLabel("video-type", id)}</span>)}
                    <span className="tag">{formatDuration(video.durationSeconds)}</span>
                  </div>
                  <p className="rejection-reason"><strong>Motivo:</strong> {video.blacklistReason?.trim() || "Sin motivo registrado."}</p>
                </div>
                <div className="pending-actions">
                  <a className="secondary-button" href={video.youtubeUrl} target="_blank" rel="noreferrer">▶ Ver video</a>
                  <button className="secondary" type="button" disabled={busy} onClick={() => setEditingBlockedVideo({ song: cloneSong(song), videoId: video.id })}>Editar</button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="admin-section">
        <div className="subheading-row">
          <div><h3>Backup de datos</h3><p className="muted">Exporta canciones, filtros, pendientes/rechazados y todos los cultos guardados a un archivo JSON.</p></div>
          <button className="secondary" type="button" disabled={busy} onClick={() => void exportBackup()}>{busy ? "Preparando…" : "Exportar backup"}</button>
        </div>
      </section>

      <section className="admin-section">
        <div className="subheading-row">
          <div><h3>Filtros</h3><p className="muted">El orden guardado aquí será el mismo que aparece al agregar, buscar y preparar un culto.</p></div>
          <button className="secondary" type="button" onClick={addGroup}>+ Grupo</button>
        </div>

        <div className="config-groups">
          {draft.filterGroups.map((group, groupIndex) => (
            <div className="config-group" key={group.id}>
              <div className="config-group-head">
                <div className="reorder-buttons" aria-label={`Reordenar ${group.label}`}>
                  <button className="icon-button" type="button" disabled={groupIndex === 0} onClick={() => setDraft((current) => ({ ...current, filterGroups: moveItem(current.filterGroups, groupIndex, -1) }))} title="Subir grupo">↑</button>
                  <button className="icon-button" type="button" disabled={groupIndex === draft.filterGroups.length - 1} onClick={() => setDraft((current) => ({ ...current, filterGroups: moveItem(current.filterGroups, groupIndex, 1) }))} title="Bajar grupo">↓</button>
                </div>
                <input value={group.label} onChange={(e) => patchGroup(groupIndex, { label: e.target.value })} />
                <label className="toggle-label"><input type="checkbox" checked={group.multiSelect} onChange={(e) => patchGroup(groupIndex, { multiSelect: e.target.checked })} />Multi-selección</label>
                {group.id !== "video-type" && <button className="icon-button danger-text" type="button" title="Eliminar grupo" onClick={() => setDraft((current) => ({ ...current, filterGroups: current.filterGroups.filter((_, i) => i !== groupIndex) }))}>×</button>}
              </div>

              <div className="config-options">
                {group.options.map((option, optionIndex) => (
                  <div className="config-option" key={option.id}>
                    <div className="reorder-buttons">
                      <button className="icon-button" type="button" disabled={optionIndex === 0} onClick={() => patchGroup(groupIndex, { options: moveItem(group.options, optionIndex, -1) })} title="Subir opción">↑</button>
                      <button className="icon-button" type="button" disabled={optionIndex === group.options.length - 1} onClick={() => patchGroup(groupIndex, { options: moveItem(group.options, optionIndex, 1) })} title="Bajar opción">↓</button>
                    </div>
                    <input value={option.label} onChange={(e) => patchGroup(groupIndex, { options: group.options.map((item, i) => i === optionIndex ? { ...item, label: e.target.value } : item) })} />
                    <label className="toggle-label small"><input type="checkbox" checked={option.active} onChange={(e) => patchGroup(groupIndex, { options: group.options.map((item, i) => i === optionIndex ? { ...item, active: e.target.checked } : item) })} />Activa</label>
                    <button className="icon-button danger-text" type="button" title="Eliminar opción" onClick={() => patchGroup(groupIndex, { options: group.options.filter((_, i) => i !== optionIndex) })}>×</button>
                  </div>
                ))}
                <button className="ghost" type="button" onClick={() => addOption(groupIndex)}>+ Añadir opción</button>
              </div>
            </div>
          ))}
        </div>

        <button className="primary wide" type="button" onClick={() => void persistConfig()} disabled={busy}>{busy ? "Guardando…" : "Guardar configuración"}</button>
      </section>

      {editingPending && <PendingReviewModal song={editingPending} allSongs={songs} config={config} busy={busy} onChange={setEditingPending} onClose={() => setEditingPending(null)} onSave={(approveAfter) => void savePendingEdit(editingPending, approveAfter)} />}

      {editingBlockedVideo && (
        <BlockedVideoEditModal
          song={editingBlockedVideo.song}
          videoId={editingBlockedVideo.videoId}
          config={config}
          busy={busy}
          onClose={() => setEditingBlockedVideo(null)}
          onSave={(updatedVideo) => void saveBlockedVideoEdit(editingBlockedVideo.song, editingBlockedVideo.videoId, updatedVideo)}
        />
      )}

      {rejectingSong && (
        <div className="modal-backdrop" onMouseDown={() => setRejectingSong(null)}>
          <div className="modal small-modal" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-header"><div><span className="eyebrow">Rechazar</span><h2>{rejectingSong.title}</h2></div><button className="icon-button" type="button" onClick={() => setRejectingSong(null)}>×</button></div>
            <label className="field-label" htmlFor="reject-reason">Motivo del rechazo</label>
            <textarea id="reject-reason" value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} placeholder="Explica por qué se rechaza este video/canción…" autoFocus />
            <div className="modal-actions">
              <button className="secondary" type="button" onClick={() => setRejectingSong(null)}>Cancelar</button>
              <button className="primary danger-button" type="button" disabled={busy || !rejectReason.trim()} onClick={() => void review(rejectingSong, "reject", rejectReason)}>{busy ? "Rechazando…" : "Confirmar rechazo"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function BlockedVideoEditModal({ song, videoId, config, busy, onClose, onSave }: {
  song: Song;
  videoId: string;
  config: AppConfig;
  busy: boolean;
  onClose: () => void;
  onSave: (video: SongVideo) => void;
}) {
  const originalVideo = song.videos.find((video) => video.id === videoId);
  const [video, setVideo] = useState<SongVideo>(() => originalVideo ? { ...originalVideo, videoTypeIds: [...(originalVideo.videoTypeIds || [])] } : {
    id: videoId, youtubeVideoId: "", youtubeUrl: "", title: song.title, thumbnailUrl: "", videoTypeIds: [], status: "blacklisted"
  });
  const [durationLoading, setDurationLoading] = useState(false);
  const [durationMessage, setDurationMessage] = useState("");
  const [attempted, setAttempted] = useState(false);
  const videoTypeGroup = config.filterGroups.find((group) => group.id === "video-type");

  function patch(value: Partial<SongVideo>) {
    setVideo((current) => ({ ...current, ...value }));
  }

  function changeUrl(value: string) {
    const youtubeVideoId = extractYouTubeVideoId(value);
    patch({
      youtubeUrl: value,
      ...(youtubeVideoId ? { youtubeVideoId, thumbnailUrl: youtubeThumbnail(youtubeVideoId) } : {})
    });
  }

  async function refreshDuration() {
    const youtubeVideoId = extractYouTubeVideoId(video.youtubeUrl);
    if (!youtubeVideoId) {
      setDurationMessage("No se puede obtener la duración porque el enlace de YouTube no es válido.");
      return;
    }
    setDurationLoading(true);
    setDurationMessage("");
    const duration = await fetchYouTubeDuration(youtubeVideoId);
    setDurationLoading(false);
    if (!duration) {
      setDurationMessage("No se pudo obtener la duración desde YouTube. Puedes introducirla manualmente.");
      return;
    }
    patch({ durationSeconds: duration });
    setDurationMessage(`Duración actualizada desde YouTube: ${formatDuration(duration)}.`);
  }

  function save() {
    setAttempted(true);
    const invalidUrl = !extractYouTubeVideoId(video.youtubeUrl);
    const missingDuration = !video.durationSeconds || video.durationSeconds <= 0;
    const missingType = !!videoTypeGroup?.options.some((option) => option.active) && !(video.videoTypeIds || []).length;
    const missingReason = video.status === "blacklisted" && !video.blacklistReason?.trim();
    if (invalidUrl || missingDuration || missingType || missingReason) return;
    onSave({ ...video, blacklistReason: video.status === "blacklisted" ? video.blacklistReason?.trim() : undefined });
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div><span className="eyebrow">Video marcado como No usar</span><h2>{song.title}</h2><div className="song-artist">{song.artist || "Artista sin registrar"}</div></div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Cerrar">×</button>
        </div>

        {video.thumbnailUrl && <div className="video-preview"><img src={video.thumbnailUrl} alt="Miniatura del video" width={240} height={135} /><div className="grow"><strong>{video.title || song.title}</strong><a className="text-link" href={video.youtubeUrl} target="_blank" rel="noreferrer">Abrir video en YouTube ↗</a></div></div>}

        <label className="field-label" htmlFor="blocked-video-title">Título / referencia del video</label>
        <input id="blocked-video-title" value={video.title || ""} onChange={(event) => patch({ title: event.target.value })} />

        <label className="field-label" htmlFor="blocked-video-url">Enlace de YouTube</label>
        <input id="blocked-video-url" className={attempted && !extractYouTubeVideoId(video.youtubeUrl) ? "input-invalid" : ""} value={video.youtubeUrl} onChange={(event) => changeUrl(event.target.value)} />
        {attempted && !extractYouTubeVideoId(video.youtubeUrl) && <div className="field-error">El enlace de YouTube no es válido.</div>}

        <div className="subheading-row compact-heading">
          <label className="field-label">Duración</label>
          <button type="button" className="ghost compact-button" disabled={durationLoading} onClick={() => void refreshDuration()}>{durationLoading ? "Consultando…" : "↻ Obtener de YouTube"}</button>
        </div>
        <DurationInput value={video.durationSeconds} onChange={(value) => patch({ durationSeconds: value })} invalid={attempted && (!video.durationSeconds || video.durationSeconds <= 0)} idPrefix={`blocked-duration-${video.id}`} />
        {durationMessage && <div className="notice">{durationMessage}</div>}
        {attempted && (!video.durationSeconds || video.durationSeconds <= 0) && <div className="field-error">Agrega la duración del video.</div>}

        {videoTypeGroup && <FilterChips group={videoTypeGroup} selected={video.videoTypeIds || []} invalid={attempted && videoTypeGroup.options.some((option) => option.active) && !(video.videoTypeIds || []).length} onChange={(value) => patch({ videoTypeIds: value })} />}

        <div className="filter-group">
          <div className="field-label">Estado del video</div>
          <div className="chips">
            <button type="button" className={`chip ${video.status === "usable" ? "selected" : ""}`} onClick={() => patch({ status: "usable", blacklistReason: undefined })}>Usable</button>
            <button type="button" className={`chip danger-chip ${video.status === "blacklisted" ? "selected" : ""}`} onClick={() => patch({ status: "blacklisted" })}>No usar esta versión</button>
          </div>
        </div>

        {video.status === "blacklisted" && (
          <>
            <label className="field-label" htmlFor="blocked-video-reason">Motivo para no usar</label>
            <textarea id="blocked-video-reason" className={attempted && !video.blacklistReason?.trim() ? "input-invalid" : ""} value={video.blacklistReason || ""} onChange={(event) => patch({ blacklistReason: event.target.value })} placeholder="Explica por qué esta versión no debe usarse…" />
            {attempted && !video.blacklistReason?.trim() && <div className="field-error">Indica el motivo para mantener este video como “No usar”.</div>}
          </>
        )}

        <div className="modal-actions">
          <button className="secondary" type="button" disabled={busy} onClick={onClose}>Cancelar</button>
          <button className="primary" type="button" disabled={busy} onClick={save}>{busy ? "Guardando…" : "Guardar cambios"}</button>
        </div>
      </div>
    </div>
  );
}

function PendingReviewModal({ song, allSongs, config, busy, onChange, onClose, onSave }: {
  song: Song;
  allSongs: Song[];
  config: AppConfig;
  busy: boolean;
  onChange: (song: Song) => void;
  onClose: () => void;
  onSave: (approveAfter: boolean) => void;
}) {
  const [attempted, setAttempted] = useState(false);
  const [durationLookupId, setDurationLookupId] = useState<string | null>(null);
  const [videoMessage, setVideoMessage] = useState("");
  const videoTypeGroup = config.filterGroups.find((group) => group.id === "video-type");
  const songGroups = config.filterGroups.filter((group) => group.id !== "video-type");
  const artists = useMemo(() => uniqueArtists(allSongs.map((item) => item.artist)), [allSongs]);

  function patch(patchValue: Partial<Song>) { onChange({ ...song, ...patchValue }); }
  function patchVideo(index: number, value: Partial<SongVideo>) { patch({ videos: ensurePrimaryVideo(song.videos.map((video, i) => i === index ? { ...video, ...value } : video)) }); }
  function setVideoStatus(index: number, status: SongVideo["status"]) { patch({ videos: updateVideoStatus(song.videos, song.videos[index]?.id || "", status) }); }
  function setPrimary(videoId: string) { patch({ videos: markPrimaryVideo(song.videos, videoId) }); }
  function changeTitle(value: string) { patch({ title: value, videos: song.videos.map((video) => ({ ...video, title: value })) }); }
  function changeVideoUrl(index: number, value: string) {
    const videoId = extractYouTubeVideoId(value);
    patchVideo(index, { youtubeUrl: value, ...(videoId ? { youtubeVideoId: videoId, thumbnailUrl: youtubeThumbnail(videoId) } : {}) });
  }

  async function refreshDuration(index: number) {
    const video = song.videos[index];
    const videoId = extractYouTubeVideoId(video.youtubeUrl);
    if (!videoId) {
      setVideoMessage("No se puede obtener la duración porque uno de los enlaces de YouTube no es válido.");
      return;
    }
    setDurationLookupId(video.id);
    setVideoMessage("");
    const duration = await fetchYouTubeDuration(videoId);
    setDurationLookupId(null);
    if (!duration) {
      setVideoMessage("No se pudo obtener la duración desde YouTube. Puedes introducirla manualmente.");
      return;
    }
    patchVideo(index, { durationSeconds: duration });
    setVideoMessage(`Duración actualizada desde YouTube: ${formatDuration(duration)}.`);
  }

  function missingGroupIds(): string[] {
    const missing = songGroups.filter((group) => group.options.some((option) => option.active) && !(song.classifications[group.id] || []).length).map((group) => group.id);
    if (videoTypeGroup?.options.some((option) => option.active) && song.videos.some((video) => !(video.videoTypeIds || []).length)) missing.push(videoTypeGroup.id);
    return missing;
  }

  function validateAndSave(approveAfter: boolean) {
    setAttempted(true);
    const invalidVideo = song.videos.some((video) => !extractYouTubeVideoId(video.youtubeUrl));
    const missingDuration = song.videos.some((video) => !video.durationSeconds || video.durationSeconds <= 0);
    const missingBlacklistReason = song.proposedStatus === "blacklisted" && !song.blacklistReason?.trim();
    const missingVideoReason = song.videos.some((video) => video.status === "blacklisted" && !video.blacklistReason?.trim());
    if (!song.title.trim() || !song.artist.trim() || song.videos.length === 0 || invalidVideo || missingDuration || missingGroupIds().length > 0 || missingBlacklistReason || missingVideoReason) return;
    onSave(approveAfter);
  }

  const missingGroups = attempted ? missingGroupIds() : [];
  const invalidVideo = attempted && song.videos.some((video) => !extractYouTubeVideoId(video.youtubeUrl));

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-header"><div><span className="eyebrow">Revisión pendiente</span><h2>Revisar antes de aprobar</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="Cerrar">×</button></div>

        {(() => { const primary = getPrimaryUsableVideo(song.videos) || song.videos[0]; return primary ? <div className="video-preview"><img src={primary.thumbnailUrl} alt="Miniatura del video" width={240} height={135} /><div className="grow"><strong>{song.title || "Sin título"}</strong><div className="song-artist">{song.artist || "Artista sin registrar"}</div><a className="text-link" href={primary.youtubeUrl} target="_blank" rel="noreferrer">Abrir video en YouTube ↗</a></div></div> : null; })()}

        <label className="field-label" htmlFor="pending-title">Título de la canción</label>
        <input id="pending-title" className={attempted && !song.title.trim() ? "input-invalid" : ""} value={song.title} onChange={(event) => changeTitle(event.target.value)} />
        {attempted && !song.title.trim() && <div className="field-error">El título es obligatorio.</div>}

        <label className="field-label" htmlFor="pending-artist">Artista</label>
        <ArtistAutocomplete id="pending-artist" value={song.artist} artists={artists} invalid={attempted && !song.artist.trim()} onChange={(value) => patch({ artist: value })} />
        {attempted && !song.artist.trim() && <div className="field-error">El artista es obligatorio.</div>}

        <label className="field-label" htmlFor="pending-lyrics">Letra de la canción</label>
        <textarea id="pending-lyrics" className="lyrics-input" value={song.lyrics || ""} onChange={(event) => patch({ lyrics: event.target.value })} placeholder="Pega la letra aquí…" />

        {songGroups.map((group) => <FilterChips key={group.id} group={group} selected={song.classifications[group.id] || []} invalid={missingGroups.includes(group.id)} onChange={(value) => patch({ classifications: { ...song.classifications, [group.id]: value } })} />)}

        <div className="filter-group"><div className="field-label">Evaluación propuesta</div><div className="chips"><button type="button" className={`chip ${song.proposedStatus !== "blacklisted" ? "selected" : ""}`} onClick={() => patch({ proposedStatus: "approved", blacklistReason: "" })}>Apta para culto</button><button type="button" className={`chip danger-chip ${song.proposedStatus === "blacklisted" ? "selected" : ""}`} onClick={() => patch({ proposedStatus: "blacklisted" })}>No apta / blacklist</button></div></div>

        {song.proposedStatus === "blacklisted" && <><label className="field-label" htmlFor="pending-blacklist-reason">Motivo</label><textarea id="pending-blacklist-reason" className={attempted && !song.blacklistReason?.trim() ? "input-invalid" : ""} value={song.blacklistReason || ""} onChange={(event) => patch({ blacklistReason: event.target.value })} />{attempted && !song.blacklistReason?.trim() && <div className="field-error">Indica por qué no debe usarse.</div>}</>}

        <label className="field-label" htmlFor="pending-notes">Notas</label>
        <textarea id="pending-notes" value={song.notes || ""} onChange={(event) => patch({ notes: event.target.value })} />

        <div className="divider" /><h3>Video</h3>
        {song.videos.map((video, index) => (
          <div className="video-edit" key={video.id}>
            <label className="field-label" htmlFor={`pending-video-${video.id}`}>Enlace de YouTube</label>
            <input id={`pending-video-${video.id}`} className={attempted && !extractYouTubeVideoId(video.youtubeUrl) ? "input-invalid" : ""} value={video.youtubeUrl} onChange={(event) => changeVideoUrl(index, event.target.value)} />
            {attempted && !extractYouTubeVideoId(video.youtubeUrl) && <div className="field-error">El enlace de YouTube no es válido.</div>}
            <div className="subheading-row compact-heading">
              <label className="field-label">Duración</label>
              <button type="button" className="ghost compact-button" disabled={durationLookupId === video.id} onClick={() => void refreshDuration(index)}>{durationLookupId === video.id ? "Consultando…" : "↻ Obtener de YouTube"}</button>
            </div>
            <DurationInput value={video.durationSeconds} onChange={(value) => patchVideo(index, { durationSeconds: value })} invalid={attempted && (!video.durationSeconds || video.durationSeconds <= 0)} idPrefix={`pending-duration-${video.id}`} compact />
            {attempted && (!video.durationSeconds || video.durationSeconds <= 0) && <div className="field-error">Agrega la duración del video.</div>}
            {videoTypeGroup && <FilterChips group={videoTypeGroup} selected={video.videoTypeIds || []} invalid={missingGroups.includes(videoTypeGroup.id) && !(video.videoTypeIds || []).length} onChange={(value) => patchVideo(index, { videoTypeIds: value })} />}
            <div className="filter-group"><div className="field-label">Estado del video</div><div className="chips compact"><button type="button" className={`chip ${video.status === "usable" ? "selected" : ""}`} onClick={() => setVideoStatus(index, "usable")}>Usable</button><button type="button" className={`chip danger-chip ${video.status === "blacklisted" ? "selected" : ""}`} onClick={() => setVideoStatus(index, "blacklisted")}>No usar esta versión</button></div></div>
            {video.status === "usable" && <div className="filter-group"><div className="field-label">Video predeterminado</div><div className="chips compact"><button type="button" className={`chip ${video.isPrimary ? "selected" : ""}`} onClick={() => setPrimary(video.id)}>{video.isPrimary ? "★ Principal" : "Hacer principal"}</button></div></div>}
            {video.status === "blacklisted" && <><label className="field-label">Motivo para no usar</label><textarea className={attempted && !video.blacklistReason?.trim() ? "input-invalid" : ""} value={video.blacklistReason || ""} onChange={(event) => patchVideo(index, { blacklistReason: event.target.value })} placeholder="Explica por qué esta versión no debe usarse…" />{attempted && !video.blacklistReason?.trim() && <div className="field-error">Indica el motivo para no usar esta versión.</div>}</>}
          </div>
        ))}

        {videoMessage && <div className="notice">{videoMessage}</div>}
        {invalidVideo && <div className="notice warning">Revisa los enlaces de YouTube antes de guardar.</div>}

        <div className="modal-actions">
          <button className="secondary" type="button" onClick={onClose} disabled={busy}>Cancelar</button>
          <button className="secondary" type="button" onClick={() => validateAndSave(false)} disabled={busy}>{busy ? "Guardando…" : "Guardar cambios"}</button>
          <button className="primary" type="button" onClick={() => validateAndSave(true)} disabled={busy}>{busy ? "Procesando…" : "Guardar y aprobar"}</button>
        </div>
      </div>
    </div>
  );
}
