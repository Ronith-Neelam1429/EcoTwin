import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { bearingBetween, googleStreetViewMiddleware } from "../server/googleStreetView";

async function endpoint(upstream: typeof fetch, run: (url: string) => Promise<void>) {
  const handler = googleStreetViewMiddleware({ apiKey: "maps-secret" }, upstream);
  const server = createServer((req, res) => handler(req, res, () => { res.writeHead(404); res.end(); }));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  try { await run(`http://127.0.0.1:${address.port}/api/google-street-view`); }
  finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
}

test("bearing points the panorama toward the selected address", () => {
  assert.ok(Math.abs(bearingBetween(47, -122, 48, -122) - 0) < 0.001);
  assert.ok(Math.abs(bearingBetween(47, -122, 47, -121) - 89.63) < 0.1);
});

test("nearest panorama is fetched facing the selected address", async () => {
  let calls = 0;
  await endpoint(async (input) => {
    calls++;
    const url = new URL(input.toString());
    assert.equal(url.hostname, "maps.googleapis.com");
    assert.equal(url.searchParams.get("key"), "maps-secret");
    if (url.pathname.endsWith("/metadata")) {
      assert.equal(url.searchParams.get("location"), "47.61,-122.2");
      return Response.json({ status: "OK", pano_id: "nearby-pano", location: { lat: 47.609, lng: -122.2 } });
    }
    assert.equal(url.searchParams.get("pano"), "nearby-pano");
    assert.equal(url.searchParams.get("size"), "640x360");
    assert.ok(Number(url.searchParams.get("heading")) < 1);
    return new Response(new Uint8Array([255, 216, 255, 217]), { headers: { "Content-Type": "image/jpeg" } });
  }, async (url) => {
    const response = await fetch(`${url}?lat=47.61&lng=-122.2`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/jpeg");
  });
  assert.equal(calls, 2);
});

test("saved panorama camera bypasses metadata lookup", async () => {
  await endpoint(async (input) => {
    const url = new URL(input.toString());
    assert.equal(url.pathname, "/maps/api/streetview");
    assert.equal(url.searchParams.get("pano"), "saved-pano_1");
    assert.equal(url.searchParams.get("heading"), "123");
    assert.equal(url.searchParams.get("pitch"), "-4");
    assert.equal(url.searchParams.get("fov"), "72");
    return new Response(new Uint8Array([255, 216, 255, 217]), { headers: { "Content-Type": "image/jpeg" } });
  }, async (url) => {
    const response = await fetch(`${url}?lat=47.61&lng=-122.2&pano=saved-pano_1&heading=123&pitch=-4&fov=72`);
    assert.equal(response.status, 200);
  });
});
