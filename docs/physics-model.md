# EcoTwin physics engine, version 1

EcoTwin now computes scenario metrics from conservation equations and editable inputs. It is an **uncalibrated screening model**, not a validated site forecast. Correct equations and numerical conservation do not establish real-world accuracy. The model is useful for comparing interventions under the same stated conditions, while making missing information visible.

## Local weather instead of fixed weather scores

When a twin opens, `weather.ts` requests the selected coordinates from Open-Meteo. It selects the latest completed local day, imports its hourly precipitation pattern, and takes temperature, humidity, wind, sunlight, and soil conditions at the hour with the most sunlight. It shows the day, timezone, and heat snapshot time. The returned weather-grid coordinates and retrieval timestamp are retained in the weather result.

Open-Meteo supplies **weather-model output and archived forecasts**, not a thermometer or rain gauge at the property. Precipitation and shortwave radiation describe the preceding hour: the parser includes the midnight interval that closes the day. It handles 23- and 25-hour daylight-saving days, rejects incomplete or stale data, checks units, and rejects days with snow/freezing temperatures. A failed request leaves the current inputs unchanged and displays an error. Default inputs are clearly identified as design assumptions.

The loaded rainfall pattern is retained when heat or soil settings change. Editing rainfall depth or duration replaces that pattern with a uniform design storm. A rain-free weather day has zero runoff; use the rainfall controls or design defaults to test a storm.

Soil saturation is estimated from modeled volumetric soil moisture at 3–9 cm divided by assumed porosity 0.45, capped at one. Soil conductivity remains an editable assumption of 5 mm/h: weather cannot identify it. Modeled soil moisture also supplies the heat-day moisture boundary. The imported 10 m wind is used as a proxy for local surface wind, without urban sheltering correction. Soil temperature at 18 cm is a proxy for the underlying soil/roof temperature; a roof assembly needs its own calibrated boundary.

Effective sky temperature is estimated using Clark–Allen emissivity and the Walton cloud correction. Total cloud cover substitutes for opaque cloud cover. This is an approximation, not measured downwelling infrared radiation.

## Rainfall, infiltration, storage, and runoff

`hydrology.ts` advances each cell in steps no longer than 30 seconds, splitting exactly at the boundaries of the supplied rainfall bins. Each interval adds its rain, fills interception storage, permits infiltration/intake, and releases overflow. Rain is added at the beginning of the step, so timing has a small discretization error; tests compare 30-second results against 5-second results.

The cell water balance is:

`rainfall = runoff + infiltration into ground + water still stored + interception`

All terms are event depths in millimetres. The displayed site volumes multiply depth by 100 m² per cell and divide by 1,000 to give m³. For example, 25 mm of rain on one 100 m² asphalt cell with 1 mm of depression storage produces **2.4 m³ of runoff**, not a dimensionless score.

Ground infiltration uses Green–Ampt:

`dF/dt = K × (1 + ψ Δθ / F)`

Here `F` is cumulative infiltration in mm, `K` is saturated conductivity in mm/h, `ψ` is wetting-front suction in mm, and `Δθ = porosity × (1 − initial saturation)`. The solver integrates the ponded equation implicitly using bisection, including the initial `F = 0` limit. Actual infiltration is bounded by available water and surface/media intake. Wetter initial soil reduces capillary uptake; a saturated soil has infiltration capacity `K`. A rapid storm can exceed infiltration capacity even when a slower storm with the same rainfall does not.

Material behavior:

- Asphalt and conventional roofs have no ground infiltration and 1 mm of surface storage.
- Grass and tree planting cells infiltrate into native soil, with 3 and 5 mm of depression storage respectively. The default mature tree intercepts up to 1 mm averaged across the cell.
- Rain gardens have 150 mm of cell-area ponding storage. Native soil conductivity and a 100 mm/h media intake limit infiltration. They receive rain on their own cell only.
- Permeable pavement has 1 mm of surface storage, a 100 mm/h entry rate, and a separate 60 mm aggregate reservoir. Water leaving that reservoir enters native soil according to Green–Ampt. Intense rain can overflow before the reservoir fills if it exceeds pavement intake; impermeable subgrade produces no ground infiltration.
- Green roofs have no ground infiltration. Rain enters a finite retention bucket of `30 × (1 − initial saturation)` mm plus a 15 mm detention reservoir, at up to 50 mm/h. Detained water drains with a first-order rate of 1/h and is included in runoff. There is also 2 mm of surface storage. Retention, detention, and interception are explicitly reported as stored water, not infiltration.

All initial surface, interception, and detention stores are empty. Initial soil/roof wetness affects soil suction and remaining roof retention capacity; it does not initialize ponded water or an already-filled pavement reservoir. These are single-event assumptions. There is no storm evaporation, wetting-front recovery between rain bursts, groundwater feedback, or post-event drainage tail. Consequently, day-end storage is not an annual runoff reduction or permanent removal. At 24–48 hours, evaporation and antecedent storage can be material sources of error.

## Surface temperature from heat balance

`thermal.ts` solves an equilibrium surface temperature with a bounded root solver:

`absorbed sunlight + net longwave radiation = sensible heat + conduction + latent heat`

- Absorbed sunlight depends on incident radiation, albedo, and the canopy-shaded fraction.
- Longwave exchange uses Stefan–Boltzmann radiation with absolute temperatures in kelvin. Canopy obscures the sky and is approximated as radiating at air temperature.
- Sensible heat uses the McAdams convection coefficient `h = 5.7 + 3.8 × wind speed` in W/(m²·K).
- Conduction uses an effective material conductance times the temperature difference to the underlying soil/roof.
- Latent cooling uses bulk aerodynamic vapor transfer, humidity, an evaporating fraction, and surface resistance divided by moisture availability. Dry surfaces have zero evaporative cooling. Vapor pressure follows the FAO saturation-vapor-pressure relation; sea-level air properties are assumed.

Every flux is in W/m². The returned residual checks that the energy balance closes. This is a simplified resistance-based surface balance, not a complete implementation of EnergyPlus or the FAO reference evapotranspiration model.

The heat calculation is a **separate equilibrium snapshot**, not a thermal time series through the storm. Moisture is maintained as a boundary condition during that snapshot; the model does not promise unlimited cooling through a drought. It does not integrate thermal mass or deplete a plant water reservoir over time. For a tree cell, the temperature represents the effective shaded ground surface, not a leaf temperature. It does not solve pedestrian air temperature, humidity feedback, thermal comfort, or cooling transported into neighboring cells.

## Metrics and the map

`simulateScenario` is the single calculation path for the metrics panel and colored cells. It recomputes from cell surface types and current inputs, ignoring old stored scores. Baseline and edited runs share identical weather. Results are area-weighted because every grid cell has equal area. The mean is the spatial mean of equilibrium surface temperatures; “hottest surface” is the spatial maximum at that snapshot, not the hottest temperature over the day.

**Heat map** shows absolute equilibrium surface temperature on a fixed 10–60°C blue-to-red gradient, clipped at the ends. Ground colors interpolate between 10 m cell samples for display; roof colors retain their cell values. This smoothing is not a heat-transfer calculation and does not affect metrics. Unlit analysis materials keep the ground and roof colors independent of decorative scene shadows. **Sun & shade** combines modeled canopy shade with the reduction in absorbed shortwave solar radiation, and **Stormwater** shows event runoff depth avoided against baseline. These are modeled layers, not UV measurements, pedestrian shade footprints, flood depths, or routed downstream effects. Analysis clicks inspect cells without editing them; the selected-cell readout shows current values and signed changes from baseline. Interventions are placed in Surface view.

Runoff is local cell outflow, not a flood depth, peak discharge, or water routed to a catchment outlet. The runoff map uses mm per cell; site totals use m³. “Rain entering soil” is actual modeled ground infiltration divided by total rain. Green roofs are excluded from ground infiltration. Tree canopy uses projected tree cover; grass, rain gardens, and green roofs do not count as tree canopy. An intervention replaces an entire 100 m² cell. The tree tool represents an established approximately 8 m crown plus a soil planting area, not an instantly mature sapling inserted into unchanged pavement.

One result is calculated per distinct surface type for each run; cells then share that result. This is intentional: current forcing and material parameters are uniform within each class. The model has no spatial transfer process. The scene preserves geometry but still classifies whole cells, including partially occupied building cells, which can bias total roof area. The interface exposes the unknown-ground fraction.

## Parameter provenance and calibration

`cellProperties.ts` contains all material parameters with units and `scenario.ts` contains default forcing. Apart from physical constants and cited equation forms, the material values are **engineering assumptions chosen for this prototype**, not certified product specifications, mapped measurements, or a fitted dataset. Unknown ground is an assumed partially evaporating soil surface. No numerical confidence interval is displayed because there is no measured parameter distribution to support one.

`simulateScenario(cells, inputs, overrides)` accepts per-surface parameter overrides, allowing measured albedo, intake rate, reservoir capacity, conductance, canopy, porosity, and suction to replace defaults without changing the equations. The UI exposes forcing and native conductivity; material overrides currently use the code API.

To validate site accuracy, compare observed rainfall/runoff and surface temperatures over multiple events, fit a small identifiable set of soil/material parameters, and evaluate errors on separate events. Surface-cover surveys and actual crown sizes improve area accounting. Drainage-network and elevation data are necessary before implementing routed runoff or flood predictions. Local weather substantially improves forcing, but cannot replace these measurements. No percentage accuracy claim is justified yet.

## Verification

`npm test` covers independent analytical water-volume, saturated-soil, Green–Ampt, heat-balance, and sky-radiation benchmarks; conservation across all surface types; storm intensity/wetness response; finite roof and pavement storage; timestep convergence; dry and empty scenarios; input validation; stale-score protection; weather-unit checks; preceding-hour rainfall; daylight-saving transitions; and existing GIS/edit regressions. The convergence fixtures require 30-second runoff and infiltration to agree with 5-second results within 0.15 mm. These tests establish implementation consistency within the model assumptions, not field validation.

A live request at Bellevue College coordinates successfully returned the completed local day 2026-09-07, including zero rainfall and a sunniest-hour air temperature of 19°C. This was a connector smoke test, not a stored calibration dataset.

## Primary references

- [EPA SWMM Hydrology Reference, chapter 4](https://nepis.epa.gov/Exe/ZyPURL.cgi?Dockey=P100NYRA.TXT): Green–Ampt conceptual model. EcoTwin is not SWMM and does not implement SWMM hydraulic routing or its full LID layers.
- [EnergyPlus exterior surface heat balance](https://bigladdersoftware.com/epx/docs/25-2/engineering-reference/outside-surface-heat-balance.html): radiation, convection, conduction, and McAdams correlation.
- [FAO meteorological data and vapor-pressure relationships](https://www.fao.org/4/X0490E/x0490e07.htm) and [surface/aerodynamic resistance](https://www.fao.org/4/X0490E/x0490e06.htm).
- [EnergyPlus climate calculations](https://bigladdersoftware.com/epx/docs/22-1/engineering-reference/climate-calculations.html): Clark–Allen and Walton sky radiation approximation.
- [Open-Meteo API documentation](https://open-meteo.com/en/docs): variable units, timing, modeled weather provenance, and local-time behavior.
