import { useEffect, useRef, useState } from 'react';
import { Input, Segmented, Switch, Select, Tag } from 'antd';
import MaterialIcon from '../../components/MaterialIcon.jsx';
import BespokeIcon from '../../components/BespokeIcon.jsx';
import IconAction from '../../components/IconAction.jsx';
import BeforeAfterSlider from '../../components/BeforeAfterSlider.jsx';
import ClearableDate from '../../components/ClearableDate.jsx';
import TargetingBuilder, { describeTargeting } from '../../components/TargetingBuilder.jsx';

function licenceState(expiry) {
  if (!expiry) return 'ok';
  const days = Math.ceil((new Date(expiry) - new Date()) / 86400000);
  if (days < 0) return 'expired';
  if (days <= 30) return 'soon';
  return 'ok';
}
function daysUntil(expiry) {
  return Math.ceil((new Date(expiry) - new Date()) / 86400000);
}

function nextVariantLabel(images, type) {
  const isVideo = type === 'video';
  const existing = images.filter((i) => (i.type === 'video') === isVideo);
  if (isVideo) return 'V' + (existing.length + 1);
  return String.fromCharCode(65 + existing.length);
}

// Every image is stored as a base64 data URI inside the Firestore document
// itself (no separate blob storage), and the whole document has to stay
// under Firestore's ~1 MiB limit. An unedited marketing photo (600KB-1.2MB
// raw) blows that on its own — and the save then fails outright with
// nothing wrong-looking in this tab itself, since setting it as default
// already updated the on-screen state before the save is even attempted.
// Downscale/recompress anything over a modest threshold before it's ever
// added to state, so an oversized upload can't silently fail to save.
const COMPRESS_THRESHOLD_BYTES = 300_000;
const MAX_DIMENSION = 1000;
const JPEG_QUALITY = 0.75;

function readAndCompress(file) {
  const readAsDataUrl = () =>
    new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(file);
    });

  if (!file.type.startsWith('image') || file.size <= COMPRESS_THRESHOLD_BYTES) {
    return readAsDataUrl();
  }

  return readAsDataUrl().then(
    (dataUrl) =>
      new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          const scale = Math.min(1, MAX_DIMENSION / Math.max(img.width, img.height));
          const width = Math.round(img.width * scale);
          const height = Math.round(img.height * scale);
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          // Flattens transparency to white — matches how the rest of the
          // catalog's photography is shot (plain white background), and
          // JPEG can't carry an alpha channel anyway.
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, width, height);
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', JPEG_QUALITY));
        };
        img.onerror = () => resolve(dataUrl);
        img.src = dataUrl;
      })
  );
}

function Tile({ img, selected, onClick }) {
  const state = img.rightsOn ? licenceState(img.rights?.expiry) : 'ok';
  const expired = state === 'expired';
  let badge = null;
  if (expired) badge = { text: 'EXPIRED', bg: '#ff4d4f', color: '#fff' };
  else if (state === 'soon') badge = { text: `${daysUntil(img.rights.expiry)}D`, bg: '#faad14', color: '#3d2800' };
  else if (img.type === '3d') badge = { text: '3D', bg: '#fff7e6', color: '#ad4e00' };
  else if (img.type === 'video') badge = { text: 'VIDEO', bg: 'rgba(0,0,0,.7)', color: '#fff' };

  return (
    <div style={{ width: 88, flexShrink: 0, cursor: 'pointer' }} onClick={onClick}>
      <div
        style={{
          width: 88, height: 88, borderRadius: 6, overflow: 'hidden', position: 'relative',
          border: '1px solid ' + (selected ? '#169bc2' : '#f0f0f0'),
          boxShadow: selected ? '0 0 0 2px rgba(22,155,194,.25)' : 'none',
          opacity: expired ? 0.5 : 1,
        }}
      >
        {img.src && <img src={img.src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />}
        <span style={{ position: 'absolute', top: 4, left: 4, fontSize: 10, lineHeight: '16px', padding: '0 5px', borderRadius: 3, background: 'rgba(255,255,255,.94)', border: '1px solid #87d9ec', color: '#09759c', fontWeight: 600 }}>
          {img.variant}
        </span>
        <div style={{ position: 'absolute', top: 4, right: 4, display: 'flex', gap: 3 }}>
          <span
            title={img.isDefault ? 'Default image' : 'Not the default image'}
            style={{ width: 20, height: 20, borderRadius: 4, background: 'rgba(255,255,255,.95)', border: '1px solid rgba(0,0,0,.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: img.isDefault ? '#faad14' : '#cfcfcf' }}
          >
            <BespokeIcon name={img.isDefault ? 'starFill' : 'starOutline'} size={12} />
          </span>
          <span
            title={img.availableForTesting ? 'Available for testing' : 'Not available for testing'}
            style={{ width: 20, height: 20, borderRadius: 4, background: img.availableForTesting ? 'rgba(232,253,255,.97)' : 'rgba(255,255,255,.95)', border: '1px solid ' + (img.availableForTesting ? '#87d9ec' : 'rgba(0,0,0,.08)'), display: 'flex', alignItems: 'center', justifyContent: 'center', color: img.availableForTesting ? '#169bc2' : '#c4c4c4' }}
          >
            <BespokeIcon name="ab" size={12} />
          </span>
          {!!(img.targeting || []).length && (
            <span
              title={`Targeted — ${describeTargeting(img.targeting)}`}
              style={{ width: 20, height: 20, borderRadius: 4, background: 'rgba(232,253,255,.97)', border: '1px solid #87d9ec', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#169bc2' }}
            >
              <MaterialIcon name="my_location" style={{ fontSize: 12 }} />
            </span>
          )}
        </div>
        {badge && (
          <span style={{ position: 'absolute', bottom: 4, left: 4, fontSize: 9, lineHeight: '16px', padding: '0 5px', borderRadius: 3, fontWeight: 600, background: badge.bg, color: badge.color }}>
            {badge.text}
          </span>
        )}
      </div>
      <div style={{ fontSize: 11, color: 'rgba(0,0,0,.65)', marginTop: 6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textAlign: 'center' }}>
        {img.name || img.variant}
      </div>
    </div>
  );
}

export default function ProductAssetsTab({ draft, patch }) {
  const images = draft.images || [];
  const [selected, setSelected] = useState(0);
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [newTagText, setNewTagText] = useState('');
  const fileInput = useRef(null);
  const fileIntent = useRef('upload'); // 'upload' | 'replace' — which action opened the picker

  // The "+ Add tag" input was uncontrolled, cleared imperatively via
  // e.currentTarget.value = ''. With no key of its own it sits right after
  // a .map() of Tag chips whose count changes on every add/remove — React
  // reconciles that whole run of siblings by position, so once the chip
  // count shifts, the previously-typed text could resurface in the input
  // on the next render instead of staying cleared. A controlled input,
  // reset here whenever the selected image changes, removes the need for
  // React to guess which DOM node is "the same one" at all.
  useEffect(() => {
    setNewTagText('');
  }, [selected]);

  // Reset the selected tile whenever the product itself changes (navigating
  // straight from one product's Assets tab to another's, e.g. via a direct
  // link) — otherwise `selected` can stay pointed at an index that belongs
  // to the previous product's image list.
  useEffect(() => {
    setSelected(0);
  }, [draft.id]);

  // The image being viewed/edited is read directly from images[selected] —
  // there is deliberately no separate "working copy" state to keep in sync
  // with it. That used to exist (a local draft only committed into images
  // on request), and every edit here silently lived only in that draft
  // until the moment "Commit changes" was clicked — including toggles like
  // Testing, where the toolbar button looked active immediately but nothing
  // was actually saved until Commit *and* the page-level Save Changes were
  // both remembered. A single source of truth removes that whole failure
  // mode: every field below patches images[selected] the instant it
  // changes, and the shared Save Changes / Cancel bar (ProductPage.jsx)
  // is the only save step left, same as every other field on this product.
  const current = images[selected] || null;

  const filtered = images.filter((img) => {
    if (filter === 'image' && img.type !== 'image') return false;
    if (filter === 'video' && !['video', '3d'].includes(img.type)) return false;
    if (q && !(`${img.name} ${(img.tags || []).join(' ')}`.toLowerCase().includes(q.toLowerCase()))) return false;
    return true;
  });

  const testingCount = images.filter((i) => i.availableForTesting).length;
  const expiringCount = images.filter((i) => i.rightsOn && licenceState(i.rights?.expiry) === 'soon').length;
  const expiredCount = images.filter((i) => i.rightsOn && licenceState(i.rights?.expiry) === 'expired').length;

  const updateSelected = (fields) => {
    const next = images.map((img, i) => (i === selected ? { ...img, ...fields } : img));
    patch({ images: next });
  };
  const updateRights = (fields) => updateSelected({ rights: { ...(current?.rights || {}), ...fields } });

  const handleUpload = (files) => {
    Promise.all([...files].map((file) => readAndCompress(file).then((src) => ({ file, src })))).then((loaded) => {
      const next = [...images];
      loaded.forEach(({ file, src }) => {
        const type = file.type.startsWith('video') ? 'video' : 'image';
        next.push({
          id: 'img-' + Date.now() + Math.random().toString(36).slice(2, 7),
          src,
          type,
          name: '',
          tags: [],
          isDefault: false,
          availableForTesting: false,
          bgRemoved: false,
          enhanced: false,
          rightsOn: false,
          rights: {},
          targeting: [],
          variant: nextVariantLabel(next, type),
        });
      });
      patch({ images: next });
      setSelected(next.length - loaded.length);
    });
  };

  // Swaps the file underneath the currently-selected tile in place — the
  // id, variant label, tags and rights all stay exactly as they were, only
  // src/type change. This used to share the same upload handler as "add a
  // new image," so clicking Replace actually appended a brand new tile and
  // silently left the old file untouched instead of replacing it.
  const handleReplace = (files) => {
    const file = files[0];
    if (!file || !current) return;
    readAndCompress(file).then((src) => {
      updateSelected({ src, type: file.type.startsWith('video') ? 'video' : 'image' });
    });
  };

  const onFileInputChange = (e) => {
    const files = e.target.files;
    if (files && files.length) {
      if (fileIntent.current === 'replace') handleReplace(files);
      else handleUpload(files);
    }
    e.target.value = ''; // allow picking the same file again next time
  };
  const openUpload = () => { fileIntent.current = 'upload'; fileInput.current?.click(); };
  const openReplace = () => { fileIntent.current = 'replace'; fileInput.current?.click(); };

  const deleteAsset = () => {
    const next = images.filter((_, i) => i !== selected);
    patch({ images: next });
    // Keep the same index where possible so the item that shifts up into
    // this slot is what's shown next, rather than always jumping back one —
    // only clamp when the deleted tile was the last one in the list.
    setSelected((s) => Math.max(0, Math.min(s, next.length - 1)));
  };

  // Default applies immediately — a single binary switch a user expects to
  // take effect the moment they click it, same as Featured on Product
  // Details — and also handles clearing any other image's Default flag,
  // since only one image can be default per product.
  const setDefault = () => {
    if (!current) return;
    const newVal = !current.isDefault;
    const next = images.map((img, i) => {
      if (i === selected) return { ...img, isDefault: newVal };
      return newVal && img.isDefault ? { ...img, isDefault: false } : img;
    });
    patch({ images: next });
  };
  const toggleTesting = () => current && updateSelected({ availableForTesting: !current.availableForTesting });
  const toggleBg = () => current && updateSelected({ bgRemoved: !current.bgRemoved });
  const toggleEnhance = () => current && updateSelected({ enhanced: !current.enhanced });

  const expired = current?.rightsOn && licenceState(current.rights?.expiry) === 'expired';
  const soon = current?.rightsOn && licenceState(current.rights?.expiry) === 'soon';

  const rightsSummary = current?.rightsOn
    ? [current.rights.type, current.rights.territory, current.rights.expiry ? `Expires ${current.rights.expiry}` : 'No expiry', current.rights.release ? 'release on file' : null]
        .filter(Boolean)
        .join(' · ')
    : 'Off — no licence terms recorded. Turn on for licensed, stock or talent-bearing assets.';

  const hasTreatment = current && (current.bgRemoved || current.enhanced);

  return (
    <div>
      {/* Sticky so the thumbnail strip stays reachable while scrolling
          through a long asset panel (Rights & licensing, Targeting) —
          switching assets from here doesn't reset scroll position, since
          nothing here does anything but flip `selected`. */}
      <div style={{ position: 'sticky', top: 0, zIndex: 10, background: '#fff', paddingTop: 4, paddingBottom: 4, marginTop: -4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
          <span className="ph-sect-label">Select an image or video</span>
          <div style={{ flex: 1 }} />
          <Segmented
            value={filter}
            onChange={setFilter}
            options={[{ label: 'All', value: 'all' }, { label: 'Images', value: 'image' }, { label: 'Video & 3D', value: 'video' }]}
          />
          <Input style={{ width: 200 }} placeholder="Search by name or tag…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>

        <div
          style={{ display: 'flex', gap: 10, overflowX: 'auto', padding: '14px 16px', background: '#fff', borderRadius: 8, boxShadow: '0 2px 6px rgba(0,0,0,.06)' }}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); handleUpload(e.dataTransfer.files); }}
        >
          <div
            onClick={openUpload}
            style={{
              width: 88, height: 88, flexShrink: 0, border: '2px dashed ' + (dragOver ? '#169bc2' : '#d9d9d9'),
              borderRadius: 6, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              gap: 2, cursor: 'pointer', color: dragOver ? '#169bc2' : 'rgba(0,0,0,.45)', background: dragOver ? '#e8fdff' : '#fafafa',
            }}
          >
            <MaterialIcon name="add_photo_alternate" style={{ fontSize: 22 }} />
            <span style={{ fontSize: 10, textAlign: 'center', padding: '0 6px' }}>Drop files</span>
            <input ref={fileInput} type="file" multiple={fileIntent.current === 'upload'} accept="image/*,video/*" style={{ display: 'none' }} onChange={onFileInputChange} />
          </div>
          {filtered.map((img) => {
            const idx = images.indexOf(img);
            return <Tile key={img.id} img={img} selected={idx === selected} onClick={() => setSelected(idx)} />;
          })}
        </div>
        <div style={{ fontSize: 12, color: 'rgba(0,0,0,.45)', margin: '8px 0' }}>
          {images.length} of {images.length} shown · {testingCount} available for testing
          {expiringCount ? ` · ${expiringCount} licence expiring` : ''}
          {expiredCount ? ` · ${expiredCount} licence expired` : ''}
        </div>
      </div>
      <div style={{ height: 12 }} />

      <div className="ph-sect" style={{ padding: 0 }}>
        {!current ? (
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); handleUpload(e.dataTransfer.files); }}
            onClick={openUpload}
            style={{ border: '2px dashed #d9d9d9', borderRadius: 8, minHeight: 320, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, cursor: 'pointer', margin: 20 }}
          >
            <MaterialIcon name="add_photo_alternate" style={{ fontSize: 36, color: '#169bc2' }} />
            <span>Drag &amp; drop an image or video here</span>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'stretch', gap: 4, padding: '11px 16px', borderBottom: '1px solid #f0f0f0', flexWrap: 'wrap' }}>
              <IconAction
                icon={<BespokeIcon name="removeBg" />}
                caption="Background"
                active={current.bgRemoved}
                disabled={expired}
                onClick={toggleBg}
                tooltipTitle={current.bgRemoved ? 'Restore background' : 'Remove background'}
                tooltipDesc={
                  expired
                    ? undefined
                    : current.bgRemoved
                    ? 'Puts the original background back. The cut-out is discarded.'
                    : 'Cuts the product out to a transparent PNG so it can sit on any campaign layout.'
                }
              />
              <IconAction
                icon={<MaterialIcon name="auto_fix_high" />}
                caption="Enhance"
                active={current.enhanced}
                disabled={expired}
                onClick={toggleEnhance}
                tooltipTitle={current.enhanced ? 'Undo enhancement' : 'Enhance quality'}
                tooltipDesc={current.enhanced ? 'Reverts to the original upload.' : 'Sharpens and colour-corrects the image.'}
              />
              <div style={{ width: 1, background: '#f0f0f0', margin: '4px 8px' }} />
              <IconAction
                icon={<MaterialIcon name={current.isDefault ? 'star' : 'star_border'} />}
                caption="Default"
                gold
                active={current.isDefault}
                disabled={expired}
                onClick={setDefault}
                tooltipTitle={current.isDefault ? 'Remove as default' : 'Set as default'}
                tooltipDesc={expired ? 'Renew the licence before making this the default.' : current.isDefault ? 'Another image can be chosen as default instead.' : 'Personalisation Hub uses this image unless a campaign specifies otherwise.'}
              />
              <IconAction
                icon={<BespokeIcon name="ab" />}
                caption="Testing"
                active={current.availableForTesting}
                disabled={expired}
                onClick={toggleTesting}
                tooltipTitle={expired ? 'Not available' : current.availableForTesting ? 'Remove from testing' : 'Make available for testing'}
                tooltipDesc={expired ? 'Renew the licence before making this available for testing.' : current.availableForTesting ? 'Personalisation Hub will stop selecting this variant for A/B testing.' : 'Lets Personalisation Hub select this variant in A/B tests.'}
              />
            </div>

            <div style={{ display: 'flex', gap: 24, padding: '20px 20px 22px', flexWrap: 'wrap' }}>
              <div style={{ width: 470, flexShrink: 0, maxWidth: '100%' }}>
                <BeforeAfterSlider beforeSrc={current.src} afterSrc={current.src} hasChange={hasTreatment} transparent={current.bgRemoved} />
                <p style={{ fontSize: 12, color: 'rgba(0,0,0,.45)', marginTop: 8 }}>
                  {hasTreatment ? 'Drag the slider to compare before/after.' : 'No treatment applied yet.'}
                </p>
                <div style={{ display: 'flex', gap: 8, marginTop: 14, paddingTop: 14, borderTop: '1px solid #f0f0f0' }}>
                  <IconAction icon={<MaterialIcon name="cached" />} caption="Replace" row tooltipTitle="Replace" tooltipDesc="Swaps the underlying file; variant label, tags and settings are kept." onClick={openReplace} />
                  <IconAction icon={<MaterialIcon name="delete" />} caption="Delete" row danger tooltipTitle="Delete" tooltipDesc="Removes this asset from the product." onClick={deleteAsset} />
                </div>
              </div>
              <div style={{ flex: 1, minWidth: 260, maxWidth: 382, display: 'flex', flexDirection: 'column' }}>
                <div style={{ marginBottom: 16 }}>
                  <label style={{ fontSize: 13, color: 'rgba(0,0,0,.65)', marginBottom: 6, display: 'block' }}>Variant name</label>
                  <Input value={current.name} onChange={(e) => updateSelected({ name: e.target.value })} placeholder="e.g. Hero — front view" />
                </div>
                <div style={{ marginBottom: 16 }}>
                  <label style={{ fontSize: 13, color: 'rgba(0,0,0,.65)', marginBottom: 6, display: 'block' }}>Tags</label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {(current.tags || []).map((t) => (
                      <Tag key={t} closable onClose={() => updateSelected({ tags: current.tags.filter((x) => x !== t) })}>
                        {t}
                      </Tag>
                    ))}
                    <Input
                      size="small"
                      style={{ width: 120 }}
                      placeholder="+ Add tag"
                      value={newTagText}
                      onChange={(e) => setNewTagText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && newTagText.trim()) {
                          updateSelected({ tags: [...(current.tags || []), newTagText.trim()] });
                          setNewTagText('');
                        }
                      }}
                    />
                  </div>
                </div>
                <div style={{ height: 1, background: '#f0f0f0', margin: '4px 0 14px' }} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: current.rightsOn ? 10 : 0 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14 }}>Rights &amp; licensing</div>
                    <div style={{ fontSize: 12, color: 'rgba(0,0,0,.45)', marginTop: 1 }}>{rightsSummary}</div>
                  </div>
                  <Switch checked={current.rightsOn} onChange={(v) => updateSelected({ rightsOn: v })} />
                </div>
                {current.rightsOn && (
                  <div style={{ border: '1px solid #f0f0f0', borderRadius: 6, background: '#fafafa', padding: '14px 16px', marginBottom: 14 }}>
                    {expired && (
                      <div style={{ background: '#fff2f0', border: '1px solid #ffccc7', color: '#a8071a', borderRadius: 6, padding: '10px 12px', fontSize: 13, marginBottom: 12 }}>
                        Licence expired — Default and Testing are disabled until renewed.
                      </div>
                    )}
                    {!expired && soon && (
                      <div style={{ background: '#fffbe6', border: '1px solid #ffe58f', color: '#874d00', borderRadius: 6, padding: '10px 12px', fontSize: 13, marginBottom: 12 }}>
                        Expires in {daysUntil(current.rights.expiry)} day(s) — renew soon.
                      </div>
                    )}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                      <div>
                        <label style={{ fontSize: 12, color: 'rgba(0,0,0,.65)' }}>Licence type</label>
                        <Select
                          style={{ width: '100%', marginTop: 4 }}
                          value={current.rights.type}
                          onChange={(v) => updateRights({ type: v })}
                          options={['Owned', 'Licensed', 'Royalty-free'].map((s) => ({ value: s, label: s }))}
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: 12, color: 'rgba(0,0,0,.65)' }}>Territory</label>
                        <Select
                          style={{ width: '100%', marginTop: 4 }}
                          value={current.rights.territory}
                          onChange={(v) => updateRights({ territory: v })}
                          options={['Global', 'AU / NZ', 'AU only', 'APAC'].map((s) => ({ value: s, label: s }))}
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: 12, color: 'rgba(0,0,0,.65)', display: 'block', marginBottom: 4 }}>Expiry date</label>
                        <ClearableDate
                          value={current.rights.expiry}
                          onChange={(v) => updateRights({ expiry: v })}
                          blankHint={{ blank: 'No expiry', set: '' }}
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: 12, color: 'rgba(0,0,0,.65)' }}>Rights holder</label>
                        <Input
                          style={{ marginTop: 4 }}
                          value={current.rights.holder}
                          onChange={(e) => updateRights({ holder: e.target.value })}
                        />
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
                      <Switch size="small" checked={!!current.rights.release} onChange={(v) => updateRights({ release: v })} />
                      <span style={{ fontSize: 13 }}>Talent / property release on file</span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div style={{ borderTop: '1px solid #f0f0f0', padding: '20px 20px 22px' }}>
              <div style={{ fontSize: 11, color: 'rgba(0,0,0,.45)', letterSpacing: '0.08em', fontWeight: 500, marginBottom: 8, textTransform: 'uppercase' }}>
                Asset Targeting Rules
              </div>
              <p style={{ fontSize: 12, color: 'rgba(0,0,0,.45)', margin: '0 0 14px' }}>
                These rules apply only to &ldquo;{current.name.trim() || current.variant}&rdquo; — not to any other image or video on this product.
              </p>
              <TargetingBuilder
                groups={current.targeting || []}
                onChange={(groups) => updateSelected({ targeting: groups })}
                emptyDescription="No targeting rules defined. This asset can be shown at every store, to every visitor."
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
