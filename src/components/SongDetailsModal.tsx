import type { AppConfig, Song } from "@/types";
import { formatDuration } from "@/lib/duration";
import { getPrimaryUsableVideo } from "@/lib/videos";

function optionLabel(config: AppConfig, groupId: string, optionId: string) {
  return config.filterGroups.find((group) => group.id === groupId)?.options.find((option) => option.id === optionId)?.label || optionId;
}

export function SongDetailsModal({ song, config, onClose, selectedVideoId }: {
  song: Song;
  config: AppConfig;
  onClose: () => void;
  selectedVideoId?: string;
}) {
  const selectedVideo = song.videos.find((video) => video.id === selectedVideoId) || getPrimaryUsableVideo(song.videos) || song.videos[0];

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal song-details-modal" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <span className="eyebrow">Detalles de la canción</span>
            <h2>{song.title}</h2>
            <div className="song-artist">{song.artist || "Artista sin registrar"}</div>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Cerrar">×</button>
        </div>

        {song.status === "rejected" && (
          <div className="notice warning"><strong>Motivo del rechazo:</strong> {song.rejectionReason?.trim() || "Sin motivo registrado."}</div>
        )}
        {song.status === "blacklisted" && song.blacklistReason?.trim() && (
          <div className="notice warning"><strong>Motivo del blacklist:</strong> {song.blacklistReason}</div>
        )}

        {selectedVideo && (
          <div className="details-video-row">
            {selectedVideo.thumbnailUrl && <img src={selectedVideo.thumbnailUrl} alt="Miniatura del video" width={220} height={124} />}
            <div className="grow">
              <div><strong>Duración:</strong> {formatDuration(selectedVideo.durationSeconds)}</div>
              <div><strong>Tipo de video:</strong> {selectedVideo.videoTypeIds.length ? selectedVideo.videoTypeIds.map((id) => optionLabel(config, "video-type", id)).join(", ") : "Sin clasificar"}</div>
              <div><strong>Video principal:</strong> {selectedVideo.isPrimary ? "Sí" : "No"}</div>
              <a className="secondary-button details-open-video" href={selectedVideo.youtubeUrl} target="_blank" rel="noreferrer">▶ Abrir video</a>
            </div>
          </div>
        )}

        <div className="details-groups">
          {config.filterGroups.filter((group) => group.id !== "video-type").map((group) => {
            const selected = song.classifications[group.id] || [];
            if (!selected.length) return null;
            return (
              <div className="details-group" key={group.id}>
                <strong>{group.label}</strong>
                <div className="tag-row">
                  {selected.map((id) => <span className="tag" key={id}>{optionLabel(config, group.id, id)}</span>)}
                </div>
              </div>
            );
          })}
        </div>

        <div className="details-section">
          <h3>Letra</h3>
          {song.lyrics?.trim()
            ? <div className="lyrics-view">{song.lyrics}</div>
            : <p className="muted">No hay letra registrada para esta canción.</p>}
        </div>

        {song.notes?.trim() && (
          <div className="details-section">
            <h3>Notas</h3>
            <div className="lyrics-view compact-text">{song.notes}</div>
          </div>
        )}

        <div className="modal-actions">
          <button className="secondary" type="button" onClick={onClose}>Cerrar</button>
        </div>
      </div>
    </div>
  );
}
