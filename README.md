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
2. Enable **Maps JavaScript API**, **Places API**, **Maps Static API**, and **Street View Static API** in a Google Cloud project.
3. Add the browser API key to `.env`:

```bash
VITE_GOOGLE_MAPS_API_KEY=your_key_here
```

Restart the development server after changing the environment file. Restrict the key to the Maps JavaScript API, Places API, Maps Static API, Street View Static API, and the web origins that should be allowed to use it.

The map includes address/place autocomplete and interactive Street View. Street View is provided by the Maps JavaScript API and does not require a separate Street View Static API key. When a twin is created, EcoTwin requests a session-only Static Maps satellite image and analyzes it locally with a conservative RGB vegetation classifier. Darker, textured green cover is treated as tree canopy and receives an existing-tree model; brighter, smoother cover is treated as grass. The image is not written to disk or retained by EcoTwin.

## EcoTwin simulation

Navigate to a location on the map or in Street View, choose a resizable square or **Draw border**, and select **Create Digital Twin**. A custom border is made by clicking at least three points on the map; its red vertex handles can be dragged to reposition individual points, undone, or cleared before modeling. EcoTwin captures the selected area and camera direction, requests nearby OpenStreetMap geometry through OpenFreeMap, and builds the scene with real building footprints, road paths, and mapped vegetation areas. No extra API key is required for this step.

Buildings retain their polygon outlines, including courtyards, and are clipped at the scene boundary. Custom-border edge cells use fractional area coverage so aggregate heat, runoff, infiltration, canopy, and unmapped-area metrics include only the selected footprint. The tile provider's render height can include defaults, so it is always labeled estimated. Road widths use mapped width or lanes when available, otherwise defaults. Terrain is currently flat and roofs are simple extrusions. This is a geographic model, not a photorealistic reconstruction or a survey.

The editable simulation uses a 30 × 30 grid with 10m cells. Building intersections reserve cells for rooftop edits; other mapped surfaces are sampled at cell centres. Tree, rain garden, green roof, and permeable pavement interventions update physics-based scenario estimates. Green roofs require a building; ground tools cannot erase buildings. Restore Cell and Reset all changes return to the imported baseline. Edits survive switching views during the session.

Unmapped ground is visibly neutral and uses explicitly assumed soil and thermal properties; terrain elevation is zero throughout. Surface temperature and runoff are uncalibrated physics estimates, not measured real-world conditions. Satellite detection can fill otherwise-unmapped 10 m cells as baseline green zones, while mapped buildings and pavement retain priority. It is an approximate green-cover overlay, not a tree inventory: shadows, seasonal color, and artificial green surfaces can cause omissions or false positives. Missing buildings, elevations, roof shapes, and individual tree geometry are not reconstructed from Google imagery.

Data: [OpenStreetMap contributors, ODbL](https://www.openstreetmap.org/copyright), [OpenMapTiles](https://openmaptiles.org/), and [OpenFreeMap](https://openfreemap.org/). The browser requests the tiles covering the selected neighborhood from OpenFreeMap. Requests are bounded to the local area, deduplicated and cached in memory (plus normal browser HTTP caching), with a timeout, rate-limit cooldown, and explicit retry UI. A service failure does not silently substitute synthetic terrain. Public service availability and local mapping coverage vary; a production rollout should evaluate a dedicated data provider.

Geometry projection, clipping, road widths, grid mapping, and height handling live in `src/lib/ecotwin/geography.ts`. Environmental formulas remain separate in `simulation.ts`. Run `npm test` for spatial and intervention regression checks.

## Physics and local weather

The twin automatically attempts to load the latest completed local weather day from [Open-Meteo](https://open-meteo.com/). The request sends the selected coordinates and requires no extra API key. The interface shows the date/time and identifies the response as modeled weather. Rain keeps its hourly pattern; heat uses a snapshot at the sunniest hour. If weather is unavailable or unsupported, the current design assumptions remain visible and editable. Use **Use recent local weather** to retry or **Use design defaults** to test a 25 mm / 2 hour storm and a hot-day snapshot.

The engine uses Green–Ampt ground infiltration, finite water storage and roof drainage, and a surface energy balance. The panel and map share the same scenario results. Runoff is reported in m³ for the study area and mm on the map; temperatures are surface temperatures, and green-roof storage is not counted as infiltration into the ground. Baseline comparisons use identical forcing. Expand **Where the rain goes** and **Assumptions & confidence** for the water budget and limitations.

Local weather improves the inputs but does not measure soil conductivity, roof construction, tree canopy, or drainage. The model currently has no flow routing, building shadows, snow physics, or neighborhood air-temperature prediction. Each edit changes 100 m²; a tree means an established tree plus soil planting area. See [the physics model documentation](docs/physics-model.md) for equations, parameter provenance, validation, and the path to site calibration.

Checks: `npm test`, `npm run lint`, and `npm run build`.

## Realistic concept views

Place your interventions, orbit/zoom to the desired composition, then select **Realistic view → Generate realistic view**. EcoTwin captures the exact current 3D camera with the session-only Google satellite image aligned beneath the model, then requests the exact Street View panorama and camera that were active when the twin was created. Mapped business names and uses assign editable building categories under **Building labels**. Categories select footprint-following wall, flat-roof, and storefront modules; shared tenants remain one complex when separate outlines are unavailable. Unidentified buildings remain unclassified rather than receiving invented business names. The image request includes these labels and projected intervention bounds. Street View supplies existing façade appearance only and must not override the proposed design. A second capture isolates the visible eco models with depth occlusion, then composites that transparent layer over the AI result for both preview and download. This preserves visible green roofs, trees, gardens, and paving even when the image model omits them. Compare the result with the captured 3D angle, download it, or generate again after edits. Results remain available while switching views in the current session; a changed design is marked as out of date.

Set `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_IMAGE_ENDPOINT`, and `AZURE_OPENAI_IMAGE_DEPLOYMENT` in `.env`, then restart `npm run dev`. For the best building fidelity, use an Azure FLUX.2 pro or flex deployment and its provider route (`/providers/blackforestlabs/v1/flux-2-pro?api-version=preview` or `/providers/blackforestlabs/v1/flux-2-flex?api-version=preview`); EcoTwin then sends the 3D camera capture and Street View as two independent reference images. The existing FLUX.1 Kontext route remains supported and receives the full scene without a Street View inset, so the reference cannot cover proposed additions. Only FLUX.2 receives the separate Street View reference. Missing Street View no longer blocks generation. Set the deployment name to the model deployed in Azure. The key stays in the server process and must never have a `VITE_` prefix. Generation uses your Azure credits and requires image-model quota. See the [Azure FLUX image-edit documentation](https://learn.microsoft.com/en-us/azure/ai-foundry/foundry-models/how-to/use-foundry-models-flux).

The endpoint is included in both `npm run dev` and `npm run preview`, accepts only local-computer requests, and permits one generation at a time. A static-only deployment cannot generate images. For a public deployment, move the handler behind authenticated server routing with per-user quotas before exposing it. Satellite-grounded model captures are processed in memory; they are not saved on the server. Cancel stops waiting and aborts the upstream request, but an already-started generation may still incur API charges.

These are AI-generated planning concepts, not actual photographs or precise forecasts. The image model can still shift architecture relative to the preserved additions; compositing guarantees visibility, not AI camera or geometry fidelity. The editable 3D model and simulation remain the source of truth. Building classification uses map metadata and user corrections, not a separate vision classification model. The temporary satellite and Street View references are fetched only for the current generation and are processed in memory rather than saved by EcoTwin.

Browser regression checks: with the dev server running, open `/tests/browser/sceneCapture.html` to test the real GPU capture, occlusion, composition, and erase behavior. `/tests/browser/modelPreview.html` provides an offline model fixture for building labels, storefronts, and planted roofs.
