import { useEffect, useRef, useState } from 'react';
import { Camera, Download, X } from 'lucide-react';

export function RealisticView({ capture, revision }: { capture: () => Promise<string>; revision: string }) {
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
      const snapshot = await capture();
      if (request.signal.aborted) return;
      setSource(snapshot);
      setCompare(false);
      const response = await fetch('/api/realistic-view', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: snapshot }), signal: request.signal,
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
      <p>Turn your current 3D angle into a photographic concept with your trees, planted roofs, rain gardens, and paving.</p>
      <div className="realistic-preview" aria-busy={busy}>
        {(result || source) ? <img src={result ? (compare ? result.source : result.image) : source} alt={result && !compare ? 'AI-generated concept of the proposed neighborhood' : 'Captured 3D model with proposed additions'} /> : <div className="realistic-empty"><Camera size={36} /><strong>See your changes come to life</strong><span>Close this window to adjust the camera or place more additions.</span></div>}
        {busy && <div className="realistic-progress" role="status">Creating your realistic view… This may take a few minutes.</div>}
      </div>
      {error && <p className="realistic-error" role="alert">{error}</p>}
      {result && result.revision !== revision && <p role="status">Your model has changed. Generate again to include the latest additions.</p>}
      <div className="realistic-actions">
        {busy ? <button type="button" onClick={cancel}>Cancel generation</button> : <button type="button" className="realistic-button" onClick={generate}><Camera size={16} />{result ? 'Generate again' : 'Generate realistic view'}</button>}
        {result && <><button type="button" aria-pressed={compare} onClick={() => setCompare(!compare)}>{compare ? 'Show realistic view' : 'Compare 3D capture'}</button><a href={result.image} download="ecotwin-realistic-concept.png"><Download size={16} /> Download</a></>}
      </div>
      <small>AI concept, not an actual photograph. Details and placement may vary. The scene capture is sent to Azure AI when you generate. Map geometry © OpenStreetMap contributors.</small>
    </dialog>
  </>;
}
