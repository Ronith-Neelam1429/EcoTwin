import type { IncomingMessage, ServerResponse } from "node:http";
import type { Connect } from "vite";

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const STREET_VIEW_HOST = "maps.googleapis.com";

type GoogleStreetViewOptions = { apiKey?: string };
type PanoramaMetadata = {
  status?: string;
  pano_id?: string;
  location?: { lat?: number; lng?: number };
};

function finiteParameter(search: URLSearchParams, name: string) {
  const raw = search.get(name);
  if (raw === null || raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/** Initial compass bearing from one WGS84 point to another. */
export function bearingBetween(fromLat: number, fromLng: number, toLat: number, toLng: number) {
  const radians = Math.PI / 180;
  const from = fromLat * radians;
  const to = toLat * radians;
  const delta = (toLng - fromLng) * radians;
  const y = Math.sin(delta) * Math.cos(to);
  const x = Math.cos(from) * Math.sin(to) - Math.sin(from) * Math.cos(to) * Math.cos(delta);
  return (Math.atan2(y, x) / radians + 360) % 360;
}

export function googleStreetViewMiddleware(
  options: GoogleStreetViewOptions,
  request: typeof fetch = fetch,
): Connect.NextHandleFunction {
  return async (req: IncomingMessage, res: ServerResponse, next: Connect.NextFunction) => {
    const incoming = new URL(req.url ?? "/", "http://localhost");
    if (incoming.pathname !== "/api/google-street-view") return next();
    const reply = (status: number, body: object) => {
      if (!res.destroyed) {
        res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        res.end(JSON.stringify(body));
      }
    };
    const peer = req.socket.remoteAddress;
    if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(peer ?? ""))
      return reply(403, { error: "Street View references are available on this computer only." });
    try {
      if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host)
        return reply(403, { error: "Cross-origin requests are not allowed." });
    } catch {
      return reply(403, { error: "Invalid request origin." });
    }
    if (req.method !== "GET") return reply(405, { error: "Use GET to request Street View." });
    if (!options.apiKey) return reply(503, { error: "Add VITE_GOOGLE_MAPS_API_KEY to .env, then restart EcoTwin." });

    const lat = finiteParameter(incoming.searchParams, "lat");
    const lng = finiteParameter(incoming.searchParams, "lng");
    const suppliedHeading = finiteParameter(incoming.searchParams, "heading");
    const pitch = finiteParameter(incoming.searchParams, "pitch") ?? 0;
    const fov = finiteParameter(incoming.searchParams, "fov") ?? 90;
    const suppliedPano = incoming.searchParams.get("pano")?.trim() ?? "";
    if (lat === null || lng === null || Math.abs(lat) > 85 || Math.abs(lng) > 180
      || pitch < -90 || pitch > 90 || fov < 10 || fov > 120
      || (suppliedHeading !== null && (suppliedHeading < 0 || suppliedHeading >= 360))
      || (suppliedPano && !/^[A-Za-z0-9_-]{1,256}$/.test(suppliedPano)))
      return reply(400, { error: "Invalid Street View location or camera." });

    try {
      const googleHeaders = req.headers.referer ? { Referer: req.headers.referer } : undefined;
      let pano = suppliedPano;
      let heading = suppliedHeading;
      if (!pano) {
        const metadataUrl = new URL(`https://${STREET_VIEW_HOST}/maps/api/streetview/metadata`);
        metadataUrl.search = new URLSearchParams({
          location: `${lat},${lng}`,
          radius: "250",
          source: "outdoor",
          key: options.apiKey,
        }).toString();
        const metadataResponse = await request(metadataUrl, { headers: googleHeaders, signal: AbortSignal.timeout(20_000) });
        if (!metadataResponse.ok) return reply(502, { error: "Google Street View metadata is unavailable." });
        const metadata = await metadataResponse.json() as PanoramaMetadata;
        const panoramaLat = metadata.location?.lat;
        const panoramaLng = metadata.location?.lng;
        if (metadata.status === "ZERO_RESULTS")
          return reply(404, { error: "No outdoor Street View panorama was found near this address." });
        if (metadata.status === "OVER_QUERY_LIMIT")
          return reply(429, { error: "Google Street View quota is exhausted. Check the Google Cloud project and retry." });
        if (metadata.status !== "OK" || !metadata.pano_id
          || !Number.isFinite(panoramaLat) || !Number.isFinite(panoramaLng))
          return reply(502, { error: "Google rejected the Street View request. Enable Street View Static API and allow this local web origin for the key." });
        pano = metadata.pano_id;
        heading = bearingBetween(panoramaLat as number, panoramaLng as number, lat, lng);
      }

      const target = new URL(`https://${STREET_VIEW_HOST}/maps/api/streetview`);
      target.search = new URLSearchParams({
        pano,
        heading: String(heading ?? 0),
        pitch: String(pitch),
        fov: String(fov),
        size: "640x360",
        scale: "2",
        source: "outdoor",
        return_error_code: "true",
        key: options.apiKey,
      }).toString();
      const response = await request(target, { headers: googleHeaders, signal: AbortSignal.timeout(20_000) });
      const contentType = response.headers.get("content-type") ?? "";
      if (!response.ok || !contentType.startsWith("image/"))
        return reply(502, { error: "Google Street View imagery is unavailable. Enable Street View Static API for this key and retry." });
      const image = new Uint8Array(await response.arrayBuffer());
      if (!image.length || image.length > MAX_IMAGE_BYTES)
        return reply(502, { error: "Google returned an invalid Street View image." });
      res.writeHead(200, {
        "Content-Type": contentType,
        "Content-Length": String(image.length),
        "Cache-Control": "no-store",
      });
      res.end(image);
    } catch {
      reply(502, { error: "EcoTwin could not reach Google Street View." });
    }
  };
}
