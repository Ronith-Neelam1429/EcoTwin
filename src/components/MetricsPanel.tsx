import { Droplets, Gauge, Sprout, ThermometerSun, Trees } from "lucide-react";
import type { EcoMetrics } from "../lib/ecotwin/types";

function signed(value: number, suffix: string) {
  const rounded = Math.abs(value) < 0.05 ? 0 : value;
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(1)}${suffix}`;
}

export function MetricsPanel({
  current,
  baseline,
}: {
  current: EcoMetrics;
  baseline: EcoMetrics;
}) {
  const temperatureDelta =
    current.averageTemperature - baseline.averageTemperature;
  const runoffDelta = baseline.totalRunoff > 1e-9
    ? ((current.totalRunoff - baseline.totalRunoff) / baseline.totalRunoff) * 100 : null;
  const canopyDelta = (current.averageCanopy - baseline.averageCanopy) * 100;
  const infiltrationDelta =
    (current.averageInfiltration - baseline.averageInfiltration) * 100;

  const metrics = [
    {
      label: "Mean surface temp.",
      value: `${current.averageTemperature.toFixed(1)}°C`,
      icon: ThermometerSun,
      tone: "warm",
    },
    {
      label: "Hottest surface",
      value: `${current.maxTemperature.toFixed(1)}°C`,
      icon: Gauge,
      tone: "warm",
    },
    {
      label: "Event runoff",
      value: `${current.totalRunoff.toLocaleString(undefined, { maximumFractionDigits: 1 })} m³`,
      icon: Droplets,
      tone: "water",
    },
    {
      label: "Rain entering soil",
      value: `${(current.averageInfiltration * 100).toFixed(0)}%`,
      icon: Sprout,
      tone: "green",
    },
    {
      label: "Tree canopy",
      value: `${(current.averageCanopy * 100).toFixed(0)}%`,
      icon: Trees,
      tone: "green",
    },
  ];

  return (
    <aside className="metrics-panel">
      <div className="metrics-title">
        <div>
          <span className="panel-kicker">Analysis</span>
          <h2>Scenario metrics</h2>
        </div>
        <span className="intervention-count">
          {current.interventions} placed
        </span>
      </div>
      <p className="model-note">
        Physics estimates · Uncalibrated. Temperatures describe surfaces under
        the selected heat conditions. Runoff is rain leaving individual cells,
        not predicted flooding or drainage-network flow.
      </p>

      <div className="metrics-grid">
        {metrics.map(({ label, value, icon: Icon, tone }) => (
          <div className="metric" key={label}>
            <span className={`metric-icon ${tone}`}>
              <Icon size={16} />
            </span>
            <span>
              <small>{label}</small>
              <strong>{value}</strong>
            </span>
          </div>
        ))}
      </div>

      <div className="impact-block">
        <span className="panel-kicker">Change from baseline</span>
        <div className="impact-row">
          <span>Surface temperature</span>
          <strong className={temperatureDelta <= 0 ? "positive" : "negative"}>
            {signed(temperatureDelta, "°C")}
          </strong>
        </div>
        <div className="impact-row">
          <span>Runoff</span>
          <strong className={current.totalRunoff <= baseline.totalRunoff ? "positive" : "negative"}>
            {runoffDelta === null ? signed(current.totalRunoff - baseline.totalRunoff, " m³") : signed(runoffDelta, "%")}
          </strong>
        </div>
        <div className="impact-row">
          <span>Canopy</span>
          <strong className={canopyDelta >= 0 ? "positive" : "negative"}>
            {signed(canopyDelta, " pts")}
          </strong>
        </div>
        <div className="impact-row">
          <span>Infiltration</span>
          <strong className={infiltrationDelta >= 0 ? "positive" : "negative"}>
            {signed(infiltrationDelta, " pts")}
          </strong>
        </div>
      </div>
      <details className="model-details">
        <summary>Where the rain goes</summary>
        <p>Volumes at the end of the event. Stored water may drain later; roof drainage is included in runoff.</p>
        {[
          ["Rainfall", current.totalRainfall], ["Runoff", current.totalRunoff],
          ["Into ground soil", current.totalInfiltration], ["Still stored", current.totalStored],
          ["Caught by trees", current.totalInterception],
        ].map(([label, value]) => <div className="impact-row" key={label}><span>{label}</span><strong>{Number(value).toFixed(1)} m³</strong></div>)}
      </details>
      <details className="model-details">
        <summary>Assumptions & confidence</summary>
        <p>{(current.unknownAreaFraction * 100).toFixed(0)}% of this scenario uses unmapped ground assumptions. All material properties are estimates.</p>
        <p>Each edit changes a full 100 m² cell. A tree represents a mature tree with a soil planting area and about 50 m² of canopy. Roofs and rain gardens do not count as tree canopy.</p>
        <p>Flat terrain; no flow between cells, drains, building shadows, air-temperature prediction, or snow. Rain gardens receive rain on their own cell only.</p>
        <p>Water balance error: {Math.abs(current.waterBalanceError).toExponential(1)} m³. Heat balance error: {current.maxEnergyBalanceError.toExponential(1)} W/m². These check the calculations, not site accuracy.</p>
      </details>
    </aside>
  );
}
