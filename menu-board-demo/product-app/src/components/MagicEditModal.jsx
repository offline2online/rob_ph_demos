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

const MIN_ZOOM = 1;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.25;
const HANDLE_HIT_PX = 16; // pointer hit radius around a crop corner, in on-screen pixels

// ── Crop-rect geometry (all fractions of the canvas, 0..1) — pure
// functions so the drag math can be unit-tested without a DOM. ───────────
export function clampRect(r) {
  let { x, y, w, h } = r;
  w = Math.max(0.05, Math.min(1, w));
  h = Math.max(0.05, Math.min(1, h));
  x = Math.max(0, Math.min(1 - w, x));
  y = Math.max(0, Math.min(1 - h, y));
  return { x, y, w, h };
}
export function resizeRect(rect, handle, dxFrac, dyFrac) {
  let { x, y, w, h } = rect;
  if (handle.includes('w')) { w -= dxFrac; x += dxFrac; }
  if (handle.includes('e')) { w += dxFrac; }
  if (handle.includes('n')) { h -= dyFrac; y += dyFrac; }
  if (handle.includes('s')) { h += dyFrac; }
  return clampRect({ x, y, w, h });
}
export function moveRect(rect, dxFrac, dyFrac) {
  return clampRect({ ...rect, x: rect.x + dxFrac, y: rect.y + dyFrac });
}
export function hitTestHandle(cropRect, displayRect, clientX, clientY) {
  const corners = {
    nw: { x: cropRect.x, y: cropRect.y },
    ne: { x: cropRect.x + cropRect.w, y: cropRect.y },
    sw: { x: cropRect.x, y: cropRect.y + cropRect.h },
    se: { x: cropRect.x + cropRect.w, y: cropRect.y + cropRect.h },
  };
  for (const key of Object.keys(corners)) {
    const c = corners[key];
    const px = displayRect.left + c.x * displayRect.width;
    const py = displayRect.top + c.y * displayRect.height;
    if (Math.hypot(clientX - px, clientY - py) <= HANDLE_HIT_PX) return key;
  }
  return null;
}
export function pointInRect(cropRect, displayRect, clientX, clientY) {
  const fx = (clientX - displayRect.left) / displayRect.width;
  const fy = (clientY - displayRect.top) / displayRect.height;
  return fx >= cropRect.x && fx <= cropRect.x + cropRect.w && fy >= cropRect.y && fy <= cropRect.y + cropRect.h;
}

// A manual, purely client-side edit tool for an already-processed image —
// grew out of what used to be just the Touch Up brush (see Restore/Erase
// below, unchanged) into a broader Magic Edit tool covering the requests
// that kept landing on it: crop, zoom for precise brush work on a large
// photo, and — closer to Canva's own Eraser — a resizable crop rather
// than only paint-based touch-ups. All three stay deliberately non-AI:
// Restore/Erase are plain canvas compositing (destination-out for Erase,
// a circular clip + drawImage of the original for Restore) and Crop is
// pure pixel geometry, the same reasoning Remove Background/Enhance moved
// AWAY from Gemini's generative edit for (see BG_REMOVAL_CONFIG's comment
// in ProductAssetsTab.jsx) — nothing here is a second AI call, so nothing
// here can behave unpredictably the way a generative edit could. The
// "Magic Edit" name/icon is about how capable the tool now is, not a claim
// that it's AI — the in-modal copy says so explicitly.
export default function MagicEditModal({ open, src, originalSrc, onCancel, onApply }) {
  const canvasRef = useRef(null);
  const origCanvasRef = useRef(null); // offscreen source for Restore — never attached to the DOM
  const containerRef = useRef(null);
  const historyRef = useRef([]); // stack of ImageData snapshots, one per completed stroke, for Undo
  const drawingRef = useRef(false);
  const lastPointRef = useRef(null);
  const cropDragRef = useRef(null);
  const [tool, setTool] = useState('brush'); // 'brush' | 'crop'
  const [mode, setMode] = useState('restore'); // brush sub-mode: 'restore' | 'erase'
  const [brushSize, setBrushSize] = useState(40);
  const [ready, setReady] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [fitWidth, setFitWidth] = useState(0);
  const [cropRect, setCropRect] = useState({ x: 0.1, y: 0.1, w: 0.8, h: 0.8 });
  // Brush cursor overlay — position in on-screen (CSS) px relative to the
  // canvas, plus the current CSS-px-per-canvas-px scale (changes with zoom
  // and with the modal's own responsive width). Kept separate from
  // brushSize itself so dragging the size slider resizes the circle
  // immediately at render time, with no pointer movement needed.
  const [brushCursorPos, setBrushCursorPos] = useState(null);
  const [displayScale, setDisplayScale] = useState(1);

  useEffect(() => {
    if (!open) { setReady(false); return undefined; }
    setTool('brush');
    setMode('restore');
    setCanUndo(false);
    setZoom(1);
    historyRef.current = [];
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      const canvas = canvasRef.current;
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext('2d').drawImage(img, 0, 0);
      // The "fit" display width at zoom=1 — the same size maxWidth:100%/
      // maxHeight:420 CSS would land on — measured once here so Zoom has a
      // concrete pixel width to scale up from instead of trying to read it
      // back out of a CSS box a plain <canvas style={maxWidth}> doesn't expose.
      const containerWidth = containerRef.current ? containerRef.current.clientWidth : canvas.width;
      const widthForMaxHeight = canvas.width * (420 / canvas.height);
      setFitWidth(Math.max(1, Math.min(canvas.width, containerWidth, widthForMaxHeight)));
      setCropRect({ x: 0.1, y: 0.1, w: 0.8, h: 0.8 });

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
      // originalSrc is only set once a treatment (Background removal,
      // Enhance, ...) has actually run — Magic Edit is available before
      // that too now, so falling back to `src` above is the common case,
      // not an edge case: Restore then has nothing to restore FROM
      // (painting `src` back over itself), a harmless no-op rather than a
      // crash. This onerror branch is only a genuine load failure.
      origImg.onerror = () => setReady(true);
      origImg.src = originalSrc || src;
    };
    img.src = src;
    return () => { cancelled = true; };
  }, [open, src, originalSrc]);

  // Each entry carries its own canvas dimensions (and the offscreen
  // Restore-source canvas's own snapshot + dimensions) alongside the pixel
  // data, not just the pixels — applyCrop() below calls this too, and a
  // crop actually shrinks canvas.width/height, so a plain ImageData isn't
  // enough to undo back to: putImageData onto a now-smaller canvas would
  // just clip the restored pixels to the current (cropped) size instead of
  // genuinely reverting the crop.
  const pushHistory = () => {
    const canvas = canvasRef.current;
    const orig = origCanvasRef.current;
    historyRef.current.push({
      imageData: canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height),
      width: canvas.width,
      height: canvas.height,
      origImageData: orig ? orig.getContext('2d').getImageData(0, 0, orig.width, orig.height) : null,
      origWidth: orig ? orig.width : 0,
      origHeight: orig ? orig.height : 0,
    });
    if (historyRef.current.length > 20) historyRef.current.shift();
    setCanUndo(true);
  };
  const undo = () => {
    const entry = historyRef.current.pop();
    if (!entry) return;
    const canvas = canvasRef.current;
    canvas.width = entry.width;
    canvas.height = entry.height;
    canvas.getContext('2d').putImageData(entry.imageData, 0, 0);
    const orig = origCanvasRef.current;
    if (orig && entry.origImageData) {
      orig.width = entry.origWidth;
      orig.height = entry.origHeight;
      orig.getContext('2d').putImageData(entry.origImageData, 0, 0);
    }
    // Same fit-width recompute applyCrop() does — undoing a crop can change
    // the canvas's own pixel dimensions back, so the display size needs to
    // follow, not stay sized for whatever was on screen a moment ago.
    const containerWidth = containerRef.current ? containerRef.current.clientWidth : entry.width;
    const widthForMaxHeight = entry.width * (420 / entry.height);
    setFitWidth(Math.max(1, Math.min(entry.width, containerWidth, widthForMaxHeight)));
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

  // Brush cursor overlay — tracked separately from the paint/stroke path
  // above so it keeps following the pointer whether or not a stroke is
  // currently being drawn (paintAt only runs while the button is held).
  const updateBrushCursor = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    setDisplayScale(rect.width / canvas.width);
    setBrushCursorPos({ left: e.clientX - rect.left, top: e.clientY - rect.top });
  };
  const handleBrushPointerMove = (e) => {
    updateBrushCursor(e);
    handlePointerMove(e);
  };
  const handleBrushPointerLeave = () => {
    setBrushCursorPos(null);
    handlePointerUp();
  };

  // ── Crop ──────────────────────────────────────────────────────────────
  const handleCropPointerDown = (e) => {
    if (!ready) return;
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const handle = hitTestHandle(cropRect, rect, e.clientX, e.clientY);
    const fx = (e.clientX - rect.left) / rect.width;
    const fy = (e.clientY - rect.top) / rect.height;
    if (handle) {
      cropDragRef.current = { kind: handle, startFrac: { x: fx, y: fy }, startRect: cropRect };
    } else if (pointInRect(cropRect, rect, e.clientX, e.clientY)) {
      cropDragRef.current = { kind: 'move', startFrac: { x: fx, y: fy }, startRect: cropRect };
    } else {
      // Click-drag on open space starts a fresh selection from that corner,
      // same as Canva's own crop tool.
      cropDragRef.current = { kind: 'new', startFrac: { x: fx, y: fy } };
      setCropRect({ x: fx, y: fy, w: 0, h: 0 });
    }
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const handleCropPointerMove = (e) => {
    const drag = cropDragRef.current;
    if (!drag) return;
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const fx = (e.clientX - rect.left) / rect.width;
    const fy = (e.clientY - rect.top) / rect.height;
    if (drag.kind === 'new') {
      const x0 = drag.startFrac.x, y0 = drag.startFrac.y;
      setCropRect(clampRect({ x: Math.min(x0, fx), y: Math.min(y0, fy), w: Math.abs(fx - x0), h: Math.abs(fy - y0) }));
    } else if (drag.kind === 'move') {
      setCropRect(moveRect(drag.startRect, fx - drag.startFrac.x, fy - drag.startFrac.y));
    } else {
      setCropRect(resizeRect(drag.startRect, drag.kind, fx - drag.startFrac.x, fy - drag.startFrac.y));
    }
  };
  const handleCropPointerUp = () => { cropDragRef.current = null; };

  const applyCrop = () => {
    // Pushed before the crop mutates anything, same as a brush stroke does
    // — so committing a crop is itself undoable back to the full pre-crop
    // photo, instead of Undo staying disabled the moment you crop.
    pushHistory();
    const canvas = canvasRef.current;
    const px = Math.round(cropRect.x * canvas.width);
    const py = Math.round(cropRect.y * canvas.height);
    const pw = Math.max(1, Math.min(canvas.width - px, Math.round(cropRect.w * canvas.width)));
    const ph = Math.max(1, Math.min(canvas.height - py, Math.round(cropRect.h * canvas.height)));
    const ctx = canvas.getContext('2d');
    const imgData = ctx.getImageData(px, py, pw, ph);
    // Resizing a canvas's width/height attributes clears its content —
    // grabbed the pixels above before touching either, same ordering the
    // offscreen original below relies on.
    canvas.width = pw;
    canvas.height = ph;
    ctx.putImageData(imgData, 0, 0);

    const orig = origCanvasRef.current;
    if (orig) {
      const origCtx = orig.getContext('2d');
      const origData = origCtx.getImageData(px, py, pw, ph);
      orig.width = pw;
      orig.height = ph;
      origCtx.putImageData(origData, 0, 0);
    }
    const containerWidth = containerRef.current ? containerRef.current.clientWidth : pw;
    const widthForMaxHeight = pw * (420 / ph);
    setFitWidth(Math.max(1, Math.min(pw, containerWidth, widthForMaxHeight)));
    setZoom(1);
    setTool('brush');
  };
  const cancelCrop = () => setTool('brush');

  const zoomIn = () => setZoom((z) => Math.min(MAX_ZOOM, +(z + ZOOM_STEP).toFixed(2)));
  const zoomOut = () => setZoom((z) => Math.max(MIN_ZOOM, +(z - ZOOM_STEP).toFixed(2)));

  const handleApply = () => {
    onApply(canvasRef.current.toDataURL('image/webp', 0.92));
  };

  // Brush mode hides the native cursor entirely (cursor: 'none') — the
  // overlay circle below is what shows instead, sized to the actual brush
  // diameter so it's obvious exactly what a stroke will cover, rather than
  // a generic crosshair that says nothing about size.
  const canvasStyle = zoom === 1
    ? { maxWidth: '100%', maxHeight: 420, display: 'block', touchAction: 'none', cursor: tool === 'crop' ? 'default' : 'none' }
    : { width: fitWidth * zoom, height: 'auto', display: 'block', touchAction: 'none', cursor: tool === 'crop' ? 'default' : 'none' };

  return (
    <Modal title="Magic Edit" open={open} onCancel={onCancel} width={680} okText="Apply" onOk={handleApply} okButtonProps={{ disabled: !ready || tool === 'crop' }}>
      <p style={{ fontSize: 13, color: 'rgba(0,0,0,.65)', marginBottom: 14 }}>
        Crop, zoom in for precise work, and paint directly on the photo — <b>Restore</b> brings back whatever the cut-out removed by mistake, <b>Erase</b> removes more of the background. Everything here runs entirely on this device; nothing calls an AI model.
      </p>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <IconAction
          row
          icon={<MaterialIcon name="brush" />}
          caption="Restore"
          active={tool === 'brush' && mode === 'restore'}
          onClick={() => { setTool('brush'); setMode('restore'); }}
          tooltipTitle="Restore"
          tooltipDesc="Paints the original photo back in under the brush — undoes an incorrect cut."
        />
        <IconAction
          row
          icon={<MaterialIcon name="ink_eraser" />}
          caption="Erase"
          active={tool === 'brush' && mode === 'erase'}
          onClick={() => { setTool('brush'); setMode('erase'); }}
          tooltipTitle="Erase"
          tooltipDesc="Paints transparency in under the brush — removes more of the background."
        />
        <IconAction
          row
          icon={<MaterialIcon name="crop" />}
          caption="Crop"
          active={tool === 'crop'}
          onClick={() => setTool('crop')}
          tooltipTitle="Crop"
          tooltipDesc="Drag a corner to resize the selection, drag inside it to move, then Apply Crop."
        />
        <div style={{ flex: 1 }} />
        {tool === 'brush' && (
          <IconAction row icon={<MaterialIcon name="undo" />} caption="Undo" onClick={undo} disabled={!canUndo} tooltipTitle="Undo" tooltipDesc="Steps back one brush stroke." />
        )}
        <IconAction row icon={<MaterialIcon name="zoom_out" />} caption="Zoom out" onClick={zoomOut} disabled={zoom <= MIN_ZOOM} tooltipTitle="Zoom out" tooltipDesc="Steps back out toward fitting the whole photo." />
        <IconAction row icon={<MaterialIcon name="zoom_in" />} caption="Zoom in" onClick={zoomIn} disabled={zoom >= MAX_ZOOM} tooltipTitle="Zoom in" tooltipDesc="Magnifies the photo for precise brush work — scroll to pan around." />
      </div>
      {tool === 'brush' ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <span style={{ fontSize: 12, color: 'rgba(0,0,0,.65)', flexShrink: 0 }}>Brush size</span>
          <Slider style={{ flex: 1, marginTop: 0 }} min={8} max={140} value={brushSize} onChange={setBrushSize} />
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <span style={{ fontSize: 12, color: 'rgba(0,0,0,.65)', flex: 1 }}>Drag the selection to crop the photo, then apply.</span>
          <IconAction row icon={<MaterialIcon name="close" />} caption="Cancel crop" onClick={cancelCrop} tooltipTitle="Cancel crop" tooltipDesc="Leaves the photo as it is." />
          <IconAction row icon={<MaterialIcon name="check" />} caption="Apply crop" onClick={applyCrop} tooltipTitle="Apply crop" tooltipDesc="Trims the photo to the selection." />
        </div>
      )}
      <div
        ref={containerRef}
        style={{
          ...CHECKERBOARD_STYLE,
          borderRadius: 6,
          overflow: 'auto',
          border: '1px solid #f0f0f0',
          display: 'flex',
          justifyContent: zoom > 1 ? 'flex-start' : 'center',
          maxHeight: 460,
        }}
      >
        <div style={{ position: 'relative', display: 'inline-block', lineHeight: 0 }}>
          <canvas
            ref={canvasRef}
            style={canvasStyle}
            onPointerDown={tool === 'crop' ? handleCropPointerDown : handlePointerDown}
            onPointerMove={tool === 'crop' ? handleCropPointerMove : handleBrushPointerMove}
            onPointerUp={tool === 'crop' ? handleCropPointerUp : handlePointerUp}
            onPointerEnter={tool === 'crop' ? undefined : updateBrushCursor}
            onPointerLeave={tool === 'crop' ? handleCropPointerUp : handleBrushPointerLeave}
          />
          {tool === 'brush' && brushCursorPos && (
            <div
              style={{
                position: 'absolute',
                left: brushCursorPos.left - (brushSize * displayScale) / 2,
                top: brushCursorPos.top - (brushSize * displayScale) / 2,
                width: brushSize * displayScale,
                height: brushSize * displayScale,
                borderRadius: '50%',
                border: '1.5px solid ' + (mode === 'erase' ? '#ff4d4f' : '#169bc2'),
                background: mode === 'erase' ? 'rgba(255,77,79,.15)' : 'rgba(22,155,194,.15)',
                pointerEvents: 'none',
              }}
            />
          )}
          {tool === 'crop' && ready && (
            <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
              <div style={{ position: 'absolute', left: 0, top: 0, right: 0, height: `${cropRect.y * 100}%`, background: 'rgba(0,0,0,.45)' }} />
              <div style={{ position: 'absolute', left: 0, top: `${(cropRect.y + cropRect.h) * 100}%`, right: 0, bottom: 0, background: 'rgba(0,0,0,.45)' }} />
              <div style={{ position: 'absolute', left: 0, top: `${cropRect.y * 100}%`, width: `${cropRect.x * 100}%`, height: `${cropRect.h * 100}%`, background: 'rgba(0,0,0,.45)' }} />
              <div style={{ position: 'absolute', left: `${(cropRect.x + cropRect.w) * 100}%`, top: `${cropRect.y * 100}%`, right: 0, height: `${cropRect.h * 100}%`, background: 'rgba(0,0,0,.45)' }} />
              <div style={{ position: 'absolute', left: `${cropRect.x * 100}%`, top: `${cropRect.y * 100}%`, width: `${cropRect.w * 100}%`, height: `${cropRect.h * 100}%`, border: '2px solid #fff', boxShadow: '0 0 0 1px rgba(0,0,0,.5)' }} />
              {['nw', 'ne', 'sw', 'se'].map((pos) => (
                <div
                  key={pos}
                  style={{
                    position: 'absolute',
                    left: pos.includes('w') ? `${cropRect.x * 100}%` : `${(cropRect.x + cropRect.w) * 100}%`,
                    top: pos.includes('n') ? `${cropRect.y * 100}%` : `${(cropRect.y + cropRect.h) * 100}%`,
                    width: 14,
                    height: 14,
                    marginLeft: -7,
                    marginTop: -7,
                    background: '#fff',
                    border: '2px solid #169bc2',
                    borderRadius: '50%',
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
