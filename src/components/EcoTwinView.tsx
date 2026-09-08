import { useMemo, useState } from "react";
import { Compass, MapPin } from "lucide-react";
import { applyIntervention } from "../lib/ecotwin/applyIntervention";
import { generateGrid } from "../lib/ecotwin/generateGrid";
import { calculateMetrics } from "../lib/ecotwin/simulation";
import type { EcoCell, InterventionTool, TwinLocation, ViewMode } from "../lib/ecotwin/types";
import { EcoTwinScene } from "./EcoTwinScene";
import { EcoTwinSidebar } from "./EcoTwinSidebar";
import { MetricsPanel } from "./MetricsPanel";
import { ViewModeToggle } from "./ViewModeToggle";

export function EcoTwinView({ location }: { location: TwinLocation }) {
  const [baseline] = useState<EcoCell[]>(() => generateGrid(location));
  const [cells, setCells] = useState<EcoCell[]>(() => baseline.map((cell) => ({ ...cell })));
  const [selectedTool, setSelectedTool] = useState<InterventionTool>("tree");
  const [viewMode, setViewMode] = useState<ViewMode>("surface");
  const baselineMetrics = useMemo(() => calculateMetrics(baseline), [baseline]);
  const currentMetrics = useMemo(() => calculateMetrics(cells), [cells]);

  function updateCell(id: string) {
    setCells((current) => current.map((cell) => (cell.id === id ? applyIntervention(cell, selectedTool) : cell)));
  }

  function resetGrid() {
    setCells(baseline.map((cell) => ({ ...cell })));
  }

  return (
    <section className="twin-workspace">
      <div className="twin-toolbar">
        <div className="twin-location">
          <span className="twin-location-icon"><MapPin size={17} /></span>
          <div>
            <span className="panel-kicker">Selected location · 300m × 300m</span>
            <strong>{location.lat.toFixed(5)}, {location.lng.toFixed(5)}</strong>
          </div>
          <span className="heading-readout"><Compass size={14} /> {Math.round(location.heading)}°</span>
        </div>
        <ViewModeToggle value={viewMode} onChange={setViewMode} />
      </div>

      <div className="twin-layout">
        <EcoTwinSidebar selectedTool={selectedTool} onSelectTool={setSelectedTool} onReset={resetGrid} />
        <EcoTwinScene cells={cells} viewMode={viewMode} onCellClick={updateCell} />
        <MetricsPanel current={currentMetrics} baseline={baselineMetrics} />
      </div>
    </section>
  );
}
