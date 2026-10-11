import { durationFromParts, durationParts, formatDuration } from "@/lib/duration";

export function DurationInput({ value, onChange, invalid = false, idPrefix = "duration", compact = false }: {
  value?: number;
  onChange: (seconds: number) => void;
  invalid?: boolean;
  idPrefix?: string;
  compact?: boolean;
}) {
  const parts = durationParts(value);
  return (
    <div className={`duration-input ${invalid ? "duration-input-invalid" : ""} ${compact ? "compact" : ""}`}>
      <div>
        <label htmlFor={`${idPrefix}-minutes`}>Minutos</label>
        <input
          id={`${idPrefix}-minutes`}
          type="number"
          min="0"
          step="1"
          inputMode="numeric"
          value={parts.minutes}
          onChange={(event) => onChange(durationFromParts(event.target.value, parts.seconds))}
        />
      </div>
      <div>
        <label htmlFor={`${idPrefix}-seconds`}>Segundos</label>
        <input
          id={`${idPrefix}-seconds`}
          type="number"
          min="0"
          max="59"
          step="1"
          inputMode="numeric"
          value={parts.seconds}
          onChange={(event) => onChange(durationFromParts(parts.minutes, event.target.value))}
        />
      </div>
      {!compact && <span className="duration-preview">{formatDuration(value)}</span>}
    </div>
  );
}
