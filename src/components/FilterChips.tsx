import type { FilterGroup } from "@/types";

export function FilterChips({
  group,
  selected,
  onChange,
  forceMultiSelect = false,
  invalid = false
}: {
  group: FilterGroup;
  selected: string[];
  onChange: (next: string[]) => void;
  forceMultiSelect?: boolean;
  invalid?: boolean;
}) {
  function toggle(optionId: string) {
    if (group.multiSelect || forceMultiSelect) {
      onChange(selected.includes(optionId) ? selected.filter((id) => id !== optionId) : [...selected, optionId]);
    } else {
      onChange(selected.includes(optionId) ? [] : [optionId]);
    }
  }

  return (
    <div className={`filter-group ${invalid ? "filter-group-invalid" : ""}`}>
      <div className="field-label">{group.label}</div>
      <div className="chips">
        {group.options.filter((option) => option.active).map((option) => (
          <button
            key={option.id}
            type="button"
            className={`chip ${selected.includes(option.id) ? "selected" : ""}`}
            onClick={() => toggle(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>
      {invalid && <div className="field-error">Selecciona al menos una opción.</div>}
    </div>
  );
}
