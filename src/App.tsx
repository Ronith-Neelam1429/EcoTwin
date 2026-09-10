import { lazy, Suspense, useState } from "react";
import { Box, Map, Orbit } from "lucide-react";
import { GoogleMapView } from "./components/GoogleMapView";
import type { TwinLocation } from "./lib/ecotwin/types";
import "./App.css";

const EcoTwinView = lazy(() =>
  import("./components/EcoTwinView").then((module) => ({
    default: module.EcoTwinView,
  })),
);

function App() {
  const [mode, setMode] = useState<"real" | "twin">("real");
  const [location, setLocation] = useState<TwinLocation | null>(null);

  function createTwin(selectedLocation: TwinLocation) {
    setLocation(selectedLocation);
    setMode("twin");
  }

  return (
    <main className="app-shell">
      <header className="workspace-header">
        <div className="workspace-identity" aria-label="EcoTwin workspace">
          <span className="product-mark" aria-hidden="true"><Box size={14} /></span>
          <strong>ECOTWIN</strong>
        </div>
        <span className="header-divider" aria-hidden="true" />
        <span className="workspace-name">Neighborhood model</span>
        <nav className="app-mode-switch" aria-label="Workspace view">
          <button
            type="button"
            className={mode === "real" ? "is-active" : ""}
            onClick={() => setMode("real")}
          >
            <Map size={15} /> Map
          </button>
          <button
            type="button"
            disabled={!location}
            className={mode === "twin" ? "is-active" : ""}
            onClick={() => setMode("twin")}
          >
            <Orbit size={15} /> Model
          </button>
        </nav>
      </header>
      <div className="view-stack">
        <div className={`view-pane ${mode === "real" ? "is-active" : ""}`}>
          <GoogleMapView onCreateTwin={createTwin} />
        </div>
        {location && (
          <div className={`view-pane ${mode === "twin" ? "is-active" : ""}`}>
            <Suspense
              fallback={
                <div className="twin-loading">
                  <span />
                  Building your environmental twin…
                </div>
              }
            >
              <EcoTwinView
                key={`${location.lat}-${location.lng}-${JSON.stringify(location.boundary ?? [])}`}
                location={location}
              />
            </Suspense>
          </div>
        )}
      </div>
    </main>
  );
}

export default App;
