export type SurfaceType =
  | "unknown"
  | "asphalt"
  | "grass"
  | "building"
  | "tree"
  | "rain_garden"
  | "green_roof"
  | "permeable_pavement";

export type InterventionTool =
  | "tree"
  | "rain_garden"
  | "green_roof"
  | "permeable_pavement"
  | "erase";

export type ViewMode = "surface" | "heat" | "runoff";

export type EcoCell = {
  id: string;
  row: number;
  col: number;
  surfaceType: SurfaceType;
  baselineSurfaceType: SurfaceType;
  elevation: number;
  heatAbsorption: number;
  infiltration: number;
  canopy: number;
  /** Event runoff depth in mm, not ponded flood depth. */
  water: number;
  /** Equilibrium surface temperature in °C, not air temperature. */
  temperature: number;
  buildingId?: string;
};

export type TwinLocation = {
  lat: number;
  lng: number;
  heading: number;
  pitch: number;
  /** Half the width of the square study area. */
  radiusMeters: number;
  address?: string;
};

export type EcoMetrics = {
  averageTemperature: number;
  maxTemperature: number;
  totalRunoff: number;
  averageInfiltration: number;
  averageCanopy: number;
  interventions: number;
  totalRainfall: number;
  totalInfiltration: number;
  totalStored: number;
  totalInterception: number;
  totalRoofDrainage: number;
  waterBalanceError: number;
  maxEnergyBalanceError: number;
  unknownAreaFraction: number;
};
