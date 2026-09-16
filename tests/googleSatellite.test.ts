import assert from "node:assert/strict";
import test from "node:test";
import { satelliteMetersPerPixel, satelliteZoom } from "../server/googleSatellite";

test("satellite zoom fits the selected neighborhood with high-resolution output", () => {
  const zoom = satelliteZoom(47.61, 300);
  assert.ok(zoom >= 17 && zoom <= 19);
  const widthMeters = satelliteMetersPerPixel(47.61, zoom) * 1280;
  assert.ok(widthMeters >= 300);
  assert.ok(widthMeters < 700);
});
