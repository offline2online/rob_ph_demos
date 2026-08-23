import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Tabs, Tag, Button, Spin, App } from 'antd';
import MaterialIcon from '../components/MaterialIcon.jsx';
import ProductDetailsTab from './tabs/ProductDetailsTab.jsx';
import StockTab from './tabs/StockTab.jsx';
import ProductAssetsTab from './tabs/ProductAssetsTab.jsx';
import PricingTab from './tabs/PricingTab.jsx';
import { getProduct, blankProduct, upsertProduct } from '../data/productStore.js';

const STATUS_COLOR = {
  Active: { bg: '#f6ffed', border: '#b7eb8f', color: '#389e0d' },
  Draft: { bg: '#fffbe6', border: '#ffe58f', color: '#ad6800' },
  Inactive: { bg: '#fffbe6', border: '#ffe58f', color: '#ad6800' },
  Archived: { bg: '#fff2f0', border: '#ffccc7', color: '#cf1322' },
};

export default function ProductPage({ isNew = false }) {
  const { id, tab = 'details' } = useParams();
  const navigate = useNavigate();
  const { message } = App.useApp();

  const [baseline, setBaseline] = useState(null);
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setDraft(null);
    setBaseline(null);
    (async () => {
      const p = isNew ? blankProduct() : await getProduct(id);
      if (cancelled) return;
      if (!p) {
        navigate('/products/new', { replace: true });
        return;
      }
      setBaseline(p);
      setDraft(p);
    })();
    return () => { cancelled = true; };
  }, [id, isNew]); // eslint-disable-line react-hooks/exhaustive-deps

  const patch = (fields) => setDraft((d) => ({ ...d, ...fields }));

  const goTab = (t) => navigate(`/products/${draft.id}/${t}`, { replace: true });

  const imageCount = useMemo(() => (draft?.images || []).filter((i) => i.type !== 'video').length, [draft]);
  const videoCount = useMemo(() => (draft?.images || []).filter((i) => i.type === 'video').length, [draft]);
  // Details and Assets share one save bar and touch dozens of fields
  // (including nested image/attribute arrays), so a deep JSON compare
  // against the last-saved baseline is the reliable way to gate it —
  // hand-picking individual fields to watch would only catch some edits.
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(baseline), [draft, baseline]);

  const saveDetailsOrAssets = async () => {
    setSaving(true);
    try {
      const saved = await upsertProduct(draft);
      setBaseline(saved);
      setDraft(saved);
      message.success(`"${draft.name || 'Product'}" saved`);
      if (isNew) navigate(`/products/${draft.id}/details`, { replace: true });
    } catch (e) {
      const raw = e.message || String(e);
      // Firestore's own error for this case names an internal field path
      // ("array") that means nothing to someone editing a product — the
      // Assets tab now compresses uploads before they reach this point, so
      // this should be rare, but if it still happens, say what's actually
      // wrong and how to fix it rather than surfacing the raw SDK message.
      const friendly = /longer than \d+ bytes/i.test(raw)
        ? 'Save failed: this product\'s images are too large in total. Remove one or replace it with a smaller file.'
        : 'Save failed: ' + raw;
      message.error(friendly, 6);
    } finally {
      setSaving(false);
    }
  };
  const discardDetailsOrAssets = () => setDraft(baseline);

  if (!draft) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <Spin size="large" />
      </div>
    );
  }

  const sc = STATUS_COLOR[draft.status] || STATUS_COLOR.Draft;

  return (
    <div style={{ padding: 20, background: '#ffffff', minHeight: '100vh' }}>
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, marginBottom: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Button type="text" onClick={() => navigate(-1)} style={{ padding: '0 4px' }} title="Back to Products">
              <MaterialIcon name="arrow_back" />
            </Button>
            <h1 style={{ margin: 0, fontWeight: 700, fontSize: 20, color: '#333333' }}>{draft.name || 'New Product'}</h1>
            {draft.sku && (
              <Tag style={{ fontFamily: 'ui-monospace,Menlo,Consolas,monospace' }}>{draft.sku}</Tag>
            )}
            <Tag style={{ background: sc.bg, borderColor: sc.border, color: sc.color, fontWeight: 600 }}>
              {draft.status?.toUpperCase()}
            </Tag>
            {draft.featured && (
              <Tag style={{ background: '#fffbe6', borderColor: '#ffe58f', color: '#d48806', fontWeight: 600 }}>
                <MaterialIcon name="star" style={{ fontSize: 12, verticalAlign: -2, fontVariationSettings: "'FILL' 1, 'wght' 600, 'GRAD' 0, 'opsz' 20" }} /> FEATURED
              </Tag>
            )}
          </div>
        </div>
        <div style={{ height: 1, background: 'rgba(5,5,5,0.06)', margin: '4px 0 16px' }} />

        <Tabs
          activeKey={tab}
          onChange={goTab}
          items={[
            { key: 'details', label: 'Product Details' },
            { key: 'assets', label: `Product Assets (${imageCount + videoCount})` },
            { key: 'pricing', label: 'Pricing' },
            { key: 'stock', label: 'Stock' },
          ]}
        />

        {tab === 'details' && (
          <ProductDetailsTab draft={draft} patch={patch} onGoPricing={() => goTab('pricing')} />
        )}
        {tab === 'assets' && <ProductAssetsTab draft={draft} patch={patch} />}
        {tab === 'pricing' && <PricingTab draft={draft} baseline={baseline} setDraft={setDraft} setBaseline={setBaseline} />}
        {tab === 'stock' && <StockTab draft={draft} patch={patch} />}

        {tab !== 'pricing' && (
          <div className="ph-savebar">
            <span style={{ fontSize: 13, color: 'rgba(0,0,0,.65)' }}>
              {dirty
                ? 'Unsaved changes.'
                : 'No changes to save.'}{' '}
              Images and video are on <strong>Product Assets</strong>. All pricing is on <strong>Pricing</strong>.
            </span>
            <div style={{ flex: 1 }} />
            <Button onClick={discardDetailsOrAssets} disabled={saving || !dirty}>Cancel</Button>
            <Button type="primary" onClick={saveDetailsOrAssets} loading={saving} disabled={!dirty}>
              Save Changes
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
