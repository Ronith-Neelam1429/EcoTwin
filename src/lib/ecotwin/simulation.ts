import { SURFACE_PARAMETERS, validateSurfaceParameters, type SurfaceParameters } from "./cellProperties";
import { simulateStorm, type WaterBalance } from "./hydrology";
import { DEFAULT_SCENARIO, validateScenario, type ScenarioInputs } from "./scenario";
import { solveSurfaceHeat, type HeatBalance } from "./thermal";
import type { EcoCell, EcoMetrics, SurfaceType } from "./types";

export const CELL_AREA_M2 = 100;
export type SurfaceOverrides = Partial<Record<SurfaceType, Partial<SurfaceParameters>>>;
export type CellPhysics = { water: WaterBalance; heat: HeatBalance };
export type ScenarioTimelinePoint = { elapsedHours: number; metrics: EcoMetrics };

function environment(p: SurfaceParameters, physics: CellPhysics) {
  return {
    heatAbsorption: 1 - p.albedo,
    shade: p.canopy * p.shadeEfficiency,
    absorbedSolar: physics.heat.absorbedSolarWm2,
    infiltration: physics.water.rainfallMm > 0 ? physics.water.infiltrationMm / physics.water.rainfallMm : 0,
    canopy: p.canopy,
    temperature: physics.heat.temperatureC,
    water: physics.water.runoffMm,
  };
}

// Imported cells keep default derived fields for backwards compatibility. Every
// scenario run recomputes them from surfaces + inputs, never from stale cell scores.
const defaultEnvironments = new Map<SurfaceType, ReturnType<typeof environment>>();
export function calculateCellEnvironment(surfaceType: SurfaceType) {
  let result = defaultEnvironments.get(surfaceType);
  if (!result) {
    const p = SURFACE_PARAMETERS[surfaceType];
    result = environment(p, { water: simulateStorm(p, DEFAULT_SCENARIO), heat: solveSurfaceHeat(p, DEFAULT_SCENARIO) });
    defaultEnvironments.set(surfaceType, result);
  }
  return { ...result };
}

export function simulateScenario(
  cells: EcoCell[],
  inputs: ScenarioInputs = DEFAULT_SCENARIO,
  overrides: SurfaceOverrides = {},
) {
  validateScenario(inputs);
  const profiles = new Map<SurfaceType, { p: SurfaceParameters; physics: CellPhysics }>();
  const metrics: EcoMetrics = {
    averageTemperature: 0, maxTemperature: cells.length ? -Infinity : 0, totalRunoff: 0, averageInfiltration: 0,
    averageCanopy: 0, interventions: 0, totalRainfall: 0, totalInfiltration: 0,
    totalStored: 0, totalInterception: 0, totalRoofDrainage: 0,
    waterBalanceError: 0, maxEnergyBalanceError: 0, unknownAreaFraction: 0,
  };
  const coverageFor = (cell: EcoCell) => cell.coverage ?? 1;
  const totalCoverage = cells.reduce((sum, cell) => sum + coverageFor(cell), 0);
  const simulatedCells = cells.map((cell) => {
    let profile = profiles.get(cell.surfaceType);
    if (!profile) {
      const p = { ...SURFACE_PARAMETERS[cell.surfaceType], ...overrides[cell.surfaceType] };
      validateSurfaceParameters(p);
      profile = { p, physics: { water: simulateStorm(p, inputs), heat: solveSurfaceHeat(p, inputs) } };
      profiles.set(cell.surfaceType, profile);
    }
    const { p, physics: { water, heat } } = profile;
    const coverage = coverageFor(cell);
    const weight = totalCoverage ? coverage / totalCoverage : 0;
    const volumePerMm = CELL_AREA_M2 * coverage / 1000; // 1 mm over 100 m² = 0.1 m³
    metrics.averageTemperature += heat.temperatureC * weight;
    metrics.maxTemperature = Math.max(metrics.maxTemperature, heat.temperatureC);
    metrics.totalRunoff += water.runoffMm * volumePerMm;
    metrics.totalRainfall += water.rainfallMm * volumePerMm;
    metrics.totalInfiltration += water.infiltrationMm * volumePerMm;
    metrics.totalStored += water.storedMm * volumePerMm;
    metrics.totalInterception += water.interceptedMm * volumePerMm;
    metrics.totalRoofDrainage += water.roofDrainageMm * volumePerMm;
    metrics.averageCanopy += p.canopy * weight;
    metrics.interventions += Number(cell.surfaceType !== cell.baselineSurfaceType);
    metrics.unknownAreaFraction += Number(cell.surfaceType === "unknown") * weight;
    metrics.maxEnergyBalanceError = Math.max(metrics.maxEnergyBalanceError, Math.abs(heat.balanceErrorWm2));
    return { ...cell, ...environment(p, profile.physics) };
  });
  metrics.averageInfiltration = metrics.totalRainfall > 0 ? metrics.totalInfiltration / metrics.totalRainfall : 0;
  metrics.waterBalanceError = metrics.totalRainfall - metrics.totalRunoff - metrics.totalInfiltration - metrics.totalStored - metrics.totalInterception;
  return { cells: simulatedCells, metrics, profiles };
}

export function calculateMetrics(cells: EcoCell[], inputs: ScenarioInputs = DEFAULT_SCENARIO): EcoMetrics {
  return simulateScenario(cells, inputs).metrics;
}

/** Cumulative scenario results sampled from the start through the end of the storm.
 * Loaded rainfall bins are sampled only on their boundaries so their original
 * timing and intensity are preserved instead of being stretched over partial bins.
 */
export function simulateScenarioTimeline(
  cells: EcoCell[],
  inputs: ScenarioInputs = DEFAULT_SCENARIO,
  maxSamples = 24,
): ScenarioTimelinePoint[] {
  validateScenario(inputs);
  if (!Number.isInteger(maxSamples) || maxSamples < 2 || maxSamples > 96)
    throw new RangeError("Timeline samples must be an integer between 2 and 96.");

  const bins = inputs.rainfallSeriesMm;
  const intervals = bins?.length ?? maxSamples;
  const sampleCount = Math.min(intervals, maxSamples);
  const indices = Array.from({ length: sampleCount + 1 }, (_, i) =>
    Math.round((i * intervals) / sampleCount),
  ).filter((value, index, values) =>
    (index === 0 || value !== values[index - 1])
    // Zero is modeled as a dry initial state below. Other prefixes must remain
    // valid ScenarioInputs, whose supported minimum duration is 0.1 hours.
    && (value === 0 || inputs.stormDurationHours * value / intervals >= 0.1 - 1e-12),
  );

  return indices.map((index) => {
    const elapsedHours = inputs.stormDurationHours * index / intervals;
    if (index === 0) {
      return {
        elapsedHours: 0,
        metrics: simulateScenario(cells, {
          ...inputs,
          rainfallMm: 0,
          rainfallSeriesMm: undefined,
        }).metrics,
      };
    }

    const rainfallSeriesMm = bins?.slice(0, index);
    const rainfallMm = rainfallSeriesMm
      ? rainfallSeriesMm.reduce((sum, value) => sum + value, 0)
      : inputs.rainfallMm * index / intervals;
    return {
      elapsedHours,
      metrics: simulateScenario(cells, {
        ...inputs,
        rainfallMm,
        stormDurationHours: elapsedHours,
        rainfallSeriesMm,
      }).metrics,
    };
  });
}
