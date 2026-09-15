import { useState } from "react";
import { SCENARIO_FIELDS, type ScenarioInputs } from "../lib/ecotwin/scenario";
import type { LocalWeather } from "../lib/ecotwin/weather";

export function ScenarioControls({ inputs, onChange, weather, loading, error, customized, onUseDefaults }: {
  inputs: ScenarioInputs; onChange: (inputs: ScenarioInputs) => void;
  weather: LocalWeather | null; loading: boolean; error: string; customized: boolean; onUseDefaults: () => void;
}) {
  const [inputError, setInputError] = useState("");
  return (
    <section className="scenario-controls" aria-label="Scenario conditions">
      <h3>Conditions</h3>
      <div className="weather-status" aria-live="polite">
        <span>{loading ? "Loading local weather…" : weather
          ? `${customized ? "Edited local weather" : "Local weather"} · ${weather.date}`
          : "Design defaults"}</span>
        {weather && <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Source</a>}
      </div>
      {error && <p className="scenario-error" role="alert">{error} Current inputs are unchanged.</p>}
      {(["storm", "heat"] as const).map((group) => (
        <details key={group}>
          <summary>{group === "storm" ? "Storm" : "Heat"}</summary>
          {SCENARIO_FIELDS.filter((field) => field.group === group).map(({ key, label, min, max, step }) => (
            <label className="scenario-field" key={key}>
              <span>{label}</span>
              <input type="number" min={min} max={max} step={step} disabled={loading}
                key={`${key}-${inputs[key]}`} defaultValue={Number(inputs[key].toFixed(3))}
                onBlur={(event) => {
                  const value = event.currentTarget.valueAsNumber;
                  if (!Number.isFinite(value) || value < min || value > max) {
                    setInputError(`${label} must be between ${min} and ${max}.`);
                    event.currentTarget.value = String(Number(inputs[key].toFixed(3)));
                    return;
                  }
                  setInputError("");
                  if (Math.abs(value - inputs[key]) < 0.00051) return;
                  onChange({ ...inputs, [key]: value,
                    rainfallSeriesMm: key === "rainfallMm" || key === "stormDurationHours" ? undefined : inputs.rainfallSeriesMm });
                }}
                onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} />
            </label>
          ))}
        </details>
      ))}
      {inputError && <p className="scenario-error" role="alert">{inputError}</p>}
      <button type="button" className="scenario-reset" disabled={loading} onClick={onUseDefaults}>Reset conditions</button>
    </section>
  );
}
