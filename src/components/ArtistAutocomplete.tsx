import { useMemo, useState } from "react";
import { canonicalArtistName, uniqueArtists } from "@/lib/artists";
import { normalizeTextKey } from "@/lib/text";

type Props = {
  value: string;
  artists: string[];
  onChange: (value: string) => void;
  invalid?: boolean;
  placeholder?: string;
  id?: string;
};

export function ArtistAutocomplete({ value, artists, onChange, invalid = false, placeholder = "Escribe o selecciona un artista", id }: Props) {
  const [focused, setFocused] = useState(false);
  const options = useMemo(() => uniqueArtists(artists), [artists]);
  const suggestions = useMemo(() => {
    const q = normalizeTextKey(value);
    const matches = q
      ? options.filter((artist) => normalizeTextKey(artist).includes(q))
      : options;
    return matches.slice(0, 8);
  }, [options, value]);

  function canonicalize() {
    const next = canonicalArtistName(value, options);
    if (next !== value) onChange(next);
  }

  return (
    <div className="artist-autocomplete">
      <input
        id={id}
        value={value}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          window.setTimeout(() => setFocused(false), 120);
          canonicalize();
        }}
        onChange={(event) => onChange(event.target.value)}
        className={invalid ? "input-invalid" : ""}
        placeholder={placeholder}
        autoComplete="off"
      />
      {focused && suggestions.length > 0 && (
        <div className="artist-suggestions" role="listbox" aria-label="Artistas registrados">
          {suggestions.map((artist) => (
            <button
              type="button"
              key={artist}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onChange(artist);
                setFocused(false);
              }}
            >
              {artist}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
