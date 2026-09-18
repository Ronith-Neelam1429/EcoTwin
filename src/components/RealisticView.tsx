import { useEffect, useRef, useState } from 'react';
import { composeRealisticView, type CapturedScene } from '../lib/ecotwin/sceneCapture';
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

export function RealisticView({ capture, revision, location }: { capture: () => Promise<CapturedScene>; revision: string; location: TwinLocation }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const controller = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ image: string; source: string; revision: string } | null>(null);
  const [source, setSource] = useState('');
  const [compare, setCompare] = useState(false);
  const [referenceNote, setReferenceNote] = useState('');
  useEffect(() => () => controller.current?.abort(), []);

  async function generate() {
    if (controller.current) return;
    setError('');
    setReferenceNote('');
    const request = new AbortController();
    controller.current = request;
    setBusy(true);
    try {
      const [snapshot, streetResponse] = await Promise.all([
        capture(),
        fetch(`/api/google-street-view?${streetViewQuery(location)}`, { signal: request.signal }).catch(() => null),
      ]);
      if (request.signal.aborted) return;
      let referenceImage: string | undefined;
      if (streetResponse?.ok) {
        const streetBlob = await streetResponse.blob();
        if (streetBlob.type.startsWith('image/')) referenceImage = await blobDataUrl(streetBlob);
      }
      if (!referenceImage) setReferenceNote('Street View is unavailable. Building labels and the 3D model will guide this view.');
      setSource(snapshot.image);
      setCompare(false);
      const response = await fetch('/api/realistic-view', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: snapshot.image, referenceImage, manifest: snapshot.manifest }), signal: request.signal,
      });
      if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('The image service is unavailable. Run the app with its server and try again.');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Image generation failed. Please retry.');
      if (typeof data.image !== 'string' || !data.image.startsWith('data:image/png;base64,')) throw new Error('The image service returned an invalid image. Please retry.');
      if (request.signal.aborted) return;
      const image = await composeRealisticView(data.image, snapshot);
      if (request.signal.aborted) return;
      setResult({ image, source: snapshot.image, revision });
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
      <p>Building labels guide the architecture. Your placed green roofs, trees, gardens, and paving are preserved over the AI-generated setting.</p>
      <div className="realistic-preview" aria-busy={busy}>
        {(result || source) ? <img src={result ? (compare ? result.source : result.image) : source} alt={result && !compare ? 'AI-generated concept of the proposed neighborhood' : 'Captured 3D camera view with the proposed additions'} /> : <div className="realistic-empty"><Camera size={36} /><strong>See your changes come to life</strong><span>Close this window to set the 3D camera angle or place more additions.</span></div>}
        {busy && <div className="realistic-progress" role="status">Creating your realistic view… This may take a few minutes.</div>}
      </div>
      {referenceNote && <p role="status">{referenceNote}</p>}
      {error && <p className="realistic-error" role="alert">{error}</p>}
      {result && result.revision !== revision && <p role="status">Your model has changed. Generate again to include the latest additions.</p>}
      <div className="realistic-actions">
        {busy ? <button type="button" onClick={cancel}>Cancel generation</button> : <button type="button" className="realistic-button" onClick={generate}><Camera size={16} />{result ? 'Generate again' : 'Generate realistic view'}</button>}
        {result && <><button type="button" aria-pressed={compare} onClick={() => setCompare(!compare)}>{compare ? 'Show realistic view' : 'Compare 3D angle'}</button><a href={result.image} download="ecotwin-realistic-concept.png"><Download size={16} /> Download</a></>}
      </div>
      <small>AI concept with preserved 3D additions, not an actual photograph. AI buildings may shift relative to the locked design layer; compare with the 3D view. The scene and building labels are sent to Azure AI. Street View guides appearance when the configured model supports multiple references. Imagery © Google · Map geometry © OpenStreetMap contributors.</small>
    </dialog>
  </>;
}
