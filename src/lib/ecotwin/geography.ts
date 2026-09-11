import osmtogeojson from "osmtogeojson";
import type { FeatureCollection } from "geojson";
import polygonClipping, { type Polygon, type MultiPolygon, type Pair } from "polygon-clipping";
import type { EcoCell, SurfaceType, TwinLocation } from "./types";
import { calculateCellEnvironment } from "./simulation";

// Scene units are 10 metres. X points east and Z points south; north is -Z.
export const CELL_METERS = 10;
export const GRID_SIZE = 30;
export const HALF_SIZE = GRID_SIZE / 2;
export type AreaFeature = {
  id: string;
  polygons: MultiPolygon;
  surface: "building" | "asphalt" | "grass" | "tree";
  kind: "building" | "road" | "cul_de_sac" | "parking_lot" | "parking_space" | "landscape";
  name?: string;
  height: number;
  heightSource: "tag" | "levels" | "assumed";
};
export type Neighborhood = {
  features: AreaFeature[];
  trees: { id: string; point: Pair }[];
  baseline: EcoCell[];
  buildings: number;
  roads: number;
  culDeSacs: number;
  parkingLots: number;
  mappedParkingSpaces: number;
  assumedHeights: number;
  unknownCells: number;
  gridSize: number;
  boundary: MultiPolygon;
  timestamp?: string;
};

const EARTH_RADIUS = 6378137;
const radians = Math.PI / 180;
function gridSizeFor(origin: TwinLocation) {
  return Math.max(1, Math.round(origin.radiusMeters * 2 / CELL_METERS));
}

function boundaryFor(halfSize: number): Polygon {
  return [[[-halfSize, -halfSize], [halfSize, -halfSize], [halfSize, halfSize], [-halfSize, halfSize], [-halfSize, -halfSize]]];
}

export function studyBoundary(origin: TwinLocation): MultiPolygon {
  if (origin.boundary && origin.boundary.length >= 3) {
    const ring = origin.boundary.map(({ lng, lat }) => project(lng, lat, origin));
    const first = ring[0], last = ring[ring.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) ring.push([...first]);
    return [[ring]];
  }
  return [boundaryFor(origin.radiusMeters / CELL_METERS)];
}

export function project(lng: number, lat: number, origin: TwinLocation): Pair {
  return [
    (lng - origin.lng) * radians * EARTH_RADIUS * Math.cos(origin.lat * radians) / CELL_METERS,
    -(lat - origin.lat) * radians * EARTH_RADIUS / CELL_METERS,
  ];
}

export function pointInRing([x, y]: Pair, ring: Pair[]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

export function contains(point: Pair, polygons: MultiPolygon) {
  return polygons.some(([outer, ...holes]) => pointInRing(point, outer) && !holes.some((hole) => pointInRing(point, hole)));
}

export function clip(polygons: MultiPolygon, halfSize = HALF_SIZE): MultiPolygon {
  return polygons.length ? polygonClipping.intersection(polygons, boundaryFor(halfSize)) : [];
}

function clipToBoundary(polygons: MultiPolygon, boundary: MultiPolygon): MultiPolygon {
  return polygons.length ? polygonClipping.intersection(polygons, boundary) : [];
}

function ringArea(ring: Pair[]) {
  return Math.abs(ring.reduce((sum, point, index) => {
    const next = ring[(index + 1) % ring.length];
    return sum + point[0] * next[1] - next[0] * point[1];
  }, 0)) / 2;
}

function polygonArea(polygons: MultiPolygon) {
  return polygons.reduce((total, [outer, ...holes]) =>
    total + ringArea(outer) - holes.reduce((sum, hole) => sum + ringArea(hole), 0), 0);
}

function circlePolygon([x, z]: Pair, radius: number, sides = 32): MultiPolygon {
  const ring = Array.from({ length: sides + 1 }, (_, index): Pair => {
    const angle = index / sides * Math.PI * 2;
    return [x + Math.cos(angle) * radius, z + Math.sin(angle) * radius];
  });
  return [[ring]];
}

export function cellPolygon(row: number, col: number, gridSize = GRID_SIZE): Polygon {
  const halfSize = gridSize / 2;
  const x = col - halfSize, z = row - halfSize;
  return [[[x, z], [x + 1, z], [x + 1, z + 1], [x, z + 1], [x, z]]];
}

export function cellAt(x: number, z: number, gridSize = GRID_SIZE) {
  const halfSize = gridSize / 2;
  const col = Math.min(gridSize - 1, Math.max(0, Math.floor(x + halfSize)));
  const row = Math.min(gridSize - 1, Math.max(0, Math.floor(z + halfSize)));
  return `${row}-${col}`;
}

export function parseMeters(value: string | undefined): number | undefined {
  if (!value) return;
  const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*(m|metres|meters|ft|feet|')?$/i);
  if (!match) return;
  const result = Number(match[1]) * (/^(ft|feet|')$/i.test(match[2] ?? "") ? 0.3048 : 1);
  return result > 0 && result < 1000 ? result : undefined;
}

export function buildingHeight(tags: Record<string, string>) {
  const height = parseMeters(tags.height);
  if (height) return { height: height / CELL_METERS, heightSource: "tag" as const };
  const levels = Number(tags["building:levels"]);
  if (Number.isFinite(levels) && levels > 0 && levels < 200) return { height: levels * 3 / CELL_METERS, heightSource: "levels" as const };
  const renderHeight = parseMeters(tags.render_height);
  if (renderHeight) return { height: renderHeight / CELL_METERS, heightSource: "assumed" as const };
  return { height: 0.6, heightSource: "assumed" as const };
}

const DEFAULT_ROAD_WIDTH_METERS: Record<string, number> = {
  motorway: 22,
  motorway_link: 7.5,
  trunk: 15,
  trunk_link: 7,
  primary: 11,
  primary_link: 7,
  secondary: 9,
  secondary_link: 6.5,
  tertiary: 7.5,
  tertiary_link: 6,
  residential: 6.5,
  living_street: 5.5,
  minor: 6,
  unclassified: 5.5,
  road: 6,
  busway: 7,
  service: 4.5,
  pedestrian: 4,
  track: 3.5,
  cycleway: 2.5,
  bridleway: 2,
  footway: 1.8,
  steps: 1.8,
  path: 1.5,
  corridor: 1.5,
  raceway: 10,
};

const SERVICE_ROAD_WIDTH_METERS: Record<string, number> = {
  parking_aisle: 5.5,
  alley: 4,
  driveway: 3.5,
  drive_through: 3.5,
  emergency_access: 4,
};

const ONEWAY_ROAD_WIDTH_METERS: Record<string, number> = {
  motorway: 11.5,
  trunk: 9,
  primary: 7,
  secondary: 6.5,
  tertiary: 5.5,
  residential: 4.5,
  living_street: 4.5,
  unclassified: 4.5,
  minor: 4.5,
  road: 4.5,
  service: 3.5,
};

function count(value: string | undefined) {
  if (!value?.trim()) return;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 && parsed < 20 ? parsed : undefined;
}

/** Returns the estimated paved width; tagged measurements always take priority. */
export function roadWidthMeters(tags: Record<string, string>) {
  const width = parseMeters(tags.width);
  if (width) return width;

  const highway = tags.highway || tags.class || "road";
  const forward = count(tags["lanes:forward"]), backward = count(tags["lanes:backward"]);
  const lanes = count(tags.lanes) ?? (forward || backward ? (forward ?? 0) + (backward ?? 0) : undefined);
  if (lanes) {
    const laneWidth = /^(motorway|trunk)/.test(highway) ? 3.6 : /^(primary|secondary)/.test(highway) ? 3.4 : 3.2;
    let estimated = lanes * laneWidth + (/^(motorway|trunk)/.test(highway) ? 2.4 : 0.4);
    const hasParkingLane = (value: string | undefined) => Boolean(value && !/^(no|none|separate)$/i.test(value));
    const parking = [tags.parking, tags["parking:lane:both"], tags["parking:lane:left"], tags["parking:lane:right"]];
    if (parking[0] === "both" || hasParkingLane(parking[1])) estimated += 4.4;
    else estimated += parking.slice(2).filter(hasParkingLane).length * 2.2;
    if (tags.shoulder === "both") estimated += 2.4;
    else if (tags.shoulder === "yes") estimated += 1.2;
    else estimated += [tags["shoulder:left"], tags["shoulder:right"]].filter((value) => value === "yes").length * 1.2;
    return Math.round(estimated * 100) / 100;
  }

  const oneWay = /^(yes|true|1|-1)$/i.test(tags.oneway ?? "");
  if (highway === "service" && tags.service) {
    const serviceWidth = SERVICE_ROAD_WIDTH_METERS[tags.service] ?? DEFAULT_ROAD_WIDTH_METERS.service;
    return oneWay ? Math.min(serviceWidth, ONEWAY_ROAD_WIDTH_METERS.service) : serviceWidth;
  }
  if (oneWay && ONEWAY_ROAD_WIDTH_METERS[highway]) return ONEWAY_ROAD_WIDTH_METERS[highway];
  return DEFAULT_ROAD_WIDTH_METERS[highway] ?? DEFAULT_ROAD_WIDTH_METERS.road;
}

function roadWidth(tags: Record<string, string>) {
  return roadWidthMeters(tags) / CELL_METERS;
}

function roadPolygons(points: Pair[], width: number, boundary: MultiPolygon): MultiPolygon {
  // Metric-width segments, joined by discs, preserve bends and intersection positions.
  const pieces: Polygon[] = [];
  points.forEach((p, i) => {
    const ring = Array.from({ length: 17 }, (_, j): Pair => [p[0] + Math.cos(j * Math.PI / 8) * width / 2, p[1] + Math.sin(j * Math.PI / 8) * width / 2]);
    pieces.push([ring]);
    if (!i) return;
    const a = points[i - 1], dx = p[0] - a[0], dz = p[1] - a[1];
    const length = Math.hypot(dx, dz);
    if (!length) return;
    const nx = -dz / length * width / 2, nz = dx / length * width / 2;
    pieces.push([[[a[0] + nx, a[1] + nz], [p[0] + nx, p[1] + nz], [p[0] - nx, p[1] - nz], [a[0] - nx, a[1] - nz], [a[0] + nx, a[1] + nz]]]);
  });
  return pieces.length ? clipToBoundary(polygonClipping.union(pieces[0], ...pieces.slice(1)), boundary) : [];
}

export function parseNeighborhood(data: Parameters<typeof osmtogeojson>[0], origin: TwinLocation): Neighborhood {
  return parseGeoNeighborhood(osmtogeojson(data, { flatProperties: true }), origin);
}

export function parseGeoNeighborhood(geojson: FeatureCollection, origin: TwinLocation): Neighborhood {
  const gridSize = gridSizeFor(origin);
  const halfSize = gridSize / 2;
  const boundary = studyBoundary(origin);
  const features: AreaFeature[] = [];
  const trees: Neighborhood["trees"] = [];
  let roads = 0;
  const explicitTurningCenters: Pair[] = [];

  // Count every road vertex so a terminal residential endpoint can be
  // distinguished from a junction when a source omits turning-circle nodes.
  const roadVertexCounts = new Map<string, number>();
  const vertexKey = ([x, z]: Pair) => `${x.toFixed(3)},${z.toFixed(3)}`;
  for (const feature of geojson.features) {
    const tags = (feature.properties ?? {}) as Record<string, string>;
    const geometry = feature.geometry;
    if (!geometry || !tags.highway || !["LineString", "MultiLineString"].includes(geometry.type)) continue;
    const lines = geometry.type === "LineString" ? [geometry.coordinates] : geometry.type === "MultiLineString" ? geometry.coordinates : [];
    for (const line of lines) for (const [lng, lat] of line) {
      const key = vertexKey(project(lng, lat, origin));
      roadVertexCounts.set(key, (roadVertexCounts.get(key) ?? 0) + 1);
    }
  }

  for (const feature of geojson.features) {
    const tags = (feature.properties ?? {}) as Record<string, string>;
    if (tags.tainted) continue; // Incomplete geometry cannot be presented as a footprint.
    const geometry = feature.geometry;
    const id = String(feature.id);
    if (!geometry) continue;
    if (geometry.type === "Point" && /^(turning_circle|turning_loop)$/.test(tags.highway ?? "")) {
      const point = project(geometry.coordinates[0], geometry.coordinates[1], origin);
      const diameter = parseMeters(tags.diameter) ?? parseMeters(tags.width) ?? 18;
      const polygons = clipToBoundary(circlePolygon(point, diameter / CELL_METERS / 2), boundary);
      if (polygons.length) {
        explicitTurningCenters.push(point);
        features.push({ id, polygons, surface: "asphalt", kind: "cul_de_sac", height: 0, heightSource: "assumed" });
      }
      continue;
    }
    if (geometry.type === "Point" && tags.natural === "tree") {
      const point = project(geometry.coordinates[0], geometry.coordinates[1], origin);
      if (contains(point, boundary)) trees.push({ id, point });
      continue;
    }

    let surface: AreaFeature["surface"] | undefined;
    if (tags.building && tags.building !== "no") surface = "building";
    else if (tags.highway || tags.amenity === "parking" || tags.amenity === "parking_space" || tags.landuse === "highway") surface = "asphalt";
    else if (tags.natural === "wood" || tags.landuse === "forest") surface = "tree";
    else if (/^(grass|meadow|recreation_ground|village_green)$/.test(tags.landuse ?? "") || /^(grassland|scrub)$/.test(tags.natural ?? "") || /^(park|garden|pitch)$/.test(tags.leisure ?? "")) surface = "grass";
    if (!surface) continue;

    let polygons: MultiPolygon = [];
    if (geometry.type === "Polygon" || geometry.type === "MultiPolygon") {
      const coordinates = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
      const projected = coordinates.map((polygon) => polygon.map((ring) => ring.map(([lng, lat]) => project(lng, lat, origin))));
      polygons = clipToBoundary(projected, boundary);
    } else if ((geometry.type === "LineString" || geometry.type === "MultiLineString") && tags.highway) {
      const lines = geometry.type === "LineString" ? [geometry.coordinates] : geometry.coordinates;
      polygons = lines.flatMap((line) => roadPolygons(line.map(([lng, lat]) => project(lng, lat, origin)), roadWidth(tags), boundary));
    }
    if (!polygons.length) continue;
    const duplicate = features.find((f) => f.id === id);
    if (duplicate) duplicate.polygons = polygonClipping.union(duplicate.polygons, polygons);
    else {
      if (tags.highway) roads++;
      const kind: AreaFeature["kind"] = surface === "building" ? "building"
        : tags.amenity === "parking_space" ? "parking_space"
          : tags.amenity === "parking" ? "parking_lot"
            : tags.highway ? "road" : "landscape";
      features.push({ id, polygons, surface, kind, name: tags.name, ...buildingHeight(tags) });
    }
  }

  // Generalized tile data often drops tagged turning-circle nodes. Add a
  // standard 18 m bulb only to isolated residential endpoints well inside the
  // study boundary; exact mapped circles above always take precedence.
  const inferredCenters: Pair[] = [];
  for (const feature of geojson.features) {
    const tags = (feature.properties ?? {}) as Record<string, string>;
    const geometry = feature.geometry;
    if (!geometry || !/^(residential|living_street)$/.test(tags.highway ?? "") || !["LineString", "MultiLineString"].includes(geometry.type)) continue;
    const lines = geometry.type === "LineString" ? [geometry.coordinates] : geometry.type === "MultiLineString" ? geometry.coordinates : [];
    for (const line of lines) for (const coordinates of [line[0], line[line.length - 1]]) {
      if (!coordinates) continue;
      const point = project(coordinates[0], coordinates[1], origin);
      if ((roadVertexCounts.get(vertexKey(point)) ?? 0) !== 1) continue;
      const radius = 0.9;
      const hasClearance = Array.from({ length: 8 }, (_, index) => index * Math.PI / 4)
        .every((angle) => contains([point[0] + Math.cos(angle) * radius, point[1] + Math.sin(angle) * radius], boundary));
      if (!hasClearance || explicitTurningCenters.some((center) => Math.hypot(center[0] - point[0], center[1] - point[1]) < radius)
        || inferredCenters.some((center) => Math.hypot(center[0] - point[0], center[1] - point[1]) < radius)) continue;
      inferredCenters.push(point);
      features.push({ id: `${String(feature.id)}-turnaround`, polygons: circlePolygon(point, radius), surface: "asphalt", kind: "cul_de_sac", height: 0, heightSource: "assumed" });
    }
  }

  // Ground cover first; paved surfaces next; footprints always take precedence.
  const priority = { grass: 0, tree: 1, asphalt: 2, building: 3 };
  features.sort((a, b) => priority[a.surface] - priority[b.surface]);
  const buildingBounds = features.filter((f) => f.surface === "building").map((feature) => {
    const points = feature.polygons.flat(2);
    return { feature, minX: Math.min(...points.map((p) => p[0])), maxX: Math.max(...points.map((p) => p[0])), minZ: Math.min(...points.map((p) => p[1])), maxZ: Math.max(...points.map((p) => p[1])) };
  });
  const baseline: EcoCell[] = Array.from({ length: gridSize ** 2 }, (_, index): EcoCell | null => {
    const row = Math.floor(index / gridSize), col = index % gridSize;
    const point: Pair = [col - halfSize + 0.5, row - halfSize + 0.5];
    const coverage = polygonArea(polygonClipping.intersection(boundary, cellPolygon(row, col, gridSize)));
    if (coverage <= 1e-6) return null;
    let surfaceType: SurfaceType = "unknown";
    let buildingId: string | undefined;
    for (const feature of features) {
      if (contains(point, feature.polygons)) {
        surfaceType = feature.surface;
        if (surfaceType === "building") buildingId = feature.id;
      }
    }
    // Reserve cells touched by a footprint too, so small houses cannot disappear
    // from editing just because their centre falls between grid sample points.
    if (!buildingId) {
      for (const { feature, minX, maxX, minZ, maxZ } of buildingBounds) {
        if (maxX <= point[0] - 0.5 || minX >= point[0] + 0.5 || maxZ <= point[1] - 0.5 || minZ >= point[1] + 0.5) continue;
        if (polygonClipping.intersection(feature.polygons, cellPolygon(row, col, gridSize)).length) {
          buildingId = feature.id;
          surfaceType = "building";
          break;
        }
      }
    }
    if (!buildingId && trees.some(({ point: p }) => cellAt(p[0], p[1], gridSize) === `${row}-${col}`)) surfaceType = "tree";
    return { id: `${row}-${col}`, row, col, surfaceType, baselineSurfaceType: surfaceType, elevation: 0, coverage, buildingId, ...calculateCellEnvironment(surfaceType) };
  }).filter((cell): cell is EcoCell => cell !== null);
  const buildings = features.filter((f) => f.surface === "building");
  return {
    features, trees, baseline, buildings: buildings.length, roads, gridSize, boundary,
    culDeSacs: features.filter((feature) => feature.kind === "cul_de_sac").length,
    parkingLots: features.filter((feature) => feature.kind === "parking_lot").length,
    mappedParkingSpaces: features.filter((feature) => feature.kind === "parking_space").length,
    assumedHeights: buildings.filter((f) => f.heightSource !== "tag").length,
    unknownCells: baseline.filter((c) => c.surfaceType === "unknown").length,
  };
}

export function neighborhoodQuery(location: TwinLocation) {
  if (!Number.isFinite(location.lat) || !Number.isFinite(location.lng) || Math.abs(location.lat) > 85 || Math.abs(location.lng) > 180) throw new Error("This location is outside the supported map area.");
  const queryRadius = location.radiusMeters + 50;
  const latDelta = queryRadius / EARTH_RADIUS / radians;
  const lngDelta = latDelta / Math.cos(location.lat * radians);
  const bounds = [location.lat - latDelta, location.lng - lngDelta, location.lat + latDelta, location.lng + lngDelta].join(",");
  return `[out:json][timeout:25];(nwr[building][building!=no](${bounds});way[highway](${bounds});nwr[highway~"^(turning_circle|turning_loop)$"](${bounds});nwr[landuse~"^(grass|meadow|forest|recreation_ground|village_green)$"](${bounds});nwr[natural~"^(wood|grassland|scrub|tree)$"](${bounds});nwr[leisure~"^(park|garden|pitch)$"](${bounds});nwr[amenity~"^(parking|parking_space)$"](${bounds}););out geom;`;
}

// Cache only in this page's memory: no saved address or location history.
const requests = new Map<string, Promise<Neighborhood>>();
export function loadNeighborhood(location: TwinLocation): Promise<Neighborhood> {
  const query = neighborhoodQuery(location);
  const cacheKey = `${query}|${JSON.stringify(location.boundary ?? [])}`;
  const cached = requests.get(cacheKey);
  if (cached) return cached;
  const request = (async () => {
    let neighborhood: Neighborhood;
    try {
      const response = await fetch("https://overpass-api.de/api/interpreter", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(28000),
      });
      if (!response.ok) throw new Error("Detailed map request failed.");
      neighborhood = parseNeighborhood(await response.json(), location);
    } catch {
      const { loadVectorNeighborhood } = await import("./vectorSource");
      neighborhood = await loadVectorNeighborhood(location);
    }
    if (requests.size > 8) requests.delete(requests.keys().next().value!);
    return neighborhood;
  })();
  requests.set(cacheKey, request);
  request.catch(() => requests.delete(cacheKey));
  return request;
}
