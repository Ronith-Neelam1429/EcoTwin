import type { IncomingMessage, ServerResponse } from "node:http";
import type { Connect } from "vite";

const EARTH_CIRCUMFERENCE_METERS = 2 * Math.PI * 6378137;
const IMAGE_SIZE = 640;
const IMAGE_SCALE = 2;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

type GoogleSatelliteOptions = { apiKey?: string };

export function satelliteZoom(lat: number, diameterMeters: number) {
  const paddedDiameter = Math.max(100, diameterMeters * 1.16);
  const numerator = Math.cos(lat * Math.PI / 180) * EARTH_CIRCUMFERENCE_METERS * IMAGE_SIZE;
  return Math.max(0, Math.min(21, Math.floor(Math.log2(numerator / (256 * paddedDiameter)))));
}

export function satelliteMetersPerPixel(lat: number, zoom: number) {
  return Math.cos(lat * Math.PI / 180) * EARTH_CIRCUMFERENCE_METERS / (256 * 2 ** zoom * IMAGE_SCALE);
}

export function googleSatelliteMiddleware(options: GoogleSatelliteOptions, request: typeof fetch = fetch): Connect.NextHandleFunction {
  return async (req: IncomingMessage, res: ServerResponse, next: Connect.NextFunction) => {
    const incoming = new URL(req.url ?? "/", "http://localhost");
    if (incoming.pathname !== "/api/google-satellite") return next();
    const reply = (status: number, body: object) => {
      if (!res.destroyed) {
        res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        res.end(JSON.stringify(body));
      }
    };
    const peer = req.socket.remoteAddress;
    if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(peer ?? ""))
      return reply(403, { error: "Satellite detection is available on this computer only." });
    try {
      if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host)
        return reply(403, { error: "Cross-origin requests are not allowed." });
    } catch {
      return reply(403, { error: "Invalid request origin." });
    }
    if (req.method !== "GET") return reply(405, { error: "Use GET to request a satellite image." });
    if (!options.apiKey) return reply(503, { error: "Add VITE_GOOGLE_MAPS_API_KEY to .env, then restart EcoTwin." });

    const lat = Number(incoming.searchParams.get("lat"));
    const lng = Number(incoming.searchParams.get("lng"));
    const diameter = Number(incoming.searchParams.get("diameter"));
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(diameter)
      || Math.abs(lat) > 85 || Math.abs(lng) > 180 || diameter < 100 || diameter > 1100)
      return reply(400, { error: "Invalid satellite study area." });

    const zoom = satelliteZoom(lat, diameter);
    const target = new URL("https://maps.googleapis.com/maps/api/staticmap");
    target.search = new URLSearchParams({
      center: `${lat},${lng}`,
      zoom: String(zoom),
      size: `${IMAGE_SIZE}x${IMAGE_SIZE}`,
      scale: String(IMAGE_SCALE),
      maptype: "satellite",
      format: "png",
      key: options.apiKey,
    }).toString();
    try {
      const response = await request(target, {
        headers: req.headers.referer ? { Referer: req.headers.referer } : undefined,
        signal: AbortSignal.timeout(20_000),
      });
      const contentType = response.headers.get("content-type") ?? "";
      if (!response.ok || !contentType.startsWith("image/"))
        return reply(502, { error: "Google satellite imagery is unavailable. Enable Maps Static API for this key and retry." });
      const image = new Uint8Array(await response.arrayBuffer());
      if (!image.length || image.length > MAX_IMAGE_BYTES)
        return reply(502, { error: "Google returned an invalid satellite image." });
      res.writeHead(200, {
        "Content-Type": contentType,
        "Content-Length": String(image.length),
        "Cache-Control": "no-store",
        "X-EcoTwin-Meters-Per-Pixel": String(satelliteMetersPerPixel(lat, zoom)),
        "X-EcoTwin-Map-Zoom": String(zoom),
      });
      res.end(image);
    } catch {
      reply(502, { error: "EcoTwin could not reach Google satellite imagery." });
    }
  };
}
