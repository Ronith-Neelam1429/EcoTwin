import { DEFAULT_SCENARIO, validateScenario, type ScenarioInputs } from "./scenario";
import type { TwinLocation } from "./types";

export type LocalWeather = {
  inputs: ScenarioInputs;
  date: string;
  heatTime: string;
  timezone: string;
  fetchedAt: string;
  gridLatitude: number;
  gridLongitude: number;
};

const VARIABLES = ["temperature_2m", "relative_humidity_2m", "dew_point_2m", "wind_speed_10m",
  "shortwave_radiation", "precipitation", "snowfall", "cloud_cover", "soil_temperature_18cm", "soil_moisture_3_to_9cm"];

export function weatherUrl(location: Pick<TwinLocation, "lat" | "lng">) {
  if (!Number.isFinite(location.lat) || !Number.isFinite(location.lng) || Math.abs(location.lat) > 85 || Math.abs(location.lng) > 180)
    throw new RangeError("Invalid weather location.");
  const query = new URLSearchParams({ latitude: String(location.lat), longitude: String(location.lng),
    hourly: VARIABLES.join(","), past_days: "2", forecast_days: "1", timezone: "auto",
    timeformat: "unixtime", wind_speed_unit: "ms", temperature_unit: "celsius", precipitation_unit: "mm" });
  return `https://api.open-meteo.com/v1/forecast?${query}`;
}

/** Clark–Allen clear-sky emissivity with Walton cloud adjustment.
 * Total cloud cover substitutes for opaque cover: an explicit approximation.
 */
export function effectiveSkyTemperature(airC: number, dewPointC: number, cloudPercent: number) {
  const n = cloudPercent / 10;
  const emissivity = Math.min(1, Math.max(0, (0.787 + 0.764 * Math.log((dewPointC + 273.15) / 273))
    * (1 + 0.0224 * n - 0.0035 * n ** 2 + 0.00028 * n ** 3)));
  return (airC + 273.15) * emissivity ** 0.25 - 273.15;
}

export function parseLocalWeather(raw: unknown, now = new Date()): LocalWeather {
  if (!raw || typeof raw !== "object") throw new Error("Weather response is missing.");
  const data = raw as { timezone?: string; latitude?: number; longitude?: number;
    hourly?: Record<string, unknown>; hourly_units?: Record<string, string> };
  const hourly = data.hourly;
  if (!hourly || !Array.isArray(hourly.time) || typeof data.timezone !== "string"
    || !Number.isFinite(data.latitude) || !Number.isFinite(data.longitude)) throw new Error("Weather response is incomplete.");
  const expectedUnits: Record<string, string> = { temperature_2m: "°C", relative_humidity_2m: "%", dew_point_2m: "°C", wind_speed_10m: "m/s",
    shortwave_radiation: "W/m²", precipitation: "mm", snowfall: "cm", cloud_cover: "%", soil_temperature_18cm: "°C", soil_moisture_3_to_9cm: "m³/m³", time: "unixtime" };
  for (const [key, unit] of Object.entries(expectedUnits)) {
    if (data.hourly_units?.[key] !== unit) throw new Error(`Unexpected weather units for ${key}.`);
  }
  const times = hourly.time as unknown[];
  const read = (key: string, index: number): number => {
    const values = hourly[key];
    const value = Array.isArray(values) ? values[index] : undefined;
    if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`Missing weather data: ${key}.`);
    return value;
  };
  const dateFormat = new Intl.DateTimeFormat("en-CA", { timeZone: data.timezone, year: "numeric", month: "2-digit", day: "2-digit" });
  const dayOf = (seconds: number) => dateFormat.format(new Date(seconds * 1000));
  const today = dateFormat.format(now);
  // Precipitation and radiation describe the PRECEDING hour. Midnight closes
  // yesterday's final interval; it must not be attributed to today's rainfall.
  const groups = new Map<string, number[]>();
  times.forEach((_, index) => {
    const time = read("time", index);
    const day = dayOf(time - 1);
    if (day < today && time <= now.getTime() / 1000) groups.set(day, [...(groups.get(day) ?? []), index]);
  });
  const date = [...groups.keys()].sort().at(-1);
  if (!date) throw new Error("No completed local weather day is available.");
  const indices = groups.get(date)!;
  const first = indices[0], last = indices.at(-1)!;
  const start = read("time", first) - 3600, end = read("time", last);
  const hourFormat = new Intl.DateTimeFormat("en-GB", { timeZone: data.timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  if (indices.length < 23 || indices.length > 25 || indices.some((index, i) => i > 0 && read("time", index) - read("time", indices[i - 1]) !== 3600)
    || hourFormat.format(new Date(start * 1000)) !== "00:00" || hourFormat.format(new Date(end * 1000)) !== "00:00"
    || now.getTime() / 1000 - end > 48 * 3600)
    throw new Error("A complete recent weather day is not available.");
  // This liquid-water engine has no snow accumulation/melt or frozen-soil physics.
  if (indices.some((index) => read("snowfall", index) > 0 || read("temperature_2m", index) < 0))
    throw new Error("This day includes snow or freezing temperatures. Use a nonfreezing design scenario.");
  const peak = indices.reduce((best, index) => read("shortwave_radiation", index) > read("shortwave_radiation", best) ? index : best, first);
  const rainfallSeriesMm = indices.map((index) => read("precipitation", index));
  const moisture = (index: number) => {
    const theta = read("soil_moisture_3_to_9cm", index);
    if (theta < 0 || theta > 1) throw new Error("Invalid modeled soil moisture.");
    return Math.min(1, theta / 0.45); // Assumed porosity; not a soil survey.
  };
  const air = read("temperature_2m", peak);
  const clouds = read("cloud_cover", peak);
  const dew = read("dew_point_2m", peak);
  if (clouds < 0 || clouds > 100 || dew > air + 0.1 || dew < -100) throw new Error("Invalid sky conditions.");
  const inputs: ScenarioInputs = {
    ...DEFAULT_SCENARIO, rainfallSeriesMm,
    rainfallMm: rainfallSeriesMm.reduce((sum, n) => sum + n, 0), stormDurationHours: indices.length,
    initialSoilSaturation: moisture(first - 1),
    airTemperatureC: air, solarRadiationWm2: read("shortwave_radiation", peak),
    relativeHumidityPercent: read("relative_humidity_2m", peak), windSpeedMs: read("wind_speed_10m", peak),
    skyTemperatureC: effectiveSkyTemperature(air, dew, clouds), substrateTemperatureC: read("soil_temperature_18cm", peak),
    heatMoistureAvailability: moisture(peak),
  };
  validateScenario(inputs);
  return { inputs, date, heatTime: hourFormat.format(new Date(read("time", peak) * 1000)), timezone: data.timezone,
    fetchedAt: now.toISOString(), gridLatitude: data.latitude!, gridLongitude: data.longitude! };
}

export async function loadLocalWeather(location: Pick<TwinLocation, "lat" | "lng">, signal?: AbortSignal): Promise<LocalWeather> {
  const response = await fetch(weatherUrl(location), { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Local weather is unavailable (${response.status}). Please retry.`);
  return parseLocalWeather(await response.json());
}
