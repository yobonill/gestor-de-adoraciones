import { type FormEvent, useEffect, useMemo, useState } from "react";
import type { AppConfig, FilterGroup, Song } from "@/types";
import { reviewSong, saveConfig } from "@/lib/database";
import { clearAdminCode, getAdminCode, setAdminCode, verifyAdminCode } from "@/lib/adminCode";

function cloneConfig(config: AppConfig): AppConfig {
  return JSON.parse(JSON.stringify(config)) as AppConfig;
}

export function ConfigPanel({ config, songs }: { config: AppConfig; songs: Song[] }) {
  const [code, setCode] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [draft, setDraft] = useState<AppConfig>(() => cloneConfig(config));
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const pending = useMemo(() => songs.filter((song) => song.status === "pending"), [songs]);

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
                  {song.videos[0] && <a className="text-link" href={song.videos[0].youtubeUrl} target="_blank" rel="noreferrer">Abrir YouTube ↗</a>}
                  {song.blacklistReason && <p><strong>Motivo:</strong> {song.blacklistReason}</p>}
                  {song.notes && <p className="card-note">{song.notes}</p>}
                </div>
                <div className="pending-actions">
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
    </div>
  );
}
