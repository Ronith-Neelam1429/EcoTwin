import assert from "node:assert/strict";
import test from "node:test";
import { effectiveSkyTemperature, parseLocalWeather, weatherUrl } from "../src/lib/ecotwin/weather";

function fixture(start = "2026-09-06T07:00:00Z", hours = 73) {
  const units = { time: "unixtime", temperature_2m: "°C", relative_humidity_2m: "%", dew_point_2m: "°C", wind_speed_10m: "m/s",
    shortwave_radiation: "W/m²", precipitation: "mm", snowfall: "cm", cloud_cover: "%", soil_temperature_18cm: "°C", soil_moisture_3_to_9cm: "m³/m³" };
  const defaults: Record<string, number> = { temperature_2m: 20, relative_humidity_2m: 50, dew_point_2m: 10, wind_speed_10m: 2,
    shortwave_radiation: 100, precipitation: 0, snowfall: 0, cloud_cover: 20, soil_temperature_18cm: 18, soil_moisture_3_to_9cm: 0.225 };
  const hourly: Record<string, (number | null)[]> = { time: Array.from({ length: hours }, (_, i) => Date.parse(start) / 1000 + i * 3600) };
  for (const [key, value] of Object.entries(defaults)) hourly[key] = Array(hours).fill(value);
  return { latitude: 47.58, longitude: -122.15, timezone: "America/Los_Angeles", hourly_units: units, hourly };
}
const now = new Date("2026-09-08T19:00:00Z");

test("local day uses preceding-hour rainfall, including closing midnight, and coincident heat weather", () => {
  const raw = fixture();
  raw.hourly.precipitation[24] = 99; // ends Sept 6, must be excluded
  raw.hourly.precipitation[25] = 2;
  raw.hourly.precipitation[48] = 5; // midnight closes Sept 7, must be included
  raw.hourly.shortwave_radiation[38] = 800;
  raw.hourly.temperature_2m[38] = 28;
  raw.hourly.wind_speed_10m[38] = 3;
  const weather = parseLocalWeather(raw, now);
  assert.equal(weather.date, "2026-09-07");
  assert.equal(weather.heatTime, "14:00");
  assert.equal(weather.inputs.rainfallMm, 7);
  assert.equal(weather.inputs.rainfallSeriesMm?.length, 24);
  assert.equal(weather.inputs.rainfallSeriesMm?.at(-1), 5);
  assert.equal(weather.inputs.airTemperatureC, 28);
  assert.equal(weather.inputs.windSpeedMs, 3);
  assert.equal(weather.inputs.initialSoilSaturation, 0.5);
});

test("DST local day retains 23 real hourly intervals", () => {
  const raw = fixture("2026-03-07T08:00:00Z", 72);
  const weather = parseLocalWeather(raw, new Date("2026-03-09T20:00:00Z"));
  assert.equal(weather.date, "2026-03-08");
  assert.equal(weather.inputs.stormDurationHours, 23);
  assert.equal(weather.inputs.rainfallSeriesMm?.length, 23);
});

test("DST fall local day retains both repeated hours", () => {
  const raw = fixture("2026-10-31T07:00:00Z", 74);
  const weather = parseLocalWeather(raw, new Date("2026-11-02T20:00:00Z"));
  assert.equal(weather.date, "2026-11-01");
  assert.equal(weather.inputs.stormDurationHours, 25);
});

test("missing values, wrong units, incomplete/stale days, and frozen conditions fail explicitly", () => {
  const missing = fixture(); missing.hourly.precipitation[30] = null;
  assert.throws(() => parseLocalWeather(missing, now), /Missing weather/);
  const negative = fixture(); negative.hourly.precipitation[30] = -1;
  assert.throws(() => parseLocalWeather(negative, now), /Rainfall series|rainfallMm/);
  const units = fixture(); units.hourly_units.wind_speed_10m = "km/h";
  assert.throws(() => parseLocalWeather(units, now), /units/);
  const incomplete = fixture(); incomplete.hourly.time.splice(40, 1);
  assert.throws(() => parseLocalWeather(incomplete, now), /complete recent/);
  assert.throws(() => parseLocalWeather(fixture(), new Date("2026-09-20T19:00:00Z")), /complete recent/);
  const snow = fixture(); snow.hourly.snowfall[30] = 1;
  assert.throws(() => parseLocalWeather(snow, now), /snow or freezing/);
  const frozen = fixture(); frozen.hourly.temperature_2m[30] = -1;
  assert.throws(() => parseLocalWeather(frozen, now), /snow or freezing/);
});

test("sky correlation matches published clear-sky example; API requests explicit SI units", () => {
  const sky = effectiveSkyTemperature(20, 10, 0);
  const infrared = 5.670374419e-8 * (sky + 273.15) ** 4;
  assert.ok(Math.abs(infrared - 341.2) < 0.2);
  assert.ok(effectiveSkyTemperature(20, 10, 100) > sky);
  const url = new URL(weatherUrl({ lat: 47, lng: -122 }));
  assert.equal(url.hostname, "api.open-meteo.com");
  assert.equal(url.searchParams.get("wind_speed_unit"), "ms");
  assert.equal(url.searchParams.get("timeformat"), "unixtime");
  assert.throws(() => weatherUrl({ lat: NaN, lng: 1 }));
});
