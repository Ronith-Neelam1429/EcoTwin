import { BUILDING_CATEGORIES, type BuildingCategory, type BuildingIdentity } from '../lib/ecotwin/buildingModels';
import type { AreaFeature } from '../lib/ecotwin/geography';

export type BuildingOverride = { name: string; identity: BuildingIdentity };
export function BuildingLabels({ buildings, visible, onVisible, onChange }: {
  buildings: AreaFeature[]; visible: boolean; onVisible: (value: boolean) => void;
  onChange: (id: string, value: BuildingOverride) => void;
}) {
  return <details className="building-labels">
    <summary>Building labels · {buildings.length}</summary>
    <p>Names and uses come from map data. Choose a type for unmapped buildings. Shared storefronts keep their original complex outline.</p>
    <label className="building-label-toggle"><input type="checkbox" checked={visible} onChange={event => onVisible(event.target.checked)} /> Show labels in 3D</label>
    {buildings.map((building, index) => {
      const category = building.identity?.category ?? 'unknown';
      const update = (name: string, next: BuildingCategory) => onChange(building.id, {
        name, identity: { category: next, source: 'user', tenants: building.identity?.tenants ?? [] },
      });
      return <div className="building-label-editor" key={building.id}>
        <label>Building {index + 1}<input aria-label={`Building ${index + 1} name`} maxLength={80}
          placeholder="Building name" value={building.name ?? ''} onChange={event => update(event.target.value, category)} /></label>
        <select aria-label={`Building ${index + 1} type`} value={category} onChange={event => update(building.name ?? '', event.target.value as BuildingCategory)}>
          {Object.entries(BUILDING_CATEGORIES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        {!!building.identity?.tenants.length && <small>{building.identity.tenants.join(' · ')}</small>}
      </div>;
    })}
  </details>;
}
