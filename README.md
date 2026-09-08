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
2. Enable **Maps JavaScript API** in a Google Cloud project.
3. Add the browser API key to `.env`:

```bash
VITE_GOOGLE_MAPS_API_KEY=your_key_here
```

Restart the development server after changing the environment file. Restrict the key to the Maps JavaScript API and to the web origins that should be allowed to use it.
