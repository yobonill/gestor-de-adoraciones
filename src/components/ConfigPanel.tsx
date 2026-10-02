import { type FormEvent, useEffect, useMemo, useState } from "react";
import type { AppConfig, FilterGroup, Song, SongVideo } from "@/types";
import { deleteSong, reviewSong, saveConfig, updateSong } from "@/lib/database";
import { clearAdminCode, getAdminCode, setAdminCode, verifyAdminCode } from "@/lib/adminCode";
import { uniqueArtists } from "@/lib/artists";
import { extractYouTubeVideoId, youtubeThumbnail } from "@/lib/youtube";
import { ArtistAutocomplete } from "./ArtistAutocomplete";
import { FilterChips } from "./FilterChips";

function cloneConfig(config: AppConfig): AppConfig {
  return JSON.parse(JSON.stringify(config)) as AppConfig;
}

function cloneSong(song: Song): Song {
  return JSON.parse(JSON.stringify(song)) as Song;
}

export function ConfigPanel({ config, songs }: { config: AppConfig; songs: Song[] }) {
  const [code, setCode] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [draft, setDraft] = useState<AppConfig>(() => cloneConfig(config));
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [editingPending, setEditingPending] = useState<Song | null>(null);

  const pending = useMemo(() => songs.filter((song) => song.status === "pending"), [songs]);
  const rejected = useMemo(() => songs.filter((song) => song.status === "rejected"), [songs]);

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
      return;
    }
    setAdminCode(value);
    setUnlocked(true);
    if (showMessage) setMessage("Panel administrativo desbloqueado.");
  }

  async function review(song: Song, action: "approve" | "reject") {
    if (!verifyAdminCode(code)) {
      setUnlocked(false);
      setMessage("Código incorrecto.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      await reviewSong(song, action);
      setMessage(action === "approve" ? "Envío aprobado." : "Envío rechazado.");
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

  function patchGroup(index: number, patch: Partial<FilterGroup>) {
    setDraft((current) => ({
      ...current,
      filterGroups: current.filterGroups.map((group, i) => i === index ? { ...group, ...patch } : group)
    }));
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
    setDraft((current) => ({
      ...current,
      filterGroups: [...current.filterGroups, { id: crypto.randomUUID(), label, multiSelect: true, options: [] }]
    }));
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
        <div>
          <span className="eyebrow">Administración</span>
          <h2>Aprobaciones y configuración</h2>
        </div>
        <button className="ghost" type="button" onClick={() => { setUnlocked(false); setCode(""); clearAdminCode(); }}>Bloquear</button>
      </div>

      {message && <div className="notice">{message}</div>}

      <section className="admin-section">
        <div className="subheading-row">
          <div>
            <h3>Pendientes de aprobación</h3>
            <p className="muted">Nada entra al catálogo aprobado sin pasar por aquí.</p>
          </div>
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
                    {(Object.entries(song.classifications) as [string, string[]][]).flatMap(([groupId, ids]) => ids.map((id) => (
                      <span className="tag" key={`${groupId}-${id}`}>{optionLabel(groupId, id)}</span>
                    )))}
                    {song.videos.flatMap((video) => video.videoTypeIds.map((id) => (
                      <span className="tag" key={`${video.id}-${id}`}>{optionLabel("video-type", id)}</span>
                    )))}
                  </div>
                  {song.videos[0] && <a className="text-link" href={song.videos[0].youtubeUrl} target="_blank" rel="noreferrer">Abrir YouTube ↗</a>}
                  {song.blacklistReason && <p><strong>Motivo:</strong> {song.blacklistReason}</p>}
                  {song.notes && <p className="card-note">{song.notes}</p>}
                </div>
                <div className="pending-actions">
                  <button className="secondary" type="button" disabled={busy} onClick={() => setEditingPending(cloneSong(song))}>Revisar / Editar</button>
                  <button className="primary" type="button" disabled={busy} onClick={() => void review(song, "approve")}>Aprobar</button>
                  <button className="ghost danger-text" type="button" disabled={busy} onClick={() => void review(song, "reject")}>Rechazar</button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="admin-section">
        <div className="subheading-row">
          <div>
            <h3>Rechazados</h3>
            <p className="muted">Se conservan para que puedas revisarlos. Elimínalos si quieres permitir que el mismo enlace vuelva a registrarse.</p>
          </div>
          <span className="count-badge">{rejected.length}</span>
        </div>

        {rejected.length === 0 ? <div className="empty-state">No hay canciones rechazadas.</div> : (
          <div className="pending-list">
            {rejected.map((song) => (
              <article className="pending-card" key={song.id}>
                <div className="grow">
                  <div className="pending-title-row">
                    <h4>{song.title}</h4>
                    <span className="status-badge danger">Rechazada</span>
                  </div>
                  <div className="song-artist">{song.artist || "Artista sin registrar"}</div>
                  {song.notes && <p className="card-note">{song.notes}</p>}
                </div>
                <div className="pending-actions">
                  {song.videos.map((video, index) => (
                    <a key={video.id} className="secondary-button" href={video.youtubeUrl} target="_blank" rel="noreferrer">
                      {song.videos.length > 1 ? `▶ Ver video ${index + 1}` : "▶ Ver video"}
                    </a>
                  ))}
                  <button className="ghost danger-text" type="button" disabled={busy} onClick={() => void removeRejected(song)}>Eliminar definitivamente</button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="admin-section">
        <div className="subheading-row">
          <div>
            <h3>Filtros</h3>
            <p className="muted">Estas opciones aparecen al agregar, buscar y preparar un culto.</p>
          </div>
          <button className="secondary" type="button" onClick={addGroup}>+ Grupo</button>
        </div>

        <div className="config-groups">
          {draft.filterGroups.map((group, groupIndex) => (
            <div className="config-group" key={group.id}>
              <div className="config-group-head">
                <input value={group.label} onChange={(e) => patchGroup(groupIndex, { label: e.target.value })} />
                <label className="toggle-label"><input type="checkbox" checked={group.multiSelect} onChange={(e) => patchGroup(groupIndex, { multiSelect: e.target.checked })} />Multi-selección</label>
                {group.id !== "video-type" && <button className="icon-button danger-text" type="button" title="Eliminar grupo" onClick={() => setDraft((current) => ({ ...current, filterGroups: current.filterGroups.filter((_, i) => i !== groupIndex) }))}>×</button>}
              </div>

              <div className="config-options">
                {group.options.map((option, optionIndex) => (
                  <div className="config-option" key={option.id}>
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

      {editingPending && (
        <PendingReviewModal
          song={editingPending}
          allSongs={songs}
          config={config}
          busy={busy}
          onChange={setEditingPending}
          onClose={() => setEditingPending(null)}
          onSave={(approveAfter) => void savePendingEdit(editingPending, approveAfter)}
        />
      )}
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
  const videoTypeGroup = config.filterGroups.find((group) => group.id === "video-type");
  const songGroups = config.filterGroups.filter((group) => group.id !== "video-type");
  const artists = useMemo(() => uniqueArtists(allSongs.map((item) => item.artist)), [allSongs]);

  function patch(patchValue: Partial<Song>) {
    onChange({ ...song, ...patchValue });
  }

  function patchVideo(index: number, value: Partial<SongVideo>) {
    patch({ videos: song.videos.map((video, i) => i === index ? { ...video, ...value } : video) });
  }

  function changeTitle(value: string) {
    patch({
      title: value,
      videos: song.videos.map((video) => ({ ...video, title: value }))
    });
  }

  function changeVideoUrl(index: number, value: string) {
    const videoId = extractYouTubeVideoId(value);
    patchVideo(index, {
      youtubeUrl: value,
      ...(videoId ? { youtubeVideoId: videoId, thumbnailUrl: youtubeThumbnail(videoId) } : {})
    });
  }

  function missingGroupIds(): string[] {
    const missing = songGroups
      .filter((group) => group.options.some((option) => option.active) && !(song.classifications[group.id] || []).length)
      .map((group) => group.id);
    if (videoTypeGroup?.options.some((option) => option.active) && song.videos.some((video) => !(video.videoTypeIds || []).length)) {
      missing.push(videoTypeGroup.id);
    }
    return missing;
  }

  function validateAndSave(approveAfter: boolean) {
    setAttempted(true);
    const invalidVideo = song.videos.some((video) => !extractYouTubeVideoId(video.youtubeUrl));
    const missingBlacklistReason = song.proposedStatus === "blacklisted" && !song.blacklistReason?.trim();
    if (!song.title.trim() || !song.artist.trim() || song.videos.length === 0 || invalidVideo || missingGroupIds().length > 0 || missingBlacklistReason) return;
    onSave(approveAfter);
  }

  const missingGroups = attempted ? missingGroupIds() : [];
  const invalidVideo = attempted && song.videos.some((video) => !extractYouTubeVideoId(video.youtubeUrl));

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <span className="eyebrow">Revisión pendiente</span>
            <h2>Revisar antes de aprobar</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Cerrar">×</button>
        </div>

        {song.videos[0] && (
          <div className="video-preview">
            <img src={song.videos[0].thumbnailUrl} alt="Miniatura del video" width={240} height={135} />
            <div className="grow">
              <strong>{song.title || "Sin título"}</strong>
              <div className="song-artist">{song.artist || "Artista sin registrar"}</div>
              <a className="text-link" href={song.videos[0].youtubeUrl} target="_blank" rel="noreferrer">Abrir video en YouTube ↗</a>
            </div>
          </div>
        )}

        <label className="field-label" htmlFor="pending-title">Título de la canción</label>
        <input id="pending-title" className={attempted && !song.title.trim() ? "input-invalid" : ""} value={song.title} onChange={(event) => changeTitle(event.target.value)} />
        {attempted && !song.title.trim() && <div className="field-error">El título es obligatorio.</div>}

        <label className="field-label" htmlFor="pending-artist">Artista</label>
        <ArtistAutocomplete id="pending-artist" value={song.artist} artists={artists} invalid={attempted && !song.artist.trim()} onChange={(value) => patch({ artist: value })} />
        {attempted && !song.artist.trim() && <div className="field-error">El artista es obligatorio.</div>}

        {songGroups.map((group) => (
          <FilterChips
            key={group.id}
            group={group}
            selected={song.classifications[group.id] || []}
            invalid={missingGroups.includes(group.id)}
            onChange={(value) => patch({ classifications: { ...song.classifications, [group.id]: value } })}
          />
        ))}

        <div className="filter-group">
          <div className="field-label">Evaluación propuesta</div>
          <div className="chips">
            <button type="button" className={`chip ${song.proposedStatus !== "blacklisted" ? "selected" : ""}`} onClick={() => patch({ proposedStatus: "approved", blacklistReason: "" })}>Apta para culto</button>
            <button type="button" className={`chip danger-chip ${song.proposedStatus === "blacklisted" ? "selected" : ""}`} onClick={() => patch({ proposedStatus: "blacklisted" })}>No apta / blacklist</button>
          </div>
        </div>

        {song.proposedStatus === "blacklisted" && (
          <>
            <label className="field-label" htmlFor="pending-blacklist-reason">Motivo</label>
            <textarea id="pending-blacklist-reason" className={attempted && !song.blacklistReason?.trim() ? "input-invalid" : ""} value={song.blacklistReason || ""} onChange={(event) => patch({ blacklistReason: event.target.value })} />
            {attempted && !song.blacklistReason?.trim() && <div className="field-error">Indica por qué no debe usarse.</div>}
          </>
        )}

        <label className="field-label" htmlFor="pending-notes">Notas</label>
        <textarea id="pending-notes" value={song.notes || ""} onChange={(event) => patch({ notes: event.target.value })} />

        <div className="divider" />
        <h3>Video</h3>
        {song.videos.map((video, index) => (
          <div className="video-edit" key={video.id}>
            <label className="field-label" htmlFor={`pending-video-${video.id}`}>Enlace de YouTube</label>
            <input
              id={`pending-video-${video.id}`}
              className={attempted && !extractYouTubeVideoId(video.youtubeUrl) ? "input-invalid" : ""}
              value={video.youtubeUrl}
              onChange={(event) => changeVideoUrl(index, event.target.value)}
            />
            {attempted && !extractYouTubeVideoId(video.youtubeUrl) && <div className="field-error">El enlace de YouTube no es válido.</div>}
            {videoTypeGroup && (
              <FilterChips
                group={videoTypeGroup}
                selected={video.videoTypeIds || []}
                invalid={missingGroups.includes(videoTypeGroup.id) && !(video.videoTypeIds || []).length}
                onChange={(value) => patchVideo(index, { videoTypeIds: value })}
              />
            )}
          </div>
        ))}

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
