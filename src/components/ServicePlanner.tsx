import { useEffect, useMemo, useState } from "react";
import type { AppConfig, ServiceItem, ServicePlan, Song } from "@/types";
import { deleteService, saveService, subscribeServices, updateSong } from "@/lib/database";
import { getAdminCode, requireAdminCode, verifyAdminCode } from "@/lib/adminCode";
import { songMatchesFilters } from "@/lib/filters";
import { FilterChips } from "./FilterChips";
import { normalizeTextKey } from "@/lib/text";
import { formatDuration, sanitizeDurationSeconds } from "@/lib/duration";
import { SongDetailsModal } from "./SongDetailsModal";
import { EditSongModal } from "./SearchPanel";
import { getPrimaryUsableVideo, preferredUsableVideo, usableVideosMatchingTypes } from "@/lib/videos";

function todayLocal() {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  return new Date(now.getTime() - offset * 60000).toISOString().slice(0, 10);
}

function newPlan(): ServicePlan {
  return {
    id: "",
    title: "Culto",
    kind: "single",
    date: todayLocal(),
    sections: [{ id: crypto.randomUUID(), label: "Canciones", items: [] }]
  };
}

function clonePlan(plan: ServicePlan): ServicePlan {
  return JSON.parse(JSON.stringify(plan)) as ServicePlan;
}

type SongUsage = {
  date: string;
  serviceTitle: string;
  sectionLabel: string;
};

function formatServiceDate(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  if (!year || !month || !day) return date;
  return new Intl.DateTimeFormat("es-DO", { day: "numeric", month: "short", year: "numeric" }).format(new Date(Date.UTC(year, month - 1, day)));
}

export function ServicePlanner({ config, songs, allSongs = songs }: { config: AppConfig; songs: Song[]; allSongs?: Song[] }) {
  const [services, setServices] = useState<ServicePlan[]>([]);
  const [plan, setPlan] = useState<ServicePlan>(() => newPlan());
  const [activeSectionId, setActiveSectionId] = useState("");
  const [filters, setFilters] = useState<Record<string, string[]>>({});
  const [query, setQuery] = useState("");
  const [selectedVideo, setSelectedVideo] = useState<Record<string, string>>({});
  const [details, setDetails] = useState<{ song: Song; videoId?: string } | null>(null);
  const [editingSong, setEditingSong] = useState<Song | null>(null);
  const [editBusy, setEditBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setActiveSectionId((current) => current || plan.sections[0]?.id || "");
  }, [plan.sections]);

  useEffect(() => subscribeServices(setServices), []);

  const songsById = useMemo(() => new Map(songs.map((song) => [song.id, song])), [songs]);
  const adminUnlocked = verifyAdminCode(getAdminCode());
  const selectedVideoTypes = filters["video-type"] || [];

  const filteredSongs = useMemo(() => {
    const q = normalizeTextKey(query);
    return songs.filter((song) => {
      const titleKey = song.search?.title || normalizeTextKey(song.title);
      const artistKey = song.search?.artist || normalizeTextKey(song.artist);
      const lyricsKey = song.search?.lyrics || normalizeTextKey(song.lyrics || "");
      const textMatch = !q || titleKey.includes(q) || artistKey.includes(q) || lyricsKey.includes(q);
      return textMatch && songMatchesFilters(song, filters);
    });
  }, [songs, query, filters]);

  const lastUsageBySong = useMemo(() => {
    const usage = new Map<string, SongUsage>();
    for (const service of services) {
      if (plan.id && service.id === plan.id) continue;
      for (const section of service.sections) {
        const usageDate = section.date || service.date;
        if (!usageDate) continue;
        if (plan.date && usageDate > plan.date) continue;
        for (const item of section.items) {
          const current = usage.get(item.songId);
          if (!current || usageDate > current.date) {
            usage.set(item.songId, { date: usageDate, serviceTitle: service.title, sectionLabel: section.label });
          }
        }
      }
    }
    return usage;
  }, [services, plan.id, plan.date]);

  const activeSection = plan.sections.find((section) => section.id === activeSectionId) || plan.sections[0];

  function setKind(kind: "single" | "weekend") {
    if (kind === plan.kind) return;
    if (kind === "weekend") {
      setPlan((current) => ({
        ...current,
        kind,
        title: current.title === "Culto" ? "Fin de semana" : current.title,
        sections: [
          { id: crypto.randomUUID(), label: "Sábado", items: [] },
          { id: crypto.randomUUID(), label: "Domingo", items: [] }
        ]
      }));
    } else {
      setPlan((current) => ({ ...current, kind, title: current.title === "Fin de semana" ? "Culto" : current.title, sections: [{ id: crypto.randomUUID(), label: "Canciones", items: [] }] }));
    }
  }

  function optionLabel(groupId: string, optionId: string) {
    return config.filterGroups.find((g) => g.id === groupId)?.options.find((o) => o.id === optionId)?.label || optionId;
  }

  function tempoLabel(song?: Song) {
    if (!song) return "";
    const values = song.classifications["tempo"] || [];
    return values.map((id) => optionLabel("tempo", id)).join(", ");
  }

  function durationForItem(item: ServiceItem) {
    const stored = sanitizeDurationSeconds(item.durationSeconds);
    if (stored) return stored;
    const song = songsById.get(item.songId);
    const video = song?.videos.find((candidate) => candidate.id === item.videoId);
    return sanitizeDurationSeconds(video?.durationSeconds);
  }

  const activeDuration = useMemo(() => (activeSection?.items || []).reduce((sum, item) => sum + durationForItem(item), 0), [activeSection, songsById]);
  const totalPlanDuration = useMemo(() => plan.sections.reduce((sum, section) => sum + section.items.reduce((sectionSum, item) => sectionSum + durationForItem(item), 0), 0), [plan.sections, songsById]);

  function addSong(song: Song) {
    if (!activeSection) return;
    const existingCount = activeSection.items.filter((item) => item.songId === song.id).length;
    if (existingCount > 0) {
      const repeatedLabel = existingCount === 1 ? "ya está agregada" : `ya está agregada ${existingCount} veces`;
      const confirmed = window.confirm(`“${song.title}” ${repeatedLabel} en ${activeSection.label}. ¿Deseas agregarla nuevamente?`);
      if (!confirmed) return;
    }

    const usableVideos = usableVideosMatchingTypes(song.videos, selectedVideoTypes);
    if (!usableVideos.length) return;
    const preferred = preferredUsableVideo(song.videos, selectedVideoTypes) || getPrimaryUsableVideo(song.videos) || usableVideos[0];
    const videoId = selectedVideo[song.id] || preferred.id;
    const video = usableVideos.find((item) => item.id === videoId) || preferred;
    const item: ServiceItem = {
      songId: song.id,
      songTitle: song.title,
      songArtist: song.artist,
      videoId: video.id,
      videoTitle: video.title,
      youtubeUrl: video.youtubeUrl,
      videoTypeLabel: video.videoTypeIds[0] ? optionLabel("video-type", video.videoTypeIds[0]) : "YouTube",
      durationSeconds: sanitizeDurationSeconds(video.durationSeconds)
    };
    setPlan((current) => ({
      ...current,
      sections: current.sections.map((section) => section.id === activeSection.id ? { ...section, items: [...section.items, item] } : section)
    }));
  }

  function removeItem(sectionId: string, index: number) {
    setPlan((current) => ({ ...current, sections: current.sections.map((section) => section.id === sectionId ? { ...section, items: section.items.filter((_, i) => i !== index) } : section) }));
  }

  function moveItem(sectionId: string, index: number, direction: -1 | 1) {
    setPlan((current) => ({
      ...current,
      sections: current.sections.map((section) => {
        if (section.id !== sectionId) return section;
        const next = [...section.items];
        const target = index + direction;
        if (target < 0 || target >= next.length) return section;
        [next[index], next[target]] = [next[target], next[index]];
        return { ...section, items: next };
      })
    }));
  }

  function beginEditSong(song: Song) {
    setEditingSong(JSON.parse(JSON.stringify(song)) as Song);
  }

  async function saveSongEdit() {
    if (!editingSong) return;
    setEditBusy(true);
    setMessage("");
    try {
      await requireAdminCode();
      const updatedSong = { ...editingSong, updatedAt: new Date().toISOString() };
      await updateSong(updatedSong);

      setPlan((current) => ({
        ...current,
        sections: current.sections.map((section) => ({
          ...section,
          items: section.items.map((item) => {
            if (item.songId !== updatedSong.id) return item;
            const video = updatedSong.videos.find((candidate) => candidate.id === item.videoId)
              || getPrimaryUsableVideo(updatedSong.videos);
            if (!video) return { ...item, songTitle: updatedSong.title, songArtist: updatedSong.artist };
            return {
              ...item,
              songTitle: updatedSong.title,
              songArtist: updatedSong.artist,
              videoId: video.id,
              videoTitle: video.title,
              youtubeUrl: video.youtubeUrl,
              videoTypeLabel: video.videoTypeIds[0] ? optionLabel("video-type", video.videoTypeIds[0]) : "YouTube",
              durationSeconds: sanitizeDurationSeconds(video.durationSeconds)
            };
          })
        }))
      }));

      setEditingSong(null);
      setMessage("Canción actualizada.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo actualizar la canción.");
    } finally {
      setEditBusy(false);
    }
  }

  async function savePlan() {
    if (!plan.title.trim() || !plan.date) {
      setMessage("Completa el nombre y la fecha.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const id = await saveService(plan);
      if (!plan.id) setPlan((current) => ({ ...current, id }));
      setMessage("Culto guardado.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo guardar.");
    } finally {
      setBusy(false);
    }
  }

  async function removePlan() {
    if (!plan.id || !window.confirm(`¿Eliminar “${plan.title}”?`)) return;
    setBusy(true);
    setMessage("");
    try {
      await requireAdminCode();
      await deleteService(plan.id);
      const blank = newPlan();
      setPlan(blank);
      setActiveSectionId(blank.sections[0].id);
      setMessage("Culto eliminado.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo eliminar.");
    } finally {
      setBusy(false);
    }
  }

  function linksText() {
    const lines = [`${plan.title} — ${plan.date}`];
    for (const section of plan.sections) {
      lines.push("", section.label);
      section.items.forEach((item, index) => lines.push(`${index + 1}. ${item.songTitle}${item.songArtist ? ` — ${item.songArtist}` : ""}: ${item.youtubeUrl}`));
    }
    lines.push("", `Duración total estimada: ${totalPlanDuration ? formatDuration(totalPlanDuration) : "0:00"}`);
    return lines.join("\n");
  }

  async function copyLinks() {
    await navigator.clipboard.writeText(linksText());
    setMessage("Enlaces copiados.");
  }

  async function shareLinks() {
    const text = linksText();
    if (navigator.share) {
      await navigator.share({ title: plan.title, text });
    } else {
      await navigator.clipboard.writeText(text);
      setMessage("Tu navegador no permite compartir directamente; los enlaces fueron copiados.");
    }
  }

  return (
    <div className="panel-stack">
      <div className="section-heading">
        <div><span className="eyebrow">Planificación</span><h2>Preparar culto</h2></div>
        <button type="button" className="secondary" onClick={() => { const blank = newPlan(); setPlan(blank); setActiveSectionId(blank.sections[0].id); }}>+ Nuevo culto</button>
      </div>

      {services.length > 0 && (
        <div className="saved-services">
          <div className="field-label">Cultos guardados</div>
          <div className="chips scroll-x">
            {services.slice(0, 30).map((service) => (
              <button key={service.id} className={`chip ${plan.id === service.id ? "selected" : ""}`} onClick={() => { const copy = clonePlan(service); setPlan(copy); setActiveSectionId(copy.sections[0]?.id || ""); }}>
                {service.date} · {service.title}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="planner-header-card">
        <div className="two-col">
          <div><label className="field-label">Nombre</label><input value={plan.title} onChange={(e) => setPlan((current) => ({ ...current, title: e.target.value }))} /></div>
          <div><label className="field-label">Fecha principal</label><input type="date" value={plan.date} onChange={(e) => setPlan((current) => ({ ...current, date: e.target.value }))} /></div>
        </div>
        <div className="filter-group">
          <div className="field-label">Formato</div>
          <div className="chips">
            <button type="button" className={`chip ${plan.kind === "single" ? "selected" : ""}`} onClick={() => setKind("single")}>Culto individual</button>
            <button type="button" className={`chip ${plan.kind === "weekend" ? "selected" : ""}`} onClick={() => setKind("weekend")}>Fin de semana</button>
          </div>
        </div>
      </div>

      <div className="planner-layout">
        <div className="service-list-card">
          <div className="section-tabs">
            {plan.sections.map((section) => <button key={section.id} className={section.id === activeSection?.id ? "active" : ""} onClick={() => setActiveSectionId(section.id)}>{section.label} ({section.items.length})</button>)}
          </div>

          {plan.sections.map((section) => section.id === activeSection?.id && (
            <div key={section.id}>
              {section.items.length === 0 ? (
                <div className="empty-state">Busca canciones a la derecha y agrégalas a {section.label.toLowerCase()}.</div>
              ) : (
                <ol className="service-items">
                  {section.items.map((item, index) => {
                    const song = songsById.get(item.songId);
                    const tempo = tempoLabel(song);
                    const duration = durationForItem(item);
                    return (
                      <li key={`${item.videoId}-${index}`}>
                        <div className="service-item-main">
                          <span className="order-number">{index + 1}</span>
                          <div>
                            <strong>{item.songTitle}</strong>
                            <span>
                              {[item.songArtist, item.videoTypeLabel || "YouTube", tempo].filter(Boolean).join(" · ")}
                              {(item.songArtist || item.videoTypeLabel || tempo) && " · "}
                              <strong>{duration ? formatDuration(duration) : "Duración pendiente"}</strong>
                            </span>
                          </div>
                        </div>
                        <div className="service-item-actions">
                          {song && (adminUnlocked
                            ? <button type="button" className="secondary compact-button" onClick={() => beginEditSong(song)}>Editar</button>
                            : <button type="button" className="secondary compact-button" onClick={() => setDetails({ song, videoId: item.videoId })}>Detalles</button>
                          )}
                          <a href={item.youtubeUrl} target="_blank" rel="noreferrer" className="play-link">▶ Abrir</a>
                          <button type="button" className="icon-button" disabled={index === 0} onClick={() => moveItem(section.id, index, -1)}>↑</button>
                          <button type="button" className="icon-button" disabled={index === section.items.length - 1} onClick={() => moveItem(section.id, index, 1)}>↓</button>
                          <button type="button" className="icon-button danger-text" onClick={() => removeItem(section.id, index)}>×</button>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
              <div className="service-duration-summary">
                <strong>Duración de {section.label}:</strong> {activeDuration ? formatDuration(activeDuration) : "0:00"}
                {plan.sections.length > 1 && <span> · Total del plan: {totalPlanDuration ? formatDuration(totalPlanDuration) : "0:00"}</span>}
              </div>
            </div>
          ))}

          <div className="share-actions">
            <button type="button" className="secondary" onClick={() => void copyLinks()} disabled={!plan.sections.some((section) => section.items.length)}>Copiar enlaces</button>
            <button type="button" className="secondary" onClick={() => void shareLinks()} disabled={!plan.sections.some((section) => section.items.length)}>Compartir</button>
            <button type="button" className="primary" onClick={() => void savePlan()} disabled={busy}>{busy ? "Guardando…" : plan.id ? "Guardar cambios" : "Guardar culto"}</button>
            {plan.id && <button type="button" className="ghost danger-text" onClick={() => void removePlan()}>Eliminar</button>}
          </div>
        </div>

        <div className="picker-card">
          <h3>Agregar a {activeSection?.label || "culto"}</h3>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar por canción, artista o letra…" />
          <div className="compact-filters">
            {config.filterGroups.map((group) => <FilterChips key={group.id} group={group} selected={filters[group.id] || []} onChange={(value) => setFilters((current) => ({ ...current, [group.id]: value }))} forceMultiSelect />)}
          </div>
          <div className="picker-results">
            {filteredSongs.map((song) => {
              const usableVideos = usableVideosMatchingTypes(song.videos, selectedVideoTypes);
              if (!usableVideos.length) return null;
              const preferred = preferredUsableVideo(song.videos, selectedVideoTypes) || getPrimaryUsableVideo(song.videos) || usableVideos[0];
              const currentVideoId = usableVideos.some((video) => video.id === selectedVideo[song.id]) ? selectedVideo[song.id] : preferred.id;
              const currentVideo = usableVideos.find((video) => video.id === currentVideoId) || preferred;
              const lastUsage = lastUsageBySong.get(song.id);
              const tempo = tempoLabel(song);
              return (
                <div className="picker-result" key={song.id}>
                  <div className="picker-result-info">
                    <strong>{song.title}</strong>
                    <span>{song.artist || "Artista sin registrar"}</span>
                    <span className="picker-meta">{[tempo, formatDuration(currentVideo.durationSeconds)].filter(Boolean).join(" · ")}</span>
                    <span className={`song-last-used ${lastUsage ? "" : "never-used"}`}>
                      {lastUsage ? `Último uso: ${formatServiceDate(lastUsage.date)} · ${lastUsage.serviceTitle}${lastUsage.sectionLabel !== "Canciones" ? ` / ${lastUsage.sectionLabel}` : ""}` : "Sin uso registrado en cultos guardados"}
                    </span>
                    {usableVideos.length > 1 ? (
                      <label className="video-choice-label">
                        <span>Versión a usar</span>
                        <select value={currentVideoId} onChange={(e) => setSelectedVideo((current) => ({ ...current, [song.id]: e.target.value }))}>
                          {usableVideos.map((video) => <option value={video.id} key={video.id}>{video.isPrimary ? "★ Principal · " : ""}{video.videoTypeIds[0] ? optionLabel("video-type", video.videoTypeIds[0]) : video.title} · {formatDuration(video.durationSeconds)}</option>)}
                        </select>
                      </label>
                    ) : <span>{currentVideo.videoTypeIds[0] ? optionLabel("video-type", currentVideo.videoTypeIds[0]) : "YouTube"}{currentVideo.isPrimary ? " · Principal" : ""}</span>}
                  </div>
                  <div className="picker-result-actions">
                    <button type="button" className="secondary compact-button" onClick={() => setDetails({ song, videoId: currentVideo.id })}>Detalles</button>
                    <a href={currentVideo.youtubeUrl} target="_blank" rel="noreferrer" className="secondary-button">▶ Abrir</a>
                    <button type="button" className="small-primary" onClick={() => addSong(song)}>+ Agregar</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {message && <div className="notice">{message}</div>}
      {editingSong && <EditSongModal song={editingSong} allSongs={allSongs} config={config} onChange={setEditingSong} onClose={() => setEditingSong(null)} onSave={() => void saveSongEdit()} busy={editBusy} />}
      {details && <SongDetailsModal song={details.song} config={config} selectedVideoId={details.videoId} onClose={() => setDetails(null)} />}
    </div>
  );
}
