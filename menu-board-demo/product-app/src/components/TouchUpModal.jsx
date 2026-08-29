import { useEffect, useRef, useState } from 'react';
import { Modal, Slider } from 'antd';
import MaterialIcon from './MaterialIcon.jsx';
import IconAction from './IconAction.jsx';

// Shows the transparent parts of the canvas the same way Canva's own Eraser
// preview and BeforeAfterSlider's transparent mode do, so a Restore stroke's
// effect (removing transparency) reads clearly against it.
const CHECKERBOARD_STYLE = {
  backgroundImage:
    'conic-gradient(#e8e8e8 90deg, #fff 90deg 180deg, #e8e8e8 180deg 270deg, #fff 270deg 360deg)',
  backgroundSize: '18px 18px',
};

// A manual, purely client-side touch-up brush for an already-processed
// image — modelled on Canva's own "Eraser" tool (confirmed live: it offers
// exactly this pair of modes) after finding a real gap in our AI background
// removal that no model tier fixed (see BG_REMOVAL_CONFIG's comment in
// ProductAssetsTab.jsx — a light-coloured prop next to the backdrop
// sometimes gets erased along with it). Rather than chase the segmentation
// model further, this lets someone paint the mistake back in by hand:
// Restore recovers original pixels under the brush, Erase clears more of
// the background. Both are plain canvas compositing — destination-out for
// Erase, a circular clip + drawImage of the original for Restore — so
// there's no second AI call, no added latency, and nothing to get wrong in
// an unpredictable way the way a generative edit could.
export default function TouchUpModal({ open, src, originalSrc, onCancel, onApply }) {
  const canvasRef = useRef(null);
  const origCanvasRef = useRef(null); // offscreen source for Restore — never attached to the DOM
  const historyRef = useRef([]); // stack of ImageData snapshots, one per completed stroke, for Undo
  const drawingRef = useRef(false);
  const lastPointRef = useRef(null);
  const [mode, setMode] = useState('restore');
  const [brushSize, setBrushSize] = useState(40);
  const [ready, setReady] = useState(false);
  const [canUndo, setCanUndo] = useState(false);

  useEffect(() => {
    if (!open) { setReady(false); return undefined; }
    setMode('restore');
    setCanUndo(false);
    historyRef.current = [];
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      const canvas = canvasRef.current;
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext('2d').drawImage(img, 0, 0);

      const origImg = new Image();
      origImg.onload = () => {
        if (cancelled) return;
        const origCanvas = document.createElement('canvas');
        origCanvas.width = canvas.width;
        origCanvas.height = canvas.height;
        // Stretched to the treated image's own pixel dimensions rather than
        // drawn at its native size — the pre-treatment original and the
        // treated copy are recompressed independently (see compressDataUrl
        // in ProductAssetsTab.jsx), so their absolute resolutions can
        // differ even though it's the same photo at the same aspect ratio.
        // Scaling into an identically-sized canvas is what keeps Restore's
        // brush coordinates lined up with the right part of the original.
        origCanvas.getContext('2d').drawImage(origImg, 0, 0, canvas.width, canvas.height);
        origCanvasRef.current = origCanvas;
        setReady(true);
      };
      // No original to restore from (shouldn't happen — this only opens
      // once a treatment has run) — Restore strokes become harmless no-ops
      // rather than a crash.
      origImg.onerror = () => setReady(true);
      origImg.src = originalSrc || src;
    };
    img.src = src;
    return () => { cancelled = true; };
  }, [open, src, originalSrc]);

  const pushHistory = () => {
    const canvas = canvasRef.current;
    const snap = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    historyRef.current.push(snap);
    if (historyRef.current.length > 20) historyRef.current.shift();
    setCanUndo(true);
  };
  const undo = () => {
    const snap = historyRef.current.pop();
    if (!snap) return;
    canvasRef.current.getContext('2d').putImageData(snap, 0, 0);
    setCanUndo(historyRef.current.length > 0);
  };

  const canvasPoint = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  const paintAt = (x, y) => {
    const ctx = canvasRef.current.getContext('2d');
    const r = brushSize / 2;
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    if (mode === 'erase') {
      ctx.clip();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fill();
    } else if (origCanvasRef.current) {
      ctx.clip();
      ctx.drawImage(origCanvasRef.current, 0, 0);
    }
    ctx.restore();
  };

  // Interpolates along the drag path so a fast pointer move paints a
  // continuous stroke instead of a trail of separated dabs.
  const strokeTo = (x, y) => {
    const last = lastPointRef.current;
    if (last) {
      const dist = Math.hypot(x - last.x, y - last.y);
      const steps = Math.max(1, Math.ceil(dist / Math.max(4, brushSize / 4)));
      for (let i = 1; i <= steps; i++) {
        paintAt(last.x + ((x - last.x) * i) / steps, last.y + ((y - last.y) * i) / steps);
      }
    } else {
      paintAt(x, y);
    }
    lastPointRef.current = { x, y };
  };

  const handlePointerDown = (e) => {
    if (!ready) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drawingRef.current = true;
    pushHistory();
    lastPointRef.current = null;
    const { x, y } = canvasPoint(e);
    strokeTo(x, y);
  };
  const handlePointerMove = (e) => {
    if (!drawingRef.current) return;
    const { x, y } = canvasPoint(e);
    strokeTo(x, y);
  };
  const handlePointerUp = () => {
    drawingRef.current = false;
    lastPointRef.current = null;
  };

  const handleApply = () => {
    onApply(canvasRef.current.toDataURL('image/webp', 0.92));
  };

  return (
    <Modal title="Touch Up" open={open} onCancel={onCancel} width={640} okText="Apply" onOk={handleApply} okButtonProps={{ disabled: !ready }}>
      <p style={{ fontSize: 13, color: 'rgba(0,0,0,.65)', marginBottom: 14 }}>
        Paint directly on the photo — <b>Restore</b> brings back whatever the cut-out removed by mistake, <b>Erase</b> removes more of the background. Both run entirely on this device; nothing here calls an AI model.
      </p>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <IconAction
          row
          icon={<MaterialIcon name="brush" />}
          caption="Restore"
          active={mode === 'restore'}
          onClick={() => setMode('restore')}
          tooltipTitle="Restore"
          tooltipDesc="Paints the original photo back in under the brush — undoes an incorrect cut."
        />
        <IconAction
          row
          icon={<MaterialIcon name="ink_eraser" />}
          caption="Erase"
          active={mode === 'erase'}
          onClick={() => setMode('erase')}
          tooltipTitle="Erase"
          tooltipDesc="Paints transparency in under the brush — removes more of the background."
        />
        <div style={{ flex: 1 }} />
        <IconAction row icon={<MaterialIcon name="undo" />} caption="Undo" onClick={undo} disabled={!canUndo} tooltipTitle="Undo" tooltipDesc="Steps back one brush stroke." />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <span style={{ fontSize: 12, color: 'rgba(0,0,0,.65)', flexShrink: 0 }}>Brush size</span>
        <Slider style={{ flex: 1, marginTop: 0 }} min={8} max={140} value={brushSize} onChange={setBrushSize} />
      </div>
      <div style={{ ...CHECKERBOARD_STYLE, borderRadius: 6, overflow: 'hidden', border: '1px solid #f0f0f0', display: 'flex', justifyContent: 'center' }}>
        <canvas
          ref={canvasRef}
          style={{ maxWidth: '100%', maxHeight: 420, display: 'block', touchAction: 'none', cursor: 'crosshair' }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
        />
      </div>
    </Modal>
  );
}
