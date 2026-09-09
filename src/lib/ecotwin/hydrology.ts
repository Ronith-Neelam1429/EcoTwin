import type { SurfaceParameters } from "./cellProperties";
import { validateScenario, type ScenarioInputs } from "./scenario";

export type WaterBalance = {
  rainfallMm: number;
  runoffMm: number;
  infiltrationMm: number;
  storedMm: number;
  interceptedMm: number;
  roofDrainageMm: number;
  balanceErrorMm: number;
};

/** Integrated Green–Ampt ponded infiltration; lengths mm, time hours.
 * Solves dF/dt = K(1 + suction * moistureDeficit / F) without a singular F=0 step.
 * EPA SWMM Hydrology Reference, §4.4. This is not the SWMM implementation.
 */
export function greenAmptIncrement(f: number, conductivity: number, suctionDeficit: number, hours: number) {
  if (![f, conductivity, suctionDeficit, hours].every((n) => Number.isFinite(n) && n >= 0))
    throw new RangeError("Green–Ampt inputs must be finite and nonnegative.");
  const kt = conductivity * hours;
  if (kt === 0 || suctionDeficit === 0) return kt;
  let low = 0;
  // The F=0 asymptote supplies a conservative upper bracket at every F >= 0.
  let high = kt + Math.sqrt(2 * suctionDeficit * kt) + suctionDeficit;
  for (let i = 0; i < 48; i++) {
    const increment = (low + high) / 2;
    const integrated = increment - suctionDeficit * Math.log1p(increment / (f + suctionDeficit));
    if (integrated < kt) low = increment;
    else high = increment;
  }
  return (low + high) / 2;
}

/** Uniform or piecewise-constant storm, independent horizontal cells; no runoff routing.
 * Rain is supplied at the start of each substep, then infiltration/storage/overflow
 * are resolved conservatively. Default 30 s; integration error is convergence tested.
 * Roof water goes into finite retention + a drained reservoir, never into ground soil.
 */
export function simulateStorm(p: SurfaceParameters, inputs: ScenarioInputs, stepSeconds = 30): WaterBalance {
  validateScenario(inputs);
  if (!Number.isFinite(stepSeconds) || stepSeconds < 1 || stepSeconds > 300)
    throw new RangeError("Storm timestep must be between 1 and 300 seconds.");
  let infiltration = 0, runoff = 0, surfaceStorage = 0, interception = 0;
  let roofRetention = 0, roofDetention = 0, roofDrainage = 0, aggregateStorage = 0;
  const bins = inputs.rainfallSeriesMm ?? [inputs.rainfallMm];
  const binHours = inputs.stormDurationHours / bins.length;
  const steps = Math.ceil(binHours * 3600 / stepSeconds);
  const dt = binHours / steps;
  const suctionDeficit = p.suctionHeadMm * p.porosity * (1 - inputs.initialSoilSaturation);
  const roofRetentionCapacity = p.roofRetentionMm * (1 - inputs.initialSoilSaturation);

  for (const binRain of bins) {
    const rain = binRain / steps;
    for (let i = 0; i < steps; i++) {
      const caught = Math.min(rain, Math.max(0, p.interceptionMm - interception));
      interception += caught;
      surfaceStorage += rain - caught;
      if (p.hydrology === "soil") {
        const capacity = greenAmptIncrement(infiltration, inputs.soilConductivityMmH, suctionDeficit, dt);
        const absorbed = Math.min(surfaceStorage, capacity, p.intakeMmH * dt);
        infiltration += absorbed;
        surfaceStorage -= absorbed;
      } else if (p.hydrology === "pavement") {
        const capacity = greenAmptIncrement(infiltration, inputs.soilConductivityMmH, suctionDeficit, dt);
        const intake = Math.min(surfaceStorage, p.intakeMmH * dt,
          Math.max(0, p.aggregateStorageMm - aggregateStorage) + Math.min(aggregateStorage, capacity));
        surfaceStorage -= intake;
        aggregateStorage += intake;
        const absorbed = Math.min(aggregateStorage, capacity);
        aggregateStorage -= absorbed;
        infiltration += absorbed;
      } else if (p.hydrology === "roof") {
        const drain = roofDetention * (1 - Math.exp(-p.roofDrainRatePerHour * dt));
        roofDetention -= drain;
        roofDrainage += drain;
        runoff += drain;
        const intake = Math.min(surfaceStorage, p.intakeMmH * dt,
          Math.max(0, roofRetentionCapacity - roofRetention) + Math.max(0, p.roofDetentionMm - roofDetention));
        const retained = Math.min(intake, Math.max(0, roofRetentionCapacity - roofRetention));
        roofRetention += retained;
        roofDetention += intake - retained;
        surfaceStorage -= intake;
      }
      const overflow = Math.max(0, surfaceStorage - p.storageMm);
      runoff += overflow;
      surfaceStorage -= overflow;
    }
  }
  const stored = surfaceStorage + roofRetention + roofDetention + aggregateStorage;
  return {
    rainfallMm: inputs.rainfallMm, runoffMm: runoff, infiltrationMm: infiltration,
    storedMm: stored, interceptedMm: interception, roofDrainageMm: roofDrainage,
    balanceErrorMm: inputs.rainfallMm - runoff - infiltration - stored - interception,
  };
}
