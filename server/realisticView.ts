import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Connect } from 'vite';

const MAX_BODY = 12 * 1024 * 1024;
const PREFIX = 'data:image/png;base64,';
export function validateImage(value: unknown): Buffer {
  if (typeof value !== 'string' || !value.startsWith(PREFIX) || value.length > MAX_BODY)
    throw new Error('A PNG capture of the scene is required.');
  const encoded = value.slice(PREFIX.length);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error('Invalid scene image.');
  const bytes = Buffer.from(encoded, 'base64');
  if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    throw new Error('Invalid scene image.');
  return bytes;
}

export const REALISTIC_PROMPT = `Transform this environmental planning 3D model into a photorealistic architectural visualization of the SAME scene. Preserve the exact camera angle, framing, street layout, building footprints, heights, and positions of every visible intervention. Do not redesign the neighborhood. Replace flat materials with plausible real-world facades, asphalt, soil, vegetation, natural daylight and shadows. Raised green tree shapes must become established leafy trees at those exact locations. Green patches on top of buildings must become planted green roofs confined to those patches. Ground rain gardens must become planted infiltration beds, and permeable paving must retain its footprint. Preserve existing greenery and do not add extra trees or roofs elsewhere. Remove selection markers and the model base slab; extend neutral surroundings naturally. No diagrams, labels, borders, text or heat-map colors. This is a proposed future concept, not a reconstruction of an actual photograph.`;

type RealisticViewOptions = { apiKey?: string; endpoint?: string; deployment?: string };

function validAzureEndpoint(value?: string) {
  if (!value) return null;
  try {
    const url = new URL(value);
    const validHost = url.hostname.endsWith('.cognitiveservices.azure.com');
    const validPath = url.pathname === '/providers/blackforestlabs/v1/flux-kontext-pro';
    const validVersion = url.searchParams.get('api-version') === 'preview';
    return url.protocol === 'https:' && validHost && validPath && validVersion ? url.toString() : null;
  } catch {
    return null;
  }
}

export function realisticViewMiddleware(options: RealisticViewOptions, request: typeof fetch = fetch): Connect.NextHandleFunction {
  const { apiKey, deployment } = options;
  const endpoint = validAzureEndpoint(options.endpoint);
  let busy = false;
  return async (req: IncomingMessage, res: ServerResponse, next: Connect.NextFunction) => {
    if (req.url?.split('?')[0] !== '/api/realistic-view') return next();
    const reply = (status: number, body: object) => {
      if (!res.destroyed) { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); }
    };
    // This endpoint belongs to the local workspace, including preview builds.
    const peer = req.socket.remoteAddress;
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(peer ?? '')) return reply(403, { error: 'Image generation is available on this computer only.' });
    try {
      if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) return reply(403, { error: 'Cross-origin requests are not allowed.' });
    } catch { return reply(403, { error: 'Invalid request origin.' }); }
    if (req.method !== 'POST') return reply(405, { error: 'Use POST to generate an image.' });
    if (!req.headers['content-type']?.startsWith('application/json')) return reply(415, { error: 'Expected a scene capture.' });
    if (!apiKey || !deployment) return reply(503, { error: 'Realistic views need Azure image settings. Add AZURE_OPENAI_API_KEY and AZURE_OPENAI_IMAGE_DEPLOYMENT to .env, then restart the app.' });
    if (!endpoint) return reply(503, { error: 'AZURE_OPENAI_IMAGE_ENDPOINT must be the Azure Black Forest Labs flux-kontext-pro provider URL, then restart the app.' });
    if (busy) return reply(429, { error: 'An image is already being generated. Please wait before retrying.' });
    busy = true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 180_000);
    const cancel = () => { if (!res.writableEnded) controller.abort(); };
    res.on('close', cancel);
    try {
      let length = 0;
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        length += chunk.length;
        if (length > MAX_BODY) { reply(413, { error: 'Scene capture is too large. Zoom out or resize the window and retry.' }); return; }
        chunks.push(Buffer.from(chunk));
      }
      let bytes: Buffer;
      try { bytes = validateImage(JSON.parse(Buffer.concat(chunks).toString()).image); }
      catch { reply(400, { error: 'A valid PNG scene capture is required.' }); return; }
      const response = await request(endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: deployment,
          prompt: REALISTIC_PROMPT,
          input_image: bytes.toString('base64'),
          aspect_ratio: '16:9',
          output_format: 'png',
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        let providerCode = '';
        let providerMessage = '';
        try {
          const providerError = await response.json() as {
            error?: { code?: string; message?: string; details?: { msg?: string }[] };
          };
          providerCode = providerError.error?.code ?? '';
          providerMessage = (providerError.error?.details?.find((detail) => detail.msg)?.msg
            ?? providerError.error?.message
            ?? '').replace(/[\r\n]+/g, ' ').slice(0, 300);
        } catch { /* Azure can return an HTML/plain-text gateway error. */ }
        if (providerCode === 'DeploymentNotFound' || response.status === 404) {
          reply(502, { error: 'Azure cannot find the Flux provider endpoint. Check AZURE_OPENAI_IMAGE_ENDPOINT against the resource endpoint, then restart the app.' });
        } else if (response.status === 401 || response.status === 403) {
          reply(502, { error: 'Azure rejected the image key. Rotate the deployment key, update AZURE_OPENAI_API_KEY, and restart the app.' });
        } else if (response.status === 429) {
          reply(429, { error: 'Azure image generation is busy or its quota is exhausted. Check the deployment quota and retry.' });
        } else if (providerMessage) {
          reply(502, { error: `Azure rejected the image edit: ${providerMessage}` });
        } else {
          reply(502, { error: 'Azure could not run this Flux image edit. Confirm the deployment uses FLUX.1-Kontext-pro and has available quota.' });
        }
        return;
      }
      const data = await response.json() as { data?: { b64_json?: string; url?: string }[] };
      const generated = data.data?.[0];
      if (generated?.b64_json) {
        reply(200, { image: PREFIX + generated.b64_json });
        return;
      }
      if (!generated?.url) throw new Error('No image returned');
      const imageUrl = new URL(generated.url);
      if (imageUrl.protocol !== 'https:') throw new Error('Invalid generated image URL');
      const imageResponse = await request(imageUrl, { signal: controller.signal });
      if (!imageResponse.ok) throw new Error('Could not retrieve generated image');
      const contentType = imageResponse.headers.get('content-type') ?? '';
      if (!contentType.startsWith('image/')) throw new Error('Invalid generated image');
      const imageBytes = new Uint8Array(await imageResponse.arrayBuffer());
      if (imageBytes.length > MAX_BODY) throw new Error('Generated image is too large');
      reply(200, { image: `data:${contentType};base64,${Buffer.from(imageBytes).toString('base64')}` });
    } catch {
      reply(502, { error: controller.signal.aborted ? 'Image generation timed out or was cancelled. You can try again.' : 'Could not reach the image service. Please try again.' });
    } finally { clearTimeout(timer); res.off('close', cancel); busy = false; }
  };
}
