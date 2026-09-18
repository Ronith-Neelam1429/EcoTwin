import type { MultiPolygon } from 'polygon-clipping';

export const BUILDING_CATEGORIES = {
  large_store: 'Large store', small_store: 'Small store', retail_complex: 'Retail complex',
  residential: 'Residential', office: 'Office / civic', warehouse: 'Warehouse', unknown: 'Unclassified building',
} as const;
export type BuildingCategory = keyof typeof BUILDING_CATEGORIES;
export type BuildingIdentity = {
  category: BuildingCategory;
  source: 'mapped' | 'inferred' | 'user';
  tenants: string[];
};

export function footprintArea(polygons: MultiPolygon) {
  const area = (ring: number[][]) => Math.abs(ring.reduce((sum, [x, z], i) => {
    const next = ring[(i + 1) % ring.length];
    return sum + x * next[1] - next[0] * z;
  }, 0)) / 2;
  return polygons.reduce((sum, [outer, ...holes]) => sum + area(outer) - holes.reduce((n, ring) => n + area(ring), 0), 0) * 100;
}

/** Mapped identities take precedence over size guesses; never invent a business name. */
export function classifyBuilding(tags: Record<string, string>, polygons: MultiPolygon, tenants: string[] = []): BuildingIdentity {
  const name = [tags.name, tags.brand, ...tenants].filter(Boolean).join(' ');
  const kind = tags.building ?? '';
  let category: BuildingCategory = 'unknown';
  if (/^(house|residential|apartments|detached|terrace|bungalow|dormitory)$/.test(kind)) category = 'residential';
  else if (/^(warehouse|industrial)$/.test(kind)) category = 'warehouse';
  else if (/^(office|school|hospital|civic|university|college)$/.test(kind)) category = 'office';
  else if (tenants.length > 1 || tags.shop === 'mall') category = 'retail_complex';
  else if (tags.shop === 'supermarket' || /\b(qfc|costco|safeway|walmart|target|fred meyer)\b/i.test(name)) category = 'large_store';
  else if (/\b(great clips|supercuts)\b/i.test(name) || /^(hairdresser|beauty|bakery|convenience)$/.test(tags.shop ?? '')) category = 'small_store';
  else if (tags.shop || /^(retail|commercial)$/.test(kind)) category = footprintArea(polygons) >= 1500 ? 'large_store' : 'small_store';
  return { category, source: category === 'unknown' ? 'inferred' : 'mapped', tenants };
}

export const BUILDING_STYLES: Record<BuildingCategory, { wall: string; roof: string; storefront: boolean }> = {
  large_store: { wall: '#c2b7a2', roof: '#a8aaa4', storefront: true },
  small_store: { wall: '#d8c8ac', roof: '#a6aca8', storefront: true },
  retail_complex: { wall: '#cdbd9f', roof: '#a7aba3', storefront: true },
  residential: { wall: '#c9bca9', roof: '#7f8581', storefront: false },
  office: { wall: '#b9c3c4', roof: '#a2a9ac', storefront: false },
  warehouse: { wall: '#aeb9ba', roof: '#c1c7c5', storefront: false },
  unknown: { wall: '#c1b7a7', roof: '#b4b4aa', storefront: false },
};
