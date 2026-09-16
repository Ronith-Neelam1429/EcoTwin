import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { realisticViewMiddleware } from "./server/realisticView.ts";
import { googleSatelliteMiddleware } from "./server/googleSatellite.ts";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const realisticOptions = {
    apiKey: env.AZURE_OPENAI_API_KEY,
    endpoint: env.AZURE_OPENAI_IMAGE_ENDPOINT,
    deployment: env.AZURE_OPENAI_IMAGE_DEPLOYMENT,
  };
  return {
    plugins: [react(), {
      name: 'ecotwin-realistic-view',
      configureServer(server) {
        server.middlewares.use(googleSatelliteMiddleware({ apiKey: env.VITE_GOOGLE_MAPS_API_KEY }));
        server.middlewares.use(realisticViewMiddleware(realisticOptions));
      },
      configurePreviewServer(server) {
        server.middlewares.use(googleSatelliteMiddleware({ apiKey: env.VITE_GOOGLE_MAPS_API_KEY }));
        server.middlewares.use(realisticViewMiddleware(realisticOptions));
      },
    }],
  };
});
