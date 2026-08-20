import { useRef, useState, useCallback } from 'react';

// Draggable before/after slider — no AntD equivalent (brief §9 calls this
// out explicitly as one of the two components to build once and reuse).
// Works on mouse and touch via the Pointer Events API.
export default function BeforeAfterSlider({ beforeSrc, afterSrc, hasChange, transparent = false }) {
  const [pos, setPos] = useState(50);
  const boxRef = useRef(null);
  const dragging = useRef(false);

  const updateFromClientX = useCallback((clientX) => {
    const el = boxRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pct = ((clientX - rect.left) / rect.width) * 100;
    setPos(Math.min(100, Math.max(0, pct)));
  }, []);

  const onPointerDown = (e) => {
    if (!hasChange) return;
    dragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    updateFromClientX(e.clientX);
  };
  const onPointerMove = (e) => {
    if (!dragging.current) return;
    updateFromClientX(e.clientX);
  };
  const onPointerUp = () => {
    dragging.current = false;
  };

  const bg = transparent
    ? {
        backgroundColor: '#fff',
        backgroundImage:
          'linear-gradient(45deg,#f0f0f0 25%,transparent 25%),linear-gradient(-45deg,#f0f0f0 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#f0f0f0 75%),linear-gradient(-45deg,transparent 75%,#f0f0f0 75%)',
        backgroundSize: '18px 18px',
        backgroundPosition: '0 0,0 9px,9px -9px,-9px 0',
      }
    : { background: '#fff' };

  return (
    <div
      ref={boxRef}
      style={{
        position: 'relative',
        width: '100%',
        aspectRatio: '1 / 1',
        border: '1px solid #f0f0f0',
        borderRadius: 6,
        overflow: 'hidden',
        userSelect: 'none',
        touchAction: 'none',
        ...bg,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <img src={beforeSrc} alt="Before" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain' }} />
      {hasChange && (
        <>
          <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', width: `${pos}%` }}>
            <img
              src={afterSrc}
              alt="After"
              style={{ position: 'absolute', top: 0, left: 0, height: '100%', width: boxRef.current ? boxRef.current.offsetWidth : '100%', objectFit: 'contain' }}
            />
          </div>
          <div
            style={{
              position: 'absolute', top: 0, bottom: 0, width: 2, background: '#fff',
              left: `${pos}%`, boxShadow: '0 0 0 1px rgba(0,0,0,.22)', cursor: 'ew-resize', zIndex: 3,
            }}
          />
          <div
            style={{
              position: 'absolute', top: '50%', left: `${pos}%`, transform: 'translate(-50%,-50%)',
              width: 36, height: 36, borderRadius: '50%', background: '#fff',
              boxShadow: '0 2px 8px rgba(0,0,0,.28)', display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#169bc2', fontSize: 12, cursor: 'ew-resize', zIndex: 3,
            }}
          >
            ◂▸
          </div>
          <span style={{ position: 'absolute', bottom: 10, left: 10, fontSize: 10, letterSpacing: '.06em', background: 'rgba(0,0,0,.6)', color: '#fff', padding: '2px 8px', borderRadius: 3 }}>
            BEFORE
          </span>
          <span style={{ position: 'absolute', bottom: 10, right: 10, fontSize: 10, letterSpacing: '.06em', background: 'rgba(0,0,0,.6)', color: '#fff', padding: '2px 8px', borderRadius: 3 }}>
            AFTER
          </span>
        </>
      )}
    </div>
  );
}
