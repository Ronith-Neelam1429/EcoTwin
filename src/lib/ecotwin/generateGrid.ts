import { calculateCellEnvironment } from "./simulation";
import type { EcoCell, SurfaceType, TwinLocation } from "./types";

export const GRID_SIZE = 30;

function seededNoise(row: number, col: number, seed: number) {
  const value = Math.sin(row * 12.9898 + col * 78.233 + seed * 0.0001) * 43758.5453;
  return value - Math.floor(value);
}

function defaultSurface(row: number, col: number, noise: number): SurfaceType {
  const isRoad = row === 7 || row === 8 || col === 20 || col === 21;
  const isParking = row > 18 && row < 27 && col > 2 && col < 13;
  const isBuilding =
    (row > 2 && row < 7 && col > 3 && col < 10) ||
    (row > 11 && row < 17 && col > 11 && col < 18) ||
    (row > 20 && row < 27 && col > 22 && col < 28);

  if (isBuilding) return "building";
  if (isRoad || isParking) return "asphalt";
  return noise > 0.44 ? "grass" : "asphalt";
}

export function generateGrid(location: TwinLocation): EcoCell[] {
  const seed = Math.round(Math.abs(location.lat * 1000 + location.lng * 1000));

  return Array.from({ length: GRID_SIZE * GRID_SIZE }, (_, index) => {
    const row = Math.floor(index / GRID_SIZE);
    const col = index % GRID_SIZE;
    const noise = seededNoise(row, col, seed);
    const surfaceType = defaultSurface(row, col, noise);
    const environment = calculateCellEnvironment(surfaceType);

    return {
      id: `${row}-${col}`,
      row,
      col,
      surfaceType,
      baselineSurfaceType: surfaceType,
      elevation: (noise - 0.5) * 0.22,
      ...environment,
    };
  });
}
