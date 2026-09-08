import { Building2, Droplets, Eraser, Grid3X3, RotateCcw, TreePine } from "lucide-react";
import type { InterventionTool } from "../lib/ecotwin/types";

const TOOLS: { value: InterventionTool; label: string; detail: string; icon: typeof TreePine }[] = [
  { value: "tree", label: "Add Tree", detail: "Shade + canopy", icon: TreePine },
  { value: "rain_garden", label: "Rain Garden", detail: "Capture runoff", icon: Droplets },
  { value: "green_roof", label: "Green Roof", detail: "Cool buildings", icon: Building2 },
  { value: "permeable_pavement", label: "Permeable", detail: "Improve infiltration", icon: Grid3X3 },
  { value: "erase", label: "Restore Cell", detail: "Return to baseline", icon: Eraser },
];

type EcoTwinSidebarProps = {
  selectedTool: InterventionTool;
  onSelectTool: (tool: InterventionTool) => void;
  onReset: () => void;
};

export function EcoTwinSidebar({ selectedTool, onSelectTool, onReset }: EcoTwinSidebarProps) {
  return (
    <aside className="twin-sidebar">
      <div className="sidebar-heading">
        <span className="panel-kicker">Interventions</span>
        <h2>Redesign this place</h2>
        <p>Select a tool, then click cells in the scene.</p>
      </div>

      <div className="tool-list">
        {TOOLS.map(({ value, label, detail, icon: Icon }) => (
          <button
            key={value}
            type="button"
            className={`tool-button ${selectedTool === value ? "is-active" : ""}`}
            onClick={() => onSelectTool(value)}
          >
            <span className={`tool-icon tool-${value}`}><Icon size={18} /></span>
            <span><strong>{label}</strong><small>{detail}</small></span>
          </button>
        ))}
      </div>

      <button className="reset-button" type="button" onClick={onReset}>
        <RotateCcw size={16} /> Reset all changes
      </button>
    </aside>
  );
}
