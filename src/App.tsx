import { useEffect, useRef, useState } from "react";
import { importLibrary, setOptions } from "@googlemaps/js-api-loader";
import { Leaf, LocateFixed, MapPin, PersonStanding, Search, X } from "lucide-react";
import "./App.css";

const BELLEVUE_COLLEGE = { lat: 47.5847, lng: -122.1497 };
const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY?.trim();

type MapStatus = "loading" | "ready" | "missing-key" | "error";

function GoogleMap() {
  const mapElement = useRef<HTMLDivElement>(null);
  const autocompleteMount = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<google.maps.Map | null>(null);
  const selectedLocation = useRef<google.maps.LatLng | google.maps.LatLngLiteral>(BELLEVUE_COLLEGE);
  const [status, setStatus] = useState<MapStatus>(
    GOOGLE_MAPS_API_KEY ? "loading" : "missing-key",
  );
  const [placeName, setPlaceName] = useState("Bellevue College");
  const [searchError, setSearchError] = useState(false);
  const [streetViewActive, setStreetViewActive] = useState(false);
  const [streetViewMessage, setStreetViewMessage] = useState("");

  useEffect(() => {
    if (!GOOGLE_MAPS_API_KEY) return;

    let cancelled = false;

    async function initializeMap() {
      try {
        setOptions({ key: GOOGLE_MAPS_API_KEY, v: "weekly" });
        const [{ Map }, { PlaceAutocompleteElement }] = await Promise.all([
          importLibrary("maps"),
          importLibrary("places"),
        ]);

        if (cancelled || !mapElement.current || !autocompleteMount.current) return;

        mapInstance.current = new Map(mapElement.current, {
          center: BELLEVUE_COLLEGE,
          zoom: 16,
          mapTypeControl: false,
          streetViewControl: true,
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

        const autocomplete = new PlaceAutocompleteElement({
          placeholder: "Search an address or place",
          requestedRegion: "us",
          locationBias: BELLEVUE_COLLEGE,
        });

        autocomplete.addEventListener("gmp-select", async (event) => {
          try {
            const place = event.placePrediction.toPlace();
            await place.fetchFields({
              fields: ["displayName", "formattedAddress", "location", "viewport"],
            });

            if (!place.location || !mapInstance.current) return;

            selectedLocation.current = place.location;
            setPlaceName(place.displayName ?? place.formattedAddress ?? "Selected location");
            setSearchError(false);
            setStreetViewMessage("");

            if (place.viewport) {
              mapInstance.current.fitBounds(place.viewport);
            } else {
              mapInstance.current.panTo(place.location);
              mapInstance.current.setZoom(17);
            }
          } catch (error) {
            console.error("Place details failed to load", error);
            setSearchError(true);
          }
        });

        autocomplete.addEventListener("gmp-error", () => setSearchError(true));
        autocompleteMount.current.replaceChildren(autocomplete);

        const panorama = mapInstance.current.getStreetView();
        panorama.addListener("visible_changed", () => {
          if (!cancelled) setStreetViewActive(panorama.getVisible());
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

  async function toggleStreetView() {
    const map = mapInstance.current;
    if (!map) return;

    const panorama = map.getStreetView();
    if (panorama.getVisible()) {
      panorama.setVisible(false);
      return;
    }

    setStreetViewMessage("Finding nearby Street View…");

    try {
      const { StreetViewService, StreetViewPreference } = await importLibrary("streetView");
      const response = await new StreetViewService().getPanorama({
        location: selectedLocation.current,
        radius: 250,
        preference: StreetViewPreference.BEST,
      });
      const location = response.data.location?.latLng;

      if (!location) throw new Error("No nearby Street View panorama");

      panorama.setPosition(location);
      panorama.setPov({ heading: 0, pitch: 0 });
      panorama.setVisible(true);
      setStreetViewMessage("");
    } catch (error) {
      console.error("Street View failed to load", error);
      setStreetViewMessage("Street View is not available near this location.");
    }
  }

  return (
    <div className="map-stage">
      <div ref={mapElement} className="google-map" aria-label="Google map of Bellevue College" />

      <div className={`search-panel ${status === "ready" ? "is-visible" : ""}`}>
        <Search className="search-icon" size={19} aria-hidden="true" />
        <div ref={autocompleteMount} className="autocomplete-mount" />
        {searchError && (
          <span className="search-error">Enable Places API for address search.</span>
        )}
      </div>

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
            {placeName}
          </div>
          <button className="recenter-button" type="button" onClick={recenterMap} aria-label="Recenter map">
            <LocateFixed size={19} />
          </button>
          <button
            className={`street-view-button ${streetViewActive ? "is-active" : ""}`}
            type="button"
            onClick={toggleStreetView}
          >
            {streetViewActive ? <X size={18} /> : <PersonStanding size={19} />}
            {streetViewActive ? "Exit Street View" : "Street View"}
          </button>
          {streetViewMessage && <div className="street-view-message">{streetViewMessage}</div>}
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
