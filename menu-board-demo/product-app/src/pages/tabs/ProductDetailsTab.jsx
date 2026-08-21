import { useMemo, useState } from 'react';
import { Input, InputNumber, Select, Switch, Button } from 'antd';
import MaterialIcon from '../../components/MaterialIcon.jsx';
import ClearableDate from '../../components/ClearableDate.jsx';
import StorePicker from '../../components/StorePicker.jsx';
import AttributeGroups from '../../components/AttributeGroups.jsx';
import OptionGroups from '../../components/OptionGroups.jsx';
import OfferBanner from '../../components/OfferBanner.jsx';
import { getCats, getTypes, getBrands, getBrandById, addCategoryToRegistry } from '../../data/registries.js';

const { TextArea } = Input;

function SectionCard({ children }) {
  return <div className="ph-sect">{children}</div>;
}
function Field({ label, required, children, hint }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <label style={{ fontSize: 13, color: 'rgba(0,0,0,.65)', marginBottom: 6 }}>
        {label} {required && <span style={{ color: '#ff4d4f' }}>*</span>}
      </label>
      {children}
      {hint && <p style={{ fontSize: 12, color: 'rgba(0,0,0,.45)', marginTop: 5 }}>{hint}</p>}
    </div>
  );
}

export default function ProductDetailsTab({ draft, patch, onGoPricing }) {
  const [newCat, setNewCat] = useState('');
  const [addingCat, setAddingCat] = useState(false);

  const catOptions = useMemo(() => {
    const set = new Set(getCats());
    if (draft.category) set.add(draft.category);
    return [...set].sort().map((c) => ({ value: c, label: c }));
  }, [draft.category]);

  const types = getTypes();
  const brands = getBrands();
  const brand = getBrandById(draft.brand);
  const shortLen = (draft.shortDescription || '').length;

  const confirmNewCategory = async () => {
    const name = newCat.trim();
    if (!name) return;
    await addCategoryToRegistry(name);
    patch({ category: name });
    setNewCat('');
    setAddingCat(false);
  };

  const toggleType = (id) => {
    const has = draft.menuTypes.includes(id);
    patch({ menuTypes: has ? draft.menuTypes.filter((t) => t !== id) : [...draft.menuTypes, id] });
  };

  return (
    <div>
      {/* Identity & pricing */}
      <SectionCard>
        <div className="ph-sect-label" style={{ marginBottom: 12 }}>
          Identity &amp; pricing
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 16px', marginBottom: 14 }}>
          <Field label="Brand" required>
            <Select
              value={draft.brand || undefined}
              onChange={(v) => patch({ brand: v })}
              options={brands.map((b) => ({ value: b.id, label: b.name }))}
              placeholder="Select brand"
            />
          </Field>
          <Field label="Product name" required>
            <Input value={draft.name} onChange={(e) => patch({ name: e.target.value })} placeholder="Full product name" />
          </Field>
        </div>
        <div style={{ marginBottom: 14 }}>
          <Field label="Display name" hint="Short board-safe name for menu boards.">
            <Input value={draft.displayName} onChange={(e) => patch({ displayName: e.target.value })} placeholder="Short form" style={{ maxWidth: 420 }} />
          </Field>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr 1fr', gap: '14px 16px' }}>
          <Field label="SKU" required>
            <Input value={draft.sku} onChange={(e) => patch({ sku: e.target.value })} style={{ fontFamily: 'ui-monospace,Menlo,Consolas,monospace' }} placeholder="e.g. BYR-CHK-001" />
          </Field>
          <Field label="RRP">
            <InputNumber disabled value={draft.rrp} prefix={draft.currency || brand?.currency || '$'} style={{ width: '100%' }} />
          </Field>
          <Field label="Offer price">
            <InputNumber disabled value={draft.offerPrice} prefix={draft.currency || brand?.currency || '$'} style={{ width: '100%' }} />
          </Field>
        </div>
        {draft.showOnMenuBoard && (
          <div style={{ marginTop: 12 }}>
            <Field label="Show on Menu Board">
              <Input disabled value={draft.showOnMenuBoard} />
            </Field>
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#fafafa', border: '1px solid #f0f0f0', borderRadius: 6, padding: '10px 12px', fontSize: 13, color: 'rgba(0,0,0,.65)', marginTop: 12 }}>
          <MaterialIcon name="lock" style={{ fontSize: 15 }} />
          <span style={{ flex: 1 }}>
            Pricing is read-only here. RRP, offer price, scheduling, currency and tax class are all managed on the
            Pricing tab so that every change is captured in the price change log.
          </span>
          <Button size="small" onClick={onGoPricing}>
            Go to Pricing →
          </Button>
        </div>
        <div style={{ marginTop: 12 }}>
          <OfferBanner rrp={draft.rrp} offerPrice={draft.offerPrice} offerFrom={draft.offerFrom} offerUntil={draft.offerUntil} />
        </div>
      </SectionCard>

      {/* Status & merchandising */}
      <SectionCard>
        <div className="ph-sect-label" style={{ marginBottom: 12 }}>
          Status &amp; merchandising
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: draft.featured ? '1fr 1fr 1fr' : '1fr 1fr', gap: '14px 16px' }}>
          <Field
            label="Product status"
            hint={
              { Draft: 'Not visible on any board yet.', Active: 'Live and available on boards.', Inactive: 'Temporarily hidden from boards.', Archived: 'Retired — kept for reporting only.' }[draft.status]
            }
          >
            <Select
              value={draft.status}
              onChange={(v) => patch(v === 'Active' ? { status: v } : { status: v, featured: false })}
              options={['Draft', 'Active', 'Inactive', 'Archived'].map((s) => ({ value: s, label: s }))}
            />
          </Field>
          <Field
            label="Featured item"
            hint={draft.status === 'Active' ? 'Drives hero placement on boards and in campaign creative.' : 'Only Active products can be featured.'}
          >
            <div style={{ marginTop: 4 }}>
              <Switch checked={draft.featured} disabled={draft.status !== 'Active'} onChange={(v) => patch({ featured: v })} />
            </div>
          </Field>
          {draft.featured && (
            <Field label="Feature priority" hint="1 = highest.">
              <InputNumber min={1} value={draft.featurePriority} onChange={(v) => patch({ featurePriority: v })} style={{ width: '100%' }} />
            </Field>
          )}
        </div>
      </SectionCard>

      {/* Descriptions + Classification & availability */}
      <SectionCard>
        <div className="ph-sect-label" style={{ marginBottom: 12 }}>
          Descriptions
        </div>
        <Field
          label="Short description"
          hint={`${shortLen}/90`}
        >
          <Input maxLength={90} value={draft.shortDescription} onChange={(e) => patch({ shortDescription: e.target.value })} />
        </Field>
        <div style={{ marginTop: 14 }}>
          <Field label="Long description">
            <TextArea rows={4} value={draft.longDescription} onChange={(e) => patch({ longDescription: e.target.value })} />
          </Field>
        </div>

        <div style={{ height: 1, background: '#f0f0f0', margin: '18px 0' }} />
        <div className="ph-sect-label" style={{ marginBottom: 12 }}>
          Classification &amp; availability
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 16px' }}>
          <Field label="Category" required>
            <Select
              value={draft.category || undefined}
              onChange={(v) => patch({ category: v })}
              options={catOptions}
              showSearch
              placeholder="Select category"
              dropdownRender={(menu) => (
                <>
                  {menu}
                  <div style={{ padding: 8, borderTop: '1px solid #f0f0f0' }}>
                    {addingCat ? (
                      <div style={{ display: 'flex', gap: 6 }}>
                        <Input
                          size="small"
                          autoFocus
                          value={newCat}
                          onChange={(e) => setNewCat(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && confirmNewCategory()}
                          placeholder="New category name…"
                        />
                        <Button size="small" type="primary" onClick={confirmNewCategory}>
                          Add
                        </Button>
                      </div>
                    ) : (
                      <Button type="text" size="small" onClick={() => setAddingCat(true)} icon={<MaterialIcon name="add" style={{ fontSize: 14 }} />}>
                        Add new category
                      </Button>
                    )}
                  </div>
                </>
              )}
            />
          </Field>
          <Field label="Sub-category">
            <Input value={draft.subCategory} onChange={(e) => patch({ subCategory: e.target.value })} placeholder="e.g. Analgesics" />
          </Field>
        </div>

        <div style={{ marginTop: 14 }}>
          <Field
            label="Menu types"
            required
            hint={
              draft.menuTypes.length === 0 ? (
                <span style={{ color: '#ff4d4f' }}>
                  At least one menu type is required — the item will not appear on any board without one.
                </span>
              ) : null
            }
          >
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {types.map((t) => {
                const on = draft.menuTypes.includes(t.id);
                return (
                  <button
                    type="button"
                    key={t.id}
                    onClick={() => toggleType(t.id)}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 7,
                      border: '1px solid ' + (on ? '#169bc2' : '#d9d9d9'),
                      borderRadius: 6, padding: '6px 11px', fontSize: 13, cursor: 'pointer',
                      background: on ? '#e8fdff' : '#fff', color: on ? '#09759c' : 'rgba(0,0,0,.88)',
                    }}
                  >
                    <span style={{ width: 9, height: 9, borderRadius: '50%', border: `1.5px solid ${t.color}`, background: on ? t.color : 'transparent' }} />
                    {t.label}
                  </button>
                );
              })}
            </div>
          </Field>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '14px 16px', marginTop: 14 }}>
          <Field
            label="Availability"
            hint={draft.availability !== 'Available' ? <span style={{ color: '#faad14' }}>Boards will fall back or suppress this item.</span> : null}
          >
            <Select
              value={draft.availability}
              onChange={(v) => patch({ availability: v })}
              options={['Available', 'Temporarily unavailable', 'Coming soon', 'Discontinued'].map((s) => ({ value: s, label: s }))}
            />
          </Field>
          <Field label="Available from">
            <ClearableDate
              value={draft.availFrom}
              onChange={(v) => patch({ availFrom: v })}
              blankHint={{ blank: 'Available immediately', set: 'Set — see date above' }}
            />
          </Field>
          <Field label="Available to">
            <ClearableDate
              value={draft.availTo}
              onChange={(v) => patch({ availTo: v })}
              blankHint={{ blank: 'No end date', set: 'Set — see date above' }}
            />
          </Field>
        </div>

        <div style={{ marginTop: 14 }}>
          <StorePicker mode={draft.storeMode} stores={draft.stores} onChange={({ mode, stores }) => patch({ storeMode: mode, stores })} />
        </div>
      </SectionCard>

      {/* Stock alert */}
      <SectionCard>
        <div className="ph-sect-label">Stock alert</div>
        <p style={{ fontSize: 12, color: 'rgba(0,0,0,.45)', margin: '4px 0 12px' }}>
          When to warn the team that this item is running low.
        </p>
        <div style={{ maxWidth: 340 }}>
          <Field
            label="Low stock alert threshold"
            hint={
              draft.lowStockThreshold === '' || draft.lowStockThreshold == null ? (
                brand?.lowStockThreshold != null
                  ? `Using the brand default of ${brand.lowStockThreshold}. Enter a value to override it for this product only.`
                  : 'No brand default set. Enter a value to set an alert threshold for this product.'
              ) : (
                <>
                  {brand?.lowStockThreshold != null && <>Overriding the brand default of {brand.lowStockThreshold}. </>}
                  <a onClick={() => patch({ lowStockThreshold: '' })}>Reset to brand default</a>
                </>
              )
            }
          >
            <InputNumber
              value={draft.lowStockThreshold}
              onChange={(v) => patch({ lowStockThreshold: v })}
              placeholder={brand?.lowStockThreshold != null ? String(brand.lowStockThreshold) : ''}
              style={{ width: '100%' }}
              min={0}
            />
          </Field>
        </div>
      </SectionCard>

      {/* Attributes */}
      <SectionCard>
        <div className="ph-sect-label" style={{ marginBottom: 12 }}>
          Attributes
        </div>
        <AttributeGroups groups={draft.attrGroups} onChange={(attrGroups) => patch({ attrGroups })} />
      </SectionCard>

      {/* Options */}
      <SectionCard>
        <div className="ph-sect-label" style={{ marginBottom: 12 }}>
          Options
        </div>
        <OptionGroups groups={draft.optionGroups} onChange={(optionGroups) => patch({ optionGroups })} />
      </SectionCard>
    </div>
  );
}
