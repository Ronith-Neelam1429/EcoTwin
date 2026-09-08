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
  water: number;
  temperature: number;
  buildingId?: string;
};

export type TwinLocation = {
  lat: number;
  lng: number;
  heading: number;
  pitch: number;
  radiusMeters: 150;
  address?: string;
};

export type EcoMetrics = {
  averageTemperature: number;
  maxTemperature: number;
  totalRunoff: number;
  averageInfiltration: number;
  averageCanopy: number;
  interventions: number;
};
