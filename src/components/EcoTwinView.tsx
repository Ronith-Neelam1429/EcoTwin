import { useEffect, useMemo, useState } from "react";
import { Compass, MapPin } from "lucide-react";
import { applyIntervention } from "../lib/ecotwin/applyIntervention";
import { loadNeighborhood, type Neighborhood } from "../lib/ecotwin/geography";
import { calculateMetrics } from "../lib/ecotwin/simulation";
import type {
  EcoCell,
  InterventionTool,
  TwinLocation,
  ViewMode,
} from "../lib/ecotwin/types";
import { EcoTwinScene } from "./EcoTwinScene";
import { EcoTwinSidebar } from "./EcoTwinSidebar";
import { MetricsPanel } from "./MetricsPanel";
import { ViewModeToggle } from "./ViewModeToggle";

export function EcoTwinView({ location }: { location: TwinLocation }) {
  const [result, setResult] = useState<Neighborhood | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    loadNeighborhood(location)
      .then((data) => {
        if (active) setResult(data);
      })
      .catch((reason: unknown) => {
        if (active)
          setError(
            reason instanceof Error
              ? reason.message
              : "Map data is unavailable. Please retry.",
          );
      });
    return () => {
      active = false;
    };
  }, [location, attempt]);

  if (!result)
    return (
      <div className="geography-loading" role="status">
        <MapPin size={28} />
        <h2>
          {error
            ? "Neighborhood data unavailable"
            : "Loading your neighborhood"}
        </h2>
        <p>
          {error ||
            "Finding real building outlines, roads, and mapped green areas within 150 metres of your location."}
        </p>
        {error ? (
          <button
            type="button"
            onClick={() => {
              setError("");
              setAttempt((n) => n + 1);
            }}
          >
            Retry map data
          </button>
        ) : (
          <span className="loading-track" />
        )}
        <small>
          OpenStreetMap · Geometry only; no Street View images are
          reconstructed.
        </small>
      </div>
    );
  return <LoadedTwin location={location} neighborhood={result} />;
}

function LoadedTwin({
  location,
  neighborhood,
}: {
  location: TwinLocation;
  neighborhood: Neighborhood;
}) {
  const baseline = neighborhood.baseline;
  const [cells, setCells] = useState<EcoCell[]>(() =>
    baseline.map((cell) => ({ ...cell })),
  );
  const [selectedTool, setSelectedTool] = useState<InterventionTool>("tree");
  const [viewMode, setViewMode] = useState<ViewMode>("surface");
  const [editMessage, setEditMessage] = useState("");
  const baselineMetrics = useMemo(() => calculateMetrics(baseline), [baseline]);
  const currentMetrics = useMemo(() => calculateMetrics(cells), [cells]);

  function updateCell(id: string) {
    const cell = cells.find((c) => c.id === id);
    if (!cell) return;
    if (selectedTool === "green_roof" && !cell.buildingId) {
      setEditMessage("Select a mapped building to add a green roof.");
      return;
    }
    if (
      cell.buildingId &&
      selectedTool !== "green_roof" &&
      selectedTool !== "erase"
    ) {
      setEditMessage(
        "This cell contains a building. Use Green Roof here, or select open ground.",
      );
      return;
    }
    setEditMessage("");
    setCells((current) =>
      current.map((cell) =>
        cell.id === id ? applyIntervention(cell, selectedTool) : cell,
      ),
    );
  }

  function resetGrid() {
    setCells(baseline.map((cell) => ({ ...cell })));
  }

  return (
    <section className="twin-workspace">
      <div className="twin-toolbar">
        <div className="twin-location">
          <span className="twin-location-icon">
            <MapPin size={17} />
          </span>
          <div>
            <span className="panel-kicker">
              Study area · 300m × 300m
            </span>
            <strong>
              {location.address ??
                `${location.lat.toFixed(5)}, ${location.lng.toFixed(5)}`}
            </strong>
          </div>
          <span className="heading-readout">
            <Compass size={14} /> {Math.round(location.heading)}°
          </span>
        </div>
        <ViewModeToggle value={viewMode} onChange={setViewMode} />
      </div>

      <div className="twin-layout">
        <EcoTwinSidebar
          selectedTool={selectedTool}
          onSelectTool={setSelectedTool}
          onReset={resetGrid}
        />
        <div className="geographic-scene">
          <EcoTwinScene
            cells={cells}
            viewMode={viewMode}
            onCellClick={updateCell}
            neighborhood={neighborhood}
            location={location}
          />
          <div className="geography-summary">
            <strong>
              {neighborhood.buildings} mapped buildings · {neighborhood.roads}{" "}
              road segments
            </strong>
            <span>
              {neighborhood.assumedHeights} heights estimated · Road widths
              approximate · Flat terrain
            </span>
            <span>
              {Math.round((neighborhood.unknownCells / 900) * 100)}% of grid has
              unmapped ground cover
            </span>
            {neighborhood.buildings === 0 && (
              <span>
                No building footprints are available here in OpenStreetMap.
              </span>
            )}
          </div>
          {editMessage && (
            <div className="edit-message" role="status">
              {editMessage}
            </div>
          )}
        </div>
        <MetricsPanel current={currentMetrics} baseline={baselineMetrics} />
      </div>
    </section>
  );
}
