/** Editable design conditions or imported modeled weather; not site measurements. */
export type ScenarioInputs = {
  /** Optional equal-duration rainfall bins, preserving a loaded hourly storm. */
  rainfallSeriesMm?: readonly number[];
  rainfallMm: number;
  stormDurationHours: number;
  soilConductivityMmH: number;
  initialSoilSaturation: number;
  airTemperatureC: number;
  solarRadiationWm2: number;
  relativeHumidityPercent: number;
  windSpeedMs: number;
  skyTemperatureC: number;
  substrateTemperatureC: number;
  heatMoistureAvailability: number;
};

export const DEFAULT_SCENARIO: Readonly<ScenarioInputs> = Object.freeze({
  rainfallMm: 25,
  stormDurationHours: 2,
  soilConductivityMmH: 5,
  initialSoilSaturation: 0.5,
  airTemperatureC: 30,
  solarRadiationWm2: 800,
  relativeHumidityPercent: 50,
  windSpeedMs: 2,
  skyTemperatureC: 20,
  substrateTemperatureC: 25,
  heatMoistureAvailability: 0.5,
});

export const SCENARIO_FIELDS: {
  key: keyof Omit<ScenarioInputs, "rainfallSeriesMm">; label: string; min: number; max: number; step: number;
  group: "storm" | "heat";
}[] = [
  { key: "rainfallMm", label: "Rainfall (mm)", min: 0, max: 500, step: 1, group: "storm" },
  { key: "stormDurationHours", label: "Storm duration (h)", min: 0.1, max: 48, step: 0.1, group: "storm" },
  { key: "soilConductivityMmH", label: "Soil conductivity (mm/h)", min: 0, max: 200, step: 0.5, group: "storm" },
  { key: "initialSoilSaturation", label: "Initial soil saturation (0–1)", min: 0, max: 1, step: 0.1, group: "storm" },
  { key: "airTemperatureC", label: "Air temperature (°C)", min: 0, max: 50, step: 1, group: "heat" },
  { key: "solarRadiationWm2", label: "Sunlight (W/m²)", min: 0, max: 1200, step: 25, group: "heat" },
  { key: "relativeHumidityPercent", label: "Relative humidity (%)", min: 1, max: 100, step: 1, group: "heat" },
  { key: "windSpeedMs", label: "Local wind (m/s)", min: 0, max: 20, step: 0.5, group: "heat" },
  { key: "skyTemperatureC", label: "Effective sky temperature (°C)", min: -40, max: 50, step: 1, group: "heat" },
  { key: "substrateTemperatureC", label: "Underlying soil / roof (°C)", min: 0, max: 50, step: 1, group: "heat" },
  { key: "heatMoistureAvailability", label: "Heat-day moisture (0–1)", min: 0, max: 1, step: 0.1, group: "heat" },
];

export function validateScenario(inputs: ScenarioInputs) {
  for (const { key, min, max } of SCENARIO_FIELDS) {
    if (!Number.isFinite(inputs[key]) || inputs[key] < min || inputs[key] > max)
      throw new RangeError(`${key} must be between ${min} and ${max}.`);
  }
  if (inputs.rainfallSeriesMm) {
    const series = inputs.rainfallSeriesMm;
    if (series.length === 0 || series.length > 2880 || series.some((n) => !Number.isFinite(n) || n < 0)
      || Math.abs(series.reduce((sum, n) => sum + n, 0) - inputs.rainfallMm) > 1e-6)
      throw new RangeError("Rainfall series must be nonnegative and sum to the event rainfall.");
  }
}
