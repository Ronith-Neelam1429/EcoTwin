import { useId, useState } from "react";
import { Download, Droplets, Gauge, Sprout, ThermometerSun, Trees } from "lucide-react";
import type { ScenarioTimelinePoint } from "../lib/ecotwin/simulation";
import type { EcoMetrics } from "../lib/ecotwin/types";

function signed(value: number, suffix: string) {
  const rounded = Math.abs(value) < 0.05 ? 0 : value;
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(1)}${suffix}`;
}

export function MetricsPanel({
  current,
  baseline,
  currentTimeline,
  baselineTimeline,
}: {
  current: EcoMetrics;
  baseline: EcoMetrics;
  currentTimeline: ScenarioTimelinePoint[];
  baselineTimeline: ScenarioTimelinePoint[];
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
      <div className="model-note">
        <span>ESTIMATE</span>
        <strong>Uncalibrated model</strong>
      </div>

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
      <MetricsTimeline current={currentTimeline} baseline={baselineTimeline} />
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

type TimelineMetric = "totalRunoff" | "totalInfiltration" | "totalStored";
const TIMELINE_METRICS: { key: TimelineMetric; label: string; shortLabel: string }[] = [
  { key: "totalRunoff", label: "Cumulative runoff", shortLabel: "Runoff" },
  { key: "totalInfiltration", label: "Cumulative rain entering soil", shortLabel: "Into soil" },
  { key: "totalStored", label: "Water still stored", shortLabel: "Stored" },
];

function MetricsTimeline({ current, baseline }: {
  current: ScenarioTimelinePoint[];
  baseline: ScenarioTimelinePoint[];
}) {
  const [metric, setMetric] = useState<TimelineMetric>("totalRunoff");
  const chartId = useId();
  const definition = TIMELINE_METRICS.find((item) => item.key === metric)!;
  const width = 252, height = 116, left = 4, right = 4, top = 8, bottom = 20;
  const duration = current.at(-1)?.elapsedHours || 1;
  const maximum = Math.max(1, ...current.map((point) => point.metrics[metric]), ...baseline.map((point) => point.metrics[metric]));
  const path = (points: ScenarioTimelinePoint[]) => points.map((point, index) => {
    const x = left + point.elapsedHours / duration * (width - left - right);
    const y = top + (1 - point.metrics[metric] / maximum) * (height - top - bottom);
    return `${index ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const currentEnd = current.at(-1)?.metrics[metric] ?? 0;
  const baselineEnd = baseline.at(-1)?.metrics[metric] ?? 0;

  function downloadResults() {
    const rows = current.map((point, index) => {
      const base = baseline[index]?.metrics ?? baseline.at(-1)!.metrics;
      const value = point.metrics;
      return [point.elapsedHours, value.totalRainfall, value.totalRunoff, base.totalRunoff,
        base.totalRunoff - value.totalRunoff, value.totalInfiltration, base.totalInfiltration,
        value.totalStored, base.totalStored];
    });
    const csv = [
      ["elapsed_hours", "rainfall_m3", "scenario_runoff_m3", "baseline_runoff_m3", "avoided_runoff_m3",
        "scenario_infiltration_m3", "baseline_infiltration_m3", "scenario_stored_m3", "baseline_stored_m3"],
      ...rows,
    ].map((row) => row.map((value) => typeof value === "number" ? value.toFixed(3) : value).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "ecotwin-scenario-over-time.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="timeline-block" aria-labelledby={`${chartId}-title`}>
      <div className="timeline-heading">
        <div>
          <span className="panel-kicker">During the storm</span>
          <strong id={`${chartId}-title`}>{definition.label}</strong>
        </div>
        <button type="button" className="timeline-download" onClick={downloadResults} title="Download all time-series results as CSV">
          <Download size={14} /> CSV
        </button>
      </div>
      <div className="timeline-tabs" aria-label="Chart metric">
        {TIMELINE_METRICS.map((item) => (
          <button type="button" key={item.key} className={metric === item.key ? "is-active" : ""}
            aria-pressed={metric === item.key} onClick={() => setMetric(item.key)}>{item.shortLabel}</button>
        ))}
      </div>
      <svg className="timeline-chart" viewBox={`0 0 ${width} ${height}`} role="img"
        aria-label={`${definition.label}: scenario ${currentEnd.toFixed(1)} cubic metres, baseline ${baselineEnd.toFixed(1)} cubic metres after ${duration.toFixed(1)} hours`}>
        <defs>
          <linearGradient id={`${chartId}-area`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#64a5ff" stopOpacity=".28" />
            <stop offset="1" stopColor="#64a5ff" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, .5, 1].map((fraction) => <line key={fraction} className="timeline-gridline" x1={left} x2={width - right}
          y1={top + fraction * (height - top - bottom)} y2={top + fraction * (height - top - bottom)} />)}
        <path className="timeline-area" d={`${path(current)} L${width - right},${height - bottom} L${left},${height - bottom} Z`} fill={`url(#${chartId}-area)`} />
        <path className="timeline-baseline-line" d={path(baseline)} />
        <path className="timeline-scenario-line" d={path(current)} />
        <text x={left} y={height - 5}>0h</text>
        <text x={width - right} y={height - 5} textAnchor="end">{duration.toFixed(duration < 10 ? 1 : 0)}h</text>
        <text x={width - right} y={top + 9} textAnchor="end">{maximum.toFixed(maximum < 10 ? 1 : 0)} m³</text>
      </svg>
      <div className="timeline-legend">
        <span><i className="scenario" />Scenario <strong>{currentEnd.toFixed(1)} m³</strong></span>
        <span><i className="baseline" />Baseline <strong>{baselineEnd.toFixed(1)} m³</strong></span>
      </div>
      <details className="timeline-results">
        <summary>View results over time</summary>
        <div className="timeline-result-header"><span>Time</span><span>Rain</span><span>{definition.shortLabel}</span></div>
        {current.map((point, index) => (
          <div className="timeline-result-row" key={point.elapsedHours}>
            <span>{point.elapsedHours.toFixed(point.elapsedHours < 10 ? 1 : 0)}h</span>
            <span>{point.metrics.totalRainfall.toFixed(1)}</span>
            <span>{point.metrics[metric].toFixed(1)} m³ <small>({(baseline[index]?.metrics[metric] ?? 0).toFixed(1)} base)</small></span>
          </div>
        ))}
      </details>
    </section>
  );
}
