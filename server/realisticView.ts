import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Connect } from 'vite';

const MAX_IMAGE = 12 * 1024 * 1024;
const MAX_BODY = 28 * 1024 * 1024;
const PREFIX = 'data:image/png;base64,';
export function validateImage(value: unknown): Buffer {
  if (typeof value !== 'string' || !value.startsWith(PREFIX) || value.length > MAX_IMAGE)
    throw new Error('A PNG capture of the scene is required.');
  const encoded = value.slice(PREFIX.length);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error('Invalid scene image.');
  const bytes = Buffer.from(encoded, 'base64');
  if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    throw new Error('Invalid scene image.');
  return bytes;
}

function validateReferenceImage(value: unknown): Buffer {
  if (typeof value !== 'string' || value.length > MAX_IMAGE) throw new Error('A building reference image is required.');
  const match = value.match(/^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match) throw new Error('Invalid building reference image.');
  const bytes = Buffer.from(match[2], 'base64');
  const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9;
  if (!png && !jpeg) throw new Error('Invalid building reference image.');
  return bytes;
}

export const REALISTIC_PROMPT = `Create a photorealistic architectural visualization of this exact shopping complex or neighborhood. INPUT IMAGE 1 is the absolute source of truth for the aerial camera, lens, framing, crop, building footprints, roof geometry, streets, parking, and every proposed intervention. Never change that camera or geometry. INPUT IMAGE 2, when supplied separately, is Google Street View of the real property and is the absolute source of truth for existing building identity and appearance: preserve its roof type, roof color, facade colors and materials, parapets, storefront glazing, canopies, architectural rhythm, and recognizable commercial character. If there is instead a small inset labeled REAL BUILDING APPEARANCE ONLY inside image 1, use that inset for the same appearance purpose, remove it completely, and reconstruct the covered background naturally. Do not turn the Street View reference into the output camera. Do not replace the real shopping complex with generic houses, pitched tile roofs, or invented architecture. Apply only the proposed additions from image 1: green patches on roofs become planted green roofs at those exact patches; raised green tree markers become mature trees at those exact locations; rain gardens and permeable paving keep their exact footprints. The aligned satellite ground supplies real site detail. Output one full-frame image with no inset, labels, borders, diagrams, or model styling.`;

type RealisticViewOptions = { apiKey?: string; endpoint?: string; deployment?: string };

function validAzureEndpoint(value?: string) {
  if (!value) return null;
  try {
    const url = new URL(value);
    const validHost = url.hostname.endsWith('.cognitiveservices.azure.com') || url.hostname.endsWith('.api.cognitive.microsoft.com');
    const modelPath = url.pathname.split('/').at(-1);
    const validPath = ['flux-kontext-pro', 'flux-2-pro', 'flux-2-flex'].includes(modelPath ?? '');
    const validVersion = url.searchParams.get('api-version') === 'preview';
    return url.protocol === 'https:' && validHost && validPath && validVersion
      ? { url: url.toString(), multiReference: modelPath === 'flux-2-pro' || modelPath === 'flux-2-flex' }
      : null;
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
    if (!endpoint) return reply(503, { error: 'AZURE_OPENAI_IMAGE_ENDPOINT must be an Azure Black Forest Labs FLUX.1 Kontext or FLUX.2 provider URL, then restart the app.' });
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
        if (length > MAX_BODY) { reply(413, { error: 'Scene references are too large. Zoom out or resize the window and retry.' }); return; }
        chunks.push(Buffer.from(chunk));
      }
      let bytes: Buffer, referenceBytes: Buffer | undefined, fallbackBytes: Buffer | undefined;
      try {
        const payload = JSON.parse(Buffer.concat(chunks).toString()) as { image?: unknown; referenceImage?: unknown; fallbackImage?: unknown };
        bytes = validateImage(payload.image);
        if (payload.referenceImage !== undefined) referenceBytes = validateReferenceImage(payload.referenceImage);
        if (payload.fallbackImage !== undefined) fallbackBytes = validateImage(payload.fallbackImage);
      } catch { reply(400, { error: 'Valid scene and building reference images are required.' }); return; }
      const primaryBytes = endpoint.multiReference ? bytes : (fallbackBytes ?? bytes);
      const response = await request(endpoint.url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: deployment,
          prompt: REALISTIC_PROMPT,
          input_image: primaryBytes.toString('base64'),
          ...(endpoint.multiReference && referenceBytes ? { input_image_2: referenceBytes.toString('base64') } : {}),
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
          reply(502, { error: 'Azure could not run this Flux image edit. Confirm the configured FLUX deployment has available quota.' });
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
      if (imageBytes.length > MAX_IMAGE) throw new Error('Generated image is too large');
      reply(200, { image: `data:${contentType};base64,${Buffer.from(imageBytes).toString('base64')}` });
    } catch {
      reply(502, { error: controller.signal.aborted ? 'Image generation timed out or was cancelled. You can try again.' : 'Could not reach the image service. Please try again.' });
    } finally { clearTimeout(timer); res.off('close', cancel); busy = false; }
  };
}
