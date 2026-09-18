import { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { EcoTwinScene, type SceneCapture } from '../../src/components/EcoTwinScene';
import { BuildingLabels, type BuildingOverride } from '../../src/components/BuildingLabels';
import { parseGeoNeighborhood } from '../../src/lib/ecotwin/geography';
import '../../src/App.css';

const location = { lat: 0, lng: 0, heading: 0, pitch: 0, radiusMeters: 50 };
const neighborhood = parseGeoNeighborhood({ type: 'FeatureCollection', features: [
  { type: 'Feature', id: 'large', properties: { name: 'QFC', building: 'retail', height: '7' }, geometry: { type: 'Polygon', coordinates: [[[-0.0003,-0.00015],[0.00005,-0.00015],[0.00005,0.00015],[-0.0003,0.00015],[-0.0003,-0.00015]]] } },
  { type: 'Feature', id: 'small', properties: { name: 'Great Clips', building: 'retail', height: '5' }, geometry: { type: 'Polygon', coordinates: [[[0.00017,0],[0.00032,0],[0.00032,0.00015],[0.00017,0.00015],[0.00017,0]]] } },
] }, location);
export function Preview() {
  const capture = useRef<SceneCapture>(null);
  const [image, setImage] = useState('');
  const [overrides, setOverrides] = useState<Record<string, BuildingOverride>>({});
  const [labels, setLabels] = useState(true);
  const modeled = { ...neighborhood, features: neighborhood.features.map(f => ({ ...f, ...overrides[f.id] })) };
  const cells = neighborhood.baseline.map(cell => cell.buildingId === 'large' && cell.col < 4 ? { ...cell, surfaceType: 'green_roof' as const } : cell);
  return <div style={{ padding: 20 }}>
    <h1>Building model preview</h1><p>Fixture: QFC with green roof additions, Great Clips small storefront.</p>
    <div style={{ display: 'flex', gap: 20 }}>
      <aside style={{ width: 250 }}><BuildingLabels buildings={modeled.features} visible={labels} onVisible={setLabels}
        onChange={(id, value) => setOverrides(current => ({ ...current, [id]: value }))} />
        <button onClick={() => setImage(capture.current!.capture().image)}>Capture proposed scene</button>
      </aside>
      <div style={{ width: 850, height: 600 }}><EcoTwinScene cells={cells} baselineCells={neighborhood.baseline} viewMode="surface" selectedTool="green_roof"
        onCellClick={() => {}} neighborhood={modeled} location={location} rainfallMm={0} captureRef={capture} showBuildingLabels={labels} /></div>
    </div>
    {image && <img src={image} alt="Captured proposed scene with planted roof" style={{ width: 650 }} />}
  </div>;
}
createRoot(document.getElementById('root')!).render(<Preview />);
