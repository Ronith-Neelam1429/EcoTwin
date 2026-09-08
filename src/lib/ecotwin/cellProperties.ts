import type { SurfaceType } from "./types";

export const CELL_PROPERTIES: Record<
  SurfaceType,
  { heatAbsorption: number; infiltration: number; canopy: number }
> = {
  asphalt: { heatAbsorption: 0.9, infiltration: 0.05, canopy: 0 },
  grass: { heatAbsorption: 0.45, infiltration: 0.55, canopy: 0.1 },
  building: { heatAbsorption: 0.75, infiltration: 0, canopy: 0 },
  tree: { heatAbsorption: 0.35, infiltration: 0.65, canopy: 0.85 },
  rain_garden: { heatAbsorption: 0.4, infiltration: 0.95, canopy: 0.25 },
  green_roof: { heatAbsorption: 0.5, infiltration: 0.6, canopy: 0.35 },
  permeable_pavement: { heatAbsorption: 0.6, infiltration: 0.65, canopy: 0 },
};

export const SURFACE_COLORS: Record<SurfaceType, string> = {
  asphalt: "#65706f",
  grass: "#75aa64",
  building: "#c1b6a4",
  tree: "#2f7d4a",
  rain_garden: "#48a88c",
  green_roof: "#78b85d",
  permeable_pavement: "#9d9b8d",
};

export const SURFACE_LABELS: Record<SurfaceType, string> = {
  asphalt: "Asphalt",
  grass: "Grass",
  building: "Building",
  tree: "Tree",
  rain_garden: "Rain garden",
  green_roof: "Green roof",
  permeable_pavement: "Permeable pavement",
};
