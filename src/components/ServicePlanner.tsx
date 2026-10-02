import { useEffect, useMemo, useState } from "react";
import type { AppConfig, ServiceItem, ServicePlan, Song } from "@/types";
import { deleteService, saveService, subscribeServices } from "@/lib/database";
import { requireAdminCode } from "@/lib/adminCode";
import { songMatchesFilters } from "@/lib/filters";
import { FilterChips } from "./FilterChips";

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

export function ServicePlanner({ config, songs }: { config: AppConfig; songs: Song[] }) {
  const [services, setServices] = useState<ServicePlan[]>([]);
  const [plan, setPlan] = useState<ServicePlan>(() => newPlan());
  const [activeSectionId, setActiveSectionId] = useState("");
  const [filters, setFilters] = useState<Record<string, string[]>>({});
  const [query, setQuery] = useState("");
  const [selectedVideo, setSelectedVideo] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setActiveSectionId((current) => current || plan.sections[0]?.id || "");
  }, [plan.sections]);

  useEffect(() => subscribeServices(setServices), []);

  const filteredSongs = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("es");
    return songs.filter((song) => {
      const textMatch = !q || song.title.toLocaleLowerCase("es").includes(q);
      return textMatch && songMatchesFilters(song, filters);
    });
  }, [songs, query, filters]);

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
      setPlan((current) => ({
        ...current,
        kind,
        title: current.title === "Fin de semana" ? "Culto" : current.title,
        sections: [{ id: crypto.randomUUID(), label: "Canciones", items: [] }]
      }));
    }
  }

  function optionLabel(groupId: string, optionId: string) {
    return config.filterGroups.find((g) => g.id === groupId)?.options.find((o) => o.id === optionId)?.label || optionId;
  }

  function addSong(song: Song) {
    if (!activeSection) return;
    const usableVideos = song.videos.filter((video) => video.status === "usable");
    if (!usableVideos.length) return;
    const videoId = selectedVideo[song.id] || usableVideos[0].id;
    const video = usableVideos.find((item) => item.id === videoId) || usableVideos[0];
    const item: ServiceItem = {
      songId: song.id,
      songTitle: song.title,
      videoId: video.id,
      videoTitle: video.title,
      youtubeUrl: video.youtubeUrl,
      videoTypeLabel: video.videoTypeIds[0] ? optionLabel("video-type", video.videoTypeIds[0]) : "YouTube"
    };

    setPlan((current) => ({
      ...current,
      sections: current.sections.map((section) => section.id === activeSection.id
        ? { ...section, items: [...section.items, item] }
        : section)
    }));
  }

  function removeItem(sectionId: string, index: number) {
    setPlan((current) => ({
      ...current,
      sections: current.sections.map((section) => section.id === sectionId
        ? { ...section, items: section.items.filter((_, i) => i !== index) }
        : section)
    }));
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

  async function savePlan() {
    if (!plan.title.trim() || !plan.date) {
      setMessage("Completa el nombre y la fecha.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      await requireAdminCode();
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
      section.items.forEach((item, index) => lines.push(`${index + 1}. ${item.songTitle}: ${item.youtubeUrl}`));
    }
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
        <div>
          <span className="eyebrow">Planificación</span>
          <h2>Preparar culto</h2>
        </div>
        <button type="button" className="secondary" onClick={() => {
          const blank = newPlan();
          setPlan(blank);
          setActiveSectionId(blank.sections[0].id);
        }}>+ Nuevo culto</button>
      </div>

      {services.length > 0 && (
        <div className="saved-services">
          <div className="field-label">Cultos guardados</div>
          <div className="chips scroll-x">
            {services.map((service) => (
              <button key={service.id} className={`chip ${plan.id === service.id ? "selected" : ""}`} onClick={() => {
                const copy = clonePlan(service);
                setPlan(copy);
                setActiveSectionId(copy.sections[0]?.id || "");
              }}>
                {service.date} · {service.title}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="planner-header-card">
        <div className="two-col">
          <div>
            <label className="field-label">Nombre</label>
            <input value={plan.title} onChange={(e) => setPlan((current) => ({ ...current, title: e.target.value }))} />
          </div>
          <div>
            <label className="field-label">Fecha principal</label>
            <input type="date" value={plan.date} onChange={(e) => setPlan((current) => ({ ...current, date: e.target.value }))} />
          </div>
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
            {plan.sections.map((section) => (
              <button key={section.id} className={section.id === activeSection?.id ? "active" : ""} onClick={() => setActiveSectionId(section.id)}>{section.label} ({section.items.length})</button>
            ))}
          </div>

          {plan.sections.map((section) => section.id === activeSection?.id && (
            <div key={section.id}>
              {section.items.length === 0 ? (
                <div className="empty-state">Busca canciones a la derecha y agrégalas a {section.label.toLowerCase()}.</div>
              ) : (
                <ol className="service-items">
                  {section.items.map((item, index) => (
                    <li key={`${item.videoId}-${index}`}>
                      <div className="service-item-main">
                        <span className="order-number">{index + 1}</span>
                        <div><strong>{item.songTitle}</strong><span>{item.videoTypeLabel || "YouTube"}</span></div>
                      </div>
                      <div className="service-item-actions">
                        <a href={item.youtubeUrl} target="_blank" rel="noreferrer" className="play-link">▶ Abrir</a>
                        <button type="button" className="icon-button" disabled={index === 0} onClick={() => moveItem(section.id, index, -1)}>↑</button>
                        <button type="button" className="icon-button" disabled={index === section.items.length - 1} onClick={() => moveItem(section.id, index, 1)}>↓</button>
                        <button type="button" className="icon-button danger-text" onClick={() => removeItem(section.id, index)}>×</button>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
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
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar canción…" />
          <div className="compact-filters">
            {config.filterGroups.map((group) => (
              <FilterChips key={group.id} group={group} selected={filters[group.id] || []} onChange={(value) => setFilters((current) => ({ ...current, [group.id]: value }))} forceMultiSelect />
            ))}
          </div>
          <div className="picker-results">
            {filteredSongs.map((song) => {
              const usableVideos = song.videos.filter((video) => video.status === "usable");
              if (!usableVideos.length) return null;
              const currentVideoId = selectedVideo[song.id] || usableVideos[0].id;
              return (
                <div className="picker-result" key={song.id}>
                  <div>
                    <strong>{song.title}</strong>
                    {usableVideos.length > 1 ? (
                      <select value={currentVideoId} onChange={(e) => setSelectedVideo((current) => ({ ...current, [song.id]: e.target.value }))}>
                        {usableVideos.map((video) => <option value={video.id} key={video.id}>{video.videoTypeIds[0] ? optionLabel("video-type", video.videoTypeIds[0]) : video.title}</option>)}
                      </select>
                    ) : (
                      <span>{usableVideos[0].videoTypeIds[0] ? optionLabel("video-type", usableVideos[0].videoTypeIds[0]) : "YouTube"}</span>
                    )}
                  </div>
                  <button type="button" className="small-primary" onClick={() => addSong(song)}>+ Agregar</button>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {message && <div className="notice">{message}</div>}
    </div>
  );
}
