import {
  Building2,
  Droplets,
  Eraser,
  Grid3X3,
  RotateCcw,
  TreePine,
} from "lucide-react";
import type { ReactNode } from "react";
import type { InterventionTool } from "../lib/ecotwin/types";

const TOOLS: {
  value: InterventionTool;
  label: string;
  detail: string;
  icon: typeof TreePine;
}[] = [
  {
    value: "tree",
    label: "Mature Tree",
    detail: "Tree + soil planting area",
    icon: TreePine,
  },
  {
    value: "rain_garden",
    label: "Rain Garden",
    detail: "Store rain in this cell",
    icon: Droplets,
  },
  {
    value: "green_roof",
    label: "Green Roof",
    detail: "Cool buildings",
    icon: Building2,
  },
  {
    value: "permeable_pavement",
    label: "Permeable",
    detail: "Improve infiltration",
    icon: Grid3X3,
  },
  {
    value: "erase",
    label: "Restore Cell",
    detail: "Return to baseline",
    icon: Eraser,
  },
];

type EcoTwinSidebarProps = {
  selectedTool: InterventionTool;
  onSelectTool: (tool: InterventionTool) => void;
  onReset: () => void;
  children?: ReactNode;
};

export function EcoTwinSidebar({
  selectedTool,
  onSelectTool,
  onReset,
  children,
}: EcoTwinSidebarProps) {
  return (
    <aside className="twin-sidebar">
      <div className="sidebar-heading">
        <span className="panel-kicker">Interventions</span>
        <h2>Design tools</h2>
        <p>Select a tool, then place it in the model.</p>
      </div>

      <div className="tool-list">
        {TOOLS.map(({ value, label, detail, icon: Icon }) => (
          <button
            key={value}
            type="button"
            className={`tool-button ${selectedTool === value ? "is-active" : ""}`}
            onClick={() => onSelectTool(value)}
          >
            <span className={`tool-icon tool-${value}`}>
              <Icon size={18} />
            </span>
            <span>
              <strong>{label}</strong>
              <small>{detail}</small>
            </span>
          </button>
        ))}
      </div>

      <button className="reset-button" type="button" onClick={onReset}>
        <RotateCcw size={16} /> Reset all changes
      </button>
      {children}
    </aside>
  );
}
