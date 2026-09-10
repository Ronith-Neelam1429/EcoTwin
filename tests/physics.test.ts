import assert from "node:assert/strict";
import test from "node:test";
import { SURFACE_PARAMETERS } from "../src/lib/ecotwin/cellProperties";
import { greenAmptIncrement, simulateStorm } from "../src/lib/ecotwin/hydrology";
import { solveSurfaceHeat } from "../src/lib/ecotwin/thermal";
import { DEFAULT_SCENARIO, validateScenario } from "../src/lib/ecotwin/scenario";
import { calculateCellEnvironment, simulateScenario } from "../src/lib/ecotwin/simulation";
import type { EcoCell, SurfaceType } from "../src/lib/ecotwin/types";

const close = (a: number, b: number, tolerance = 1e-8) => assert.ok(Math.abs(a - b) < tolerance, `${a} differs from ${b}`);
const cell = (surfaceType: SurfaceType, id = "0-0"): EcoCell => ({ id, row: 0, col: 0, surfaceType,
  baselineSurfaceType: surfaceType, elevation: 0, coverage: 1, ...calculateCellEnvironment(surfaceType) });

test("impervious area benchmark: 25 mm rain minus 1 mm storage over 100 m² = 2.4 m³ runoff", () => {
  const { metrics } = simulateScenario([cell("asphalt")]);
  close(metrics.totalRainfall, 2.5);
  close(metrics.totalRunoff, 2.4);
  close(metrics.totalStored, 0.1);
  close(metrics.totalInfiltration, 0);
});

test("partial boundary cells contribute only their selected area to totals", () => {
  const halfCell = { ...cell("asphalt"), coverage: 0.5 };
  const { metrics } = simulateScenario([halfCell]);
  close(metrics.totalRainfall, 1.25);
  close(metrics.totalRunoff, 1.2);
  close(metrics.totalStored, 0.05);
});

test("ponded Green–Ampt matches independently calculated elapsed time and handles initial singularity", () => {
  const initial = 4, target = 27, suction = 33, k = 5;
  const hours = (target - initial - suction * Math.log((target + suction) / (initial + suction))) / k;
  close(greenAmptIncrement(initial, k, suction, hours), target - initial);
  const fromDryHours = (target - suction * Math.log((target + suction) / suction)) / k;
  close(greenAmptIncrement(0, k, suction, fromDryHours), target);
  close(greenAmptIncrement(0, 5, 0, 2), 10);
  close(greenAmptIncrement(0, 0, 30, 2), 0);
});

test("saturated soil benchmark: infiltration = K × time; excess is storage plus runoff", () => {
  const w = simulateStorm(SURFACE_PARAMETERS.grass, { ...DEFAULT_SCENARIO, initialSoilSaturation: 1 });
  close(w.infiltrationMm, 10);
  close(w.storedMm, 3);
  close(w.runoffMm, 12);
});

test("water closes and remains nonnegative for every material across dry, intense and long storms", () => {
  for (const p of Object.values(SURFACE_PARAMETERS)) {
    for (const rainfallMm of [0, 0.1, 25, 500]) {
      for (const initialSoilSaturation of [0, 0.5, 1]) {
        const w = simulateStorm(p, { ...DEFAULT_SCENARIO, rainfallMm, initialSoilSaturation });
        close(w.balanceErrorMm, 0, 1e-7);
        for (const key of ["runoffMm", "infiltrationMm", "storedMm", "interceptedMm", "roofDrainageMm"] as const)
          assert.ok(w[key] >= 0 && w[key] <= rainfallMm + 1e-8, `${key}: ${w[key]}`);
      }
    }
  }
});

test("same rainfall delivered faster produces more grass runoff; wetter soil reduces infiltration", () => {
  const slow = simulateStorm(SURFACE_PARAMETERS.grass, { ...DEFAULT_SCENARIO, rainfallMm: 40, stormDurationHours: 8 });
  const fast = simulateStorm(SURFACE_PARAMETERS.grass, { ...DEFAULT_SCENARIO, rainfallMm: 40, stormDurationHours: 0.5 });
  assert.ok(fast.runoffMm > slow.runoffMm);
  const saturated = simulateStorm(SURFACE_PARAMETERS.grass, { ...DEFAULT_SCENARIO, initialSoilSaturation: 1 });
  const dry = simulateStorm(SURFACE_PARAMETERS.grass, { ...DEFAULT_SCENARIO, initialSoilSaturation: 0 });
  assert.ok(saturated.infiltrationMm < dry.infiltrationMm);
});

test("green roofs have finite storage and send drainage to runoff, never ground infiltration", () => {
  const w = simulateStorm(SURFACE_PARAMETERS.green_roof, { ...DEFAULT_SCENARIO, rainfallMm: 100, initialSoilSaturation: 1 });
  close(w.infiltrationMm, 0);
  assert.ok(w.roofDrainageMm > 0 && w.runoffMm >= w.roofDrainageMm);
  assert.ok(w.storedMm <= 17 + 1e-8);
  assert.ok(w.runoffMm > 80);
});

test("impermeable subgrade cannot infiltrate and a full rain garden overflows", () => {
  const w = simulateStorm(SURFACE_PARAMETERS.rain_garden, { ...DEFAULT_SCENARIO, rainfallMm: 200, soilConductivityMmH: 0 });
  close(w.infiltrationMm, 0); close(w.storedMm, 150); close(w.runoffMm, 50);
});

test("hourly rainfall preserves burst timing rather than smearing it across a day", () => {
  const hourly = { ...DEFAULT_SCENARIO, rainfallMm: 48, stormDurationHours: 24, rainfallSeriesMm: [...Array(23).fill(0), 48] };
  const burst = simulateStorm(SURFACE_PARAMETERS.grass, hourly);
  const uniform = simulateStorm(SURFACE_PARAMETERS.grass, { ...hourly, rainfallSeriesMm: undefined });
  assert.ok(burst.runoffMm > uniform.runoffMm + 10);
  close(burst.balanceErrorMm, 0);
});

test("30 second storm integration converges against 5 seconds within 0.15 mm", () => {
  for (const p of Object.values(SURFACE_PARAMETERS)) {
    for (const inputs of [DEFAULT_SCENARIO, { ...DEFAULT_SCENARIO, rainfallMm: 100, stormDurationHours: 3 },
      { ...DEFAULT_SCENARIO, rainfallMm: 25, stormDurationHours: 3, rainfallSeriesMm: [0, 25, 0] }]) {
      const coarse = simulateStorm(p, inputs, 30), fine = simulateStorm(p, inputs, 5);
      close(coarse.runoffMm, fine.runoffMm, 0.15);
      close(coarse.infiltrationMm, fine.infiltrationMm, 0.15);
    }
  }
});

test("isothermal, dark, dry boundaries yield their exact common temperature", () => {
  const inputs = { ...DEFAULT_SCENARIO, airTemperatureC: 20, skyTemperatureC: 20, substrateTemperatureC: 20,
    solarRadiationWm2: 0, heatMoistureAvailability: 0 };
  for (const p of Object.values(SURFACE_PARAMETERS)) close(solveSurfaceHeat(p, inputs).temperatureC, 20);
});

test("independent Stefan–Boltzmann/convection/conduction benchmark", () => {
  const temperature = 45, sigma = 5.670374419e-8, p = SURFACE_PARAMETERS.asphalt;
  const inputs = { ...DEFAULT_SCENARIO, heatMoistureAvailability: 0 };
  const requiredSolar = (p.emissivity * sigma * ((temperature + 273.15) ** 4 - (inputs.skyTemperatureC + 273.15) ** 4)
    + (5.7 + 3.8 * inputs.windSpeedMs) * (temperature - inputs.airTemperatureC)
    + p.thermalConductanceWm2K * (temperature - inputs.substrateTemperatureC)) / (1 - p.albedo);
  close(solveSurfaceHeat(p, { ...inputs, solarRadiationWm2: requiredSolar }).temperatureC, temperature);
});

test("heat responds to sunlight, wind, reflectivity and water availability and closes energy", () => {
  const asphalt = solveSurfaceHeat(SURFACE_PARAMETERS.asphalt, DEFAULT_SCENARIO);
  assert.ok(solveSurfaceHeat(SURFACE_PARAMETERS.asphalt, { ...DEFAULT_SCENARIO, solarRadiationWm2: 200 }).temperatureC < asphalt.temperatureC);
  assert.ok(solveSurfaceHeat(SURFACE_PARAMETERS.asphalt, { ...DEFAULT_SCENARIO, windSpeedMs: 8 }).temperatureC < asphalt.temperatureC);
  assert.ok(solveSurfaceHeat({ ...SURFACE_PARAMETERS.asphalt, albedo: 0.6 }, DEFAULT_SCENARIO).temperatureC < asphalt.temperatureC);
  const dry = solveSurfaceHeat(SURFACE_PARAMETERS.grass, { ...DEFAULT_SCENARIO, heatMoistureAvailability: 0 });
  close(dry.latentHeatWm2, 0);
  assert.ok(solveSurfaceHeat(SURFACE_PARAMETERS.grass, DEFAULT_SCENARIO).temperatureC < dry.temperatureC);
  for (const p of Object.values(SURFACE_PARAMETERS)) close(solveSurfaceHeat(p, DEFAULT_SCENARIO).balanceErrorWm2, 0, 1e-7);
});

test("scenario ignores stale scores, does not mutate input, and returns the same cells used in metrics", () => {
  const original = { ...cell("asphalt"), temperature: -1000, water: -1000 };
  const inputs = { ...DEFAULT_SCENARIO, solarRadiationWm2: 500 };
  const { cells, metrics } = simulateScenario([original], inputs);
  assert.equal(original.temperature, -1000);
  close(cells[0].temperature, metrics.averageTemperature);
  close(cells[0].water * 0.1, metrics.totalRunoff);
  assert.ok(cells[0].temperature > 0);
  close(simulateScenario([cell("grass")]).metrics.averageCanopy, 0);
  close(simulateScenario([cell("green_roof")]).metrics.averageCanopy, 0);
});

test("empty areas, dry scenarios, invalid inputs and material calibration overrides are handled", () => {
  assert.ok(Object.values(simulateScenario([]).metrics).every((n) => n === 0));
  const dry = simulateScenario([cell("asphalt")], { ...DEFAULT_SCENARIO, rainfallMm: 0 });
  assert.ok(Object.values(dry.metrics).every(Number.isFinite));
  assert.throws(() => validateScenario({ ...DEFAULT_SCENARIO, rainfallMm: NaN }));
  assert.throws(() => validateScenario({ ...DEFAULT_SCENARIO, stormDurationHours: 0 }));
  assert.throws(() => validateScenario({ ...DEFAULT_SCENARIO, rainfallSeriesMm: [1] }));
  assert.throws(() => simulateScenario([cell("asphalt")], DEFAULT_SCENARIO, { asphalt: { albedo: 2 } }));
  const calibrated = simulateScenario([cell("asphalt")], DEFAULT_SCENARIO, { asphalt: { storageMm: 0 } });
  close(calibrated.metrics.totalRunoff, 2.5);
});

test("pavement intake and aggregate capacity are distinct limits during intense rain", () => {
  const w = simulateStorm(SURFACE_PARAMETERS.permeable_pavement, { ...DEFAULT_SCENARIO,
    rainfallMm: 50, stormDurationHours: 0.1, soilConductivityMmH: 0 });
  // 100 mm/h enters the aggregate for 0.1 h; only 1 mm can stay on the surface.
  close(w.storedMm, 11); close(w.runoffMm, 39); close(w.infiltrationMm, 0);
});
