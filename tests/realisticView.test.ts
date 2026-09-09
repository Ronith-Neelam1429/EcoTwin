import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { realisticViewMiddleware, validateImage, REALISTIC_PROMPT } from '../server/realisticView.ts';

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jBf8AAAAASUVORK5CYII=';
async function endpoint(key: string, upstream: typeof fetch, run: (url: string) => Promise<void>) {
  const handler = realisticViewMiddleware({
    apiKey: key,
    endpoint: 'https://vide.cognitiveservices.azure.com/providers/blackforestlabs/v1/flux-kontext-pro?api-version=preview',
    deployment: 'test-image-model',
  }, upstream);
  const server = createServer((req, res) => handler(req, res, () => { res.writeHead(404); res.end(); }));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address !== 'string');
  try { await run(`http://127.0.0.1:${address.port}/api/realistic-view`); }
  finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
}
const send = (url: string, body: unknown, origin?: string) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify(body) });

test('scene image validation rejects non-images and oversized input', () => {
  assert(validateImage(png).length > 8);
  for (const input of [null, 'https://example.com/image.png', 'data:image/png;base64,aGVsbG8=', png + '!']) assert.throws(() => validateImage(input));
  assert.throws(() => validateImage('data:image/png;base64,' + 'A'.repeat(13 * 1024 * 1024)));
});

test('missing key gives actionable setup without contacting provider', async () => {
  await endpoint('', async () => { throw new Error('Must not call provider'); }, async (url) => {
    const response = await send(url, { image: png });
    assert.equal(response.status, 503);
    assert.match((await response.json()).error, /AZURE_OPENAI_API_KEY/);
  });
});

test('valid capture reaches the Flux provider with server credentials and returns image', async () => {
  await endpoint('server-secret', async (url, options) => {
    assert.equal(url, 'https://vide.cognitiveservices.azure.com/providers/blackforestlabs/v1/flux-kontext-pro?api-version=preview');
    assert.deepEqual(options?.headers, { Authorization: 'Bearer server-secret', 'Content-Type': 'application/json' });
    const body = JSON.parse(options?.body as string);
    assert.equal(body.model, 'test-image-model');
    assert.equal(body.prompt, REALISTIC_PROMPT);
    assert.equal(body.input_image, png.split(',')[1]);
    assert.equal(body.aspect_ratio, '16:9');
    assert.equal(body.output_format, 'png');
    return Response.json({ data: [{ b64_json: png.split(',')[1] }] });
  }, async (url) => {
    const response = await send(url, { image: png });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { image: png });
  });
});

test('invalid payload and foreign/malformed origins never reach provider', async () => {
  await endpoint('key', async () => { throw new Error('Must not call provider'); }, async (url) => {
    assert.equal((await send(url, { image: 'bad' })).status, 400);
    assert.equal((await send(url, { image: png }, 'https://other.example')).status, 403);
    assert.equal((await send(url, { image: png }, 'invalid')).status, 403);
    assert.equal((await fetch(url)).status, 405);
  });
});

test('provider errors do not expose credentials or provider payloads', async () => {
  await endpoint('server-secret', async () => Response.json({ error: 'private provider detail' }, { status: 401 }), async (url) => {
    const response = await send(url, { image: png });
    assert.equal(response.status, 502);
    const body = await response.text();
    assert(!body.includes('server-secret'));
    assert(!body.includes('private provider detail'));
  });
});
