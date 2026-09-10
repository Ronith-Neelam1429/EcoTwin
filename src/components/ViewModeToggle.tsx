import { Droplets, Layers3, SunMedium, ThermometerSun } from "lucide-react";
import type { ViewMode } from "../lib/ecotwin/types";

const MODES: { value: ViewMode; label: string; icon: typeof Layers3 }[] = [
  { value: "surface", label: "Surface", icon: Layers3 },
  { value: "temperature", label: "Heat map", icon: ThermometerSun },
  { value: "solar", label: "Sun & shade", icon: SunMedium },
  { value: "stormwater", label: "Stormwater", icon: Droplets },
];

export function ViewModeToggle({ value, onChange }: { value: ViewMode; onChange: (mode: ViewMode) => void }) {
  return (
    <div className="view-mode-toggle" aria-label="Environmental data view">
      {MODES.map(({ value: mode, label, icon: Icon }) => (
        <button key={mode} type="button" aria-pressed={value === mode} className={value === mode ? "is-active" : ""} onClick={() => onChange(mode)}>
          <Icon size={15} />
          {label}
        </button>
      ))}
    </div>
  );
}
