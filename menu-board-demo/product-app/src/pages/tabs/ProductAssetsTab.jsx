import { useEffect, useMemo, useRef, useState } from 'react';
import { Input, Segmented, Switch, Select, Tag, Tooltip } from 'antd';
import MaterialIcon from '../../components/MaterialIcon.jsx';
import BespokeIcon from '../../components/BespokeIcon.jsx';
import IconAction from '../../components/IconAction.jsx';
import BeforeAfterSlider from '../../components/BeforeAfterSlider.jsx';
import ClearableDate from '../../components/ClearableDate.jsx';

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
  const existing = images.filter((i) => (i.type === 'video') === isVideo && !i.isPending);
  if (isVideo) return 'V' + (existing.length + 1);
  return String.fromCharCode(65 + existing.length);
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
          border: '1px solid ' + (selected ? '#169bc2' : img.isPending ? '#ffd666' : '#f0f0f0'),
          boxShadow: selected ? '0 0 0 2px rgba(22,155,194,.25)' : img.isPending ? '0 0 0 2px rgba(250,173,20,.2)' : 'none',
          opacity: expired ? 0.5 : 1,
        }}
      >
        {img.src && <img src={img.src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />}
        <span style={{ position: 'absolute', top: 4, left: 4, fontSize: 10, lineHeight: '16px', padding: '0 5px', borderRadius: 3, background: 'rgba(255,255,255,.94)', border: '1px solid #87d9ec', color: '#09759c', fontWeight: 600 }}>
          {img.isPending ? 'NEW' : img.variant}
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
        </div>
        {badge && (
          <span style={{ position: 'absolute', bottom: 4, left: 4, fontSize: 9, lineHeight: '16px', padding: '0 5px', borderRadius: 3, fontWeight: 600, background: badge.bg, color: badge.color }}>
            {badge.text}
          </span>
        )}
      </div>
      <div style={{ fontSize: 11, color: 'rgba(0,0,0,.65)', marginTop: 6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textAlign: 'center' }}>
        {img.name || (img.isPending ? 'Pending upload' : img.variant)}
      </div>
    </div>
  );
}

export default function ProductAssetsTab({ draft, patch }) {
  const images = draft.images || [];
  const [selected, setSelected] = useState(0);
  const [working, setWorking] = useState(images[0] || null);
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef(null);

  // Reset the selected tile whenever the product itself changes (navigating
  // straight from one product's Assets tab to another's, e.g. via a direct
  // link) — otherwise `selected`/`working` can stay pointed at the previous
  // product's image if the new one also has an image at the same index.
  useEffect(() => {
    setSelected(0);
  }, [draft.id]);

  useEffect(() => {
    setWorking(images[selected] ? { ...images[selected], rights: { ...(images[selected].rights || {}) } } : null);
  }, [selected, images.length, draft.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = images.filter((img) => {
    if (filter === 'image' && img.type !== 'image') return false;
    if (filter === 'video' && !['video', '3d'].includes(img.type)) return false;
    if (q && !(`${img.name} ${(img.tags || []).join(' ')}`.toLowerCase().includes(q.toLowerCase()))) return false;
    return true;
  });

  const testingCount = images.filter((i) => i.availableForTesting).length;
  const expiringCount = images.filter((i) => i.rightsOn && licenceState(i.rights?.expiry) === 'soon').length;
  const expiredCount = images.filter((i) => i.rightsOn && licenceState(i.rights?.expiry) === 'expired').length;

  const handleFiles = (files) => {
    const additions = [];
    let remaining = files.length;
    [...files].forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        additions.push({
          id: 'img-' + Date.now() + Math.random().toString(36).slice(2, 7),
          src: reader.result,
          type: file.type.startsWith('video') ? 'video' : 'image',
          name: '',
          tags: [],
          isDefault: false,
          availableForTesting: false,
          bgRemoved: false,
          enhanced: false,
          rightsOn: false,
          rights: {},
          isPending: true,
          variant: 'NEW',
        });
        remaining -= 1;
        if (remaining === 0) {
          const next = [...images, ...additions];
          patch({ images: next });
          setSelected(next.length - additions.length);
        }
      };
      reader.readAsDataURL(file);
    });
  };

  const commit = () => {
    if (!working) return;
    const next = images.map((img, i) => {
      if (i !== selected) {
        // only one default image per product
        return working.isDefault && img.isDefault ? { ...img, isDefault: false } : img;
      }
      if (img.isPending) {
        return { ...working, isPending: false, variant: nextVariantLabel(images, img.type) };
      }
      return working;
    });
    patch({ images: next });
  };

  const deleteAsset = () => {
    const next = images.filter((_, i) => i !== selected);
    patch({ images: next });
    setSelected(Math.max(0, selected - 1));
  };

  const setDefault = () => {
    setWorking((w) => ({ ...w, isDefault: !w.isDefault }));
  };
  const toggleTesting = () => setWorking((w) => ({ ...w, availableForTesting: !w.availableForTesting }));
  const toggleBg = () => setWorking((w) => ({ ...w, bgRemoved: !w.bgRemoved }));
  const toggleEnhance = () => setWorking((w) => ({ ...w, enhanced: !w.enhanced }));

  const expired = working?.rightsOn && licenceState(working.rights?.expiry) === 'expired';
  const soon = working?.rightsOn && licenceState(working.rights?.expiry) === 'soon';

  const rightsSummary = working?.rightsOn
    ? [working.rights.type, working.rights.territory, working.rights.expiry ? `Expires ${working.rights.expiry}` : 'No expiry', working.rights.release ? 'release on file' : null]
        .filter(Boolean)
        .join(' · ')
    : 'Off — no licence terms recorded. Turn on for licensed, stock or talent-bearing assets.';

  const hasTreatment = working && (working.bgRemoved || working.enhanced);

  return (
    <div>
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
        style={{ display: 'flex', gap: 10, overflowX: 'auto', padding: '14px 16px', background: '#fff', borderRadius: 8 }}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
      >
        <div
          onClick={() => fileInput.current?.click()}
          style={{
            width: 88, height: 88, flexShrink: 0, border: '2px dashed ' + (dragOver ? '#169bc2' : '#d9d9d9'),
            borderRadius: 6, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            gap: 2, cursor: 'pointer', color: dragOver ? '#169bc2' : 'rgba(0,0,0,.45)', background: dragOver ? '#e8fdff' : '#fafafa',
          }}
        >
          <MaterialIcon name="add_photo_alternate" style={{ fontSize: 22 }} />
          <span style={{ fontSize: 10, textAlign: 'center', padding: '0 6px' }}>Drop files</span>
          <input ref={fileInput} type="file" multiple accept="image/*,video/*" style={{ display: 'none' }} onChange={(e) => handleFiles(e.target.files)} />
        </div>
        {filtered.map((img) => {
          const idx = images.indexOf(img);
          return <Tile key={img.id} img={img} selected={idx === selected} onClick={() => setSelected(idx)} />;
        })}
      </div>
      <div style={{ fontSize: 12, color: 'rgba(0,0,0,.45)', margin: '8px 0 20px' }}>
        {images.length} of {images.length} shown · {testingCount} available for testing
        {expiringCount ? ` · ${expiringCount} licence expiring` : ''}
        {expiredCount ? ` · ${expiredCount} licence expired` : ''}
      </div>

      <div className="ph-sect" style={{ padding: 0 }}>
        {!working ? (
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
            onClick={() => fileInput.current?.click()}
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
                active={working.bgRemoved}
                disabled={expired}
                onClick={toggleBg}
                tooltipTitle={working.bgRemoved ? 'Restore background' : 'Remove background'}
                tooltipDesc={
                  expired
                    ? undefined
                    : working.bgRemoved
                    ? 'Puts the original background back. The cut-out is discarded.'
                    : 'Cuts the product out to a transparent PNG so it can sit on any campaign layout.'
                }
              />
              <IconAction
                icon={<MaterialIcon name="auto_fix_high" />}
                caption="Enhance"
                active={working.enhanced}
                disabled={expired}
                onClick={toggleEnhance}
                tooltipTitle={working.enhanced ? 'Undo enhancement' : 'Enhance quality'}
                tooltipDesc={working.enhanced ? 'Reverts to the original upload.' : 'Sharpens and colour-corrects the image.'}
              />
              <div style={{ width: 1, background: '#f0f0f0', margin: '4px 8px' }} />
              <IconAction
                icon={<MaterialIcon name={working.isDefault ? 'star' : 'star_border'} />}
                caption="Default"
                gold
                active={working.isDefault}
                disabled={expired}
                onClick={setDefault}
                tooltipTitle={working.isDefault ? 'Remove as default' : 'Set as default'}
                tooltipDesc={expired ? 'Renew the licence before making this the default.' : working.isDefault ? 'Another image can be chosen as default instead.' : 'Personalisation Hub uses this image unless a campaign specifies otherwise.'}
              />
              <IconAction
                icon={<BespokeIcon name="ab" />}
                caption="Testing"
                active={working.availableForTesting}
                disabled={expired}
                onClick={toggleTesting}
                tooltipTitle={expired ? 'Not available' : working.availableForTesting ? 'Remove from testing' : 'Make available for testing'}
                tooltipDesc={expired ? 'Renew the licence before making this available for testing.' : working.availableForTesting ? 'Personalisation Hub will stop selecting this variant for A/B testing.' : 'Lets Personalisation Hub select this variant in A/B tests.'}
              />
            </div>

            <div style={{ display: 'flex', gap: 24, padding: '20px 20px 22px', flexWrap: 'wrap' }}>
              <div style={{ width: 470, flexShrink: 0, maxWidth: '100%' }}>
                <BeforeAfterSlider beforeSrc={working.src} afterSrc={working.src} hasChange={hasTreatment} transparent={working.bgRemoved} />
                <p style={{ fontSize: 12, color: 'rgba(0,0,0,.45)', marginTop: 8 }}>
                  {hasTreatment ? 'Drag the slider to compare before/after.' : 'No treatment applied yet.'}
                </p>
                <div style={{ display: 'flex', gap: 8, marginTop: 14, paddingTop: 14, borderTop: '1px solid #f0f0f0' }}>
                  <IconAction icon={<MaterialIcon name="cached" />} caption="Replace" row tooltipTitle="Replace" tooltipDesc="Swaps the underlying file; variant label, tags and settings are kept." onClick={() => fileInput.current?.click()} />
                  <IconAction icon={<MaterialIcon name="delete" />} caption={working.isPending ? 'Discard' : 'Delete'} row danger tooltipTitle={working.isPending ? 'Discard' : 'Delete'} tooltipDesc="Removes this asset from the product." onClick={deleteAsset} />
                </div>
              </div>
              <div style={{ flex: 1, minWidth: 260, maxWidth: 382, display: 'flex', flexDirection: 'column' }}>
                <div style={{ marginBottom: 16 }}>
                  <label style={{ fontSize: 13, color: 'rgba(0,0,0,.65)', marginBottom: 6, display: 'block' }}>Variant name</label>
                  <Input value={working.name} onChange={(e) => setWorking((w) => ({ ...w, name: e.target.value }))} placeholder="e.g. Hero — front view" />
                </div>
                <div style={{ marginBottom: 16 }}>
                  <label style={{ fontSize: 13, color: 'rgba(0,0,0,.65)', marginBottom: 6, display: 'block' }}>Tags</label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {(working.tags || []).map((t) => (
                      <Tag key={t} closable onClose={() => setWorking((w) => ({ ...w, tags: w.tags.filter((x) => x !== t) }))}>
                        {t}
                      </Tag>
                    ))}
                    <Input
                      size="small"
                      style={{ width: 120 }}
                      placeholder="+ Add tag"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && e.currentTarget.value.trim()) {
                          setWorking((w) => ({ ...w, tags: [...(w.tags || []), e.currentTarget.value.trim()] }));
                          e.currentTarget.value = '';
                        }
                      }}
                    />
                  </div>
                </div>
                <div style={{ height: 1, background: '#f0f0f0', margin: '4px 0 14px' }} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: working.rightsOn ? 10 : 0 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14 }}>Rights &amp; licensing</div>
                    <div style={{ fontSize: 12, color: 'rgba(0,0,0,.45)', marginTop: 1 }}>{rightsSummary}</div>
                  </div>
                  <Switch checked={working.rightsOn} onChange={(v) => setWorking((w) => ({ ...w, rightsOn: v }))} />
                </div>
                {working.rightsOn && (
                  <div style={{ border: '1px solid #f0f0f0', borderRadius: 6, background: '#fafafa', padding: '14px 16px', marginBottom: 14 }}>
                    {expired && (
                      <div style={{ background: '#fff2f0', border: '1px solid #ffccc7', color: '#a8071a', borderRadius: 6, padding: '10px 12px', fontSize: 13, marginBottom: 12 }}>
                        Licence expired — Default and Testing are disabled until renewed.
                      </div>
                    )}
                    {!expired && soon && (
                      <div style={{ background: '#fffbe6', border: '1px solid #ffe58f', color: '#874d00', borderRadius: 6, padding: '10px 12px', fontSize: 13, marginBottom: 12 }}>
                        Expires in {daysUntil(working.rights.expiry)} day(s) — renew soon.
                      </div>
                    )}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                      <div>
                        <label style={{ fontSize: 12, color: 'rgba(0,0,0,.65)' }}>Licence type</label>
                        <Select
                          style={{ width: '100%', marginTop: 4 }}
                          value={working.rights.type}
                          onChange={(v) => setWorking((w) => ({ ...w, rights: { ...w.rights, type: v } }))}
                          options={['Owned', 'Licensed', 'Royalty-free'].map((s) => ({ value: s, label: s }))}
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: 12, color: 'rgba(0,0,0,.65)' }}>Territory</label>
                        <Select
                          style={{ width: '100%', marginTop: 4 }}
                          value={working.rights.territory}
                          onChange={(v) => setWorking((w) => ({ ...w, rights: { ...w.rights, territory: v } }))}
                          options={['Global', 'AU / NZ', 'AU only', 'APAC'].map((s) => ({ value: s, label: s }))}
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: 12, color: 'rgba(0,0,0,.65)', display: 'block', marginBottom: 4 }}>Expiry date</label>
                        <ClearableDate
                          value={working.rights.expiry}
                          onChange={(v) => setWorking((w) => ({ ...w, rights: { ...w.rights, expiry: v } }))}
                          blankHint={{ blank: 'No expiry', set: '' }}
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: 12, color: 'rgba(0,0,0,.65)' }}>Rights holder</label>
                        <Input
                          style={{ marginTop: 4 }}
                          value={working.rights.holder}
                          onChange={(e) => setWorking((w) => ({ ...w, rights: { ...w.rights, holder: e.target.value } }))}
                        />
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
                      <Switch size="small" checked={!!working.rights.release} onChange={(v) => setWorking((w) => ({ ...w, rights: { ...w.rights, release: v } }))} />
                      <span style={{ fontSize: 13 }}>Talent / property release on file</span>
                    </div>
                  </div>
                )}
                <button
                  type="button"
                  onClick={commit}
                  style={{ background: '#169bc2', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 16px', fontSize: 14, cursor: 'pointer', alignSelf: 'flex-start' }}
                >
                  {working.isPending ? 'Add to product' : 'Commit changes'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
