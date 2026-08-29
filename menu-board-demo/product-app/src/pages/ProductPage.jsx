import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Tabs, Tag, Button, Spin, App, Badge, Switch, Tooltip } from 'antd';
import MaterialIcon from '../components/MaterialIcon.jsx';
import ProductDetailsTab from './tabs/ProductDetailsTab.jsx';
import StockTab from './tabs/StockTab.jsx';
import ProductAssetsTab from './tabs/ProductAssetsTab.jsx';
import PricingTab from './tabs/PricingTab.jsx';
import { getProduct, blankProduct, upsertProduct, setProductStatus } from '../data/productStore.js';

export default function ProductPage({ isNew = false }) {
  // /products/new carries no :tab segment (App.jsx's route for it is
  // path-only), so this default is what actually decides a brand-new
  // product's landing tab — Product Details first, so its required fields
  // (checked by detailsIncomplete below) get filled in before anything else.
  const { id, tab = 'details' } = useParams();
  const navigate = useNavigate();
  const { message } = App.useApp();

  const [baseline, setBaseline] = useState(null);
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [statusSaving, setStatusSaving] = useState(false);
  // Turns true only once a save has actually been attempted while a
  // required field was missing — a fresh blank product shouldn't greet
  // the user with a wall of red before they've touched anything. Once
  // true, ProductDetailsTab.jsx keeps showing per-field errors live as
  // the user fixes them (rather than only re-checking on the next save
  // attempt), same as switching it off would be a worse "did that field
  // count?" experience.
  const [showValidation, setShowValidation] = useState(false);

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

  // Mirrors Product Details' own required-field markers (ProductDetailsTab.jsx:
  // Brand, Product name, SKU, Category, Menu types) — a product can't go
  // Active until all of them are filled in, so it can never reach a live
  // board half-defined.
  const detailsIncomplete = !draft?.brand || !(draft?.name || '').trim() || !(draft?.sku || '').trim()
    || !draft?.category || !(draft?.menuTypes || []).length;

  const imageCount = useMemo(() => (draft?.images || []).filter((i) => i.type !== 'video').length, [draft]);
  const videoCount = useMemo(() => (draft?.images || []).filter((i) => i.type === 'video').length, [draft]);
  // Details and Assets share one save bar and touch dozens of fields
  // (including nested image/attribute arrays), so a deep JSON compare
  // against the last-saved baseline is the reliable way to gate it —
  // hand-picking individual fields to watch would only catch some edits.
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(baseline), [draft, baseline]);

  const saveDetailsOrAssets = async () => {
    // Blocks the save itself, not just the Active toggle — a product
    // missing Brand/Product name/SKU/Category/Menu types could previously
    // still be saved as Inactive with no feedback about what was missing.
    // Jumps to Details (wherever the save was actually attempted from) so
    // the per-field error states this turns on are visible, not just a
    // toast naming fields the user can't currently see.
    if (detailsIncomplete) {
      setShowValidation(true);
      if (tab !== 'details') goTab('details');
      message.error('Complete the required fields (marked *) on Product Details before saving.');
      return;
    }
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

  // Status is the one field that behaves like HQ Admin's grid row
  // Activate/Deactivate action — it flips immediately, without the user
  // having to find and click a Save Changes button (which, on the
  // Pricing tab, doesn't even exist for this field — see
  // setProductStatus's comment). A brand-new, not-yet-created product
  // has no Firestore document to merge onto, so it still just patches
  // the draft; the toggle is then included in the product's first save.
  const toggleStatus = async (v) => {
    const status = v ? 'Active' : 'Inactive';
    const fields = v ? { status: 'Active' } : { status: 'Inactive', featured: false };
    if (isNew) {
      patch(fields);
      return;
    }
    setStatusSaving(true);
    try {
      await setProductStatus(draft.id, status);
      setDraft((d) => ({ ...d, ...fields }));
      setBaseline((b) => ({ ...b, ...fields }));
      message.success(status === 'Active' ? 'Product activated' : 'Product deactivated');
    } catch (e) {
      message.error('Status change failed: ' + (e.message || e));
    } finally {
      setStatusSaving(false);
    }
  };

  if (!draft) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <Spin size="large" />
      </div>
    );
  }

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
            {draft.featured && (
              <Tag style={{ background: '#fffbe6', borderColor: '#ffe58f', color: '#d48806', fontWeight: 600 }}>
                <MaterialIcon name="star" style={{ fontSize: 12, verticalAlign: -2, fontVariationSettings: "'FILL' 1, 'wght' 600, 'GRAD' 0, 'opsz' 20" }} /> FEATURED
              </Tag>
            )}
          </div>
          {/* Same treatment as Campaign Detail's own Status control
              (ph-designer skill references/hq-admin.md §2) — muted "Status"
              label, coloured dot, bold status text, teal Switch — top-right
              of the page header, visible across every tab since it's a
              page-level property, not something scoped to Details. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 14, color: 'rgba(0,0,0,.65)' }}>Status</span>
            <Badge dot color={draft.status === 'Active' ? '#52c41a' : '#ff4d4f'} />
            <span style={{ fontSize: 14, fontWeight: 700, color: '#333333' }}>{draft.status === 'Active' ? 'Active' : 'Inactive'}</span>
            <Tooltip title={detailsIncomplete ? 'Complete Brand, Product name, SKU, Category and Menu types on Product Details before activating' : ''}>
              <Switch
                checked={draft.status === 'Active'}
                loading={statusSaving}
                disabled={draft.status !== 'Active' && detailsIncomplete}
                onChange={toggleStatus}
              />
            </Tooltip>
          </div>
        </div>
        <div style={{ height: 1, background: 'rgba(5,5,5,0.06)', margin: '4px 0 16px' }} />

        <Tabs
          activeKey={tab}
          onChange={goTab}
          items={[
            { key: 'assets', label: `Product Assets (${imageCount + videoCount})` },
            { key: 'details', label: 'Product Details' },
            { key: 'pricing', label: 'Pricing' },
            { key: 'stock', label: 'Stockists' },
          ]}
        />

        {tab === 'details' && (
          <ProductDetailsTab draft={draft} patch={patch} onGoPricing={() => goTab('pricing')} showValidation={showValidation} />
        )}
        {tab === 'assets' && <ProductAssetsTab draft={draft} baseline={baseline} patch={patch} />}
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
