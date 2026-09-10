import { useEffect, useRef, useState } from "react";
import { importLibrary, setOptions } from "@googlemaps/js-api-loader";
import { Box, LocateFixed, MapPin, PersonStanding, Scaling, Square, Spline, Trash2, Undo2, X } from "lucide-react";
import type { GeoPoint, TwinLocation } from "../lib/ecotwin/types";

const SEATTLE = { lat: 47.6062, lng: -122.3321 };
const DEFAULT_AREA_METERS = 300;
const MIN_AREA_METERS = 100;
const MAX_AREA_METERS = 500;
const EARTH_RADIUS_METERS = 6378137;
const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY?.trim();
let mapsLoaderConfigured = false;

type MapStatus = "loading" | "ready" | "missing-key" | "error";
type AreaMode = "square" | "custom";

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

function squareBounds(center: google.maps.LatLngLiteral, sideMeters: number) {
  const half = sideMeters / 2;
  const latDelta = half / EARTH_RADIUS_METERS * 180 / Math.PI;
  const lngDelta = latDelta / Math.cos(center.lat * Math.PI / 180);
  return {
    north: center.lat + latDelta,
    south: center.lat - latDelta,
    east: center.lng + lngDelta,
    west: center.lng - lngDelta,
  };
}

function customAreaGeometry(points: GeoPoint[]) {
  const minLat = Math.min(...points.map((point) => point.lat));
  const maxLat = Math.max(...points.map((point) => point.lat));
  const minLng = Math.min(...points.map((point) => point.lng));
  const maxLng = Math.max(...points.map((point) => point.lng));
  const center = { lat: (minLat + maxLat) / 2, lng: (minLng + maxLng) / 2 };
  const heightMeters = (maxLat - minLat) * Math.PI / 180 * EARTH_RADIUS_METERS;
  const widthMeters = (maxLng - minLng) * Math.PI / 180 * EARTH_RADIUS_METERS * Math.cos(center.lat * Math.PI / 180);
  const projected = points.map((point) => ({
    x: (point.lng - center.lng) * Math.PI / 180 * EARTH_RADIUS_METERS * Math.cos(center.lat * Math.PI / 180),
    y: (point.lat - center.lat) * Math.PI / 180 * EARTH_RADIUS_METERS,
  }));
  const areaMeters2 = Math.abs(projected.reduce((sum, point, index) => {
    const next = projected[(index + 1) % projected.length];
    return sum + point.x * next.y - next.x * point.y;
  }, 0)) / 2;
  return {
    center,
    widthMeters,
    heightMeters,
    areaMeters2,
    radiusMeters: Math.max(10, Math.ceil(Math.max(widthMeters, heightMeters) / 20) * 10),
  };
}

function boundaryCrossesItself(points: GeoPoint[]) {
  const orientation = (a: GeoPoint, b: GeoPoint, c: GeoPoint) =>
    Math.sign((b.lng - a.lng) * (c.lat - a.lat) - (b.lat - a.lat) * (c.lng - a.lng));
  const intersects = (a: GeoPoint, b: GeoPoint, c: GeoPoint, d: GeoPoint) =>
    orientation(a, b, c) !== orientation(a, b, d) && orientation(c, d, a) !== orientation(c, d, b);
  return points.some((point, index) => {
    const nextIndex = (index + 1) % points.length;
    return points.some((other, otherIndex) => {
      const otherNextIndex = (otherIndex + 1) % points.length;
      if (index === otherIndex || index === otherNextIndex || nextIndex === otherIndex) return false;
      return intersects(point, points[nextIndex], other, points[otherNextIndex]);
    });
  });
}

export function GoogleMapView({ onCreateTwin }: GoogleMapViewProps) {
  const mapElement = useRef<HTMLDivElement>(null);
  const autocompleteMount = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<google.maps.Map | null>(null);
  const locationMarker = useRef<google.maps.Marker | null>(null);
  const studyArea = useRef<google.maps.Rectangle | null>(null);
  const customArea = useRef<google.maps.Polygon | null>(null);
  const boundaryMarkers = useRef<google.maps.Marker[]>([]);
  const areaSize = useRef(DEFAULT_AREA_METERS);
  const areaMode = useRef<AreaMode>("square");
  const customBoundary = useRef<GeoPoint[]>([]);
  const selectedLocation = useRef<
    google.maps.LatLng | google.maps.LatLngLiteral
  >(SEATTLE);
  const [status, setStatus] = useState<MapStatus>(
    GOOGLE_MAPS_API_KEY ? "loading" : "missing-key",
  );
  const [placeName, setPlaceName] = useState("Seattle");
  const [areaSizeMeters, setAreaSizeMeters] = useState(DEFAULT_AREA_METERS);
  const [selectionMode, setSelectionMode] = useState<AreaMode>("square");
  const [customBoundaryPoints, setCustomBoundaryPoints] = useState<GeoPoint[]>([]);
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
          mapTypeId: google.maps.MapTypeId.SATELLITE,
          tilt: 0,
          heading: 0,
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
        locationMarker.current = new google.maps.Marker({
          map,
          position: initialLocation.center,
          title: initialLocation.label,
          animation: google.maps.Animation.DROP,
        });
        studyArea.current = new google.maps.Rectangle({
          map,
          bounds: squareBounds(initialLocation.center, DEFAULT_AREA_METERS),
          clickable: false,
          fillColor: "#2f6fed",
          fillOpacity: 0.16,
          strokeColor: "#ffffff",
          strokeOpacity: 0.95,
          strokeWeight: 3,
        });
        customArea.current = new google.maps.Polygon({
          map,
          paths: [],
          clickable: false,
          fillColor: "#2f6fed",
          fillOpacity: 0.2,
          strokeColor: "#ffffff",
          strokeOpacity: 0.98,
          strokeWeight: 3,
          visible: false,
        });

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
            const selectedPoint = toLiteral(place.location);
            locationMarker.current?.setPosition(place.location);
            locationMarker.current?.setTitle(
              place.formattedAddress ?? place.displayName ?? "Selected location",
            );
            studyArea.current?.setBounds(squareBounds(selectedPoint, areaSize.current));
            updateCustomBoundary([]);
            setPlaceName(
              place.formattedAddress ??
                place.displayName ??
                "Selected location",
            );
            setAddressWasTyped(true);
            setSearchError(false);
            setMessage(areaMode.current === "custom" ? boundaryMessage(0) : "");
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

        map.addListener("click", async (event: google.maps.MapMouseEvent) => {
          if (!event.latLng) return;
          const point = toLiteral(event.latLng);
          if (areaMode.current === "custom") {
            const next = [...customBoundary.current, point];
            const geometry = customAreaGeometry(next);
            if (geometry.widthMeters > MAX_AREA_METERS || geometry.heightMeters > MAX_AREA_METERS) {
              setMessage(`Custom boundaries can be up to ${MAX_AREA_METERS}m wide and tall.`);
              return;
            }
            updateCustomBoundary(next);
            setMessage(boundaryMessage(next.length));
            return;
          }
          selectedLocation.current = point;
          locationMarker.current?.setPosition(point);
          locationMarker.current?.setTitle("Selected location");
          studyArea.current?.setBounds(squareBounds(point, areaSize.current));
          setAddressWasTyped(true);
          setMessage("");
          try {
            const response = await geocoder.geocode({ location: point });
            if (cancelled) return;
            const label = response.results[0]?.formatted_address ?? "Selected location";
            setPlaceName(label);
            locationMarker.current?.setTitle(label);
          } catch {
            if (!cancelled) setPlaceName("Selected location");
          }
        });

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
      locationMarker.current?.setMap(null);
      studyArea.current?.setMap(null);
      customArea.current?.setMap(null);
      boundaryMarkers.current.forEach((marker) => marker.setMap(null));
      locationMarker.current = null;
      studyArea.current = null;
      customArea.current = null;
      boundaryMarkers.current = [];
      mapInstance.current = null;
    };
    // The map owns these listeners for its lifetime; boundary state is read from refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function recenterMap() {
    selectedLocation.current = SEATTLE;
    setPlaceName("Seattle");
    setAddressWasTyped(false);
    mapInstance.current?.getStreetView().setVisible(false);
    mapInstance.current?.panTo(SEATTLE);
    mapInstance.current?.setZoom(16);
    mapInstance.current?.setTilt(0);
    mapInstance.current?.setHeading(0);
    locationMarker.current?.setPosition(SEATTLE);
    locationMarker.current?.setTitle("Seattle");
    studyArea.current?.setBounds(squareBounds(SEATTLE, areaSizeMeters));
    updateCustomBoundary([]);
    if (areaMode.current === "custom") setMessage(boundaryMessage(0));
  }

  function resizeStudyArea(sideMeters: number) {
    areaSize.current = sideMeters;
    setAreaSizeMeters(sideMeters);
    const center = toLiteral(selectedLocation.current);
    studyArea.current?.setBounds(squareBounds(center, sideMeters));
  }

  function boundaryMessage(pointCount: number) {
    if (pointCount >= 3) return `${pointCount} points selected. Drag a red point to reposition it, or add another point.`;
    if (pointCount) return `Add ${3 - pointCount} more ${pointCount === 2 ? "point" : "points"} to complete the boundary.`;
    return "Click the map to place the corners of your boundary.";
  }

  function rebuildBoundaryMarkers(points: GeoPoint[]) {
    boundaryMarkers.current.forEach((marker) => marker.setMap(null));
    const map = mapInstance.current;
    if (!map) {
      boundaryMarkers.current = [];
      return;
    }
    boundaryMarkers.current = points.map((point, index) => {
      let dragStart = point;
      const marker = new google.maps.Marker({
        map: areaMode.current === "custom" ? map : null,
        position: point,
        draggable: true,
        clickable: true,
        cursor: "grab",
        title: `Boundary point ${index + 1}. Drag to reposition.`,
        zIndex: 20,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 7,
          fillColor: "#e53935",
          fillOpacity: 1,
          strokeColor: "#ffffff",
          strokeOpacity: 1,
          strokeWeight: 2,
        },
      });
      marker.addListener("dragstart", () => {
        dragStart = customBoundary.current[index];
      });
      marker.addListener("drag", () => {
        const position = marker.getPosition();
        if (!position) return;
        const preview = customBoundary.current.map((current, pointIndex) =>
          pointIndex === index ? toLiteral(position) : current);
        customArea.current?.setPath(preview);
      });
      marker.addListener("dragend", () => {
        const position = marker.getPosition();
        if (!position) return;
        const next = customBoundary.current.map((current, pointIndex) =>
          pointIndex === index ? toLiteral(position) : current);
        const geometry = customAreaGeometry(next);
        if (geometry.widthMeters > MAX_AREA_METERS || geometry.heightMeters > MAX_AREA_METERS) {
          marker.setPosition(dragStart);
          customArea.current?.setPath(customBoundary.current);
          setMessage(`Custom boundaries can be up to ${MAX_AREA_METERS}m wide and tall.`);
          return;
        }
        if (next.length >= 3 && (geometry.areaMeters2 < 1 || boundaryCrossesItself(next))) {
          marker.setPosition(dragStart);
          customArea.current?.setPath(customBoundary.current);
          setMessage("That position would make the boundary invalid. Try dragging the point somewhere else.");
          return;
        }
        customBoundary.current = next;
        setCustomBoundaryPoints(next);
        customArea.current?.setPath(next);
        setMessage(boundaryMessage(next.length));
      });
      return marker;
    });
  }

  function updateCustomBoundary(points: GeoPoint[]) {
    customBoundary.current = points;
    setCustomBoundaryPoints(points);
    customArea.current?.setPath(points);
    rebuildBoundaryMarkers(points);
  }

  function setAreaSelectionMode(mode: AreaMode) {
    areaMode.current = mode;
    setSelectionMode(mode);
    const map = mapInstance.current;
    studyArea.current?.setVisible(mode === "square");
    customArea.current?.setVisible(mode === "custom");
    boundaryMarkers.current.forEach((marker) => marker.setMap(mode === "custom" ? map : null));
    locationMarker.current?.setMap(mode === "square" ? map : null);
    map?.setOptions({ draggableCursor: mode === "custom" ? "crosshair" : undefined });
    setMessage(mode === "custom" ? boundaryMessage(customBoundary.current.length) : "");
  }

  function undoCustomPoint() {
    const next = customBoundary.current.slice(0, -1);
    updateCustomBoundary(next);
    setMessage(boundaryMessage(next.length));
  }

  function clearCustomBoundary() {
    updateCustomBoundary([]);
    setMessage(boundaryMessage(0));
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
    const boundary = selectionMode === "custom" ? customBoundaryPoints : undefined;
    if (boundary && boundary.length < 3) {
      setMessage("Add at least 3 points to complete the boundary.");
      return;
    }
    const geometry = boundary ? customAreaGeometry(boundary) : null;
    if (geometry && geometry.areaMeters2 < 1) {
      setMessage("The boundary needs to enclose an area. Move or add a point and try again.");
      return;
    }
    if (boundary && boundaryCrossesItself(boundary)) {
      setMessage("Boundary lines cannot cross. Undo a point and trace around the outside edge.");
      return;
    }
    onCreateTwin({
      lat: geometry?.center.lat ?? position.lat,
      lng: geometry?.center.lng ?? position.lng,
      heading: panorama.getVisible() ? pov.heading : 0,
      pitch: panorama.getVisible() ? pov.pitch : 0,
      radiusMeters: geometry?.radiusMeters ?? areaSizeMeters / 2,
      ...(boundary ? { boundary } : {}),
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
          <div className="area-selector">
            <div className="area-selector-heading"><span><Scaling size={15} /> Model area</span></div>
            <div className="area-mode-toggle" aria-label="Study area shape">
              <button type="button" className={selectionMode === "square" ? "is-active" : ""} onClick={() => setAreaSelectionMode("square")}>
                <Square size={14} /> Square
              </button>
              <button type="button" className={selectionMode === "custom" ? "is-active" : ""} onClick={() => setAreaSelectionMode("custom")}>
                <Spline size={14} /> Draw border
              </button>
            </div>
            {selectionMode === "square" ? (
              <>
                <label htmlFor="study-area-size"><span>Square size</span><strong>{areaSizeMeters}m × {areaSizeMeters}m</strong></label>
                <input
                  id="study-area-size"
                  type="range"
                  min={MIN_AREA_METERS}
                  max={MAX_AREA_METERS}
                  step={20}
                  value={areaSizeMeters}
                  onChange={(event) => resizeStudyArea(Number(event.target.value))}
                  aria-valuetext={`${areaSizeMeters} metres square`}
                />
                <div className="area-range-labels"><span>{MIN_AREA_METERS}m</span><span>Maximum {MAX_AREA_METERS}m</span></div>
              </>
            ) : (
              <div className="draw-controls">
                <span>{customBoundaryPoints.length >= 3 ? `${customBoundaryPoints.length} boundary points` : "Click at least 3 points on the map"}</span>
                <div>
                  <button type="button" onClick={undoCustomPoint} disabled={!customBoundaryPoints.length}><Undo2 size={13} /> Undo</button>
                  <button type="button" onClick={clearCustomBoundary} disabled={!customBoundaryPoints.length}><Trash2 size={13} /> Clear</button>
                </div>
              </div>
            )}
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
            disabled={selectionMode === "custom" && customBoundaryPoints.length < 3}
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
