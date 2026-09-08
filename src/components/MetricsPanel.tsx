import { Droplets, Gauge, Sprout, ThermometerSun, Trees } from "lucide-react";
import type { EcoMetrics } from "../lib/ecotwin/types";

function signed(value: number, suffix: string) {
  const rounded = Math.abs(value) < 0.05 ? 0 : value;
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(1)}${suffix}`;
}

export function MetricsPanel({ current, baseline }: { current: EcoMetrics; baseline: EcoMetrics }) {
  const temperatureDelta = current.averageTemperature - baseline.averageTemperature;
  const runoffDelta = ((current.totalRunoff - baseline.totalRunoff) / baseline.totalRunoff) * 100;
  const canopyDelta = (current.averageCanopy - baseline.averageCanopy) * 100;
  const infiltrationDelta = (current.averageInfiltration - baseline.averageInfiltration) * 100;

  const metrics = [
    { label: "Average heat", value: `${current.averageTemperature.toFixed(1)}°C`, icon: ThermometerSun, tone: "warm" },
    { label: "Peak heat", value: `${current.maxTemperature.toFixed(1)}°C`, icon: Gauge, tone: "warm" },
    { label: "Total runoff", value: current.totalRunoff.toLocaleString(undefined, { maximumFractionDigits: 0 }), icon: Droplets, tone: "water" },
    { label: "Infiltration", value: `${(current.averageInfiltration * 100).toFixed(0)}%`, icon: Sprout, tone: "green" },
    { label: "Canopy", value: `${(current.averageCanopy * 100).toFixed(0)}%`, icon: Trees, tone: "green" },
  ];

  return (
    <aside className="metrics-panel">
      <div className="metrics-title">
        <div><span className="panel-kicker">Live environment</span><h2>Scenario impact</h2></div>
        <span className="intervention-count">{current.interventions} placed</span>
      </div>

      <div className="metrics-grid">
        {metrics.map(({ label, value, icon: Icon, tone }) => (
          <div className="metric" key={label}>
            <span className={`metric-icon ${tone}`}><Icon size={16} /></span>
            <span><small>{label}</small><strong>{value}</strong></span>
          </div>
        ))}
      </div>

      <div className="impact-block">
        <span className="panel-kicker">Change from baseline</span>
        <div className="impact-row"><span>Temperature</span><strong className={temperatureDelta <= 0 ? "positive" : "negative"}>{signed(temperatureDelta, "°C")}</strong></div>
        <div className="impact-row"><span>Runoff</span><strong className={runoffDelta <= 0 ? "positive" : "negative"}>{signed(runoffDelta, "%")}</strong></div>
        <div className="impact-row"><span>Canopy</span><strong className={canopyDelta >= 0 ? "positive" : "negative"}>{signed(canopyDelta, " pts")}</strong></div>
        <div className="impact-row"><span>Infiltration</span><strong className={infiltrationDelta >= 0 ? "positive" : "negative"}>{signed(infiltrationDelta, " pts")}</strong></div>
      </div>
    </aside>
  );
}
