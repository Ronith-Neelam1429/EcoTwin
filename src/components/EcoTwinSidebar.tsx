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
  icon: typeof TreePine;
}[] = [
  {
    value: "tree",
    label: "Tree",
    icon: TreePine,
  },
  {
    value: "rain_garden",
    label: "Rain Garden",
    icon: Droplets,
  },
  {
    value: "green_roof",
    label: "Green Roof",
    icon: Building2,
  },
  {
    value: "permeable_pavement",
    label: "Permeable Ground",
    icon: Grid3X3,
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
        <h2>Add to model</h2>
        <p>Choose an item, then click the 3D view.</p>
      </div>

      <div className="tool-list">
        {TOOLS.map(({ value, label, icon: Icon }) => (
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
            </span>
          </button>
        ))}
      </div>

      <div className="edit-actions">
        <button className={`restore-button ${selectedTool === "erase" ? "is-active" : ""}`} type="button"
          onClick={() => onSelectTool("erase")}>
          <Eraser size={15} /> Restore one cell
        </button>
        <button className="reset-button" type="button" onClick={onReset}>
          <RotateCcw size={15} /> Reset design
        </button>
      </div>
      {children}
    </aside>
  );
}
