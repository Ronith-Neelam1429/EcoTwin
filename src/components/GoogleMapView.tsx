import { useEffect, useRef, useState } from "react";
import { importLibrary, setOptions } from "@googlemaps/js-api-loader";
import { Box, LocateFixed, MapPin, PersonStanding, X } from "lucide-react";
import type { TwinLocation } from "../lib/ecotwin/types";

const SEATTLE = { lat: 47.6062, lng: -122.3321 };
const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY?.trim();
let mapsLoaderConfigured = false;

type MapStatus = "loading" | "ready" | "missing-key" | "error";

type GoogleMapViewProps = {
  onCreateTwin: (location: TwinLocation) => void;
};

async function getInitialLocation(geocoder: google.maps.Geocoder) {
  const position = await new Promise<GeolocationPosition | null>((resolve) => {
    if (!navigator.geolocation) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, () => resolve(null), {
      enableHighAccuracy: true,
      timeout: 8000,
      maximumAge: 300000,
    });
  });

  if (!position) return { center: SEATTLE, label: "Seattle" };

  const center = {
    lat: position.coords.latitude,
    lng: position.coords.longitude,
  };
  try {
    const response = await geocoder.geocode({ location: center });
    return {
      center,
      label: response.results[0]?.formatted_address ?? "Your location",
    };
  } catch {
    return { center, label: "Your location" };
  }
}

function toLiteral(location: google.maps.LatLng | google.maps.LatLngLiteral) {
  if (typeof (location as google.maps.LatLng).lat === "function") {
    const point = location as google.maps.LatLng;
    return { lat: point.lat(), lng: point.lng() };
  }
  return location as google.maps.LatLngLiteral;
}

export function GoogleMapView({ onCreateTwin }: GoogleMapViewProps) {
  const mapElement = useRef<HTMLDivElement>(null);
  const autocompleteMount = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<google.maps.Map | null>(null);
  const selectedLocation = useRef<
    google.maps.LatLng | google.maps.LatLngLiteral
  >(SEATTLE);
  const [status, setStatus] = useState<MapStatus>(
    GOOGLE_MAPS_API_KEY ? "loading" : "missing-key",
  );
  const [placeName, setPlaceName] = useState("Seattle");
  const [addressWasTyped, setAddressWasTyped] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [streetViewActive, setStreetViewActive] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!GOOGLE_MAPS_API_KEY) return;
    let cancelled = false;

    async function initializeMap() {
      try {
        if (!mapsLoaderConfigured) {
          setOptions({ key: GOOGLE_MAPS_API_KEY, v: "weekly" });
          mapsLoaderConfigured = true;
        }
        const [{ Map }, { PlaceAutocompleteElement }] = await Promise.all([
          importLibrary("maps"),
          importLibrary("places"),
        ]);

        if (cancelled || !mapElement.current || !autocompleteMount.current)
          return;

        const geocoder = new google.maps.Geocoder();
        const initialLocation = await getInitialLocation(geocoder);
        if (cancelled || !mapElement.current) return;
        selectedLocation.current = initialLocation.center;
        setPlaceName(initialLocation.label);

        const map = new Map(mapElement.current, {
          center: initialLocation.center,
          zoom: 16,
          mapTypeControl: false,
          streetViewControl: true,
          fullscreenControl: true,
          zoomControl: true,
          gestureHandling: "greedy",
          styles: [
            { featureType: "poi.business", stylers: [{ visibility: "off" }] },
          ],
        });
        mapInstance.current = map;

        const autocomplete = new PlaceAutocompleteElement({
          placeholder: "Search an address or place",
          requestedRegion: "us",
          locationBias: initialLocation.center,
        });

        autocomplete.addEventListener("gmp-select", async (event) => {
          try {
            const place = event.placePrediction.toPlace();
            await place.fetchFields({
              fields: [
                "displayName",
                "formattedAddress",
                "location",
                "viewport",
              ],
            });
            if (!place.location || !mapInstance.current) return;

            selectedLocation.current = place.location;
            setPlaceName(
              place.formattedAddress ??
                place.displayName ??
                "Selected location",
            );
            setAddressWasTyped(true);
            setSearchError(false);
            setMessage("");
            mapInstance.current.getStreetView().setVisible(false);

            if (place.viewport) mapInstance.current.fitBounds(place.viewport);
            else {
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

        const panorama = map.getStreetView();
        panorama.addListener("visible_changed", () => {
          if (cancelled) return;
          setStreetViewActive(panorama.getVisible());
          if (panorama.getVisible()) setMessage("");
        });
        panorama.addListener("position_changed", () => {
          const position = panorama.getPosition();
          if (position && panorama.getVisible())
            selectedLocation.current = position;
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
    selectedLocation.current = SEATTLE;
    setPlaceName("Seattle");
    setAddressWasTyped(false);
    mapInstance.current?.getStreetView().setVisible(false);
    mapInstance.current?.panTo(SEATTLE);
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

    setMessage("Finding nearby Street View…");
    try {
      const { StreetViewService, StreetViewPreference } =
        await importLibrary("streetView");
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
      setMessage("");
    } catch (error) {
      console.error("Street View failed to load", error);
      setMessage("Street View is not available near this location.");
    }
  }

  function createDigitalTwin() {
    const map = mapInstance.current;
    if (!map) return;
    const panorama = map.getStreetView();
    const rawPosition = panorama.getVisible()
      ? panorama.getPosition()
      : selectedLocation.current;
    if (!rawPosition) return;

    const position = toLiteral(rawPosition);
    const pov = panorama.getPov();
    onCreateTwin({
      lat: position.lat,
      lng: position.lng,
      heading: panorama.getVisible() ? pov.heading : 0,
      pitch: panorama.getVisible() ? pov.pitch : 0,
      radiusMeters: 150,
      ...(addressWasTyped ? { address: placeName } : {}),
    });
  }

  return (
    <section className="map-stage">
      <div
        ref={mapElement}
        className="google-map"
        aria-label="Google map and Street View location picker"
      />

      <div className={`search-panel ${status === "ready" ? "is-visible" : ""}`}>
        <div ref={autocompleteMount} className="autocomplete-mount" />
        {searchError && (
          <span className="search-error">
            Enable Places API for address search.
          </span>
        )}
      </div>

      {status !== "ready" && (
        <div className="map-status" role="status">
          {status === "loading" && <span>Loading Google Maps…</span>}
          {status === "missing-key" && (
            <>
              <div className="status-icon">
                <MapPin size={22} />
              </div>
              <strong>Google Maps is ready to connect</strong>
              <span>
                Add your API key to the local environment file, then restart the
                app.
              </span>
              <code>VITE_GOOGLE_MAPS_API_KEY=your_key_here</code>
            </>
          )}
          {status === "error" && (
            <>
              <strong>The map could not load</strong>
              <span>
                Check that the key is valid and Maps JavaScript API is enabled.
              </span>
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
          <button
            className="recenter-button"
            type="button"
            onClick={recenterMap}
            aria-label="Recenter map"
          >
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
          <button
            className="create-twin-button"
            type="button"
            onClick={createDigitalTwin}
          >
            <Box size={18} />
            Create Digital Twin
          </button>
          {message && <div className="street-view-message">{message}</div>}
        </>
      )}
    </section>
  );
}
