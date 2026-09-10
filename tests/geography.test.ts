import assert from "node:assert/strict";
import test from "node:test";
import { buildingHeight, cellAt, clip, contains, neighborhoodQuery, parseMeters, parseNeighborhood, project, roadWidthMeters, studyBoundary } from "../src/lib/ecotwin/geography";
import { applyIntervention } from "../src/lib/ecotwin/applyIntervention";
import { tileTags } from "../src/lib/ecotwin/vectorSource";
import { calculateMetrics } from "../src/lib/ecotwin/simulation";
import type { TwinLocation } from "../src/lib/ecotwin/types";

const origin: TwinLocation = { lat: 0, lng: 0, heading: 90, pitch: 10, radiusMeters: 150 };
const degrees = 180 / Math.PI / 6378137;
const point = (east: number, north: number) => ({ lon: east * degrees, lat: north * degrees });
const house = {
  type: "way", id: 1, nodes: [1, 2, 3, 4, 1],
  tags: { building: "house", height: "9 m" },
  geometry: [point(0, 0), point(20, 0), point(20, 20), point(0, 20), point(0, 0)],
};
const road = { type: "way", id: 2, nodes: [5, 6, 7], tags: { highway: "residential", width: "6" }, geometry: [point(-100, -50), point(0, -50), point(100, -80)] };

test("metric projection preserves east, north, distance, and exact origin", () => {
  assert.deepEqual(project(0, 0, origin), [0, -0]);
  const [x, z] = project(point(100, 50).lon, point(100, 50).lat, origin);
  assert.ok(Math.abs(x - 10) < 1e-8);
  assert.ok(Math.abs(z + 5) < 1e-8);
  assert.equal(cellAt(x, z), "10-25");
});

test("cell lookup follows a resized study-area grid", () => {
  assert.equal(cellAt(0, 0, 16), "8-8");
  assert.equal(cellAt(-7.5, -7.5, 16), "0-0");
  assert.equal(cellAt(7.5, 7.5, 16), "15-15");
});

test("vector tree points are retained from POI tiles", () => {
  assert.deepEqual(tileTags("poi", { class: "tree" }), { natural: "tree" });
  assert.deepEqual(tileTags("poi", { subclass: "tree" }), { natural: "tree" });
});

test("courtyards remain empty and polygon edges clip to 300 metres", () => {
  const clipped = clip([[[[-20, -20], [20, -20], [20, 20], [-20, 20], [-20, -20]], [[-2, -2], [-2, 2], [2, 2], [2, -2], [-2, -2]]]]);
  assert.equal(contains([0, 0], clipped), false);
  assert.equal(contains([10, 10], clipped), true);
  assert.ok(clipped.flat(2).every((p) => p.every((n) => Math.abs(n) <= 15)));
});

test("height precedence and units are explicit", () => {
  assert.equal(parseMeters("30 ft"), 9.144);
  assert.equal(parseMeters("12 feet"), 3.6576000000000004);
  assert.equal(parseMeters("two storeys"), undefined);
  assert.deepEqual(buildingHeight({ height: "12", "building:levels": "2" }), { height: 1.2, heightSource: "tag" });
  assert.deepEqual(buildingHeight({ "building:levels": "2" }), { height: 0.6, heightSource: "levels" });
  assert.deepEqual(buildingHeight({}), { height: 0.6, heightSource: "assumed" });
});

test("road widths prefer mapped measurements, then lanes, class, and service type", () => {
  assert.equal(roadWidthMeters({ highway: "primary", width: "30 ft", lanes: "2" }), 9.144);
  assert.equal(roadWidthMeters({ highway: "residential", lanes: "2" }), 6.8);
  assert.equal(roadWidthMeters({ highway: "motorway", "lanes:forward": "3", "lanes:backward": "3" }), 24);
  assert.equal(roadWidthMeters({ highway: "motorway", oneway: "1" }), 11.5);
  assert.equal(roadWidthMeters({ highway: "service", service: "driveway" }), 3.5);
  assert.equal(roadWidthMeters({ highway: "service", service: "parking_aisle" }), 5.5);
  assert.equal(roadWidthMeters({ highway: "service", service: "parking_aisle", oneway: "yes" }), 3.5);
  assert.equal(roadWidthMeters({ highway: "residential", lanes: "2", "parking:lane:left": "no" }), 6.8);
  assert.equal(roadWidthMeters({ highway: "footway" }), 1.8);
  assert.equal(roadWidthMeters({ highway: "primary" }), 11);
});

test("vector road tags retain width-relevant attributes", () => {
  assert.deepEqual(tileTags("transportation", {
    class: "service", subclass: "service", service: "parking_aisle", lanes: 1, width: 5.5,
  }), {
    highway: "service", class: "service", width: "5.5", lanes: "1",
    "lanes:forward": "", "lanes:backward": "", service: "parking_aisle", oneway: "",
    shoulder: "", "shoulder:left": "", "shoulder:right": "", parking: "",
    "parking:lane:both": "", "parking:lane:left": "", "parking:lane:right": "",
  });
});

test("mapped geometry builds a site baseline without fake buildings or terrain", () => {
  const n = parseNeighborhood({ elements: [house, road] }, origin);
  assert.equal(n.buildings, 1);
  assert.equal(n.roads, 1);
  assert.equal(n.baseline.length, 900);
  assert.ok(n.unknownCells > 800);
  assert.ok(n.baseline.every((c) => c.elevation === 0));
  assert.ok(n.baseline.some((c) => c.buildingId === "way/1"));
  assert.equal(n.features.find((f) => f.id === "way/1")?.height, 0.9);
});

test("empty coverage is explicitly unknown, not synthetic terrain", () => {
  const n = parseNeighborhood({ elements: [] }, origin);
  assert.equal(n.buildings, 0);
  assert.equal(n.features.length, 0);
  assert.equal(n.unknownCells, 900);
});

test("a custom border clips the modeled cells and preserves fractional edge area", () => {
  const geoPoint = (east: number, north: number) => {
    const p = point(east, north);
    return { lng: p.lon, lat: p.lat };
  };
  const custom: TwinLocation = {
    ...origin,
    radiusMeters: 100,
    boundary: [geoPoint(0, 80), geoPoint(80, 0), geoPoint(0, -80), geoPoint(-80, 0)],
  };
  const n = parseNeighborhood({ elements: [] }, custom);
  assert.equal(n.gridSize, 20);
  assert.ok(n.baseline.length < 400);
  assert.ok(n.baseline.some((cell) => cell.coverage > 0 && cell.coverage < 1));
  assert.ok(Math.abs(n.baseline.reduce((sum, cell) => sum + cell.coverage, 0) - 128) < 1e-8);
  assert.equal(contains([0, 0], studyBoundary(custom)), true);
  assert.equal(contains([9, 9], studyBoundary(custom)), false);
});

test("green roofs preserve buildings; ground tools cannot remove houses; erase restores baseline", () => {
  const n = parseNeighborhood({ elements: [house] }, origin);
  const building = n.baseline.find((c) => c.buildingId)!;
  const roof = applyIntervention(building, "green_roof");
  assert.equal(roof.surfaceType, "green_roof");
  assert.equal(roof.buildingId, building.buildingId);
  assert.equal(applyIntervention(building, "tree"), building);
  assert.deepEqual(applyIntervention(roof, "erase"), building);
  const ground = n.baseline.find((c) => !c.buildingId)!;
  assert.equal(applyIntervention(ground, "green_roof"), ground);
});

test("placing a tree updates temperature, runoff, canopy and counts on the GIS grid", () => {
  const n = parseNeighborhood({ elements: [road] }, origin);
  const before = calculateMetrics(n.baseline);
  const id = n.baseline.find((c) => c.surfaceType === "asphalt")!.id;
  const edited = n.baseline.map((c) => c.id === id ? applyIntervention(c, "tree") : c);
  const after = calculateMetrics(edited);
  assert.equal(after.interventions, 1);
  assert.ok(after.totalRunoff < before.totalRunoff);
  assert.ok(after.averageTemperature < before.averageTemperature);
  assert.ok(after.averageCanopy > before.averageCanopy);
  assert.equal(calculateMetrics(n.baseline).interventions, 0);
});

test("query rejects invalid positions and requests complete geometry", () => {
  assert.throws(() => neighborhoodQuery({ ...origin, lat: NaN }));
  assert.throws(() => neighborhoodQuery({ ...origin, lng: 200 }));
  assert.match(neighborhoodQuery(origin), /out geom;/);
});
