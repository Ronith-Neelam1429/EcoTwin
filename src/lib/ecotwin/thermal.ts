import type { SurfaceParameters } from "./cellProperties";
import { validateScenario, type ScenarioInputs } from "./scenario";

const SIGMA = 5.670374419e-8; // Stefan–Boltzmann, W m−2 K−4
const AIR_VOLUMETRIC_HEAT_CAPACITY = 1206; // rho * cp, J m−3 K−1 near sea level
const PSYCHROMETRIC_CONSTANT = 0.066; // kPa K−1, assumed sea-level pressure
const saturationVaporPressure = (c: number) => 0.6108 * Math.exp(17.27 * c / (c + 237.3));

export type HeatBalance = {
  temperatureC: number;
  absorbedSolarWm2: number;
  netLongwaveWm2: number;
  sensibleHeatWm2: number;
  conductionWm2: number;
  latentHeatWm2: number;
  balanceErrorWm2: number;
};

/** Steady surface/ground-under-canopy balance, not neighborhood air temperature.
 * Rn = H + G + LE. McAdams convection, Stefan–Boltzmann longwave,
 * bulk aerodynamic vapor transfer with moisture-limited surface resistance.
 * Moisture is a maintained heat-day boundary condition, independent of the storm.
 */
export function solveSurfaceHeat(p: SurfaceParameters, inputs: ScenarioInputs): HeatBalance {
  validateScenario(inputs);
  const h = 5.7 + 3.8 * inputs.windSpeedMs;
  const aerodynamicResistance = AIR_VOLUMETRIC_HEAT_CAPACITY / h;
  const vaporPressure = saturationVaporPressure(inputs.airTemperatureC) * inputs.relativeHumidityPercent / 100;
  const absorbedSolar = inputs.solarRadiationWm2 * (1 - p.albedo) * (1 - p.canopy * p.shadeEfficiency);
  // Canopy blocks sky and emits approximately at air temperature.
  const incomingLongwave = SIGMA * ((1 - p.canopy) * (inputs.skyTemperatureC + 273.15) ** 4
    + p.canopy * (inputs.airTemperatureC + 273.15) ** 4);
  function fluxes(temperature: number) {
    const netLongwave = p.emissivity * (incomingLongwave - SIGMA * (temperature + 273.15) ** 4);
    const sensible = h * (temperature - inputs.airTemperatureC);
    const conduction = p.thermalConductanceWm2K * (temperature - inputs.substrateTemperatureC);
    const latent = inputs.heatMoistureAvailability === 0 || p.evaporatingFraction === 0 ? 0
      : p.evaporatingFraction * AIR_VOLUMETRIC_HEAT_CAPACITY / PSYCHROMETRIC_CONSTANT
        * Math.max(0, saturationVaporPressure(temperature) - vaporPressure)
        / (aerodynamicResistance + p.surfaceResistanceSm / inputs.heatMoistureAvailability);
    return { absorbedSolarWm2: absorbedSolar, netLongwaveWm2: netLongwave,
      sensibleHeatWm2: sensible, conductionWm2: conduction, latentHeatWm2: latent,
      balanceErrorWm2: absorbedSolar + netLongwave - sensible - conduction - latent };
  }
  let low = -80, high = 120;
  if (fluxes(low).balanceErrorWm2 < 0 || fluxes(high).balanceErrorWm2 > 0)
    throw new RangeError("Surface temperature lies outside the solver's supported range.");
  for (let i = 0; i < 60; i++) {
    const mid = (low + high) / 2;
    if (fluxes(mid).balanceErrorWm2 > 0) low = mid;
    else high = mid;
  }
  const temperatureC = (low + high) / 2;
  return { temperatureC, ...fluxes(temperatureC) };
}
