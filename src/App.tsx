import { useEffect, useMemo, useState } from "react";
import { AddSongPanel } from "@/components/AddSongPanel";
import { SearchPanel } from "@/components/SearchPanel";
import { ServicePlanner } from "@/components/ServicePlanner";
import { ConfigPanel } from "@/components/ConfigPanel";
import type { AppConfig, Song } from "@/types";
import { DEFAULT_CONFIG } from "@/lib/defaultConfig";
import { subscribeConfig, subscribeSongs } from "@/lib/database";

type Tab = "add" | "search" | "service" | "config";

export function App() {
  const [tab, setTab] = useState<Tab>("service");
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG);
  const [songs, setSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState(true);
  const [dataError, setDataError] = useState("");

  useEffect(() => {
    let gotConfig = false;
    let gotSongs = false;
    const updateLoading = () => {
      if (gotConfig && gotSongs) setLoading(false);
    };

    try {
      const unsubscribeConfig = subscribeConfig((value) => {
        gotConfig = true;
        setConfig(value);
        updateLoading();
      });
      const unsubscribeSongs = subscribeSongs((value) => {
        gotSongs = true;
        setSongs(value);
        updateLoading();
      });
      return () => {
        unsubscribeConfig();
        unsubscribeSongs();
      };
    } catch (error) {
      setLoading(false);
      setDataError(error instanceof Error ? error.message : "No se pudo conectar con Firebase.");
      return undefined;
    }
  }, []);

  const approvedCount = useMemo(() => songs.filter((song) => song.status === "approved").length, [songs]);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="logo-wrap">
            <img src="./logo.png" alt="Logo" width={76} height={76} />
          </div>
          <div>
            <h1>Gestor de Adoraciones</h1>
            <p>Organiza, filtra y prepara las canciones del servicio.</p>
          </div>
        </div>
        <div className="status-pill">{loading ? "Cargando…" : `${approvedCount} canciones aprobadas`}</div>
      </header>

      <section className="content-card">
        {dataError && <div className="notice warning">{dataError}</div>}
        {!dataError && tab === "add" && <AddSongPanel config={config} songs={songs} onSubmitted={() => setTab("search")} />}
        {!dataError && tab === "search" && <SearchPanel config={config} songs={songs} />}
        {!dataError && tab === "service" && <ServicePlanner config={config} songs={songs.filter((song) => song.status === "approved")} />}
        {!dataError && tab === "config" && <ConfigPanel config={config} songs={songs} />}
      </section>

      <nav className="bottom-nav" aria-label="Navegación principal">
        <button className={tab === "add" ? "active" : ""} onClick={() => setTab("add")}>＋<span>Agregar</span></button>
        <button className={tab === "search" ? "active" : ""} onClick={() => setTab("search")}>⌕<span>Buscar</span></button>
        <button className={tab === "service" ? "active" : ""} onClick={() => setTab("service")}>♫<span>Culto</span></button>
        <button className={tab === "config" ? "active" : ""} onClick={() => setTab("config")}>⚙<span>Config</span></button>
      </nav>
    </main>
  );
}
