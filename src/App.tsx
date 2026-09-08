import { lazy, Suspense, useState } from "react";
import { ArrowLeft, Leaf, Map, Orbit } from "lucide-react";
import { GoogleMapView } from "./components/GoogleMapView";
import type { TwinLocation } from "./lib/ecotwin/types";
import "./App.css";

const EcoTwinView = lazy(() =>
  import("./components/EcoTwinView").then((module) => ({ default: module.EcoTwinView })),
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
      <header className="topbar">
        <a className="brand" href="/" aria-label="EcoTwin home">
          <span className="brand-mark"><Leaf size={20} /></span>
          <span>EcoTwin</span>
        </a>
        <div className="app-mode-switch" aria-label="Application view">
          <button type="button" className={mode === "real" ? "is-active" : ""} onClick={() => setMode("real")}>
            <Map size={15} /> Real View
          </button>
          <button type="button" disabled={!location} className={mode === "twin" ? "is-active" : ""} onClick={() => setMode("twin")}>
            <Orbit size={15} /> EcoTwin View
          </button>
        </div>
        {mode === "twin" ? (
          <button className="back-to-map" type="button" onClick={() => setMode("real")}><ArrowLeft size={16} /> Back to map</button>
        ) : (
          <span className="prototype-badge">Digital twin prototype</span>
        )}
      </header>
      <div className="view-stack">
        <div className={`view-pane ${mode === "real" ? "is-active" : ""}`}>
          <GoogleMapView onCreateTwin={createTwin} />
        </div>
        {location && (
          <div className={`view-pane ${mode === "twin" ? "is-active" : ""}`}>
            <Suspense fallback={<div className="twin-loading"><span />Building your environmental twin…</div>}>
              <EcoTwinView key={`${location.lat}-${location.lng}`} location={location} />
            </Suspense>
          </div>
        )}
      </div>
    </main>
  );
}

export default App;
