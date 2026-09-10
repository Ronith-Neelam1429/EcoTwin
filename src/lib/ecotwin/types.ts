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
  /** Fraction of this 10 m cell inside the selected study boundary. */
  coverage: number;
  buildingId?: string;
};

export type GeoPoint = {
  lat: number;
  lng: number;
};

export type TwinLocation = {
  lat: number;
  lng: number;
  heading: number;
  pitch: number;
  /** Half the width of the square that contains the study area. */
  radiusMeters: number;
  /** User-drawn study boundary. Omitted for the standard square area. */
  boundary?: GeoPoint[];
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
