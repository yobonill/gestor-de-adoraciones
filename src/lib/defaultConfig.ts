import type { AppConfig } from "@/types";

export const DEFAULT_CONFIG: AppConfig = {
  filterGroups: [
    {
      id: "suitable-for",
      label: "Adecuada para",
      multiSelect: true,
      options: [
        { id: "birthday", label: "Cumpleaños", active: true },
        { id: "worship", label: "Adoración", active: true },
        { id: "prayer", label: "Oración", active: true },
        { id: "communion", label: "Santa Cena", active: true }
      ]
    },
    {
      id: "tempo",
      label: "Ritmo",
      multiSelect: false,
      options: [
        { id: "slow", label: "Lenta", active: true },
        { id: "medium", label: "Media", active: true },
        { id: "fast", label: "Rápida", active: true }
      ]
    },
    {
      id: "days",
      label: "Días",
      multiSelect: true,
      options: [
        { id: "saturday", label: "Sábado", active: true },
        { id: "sunday", label: "Domingo", active: true }
      ]
    },
    {
      id: "song-type",
      label: "Tipo de canción",
      multiSelect: true,
      options: [
        { id: "adoration", label: "Adoración", active: true },
        { id: "humiliation", label: "Humillación", active: true },
        { id: "exaltation", label: "Exaltación", active: true },
        { id: "animation", label: "Animación", active: true },
        { id: "reflection", label: "Reflexión", active: true }
      ]
    },
    {
      id: "video-type",
      label: "Tipo de video",
      multiSelect: true,
      options: [
        { id: "music-video", label: "Video musical", active: true },
        { id: "lyrics", label: "Canción con letra", active: true },
        { id: "karaoke", label: "Karaoke", active: true },
        { id: "live", label: "En vivo", active: true },
        { id: "instrumental", label: "Instrumental", active: true }
      ]
    }
  ]
};
