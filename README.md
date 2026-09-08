# EcoTwin

EcoTwin is an interactive environmental digital twin for testing neighborhood-scale interventions before they are built.

The first EcoTwin prototype screen displays an interactive Google map centered on Bellevue College.

## Getting Started

Install dependencies:

```bash
npm install
```

Start the local development server:

```bash
npm run dev
```

## Google Maps setup

1. Copy `.env.example` to `.env`.
2. Enable **Maps JavaScript API** and **Places API** in a Google Cloud project.
3. Add the browser API key to `.env`:

```bash
VITE_GOOGLE_MAPS_API_KEY=your_key_here
```

Restart the development server after changing the environment file. Restrict the key to the Maps JavaScript API, Places API, and the web origins that should be allowed to use it.

The map includes address/place autocomplete and interactive Street View. Street View is provided by the Maps JavaScript API and does not require a separate Street View Static API key.

## EcoTwin simulation

Navigate to a location on the map or in Street View and select **Create Digital Twin**. EcoTwin captures the active location and camera direction, requests nearby OpenStreetMap geometry through OpenFreeMap, and builds a 300m square scene with real building footprints, road paths, and mapped vegetation areas. No extra API key is required for this step.

Buildings retain their polygon outlines, including courtyards, and are clipped at the scene boundary. The tile provider's render height can include defaults, so it is always labeled estimated. Road widths use mapped width or lanes when available, otherwise defaults. Terrain is currently flat and roofs are simple extrusions. This is a geographic model, not a photorealistic reconstruction or a survey.

The editable simulation uses a 30 × 30 grid with 10m cells. Building intersections reserve cells for rooftop edits; other mapped surfaces are sampled at cell centres. Tree, rain garden, green roof, and permeable pavement interventions update the illustrative environmental metrics. Green roofs require a building; ground tools cannot erase buildings. Restore Cell and Reset all changes return to the imported baseline. Edits survive switching views during the session.

Unmapped ground is visibly neutral. Its simulation assumptions are heat absorption 0.65, infiltration 0.3, and zero canopy; terrain elevation is zero throughout. Heat/runoff values are model estimates, not measured real-world conditions. Missing buildings, ground cover, trees, elevations, and roof shapes are not reconstructed from Google imagery.

Data: [OpenStreetMap contributors, ODbL](https://www.openstreetmap.org/copyright), [OpenMapTiles](https://openmaptiles.org/), and [OpenFreeMap](https://openfreemap.org/). The browser requests the tiles covering the selected neighborhood from OpenFreeMap. Requests are bounded to the local area, deduplicated and cached in memory (plus normal browser HTTP caching), with a timeout, rate-limit cooldown, and explicit retry UI. A service failure does not silently substitute synthetic terrain. Public service availability and local mapping coverage vary; a production rollout should evaluate a dedicated data provider.

Geometry projection, clipping, road widths, grid mapping, and height handling live in `src/lib/ecotwin/geography.ts`. Environmental formulas remain separate in `simulation.ts`. Run `npm test` for spatial and intervention regression checks.
