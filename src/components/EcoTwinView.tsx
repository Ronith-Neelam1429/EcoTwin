import { flushSync } from "react-dom";
import { RealisticView } from "./RealisticView";
import type { SceneCapture } from "./EcoTwinScene";
import { useEffect, useMemo, useRef, useState } from "react";
import { Compass, MapPin } from "lucide-react";
import { applyIntervention } from "../lib/ecotwin/applyIntervention";
import { loadNeighborhood, type Neighborhood } from "../lib/ecotwin/geography";
import { simulateScenario } from "../lib/ecotwin/simulation";
import type {
  EcoCell,
  InterventionTool,
  TwinLocation,
  ViewMode,
} from "../lib/ecotwin/types";
import { DEFAULT_SCENARIO, type ScenarioInputs } from "../lib/ecotwin/scenario";
import { loadLocalWeather, type LocalWeather } from "../lib/ecotwin/weather";
import { ScenarioControls } from "./ScenarioControls";
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
            (location.boundary
              ? "Finding real building outlines, roads, and mapped green areas inside your custom boundary."
              : `Finding real building outlines, roads, and mapped green areas within ${location.radiusMeters} metres of your location.`)}
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
  const captureRef = useRef<SceneCapture>(null);
  const baseline = neighborhood.baseline;
  const [cells, setCells] = useState<EcoCell[]>(() =>
    baseline.map((cell) => ({ ...cell })),
  );
  const [selectedTool, setSelectedTool] = useState<InterventionTool>("tree");
  const [viewMode, setViewMode] = useState<ViewMode>("surface");
  const [editMessage, setEditMessage] = useState("");
  const [inputs, setInputs] = useState<ScenarioInputs>({ ...DEFAULT_SCENARIO });
  const [weather, setWeather] = useState<LocalWeather | null>(null);
  const [weatherLoading, setWeatherLoading] = useState(true);
  const [weatherError, setWeatherError] = useState("");
  const [weatherAttempt, setWeatherAttempt] = useState(0);
  const [customized, setCustomized] = useState(false);
  const totalSelectedCoverage = baseline.reduce((sum, cell) => sum + cell.coverage, 0);
  const selectedAreaM2 = totalSelectedCoverage * 100;
  const unknownAreaFraction = totalSelectedCoverage
    ? baseline.reduce((sum, cell) => sum + (cell.surfaceType === "unknown" ? cell.coverage : 0), 0) / totalSelectedCoverage
    : 0;
  useEffect(() => {
    const controller = new AbortController();
    loadLocalWeather(location, controller.signal).then((data) => {
      if (controller.signal.aborted) return;
      setWeather(data);
      setInputs(data.inputs);
      setCustomized(false);
      setWeatherError("");
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setWeatherError(reason instanceof Error ? reason.message : "Weather could not be loaded.");
    }).finally(() => { if (!controller.signal.aborted) setWeatherLoading(false); });
    return () => controller.abort();
  }, [location, weatherAttempt]);
  const baselineRun = useMemo(() => simulateScenario(baseline, inputs), [baseline, inputs]);
  const currentRun = useMemo(() => simulateScenario(cells, inputs), [cells, inputs]);

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
              {location.boundary
                ? `Custom study area · ${Math.round(selectedAreaM2).toLocaleString()} m²`
                : `Study area · ${location.radiusMeters * 2}m × ${location.radiusMeters * 2}m`}
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
        <div className="twin-view-actions">
          <ViewModeToggle value={viewMode} onChange={setViewMode} />
          <RealisticView revision={cells.map((cell) => cell.surfaceType).join(',')} capture={async () => {
            flushSync(() => setViewMode("surface"));
            // The Three scene reconciles in its own React root. Let it commit the surface materials.
            await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
            if (!captureRef.current) throw new Error("The scene is still loading. Please retry.");
            return captureRef.current.capture();
          }} />
        </div>
      </div>

      <div className="twin-layout">
        <EcoTwinSidebar
          selectedTool={selectedTool}
          onSelectTool={setSelectedTool}
          onReset={resetGrid}
        >
          <ScenarioControls inputs={inputs} weather={weather} loading={weatherLoading} error={weatherError} customized={customized}
            onUseDefaults={() => { setInputs({ ...DEFAULT_SCENARIO }); setWeather(null); setCustomized(false); setWeatherError(""); }}
            onChange={(next) => { setInputs(next); setCustomized(true); }}
            onLoadWeather={() => { setWeatherLoading(true); setWeatherError(""); setWeatherAttempt((n) => n + 1); }} />
        </EcoTwinSidebar>
        <div className="geographic-scene">
          <EcoTwinScene
            captureRef={captureRef}
            cells={currentRun.cells}
            baselineCells={baselineRun.cells}
            rainfallMm={inputs.rainfallMm}
            viewMode={viewMode}
            selectedTool={selectedTool}
            onCellClick={updateCell}
            neighborhood={neighborhood}
            location={location}
          />
          <div className="geography-summary">
            <strong>{neighborhood.buildings} BLDG</strong>
            <span>{neighborhood.roads} ROAD</span>
            {neighborhood.parkingLots > 0 && <span>{neighborhood.parkingLots} PARKING</span>}
            {neighborhood.culDeSacs > 0 && <span>{neighborhood.culDeSacs} CUL-DE-SAC</span>}
            <span>{Math.round(unknownAreaFraction * 100)}% UNMAPPED</span>
            {neighborhood.buildings === 0 && (
              <span>No building footprints</span>
            )}
          </div>
          {editMessage && (
            <div className="edit-message" role="status">
              {editMessage}
            </div>
          )}
        </div>
        <MetricsPanel current={currentRun.metrics} baseline={baselineRun.metrics} />
      </div>
    </section>
  );
}
