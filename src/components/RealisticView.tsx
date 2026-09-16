import { useEffect, useRef, useState } from 'react';
import { Camera, Download, X } from 'lucide-react';
import type { TwinLocation } from '../lib/ecotwin/types';

function blobDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Could not read the building reference.'));
    reader.onerror = () => reject(new Error('Could not read the building reference.'));
    reader.readAsDataURL(blob);
  });
}

function streetViewQuery(location: TwinLocation) {
  const view = location.streetView;
  return new URLSearchParams({
    lat: String(location.lat),
    lng: String(location.lng),
    ...(view ? {
      pano: view.panoId,
      heading: String(view.heading),
      pitch: String(view.pitch),
      fov: String(view.fov),
    } : {}),
  });
}

function drawCover(context: CanvasRenderingContext2D, image: ImageBitmap, x: number, y: number, width: number, height: number) {
  const scale = Math.max(width / image.width, height / image.height);
  const renderedWidth = image.width * scale, renderedHeight = image.height * scale;
  context.drawImage(image, x + (width - renderedWidth) / 2, y + (height - renderedHeight) / 2, renderedWidth, renderedHeight);
}

/** FLUX.1 fallback: keep the 3D camera full-frame and add Street View only as a removable style inset. */
async function singleReferenceFallback(snapshot: string, streetBlob: Blob) {
  const [scene, street] = await Promise.all([
    fetch(snapshot).then((response) => response.blob()).then((blob) => createImageBitmap(blob)),
    createImageBitmap(streetBlob),
  ]);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = scene.width;
    canvas.height = scene.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not prepare the building reference.');
    context.drawImage(scene, 0, 0);
    const insetWidth = Math.round(canvas.width * 0.34);
    const insetHeight = Math.round(insetWidth * 9 / 16);
    const border = Math.max(6, Math.round(canvas.width * 0.008));
    const x = canvas.width - insetWidth - border * 2;
    const y = border * 2;
    context.fillStyle = '#ffffff';
    context.fillRect(x - border, y - border, insetWidth + border * 2, insetHeight + border * 2);
    drawCover(context, street, x, y, insetWidth, insetHeight);
    context.fillStyle = 'rgba(12, 20, 28, 0.88)';
    context.fillRect(x, y, insetWidth, Math.max(26, Math.round(insetHeight * 0.14)));
    context.fillStyle = '#ffffff';
    context.font = `600 ${Math.max(14, Math.round(canvas.width * 0.014))}px system-ui, sans-serif`;
    context.textBaseline = 'middle';
    context.fillText('REAL BUILDING APPEARANCE ONLY', x + border, y + Math.max(13, Math.round(insetHeight * 0.07)));
    return canvas.toDataURL('image/png');
  } finally {
    scene.close();
    street.close();
  }
}

export function RealisticView({ capture, revision, location }: { capture: () => Promise<string>; revision: string; location: TwinLocation }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const controller = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ image: string; source: string; revision: string } | null>(null);
  const [source, setSource] = useState('');
  const [compare, setCompare] = useState(false);
  useEffect(() => () => controller.current?.abort(), []);

  async function generate() {
    if (controller.current) return;
    setError('');
    const request = new AbortController();
    controller.current = request;
    setBusy(true);
    try {
      const [snapshot, streetResponse] = await Promise.all([
        capture(),
        fetch(`/api/google-street-view?${streetViewQuery(location)}`, { signal: request.signal }),
      ]);
      if (request.signal.aborted) return;
      if (!streetResponse.ok) {
        let message = 'Street View is unavailable for this building.';
        try { message = (await streetResponse.json() as { error?: string }).error ?? message; } catch { /* Image endpoints can return plain text. */ }
        throw new Error(message);
      }
      const streetBlob = await streetResponse.blob();
      if (!streetBlob.type.startsWith('image/')) throw new Error('Google returned an invalid building reference.');
      const [referenceImage, fallbackImage] = await Promise.all([
        blobDataUrl(streetBlob),
        singleReferenceFallback(snapshot, streetBlob),
      ]);
      setSource(snapshot);
      setCompare(false);
      const response = await fetch('/api/realistic-view', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: snapshot, referenceImage, fallbackImage }), signal: request.signal,
      });
      if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('The image service is unavailable. Run the app with its server and try again.');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Image generation failed. Please retry.');
      if (typeof data.image !== 'string' || !data.image.startsWith('data:image/png;base64,')) throw new Error('The image service returned an invalid image. Please retry.');
      if (request.signal.aborted) return;
      setResult({ image: data.image, source: snapshot, revision });
    } catch (reason) {
      if (!request.signal.aborted) setError(reason instanceof Error ? reason.message : 'Image generation failed.');
    } finally {
      if (controller.current === request) { controller.current = null; setBusy(false); }
    }
  }
  function cancel() { controller.current?.abort(); controller.current = null; setBusy(false); }
  return <>
    <button className="realistic-button" type="button" onClick={() => dialog.current?.showModal()}><Camera size={16} /> Realistic view</button>
    <dialog ref={dialog} className="realistic-dialog" onCancel={cancel} onClose={cancel}>
      <div className="realistic-heading"><div><span className="panel-kicker">Your proposed neighborhood</span><h2>Realistic view</h2></div><button autoFocus type="button" aria-label="Close realistic view" onClick={() => dialog.current?.close()}><X size={20} /></button></div>
      <p>Keep the exact 3D camera and building shapes, then apply the real roofs, façades, and storefront appearance from Street View.</p>
      <div className="realistic-preview" aria-busy={busy}>
        {(result || source) ? <img src={result ? (compare ? result.source : result.image) : source} alt={result && !compare ? 'AI-generated concept of the proposed neighborhood' : 'Captured 3D camera view with the proposed additions'} /> : <div className="realistic-empty"><Camera size={36} /><strong>See your changes come to life</strong><span>Close this window to set the 3D camera angle or place more additions.</span></div>}
        {busy && <div className="realistic-progress" role="status">Creating your realistic view… This may take a few minutes.</div>}
      </div>
      {error && <p className="realistic-error" role="alert">{error}</p>}
      {result && result.revision !== revision && <p role="status">Your model has changed. Generate again to include the latest additions.</p>}
      <div className="realistic-actions">
        {busy ? <button type="button" onClick={cancel}>Cancel generation</button> : <button type="button" className="realistic-button" onClick={generate}><Camera size={16} />{result ? 'Generate again' : 'Generate realistic view'}</button>}
        {result && <><button type="button" aria-pressed={compare} onClick={() => setCompare(!compare)}>{compare ? 'Show realistic view' : 'Compare 3D angle'}</button><a href={result.image} download="ecotwin-realistic-concept.png"><Download size={16} /> Download</a></>}
      </div>
      <small>AI concept, not an actual photograph. Details and placement may vary. The exact scene capture plus session-only Google satellite and Street View references are sent to Azure AI when you generate. Imagery © Google · Map geometry © OpenStreetMap contributors.</small>
    </dialog>
  </>;
}
