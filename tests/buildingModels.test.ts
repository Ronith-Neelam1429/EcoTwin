import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyBuilding, footprintArea } from '../src/lib/ecotwin/buildingModels.ts';
import { parseGeoNeighborhood } from '../src/lib/ecotwin/geography.ts';
import { tileTags } from '../src/lib/ecotwin/vectorSource.ts';
import type { MultiPolygon } from 'polygon-clipping';

const footprint: MultiPolygon = [[[[0, 0], [5, 0], [5, 4], [0, 4], [0, 0]]]];
test('business identities override size guesses and unidentified buildings stay unknown', () => {
  assert.equal(classifyBuilding({ name: 'QFC' }, footprint).category, 'large_store');
  assert.equal(classifyBuilding({ name: 'Great Clips' }, footprint).category, 'small_store');
  assert.equal(classifyBuilding({ building: 'apartments' }, footprint).category, 'residential');
  assert.equal(classifyBuilding({ building: 'retail' }, footprint).category, 'large_store');
  assert.equal(classifyBuilding({ building: 'yes' }, footprint).category, 'unknown');
  assert.equal(footprintArea(footprint), 2000);
});
test('point tenants label a shared complex without inventing or splitting its footprint', () => {
  const result = parseGeoNeighborhood({ type: 'FeatureCollection', features: [
    { type: 'Feature', id: 'building', properties: { building: 'yes' }, geometry: { type: 'Polygon', coordinates: [[[0, 0], [0.001, 0], [0.001, 0.001], [0, 0.001], [0, 0]]] } },
    ...['QFC', 'Great Clips'].map((name, i) => ({ type: 'Feature' as const, id: `shop${i}`, properties: { name, shop: 'yes' }, geometry: { type: 'Point' as const, coordinates: [0.0002 + i * 0.0003, 0.0003] } })),
  ] }, { lat: 0.0005, lng: 0.0005, radiusMeters: 150, heading: 0, pitch: 0 });
  assert.equal(result.buildings, 1);
  assert.equal(result.features[0].identity?.category, 'retail_complex');
  assert.deepEqual(result.features[0].identity?.tenants, ['QFC', 'Great Clips']);
});
test('fallback tiles preserve mapped shop names', () => {
  assert.deepEqual(tileTags('poi', { name: 'QFC', class: 'shop', subclass: 'supermarket' }), { name: 'QFC', shop: 'supermarket' });
});
