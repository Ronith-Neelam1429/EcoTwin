import type { SurfaceType } from "./types";

/** Engineering assumptions for a whole 100 m² cell, not measured material data.
 * Calibrate these independently of weather; see docs/physics-model.md.
 */
export type SurfaceParameters = {
  albedo: number;
  emissivity: number;
  canopy: number;
  shadeEfficiency: number;
  thermalConductanceWm2K: number;
  evaporatingFraction: number;
  surfaceResistanceSm: number;
  hydrology: "impervious" | "soil" | "roof" | "pavement";
  storageMm: number;
  interceptionMm: number;
  aggregateStorageMm: number;
  intakeMmH: number;
  suctionHeadMm: number;
  porosity: number;
  roofRetentionMm: number;
  roofDetentionMm: number;
  roofDrainRatePerHour: number;
};

const common: SurfaceParameters = {
  albedo: 0.2, emissivity: 0.95, canopy: 0, shadeEfficiency: 0.85,
  thermalConductanceWm2K: 5, evaporatingFraction: 0, surfaceResistanceSm: 150,
  hydrology: "impervious", storageMm: 1, interceptionMm: 0, aggregateStorageMm: 0, intakeMmH: 0,
  suctionHeadMm: 110, porosity: 0.45,
  roofRetentionMm: 0, roofDetentionMm: 0, roofDrainRatePerHour: 0,
};
export const SURFACE_PARAMETERS: Record<SurfaceType, Readonly<SurfaceParameters>> = {
  unknown: { ...common, hydrology: "soil", intakeMmH: 30, storageMm: 2, evaporatingFraction: 0.3 },
  asphalt: { ...common, albedo: 0.12, emissivity: 0.95, thermalConductanceWm2K: 8 },
  grass: { ...common, albedo: 0.23, hydrology: "soil", intakeMmH: 50, storageMm: 3, evaporatingFraction: 1, surfaceResistanceSm: 100 },
  building: { ...common, albedo: 0.2, emissivity: 0.9, thermalConductanceWm2K: 3 },
  // An established tree and soil planting area, with an approximately 8 m crown.
  tree: { ...common, canopy: 0.5, hydrology: "soil", intakeMmH: 50, storageMm: 5, interceptionMm: 1, evaporatingFraction: 1, surfaceResistanceSm: 100 },
  rain_garden: { ...common, albedo: 0.23, hydrology: "soil", intakeMmH: 100, storageMm: 150, evaporatingFraction: 1, surfaceResistanceSm: 100 },
  green_roof: { ...common, albedo: 0.25, hydrology: "roof", intakeMmH: 50, storageMm: 2, evaporatingFraction: 1, surfaceResistanceSm: 120, thermalConductanceWm2K: 1.5, roofRetentionMm: 30, roofDetentionMm: 15, roofDrainRatePerHour: 1 },
  // Storage represents an unlined aggregate reservoir; native soil limits exfiltration.
  permeable_pavement: { ...common, albedo: 0.3, hydrology: "pavement", intakeMmH: 100, storageMm: 1, aggregateStorageMm: 60, thermalConductanceWm2K: 6 },
};

export function validateSurfaceParameters(p: SurfaceParameters) {
  for (const [key, value] of Object.entries(p)) {
    if (key === "hydrology") continue;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
      throw new RangeError(`Invalid surface parameter: ${key}`);
  }
  for (const key of ["albedo", "emissivity", "canopy", "shadeEfficiency", "evaporatingFraction", "porosity"] as const) {
    if (p[key] > 1) throw new RangeError(`${key} must be between 0 and 1.`);
  }
  if (!["impervious", "soil", "roof", "pavement"].includes(p.hydrology)) throw new RangeError("Invalid hydrology type.");
}

export const SURFACE_COLORS: Record<SurfaceType, string> = {
  unknown: "#d0cec3",
  asphalt: "#65706f",
  grass: "#75aa64",
  building: "#c1b6a4",
  tree: "#2f7d4a",
  rain_garden: "#48a88c",
  green_roof: "#78b85d",
  permeable_pavement: "#9d9b8d",
};

export const SURFACE_LABELS: Record<SurfaceType, string> = {
  unknown: "Unmapped ground (assumed properties)",
  asphalt: "Asphalt",
  grass: "Grass",
  building: "Building",
  tree: "Tree",
  rain_garden: "Rain garden",
  green_roof: "Green roof",
  permeable_pavement: "Permeable pavement",
};
