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

Navigate to a location on the map or in Street View and select **Create Digital Twin**. The prototype captures the current coordinates and camera direction, then generates a deterministic 30 × 30 editable simulation grid. Tree, rain garden, green roof, and permeable pavement interventions update the heat, runoff, infiltration, and canopy metrics immediately.

The terrain is intentionally synthetic for this MVP. Simulation logic lives in `src/lib/ecotwin` so it can later be replaced with real GIS and environmental data without rebuilding the interface.
