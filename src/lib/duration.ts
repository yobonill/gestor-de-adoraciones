export function sanitizeDurationSeconds(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return Math.round(numeric);
}

export function formatDuration(totalSeconds?: number): string {
  const seconds = sanitizeDurationSeconds(totalSeconds);
  if (!seconds) return "Sin duración";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

export function durationParts(totalSeconds?: number): { minutes: number; seconds: number } {
  const total = sanitizeDurationSeconds(totalSeconds);
  return { minutes: Math.floor(total / 60), seconds: total % 60 };
}

export function durationFromParts(minutes: number | string, seconds: number | string): number {
  const parsedMinutes = Math.max(0, Math.floor(Number(minutes) || 0));
  const parsedSeconds = Math.min(59, Math.max(0, Math.floor(Number(seconds) || 0)));
  return parsedMinutes * 60 + parsedSeconds;
}
