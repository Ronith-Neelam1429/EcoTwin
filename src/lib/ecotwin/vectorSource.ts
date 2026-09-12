import { VectorTile } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";
import type { Feature } from "geojson";
import { parseGeoNeighborhood } from "./geography";
import type { TwinLocation } from "./types";

const TILEJSON = "https://tiles.openfreemap.org/planet";
type TileMetadata = { tiles: string[]; maxzoom: number };
let metadata: Promise<TileMetadata> | undefined;
let retryAfter = 0;

async function get(url: string) {
  if (Date.now() < retryAfter) throw new Error("The map service is busy. Please retry in a minute.");
  let response: Response;
  try { response = await fetch(url, { signal: AbortSignal.timeout(20000) }); }
  catch { throw new Error("Map data could not be reached. Check your connection and retry."); }
  if (response.status === 429) retryAfter = Date.now() + 60000;
  if (!response.ok) throw new Error("Map data is temporarily unavailable. Please retry in a minute.");
  return response;
}

export function tilePosition(lng: number, lat: number, zoom: number) {
  const scale = 2 ** zoom, phi = lat * Math.PI / 180;
  return { x: Math.floor((lng + 180) / 360 * scale), y: Math.floor((1 - Math.asinh(Math.tan(phi)) / Math.PI) / 2 * scale) };
}

export function tileTags(layer: string, properties: Record<string, unknown>): Record<string, string> | null {
  const kind = String(properties.class ?? "");
  const subclass = String(properties.subclass ?? "");
  if (layer === "poi" && (kind === "tree" || subclass === "tree" || properties.natural === "tree")) {
    return { natural: "tree" };
  }
  if (layer === "building") {
    if (properties.hide_3d === true) return null;
    return { building: "yes", render_height: String(properties.render_height ?? 6) };
  }
  if (layer === "transportation") {
    if (["rail", "aerialway", "ferry"].includes(kind) || properties.brunnel === "tunnel") return null;
    const highway = subclass || kind;
    return {
      highway,
      class: kind,
      width: String(properties.width ?? ""),
      lanes: String(properties.lanes ?? ""),
      "lanes:forward": String(properties["lanes:forward"] ?? ""),
      "lanes:backward": String(properties["lanes:backward"] ?? ""),
      service: String(properties.service ?? ""),
      oneway: String(properties.oneway ?? ""),
      shoulder: String(properties.shoulder ?? ""),
      "shoulder:left": String(properties["shoulder:left"] ?? ""),
      "shoulder:right": String(properties["shoulder:right"] ?? ""),
      parking: String(properties.parking ?? ""),
      "parking:lane:both": String(properties["parking:lane:both"] ?? ""),
      "parking:lane:left": String(properties["parking:lane:left"] ?? ""),
      "parking:lane:right": String(properties["parking:lane:right"] ?? ""),
    };
  }
  if (layer === "landcover" || layer === "landuse" || layer === "park") {
    if (kind === "tree" || subclass === "tree") return { natural: "tree" };
    if (["wood", "forest", "orchard"].includes(kind)) return { natural: "wood" };
    if (["grass", "grassland", "meadow", "garden", "park", "cemetery", "recreation_ground", "village_green", "golf_course"].includes(kind) || layer === "park") return { landuse: "grass" };
    if (kind === "parking") return { amenity: "parking" };
  }
  return null;
}

export async function loadVectorNeighborhood(location: TwinLocation) {
  metadata ??= get(TILEJSON).then((r) => r.json()).catch((error) => { metadata = undefined; throw error; });
  const source = await metadata;
  if (!Array.isArray(source.tiles) || !Number.isFinite(source.maxzoom)) throw new Error("Map source configuration is unavailable.");
  const zoom = Math.min(source.maxzoom, 14);
  const fetchRadius = location.radiusMeters + 20;
  const dLat = fetchRadius / 111320, dLng = dLat / Math.cos(location.lat * Math.PI / 180);
  const nw = tilePosition(location.lng - dLng, location.lat + dLat, zoom);
  const se = tilePosition(location.lng + dLng, location.lat - dLat, zoom);
  const features: Feature[] = [];
  // Fetch sequentially to limit
  // public-service load; HTTP caching reuses them for nearby locations.
  for (let x = nw.x; x <= se.x; x++) for (let y = nw.y; y <= se.y; y++) {
    const tileX = (x + 2 ** zoom) % (2 ** zoom);
    const url = source.tiles[0].replace("{z}", String(zoom)).replace("{x}", String(tileX)).replace("{y}", String(y));
    if (new URL(url).origin !== "https://tiles.openfreemap.org") throw new Error("Unexpected map source.");
    const tile = new VectorTile(new PbfReader(await (await get(url)).arrayBuffer()));
    for (const layerName of ["landcover", "landuse", "park", "poi", "transportation", "building"]) {
      const layer = tile.layers[layerName];
      if (!layer) continue;
      for (let i = 0; i < layer.length; i++) {
        const raw = layer.feature(i);
        const tags = tileTags(layerName, raw.properties);
        if (!tags) continue;
        const feature = raw.toGeoJSON(tileX, y, zoom);
        feature.id = `${layerName}/${raw.id ?? `${x}-${y}-${i}`}`;
        feature.properties = tags;
        features.push(feature);
      }
    }
  }
  return parseGeoNeighborhood({ type: "FeatureCollection", features }, location);
}
