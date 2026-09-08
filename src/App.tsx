import { useEffect, useRef, useState } from "react";
import { importLibrary, setOptions } from "@googlemaps/js-api-loader";
import { Leaf, LocateFixed, MapPin } from "lucide-react";
import "./App.css";

const BELLEVUE_COLLEGE = { lat: 47.5847, lng: -122.1497 };
const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY?.trim();

type MapStatus = "loading" | "ready" | "missing-key" | "error";

function GoogleMap() {
  const mapElement = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<google.maps.Map | null>(null);
  const [status, setStatus] = useState<MapStatus>(
    GOOGLE_MAPS_API_KEY ? "loading" : "missing-key",
  );

  useEffect(() => {
    if (!GOOGLE_MAPS_API_KEY) return;

    let cancelled = false;

    async function initializeMap() {
      try {
        setOptions({ key: GOOGLE_MAPS_API_KEY, v: "weekly" });
        const { Map } = await importLibrary("maps");

        if (cancelled || !mapElement.current) return;

        mapInstance.current = new Map(mapElement.current, {
          center: BELLEVUE_COLLEGE,
          zoom: 16,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          zoomControl: true,
          gestureHandling: "greedy",
          styles: [
            {
              featureType: "poi.business",
              stylers: [{ visibility: "off" }],
            },
          ],
        });
        setStatus("ready");
      } catch (error) {
        console.error("Google Maps failed to load", error);
        if (!cancelled) setStatus("error");
      }
    }

    void initializeMap();

    return () => {
      cancelled = true;
      mapInstance.current = null;
    };
  }, []);

  function recenterMap() {
    mapInstance.current?.panTo(BELLEVUE_COLLEGE);
    mapInstance.current?.setZoom(16);
  }

  return (
    <div className="map-stage">
      <div ref={mapElement} className="google-map" aria-label="Google map of Bellevue College" />

      {status !== "ready" && (
        <div className="map-status" role="status">
          {status === "loading" && <span>Loading Google Maps…</span>}
          {status === "missing-key" && (
            <>
              <div className="status-icon"><MapPin size={22} /></div>
              <strong>Google Maps is ready to connect</strong>
              <span>Add your API key to the local environment file, then restart the app.</span>
              <code>VITE_GOOGLE_MAPS_API_KEY=your_key_here</code>
            </>
          )}
          {status === "error" && (
            <>
              <strong>The map could not load</strong>
              <span>Check that the key is valid and Maps JavaScript API is enabled.</span>
            </>
          )}
        </div>
      )}

      {status === "ready" && (
        <>
          <div className="location-pill">
            <MapPin size={15} />
            Bellevue College
          </div>
          <button className="recenter-button" type="button" onClick={recenterMap} aria-label="Recenter map">
            <LocateFixed size={19} />
          </button>
        </>
      )}
    </div>
  );
}

function App() {
  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="EcoTwin home">
          <span className="brand-mark"><Leaf size={20} /></span>
          <span>EcoTwin</span>
        </a>
        <span className="prototype-badge">Digital twin prototype</span>
      </header>
      <GoogleMap />
    </main>
  );
}

export default App;
