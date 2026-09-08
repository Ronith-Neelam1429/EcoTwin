import { CELL_PROPERTIES } from "./cellProperties";
import type { EcoCell, EcoMetrics, SurfaceType } from "./types";

export const BASE_AIR_TEMPERATURE = 30;
export const RAINFALL_AMOUNT = 10;

export function calculateCellEnvironment(surfaceType: SurfaceType) {
  const properties = CELL_PROPERTIES[surfaceType];
  return {
    ...properties,
    temperature:
      BASE_AIR_TEMPERATURE +
      properties.heatAbsorption * 12 -
      properties.canopy * 6 -
      properties.infiltration * 2,
    water: RAINFALL_AMOUNT * (1 - properties.infiltration),
  };
}

export function calculateMetrics(cells: EcoCell[]): EcoMetrics {
  const totals = cells.reduce(
    (sum, cell) => ({
      temperature: sum.temperature + cell.temperature,
      runoff: sum.runoff + cell.water,
      infiltration: sum.infiltration + cell.infiltration,
      canopy: sum.canopy + cell.canopy,
      maxTemperature: Math.max(sum.maxTemperature, cell.temperature),
      interventions:
        sum.interventions + (cell.surfaceType !== cell.baselineSurfaceType ? 1 : 0),
    }),
    {
      temperature: 0,
      runoff: 0,
      infiltration: 0,
      canopy: 0,
      maxTemperature: Number.NEGATIVE_INFINITY,
      interventions: 0,
    },
  );

  return {
    averageTemperature: totals.temperature / cells.length,
    maxTemperature: totals.maxTemperature,
    totalRunoff: totals.runoff,
    averageInfiltration: totals.infiltration / cells.length,
    averageCanopy: totals.canopy / cells.length,
    interventions: totals.interventions,
  };
}
