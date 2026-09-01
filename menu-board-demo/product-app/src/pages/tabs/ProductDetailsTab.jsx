import { useMemo, useState } from 'react';
import { Input, InputNumber, Select, Switch, Button, Modal, message } from 'antd';
import MaterialIcon from '../../components/MaterialIcon.jsx';
import ClearableDate, { shiftEndOneHour } from '../../components/ClearableDate.jsx';
import AdditionalAttributes from '../../components/AdditionalAttributes.jsx';
import OptionGroups from '../../components/OptionGroups.jsx';
import OfferBanner from '../../components/OfferBanner.jsx';
import { getCats, getSubCats, getTypes, getBrands, getBrandById, addCategoryToRegistry, addSubCategoryToRegistry, getLanguages, getKnownIngredients, useAiProviders } from '../../data/registries.js';
import { translateProductCopy, isProviderConfigured } from '../../lib/aiProviders.js';

const { TextArea } = Input;

function SectionCard({ children }) {
  return <div className="ph-sect">{children}</div>;
}
// `error`, when set, always wins over `hint` — same slot, red instead of
// muted grey, so a field never shows both its normal hint and a
// validation message stacked on top of each other.
function Field({ label, required, children, hint, error }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <label style={{ fontSize: 13, color: 'rgba(0,0,0,.65)', marginBottom: 6 }}>
        {label} {required && <span style={{ color: '#ff4d4f' }}>*</span>}
      </label>
      {children}
      {error ? (
        <p style={{ fontSize: 12, color: '#ff4d4f', marginTop: 5 }}>{error}</p>
      ) : hint ? (
        <p style={{ fontSize: 12, color: 'rgba(0,0,0,.45)', marginTop: 5 }}>{hint}</p>
      ) : null}
    </div>
  );
}

// AI-driven action button — ph-designer skill's AI gradient recipe
// (references/components.md §1): a 20%-opacity teal→violet gradient fill,
// no border, and gradient-clipped label text. Used for every AI-driven
// action in this file (opening the language picker, and the picker's own
// "Translate" confirm) rather than a plain solid-teal primary button.
function AiButton({ children, icon = 'auto_awesome', ...rest }) {
  return (
    <Button
      className="border-none!"
      style={{ background: 'linear-gradient(135deg, rgba(22,155,194,.2), rgba(151,71,255,.2))' }}
      icon={<MaterialIcon name={icon} style={{ fontSize: 16 }} />}
      {...rest}
    >
      <span
        style={{
          backgroundImage: 'linear-gradient(135deg, #169bc2, #9747ff)',
          WebkitBackgroundClip: 'text',
          backgroundClip: 'text',
          color: 'transparent',
        }}
      >
        {children}
      </span>
    </Button>
  );
}

export default function ProductDetailsTab({ draft, patch, onGoPricing, showValidation }) {
  const aiProviders = useAiProviders();
  const [newCat, setNewCat] = useState('');
  const [addingCat, setAddingCat] = useState(false);
  const [newSubCat, setNewSubCat] = useState('');
  const [addingSubCat, setAddingSubCat] = useState(false);
  // Which language's Short/Long description is currently shown — page-
  // local UI state, not persisted itself. English is the one language
  // every product already has real content for (draft.shortDescription/
  // longDescription, read by the grid, menu-board.html, everywhere else),
  // so it stays the default and keeps writing straight to those same flat
  // fields; every other language is additive, stored only in
  // draft.descriptionTranslations so nothing outside this tab needs to
  // know translations exist yet.
  const [descLang, setDescLang] = useState('en');
  // "Add New Language" modal — mock-only translation flow (see
  // confirmAddLanguage below). English is always present; every other
  // language must be explicitly added here before it shows up in the
  // Language selector above, rather than every registry language always
  // being offered whether or not this product has been translated into it.
  const [addLangOpen, setAddLangOpen] = useState(false);
  const [pickedLang, setPickedLang] = useState(undefined);
  const [translating, setTranslating] = useState(false);

  const catOptions = useMemo(() => {
    const set = new Set(getCats());
    if (draft.category) set.add(draft.category);
    return [...set].sort().map((c) => ({ value: c, label: c }));
  }, [draft.category]);

  const subCatOptions = useMemo(() => {
    const set = new Set(getSubCats());
    if (draft.subCategory) set.add(draft.subCategory);
    return [...set].sort().map((c) => ({ value: c, label: c }));
  }, [draft.subCategory]);

  const types = getTypes();
  const brands = getBrands();
  const brand = getBrandById(draft.brand);
  // Mirrors ProductPage.jsx's own detailsIncomplete check (same 5 fields:
  // Brand, Product name, SKU, Category, Menu types) — showValidation only
  // turns true once a save has actually been attempted while one of them
  // was missing, so a fresh blank product doesn't greet the user with a
  // wall of red before they've touched anything.
  const showErr = (missing) => showValidation && missing;
  const languages = getLanguages();
  const addedLanguageCodes = draft.descriptionLanguages && draft.descriptionLanguages.length
    ? draft.descriptionLanguages
    : ['en'];
  const addedLanguages = addedLanguageCodes
    .map((code) => languages.find((l) => l.code === code) || { code, name: code });
  const availableToAddLanguages = languages.filter((l) => !addedLanguageCodes.includes(l.code));

  const isEnglishDesc = descLang === 'en';
  const currentDisplayName = isEnglishDesc
    ? draft.displayName || ''
    : draft.descriptionTranslations?.[descLang]?.displayName || '';
  const currentShortDescription = isEnglishDesc
    ? draft.shortDescription || ''
    : draft.descriptionTranslations?.[descLang]?.shortDescription || '';
  const currentLongDescription = isEnglishDesc
    ? draft.longDescription || ''
    : draft.descriptionTranslations?.[descLang]?.longDescription || '';
  const shortLen = currentShortDescription.length;

  const patchDisplayName = (value) => {
    if (isEnglishDesc) { patch({ displayName: value }); return; }
    patch({
      descriptionTranslations: {
        ...(draft.descriptionTranslations || {}),
        [descLang]: { ...(draft.descriptionTranslations?.[descLang] || {}), displayName: value },
      },
    });
  };
  const patchShortDescription = (value) => {
    if (isEnglishDesc) { patch({ shortDescription: value }); return; }
    patch({
      descriptionTranslations: {
        ...(draft.descriptionTranslations || {}),
        [descLang]: { ...(draft.descriptionTranslations?.[descLang] || {}), shortDescription: value },
      },
    });
  };
  const patchLongDescription = (value) => {
    if (isEnglishDesc) { patch({ longDescription: value }); return; }
    patch({
      descriptionTranslations: {
        ...(draft.descriptionTranslations || {}),
        [descLang]: { ...(draft.descriptionTranslations?.[descLang] || {}), longDescription: value },
      },
    });
  };

  const openAddLanguage = () => {
    setPickedLang(undefined);
    setAddLangOpen(true);
  };

  // Calls the configured Translation provider (e.g. GPT-5.2, per Settings
  // → AI Integrations) to translate this product's Display name, Short and
  // Long description into the picked language. Adds the picked language to
  // descriptionLanguages so it now appears in the Language selector above,
  // and switches to it so the result is immediately visible.
  const hasTranslationProvider = isProviderConfigured(aiProviders.translation);

  const confirmAddLanguage = async () => {
    if (!pickedLang) return;
    const lang = languages.find((l) => l.code === pickedLang);
    if (!lang) return;
    if (!hasTranslationProvider) {
      message.error('No Translation provider configured — add one in Settings → AI Integrations.');
      return;
    }
    setTranslating(true);
    try {
      const translated = await translateProductCopy({
        targetLangName: lang.name,
        displayName: draft.displayName || '',
        shortDescription: draft.shortDescription || '',
        longDescription: draft.longDescription || '',
      });
      patch({
        descriptionTranslations: {
          ...(draft.descriptionTranslations || {}),
          [pickedLang]: translated,
        },
        descriptionLanguages: [...addedLanguageCodes, pickedLang],
      });
      setDescLang(pickedLang);
      setAddLangOpen(false);
    } catch (e) {
      message.error(`Translation failed: ${e.message}`);
    } finally {
      setTranslating(false);
    }
  };

  const confirmNewCategory = async () => {
    const name = newCat.trim();
    if (!name) return;
    await addCategoryToRegistry(name);
    patch({ category: name });
    setNewCat('');
    setAddingCat(false);
  };

  const confirmNewSubCategory = async () => {
    const name = newSubCat.trim();
    if (!name) return;
    await addSubCategoryToRegistry(name);
    patch({ subCategory: name });
    setNewSubCat('');
    setAddingSubCat(false);
  };

  const toggleType = (id) => {
    const has = draft.menuTypes.includes(id);
    patch({ menuTypes: has ? draft.menuTypes.filter((t) => t !== id) : [...draft.menuTypes, id] });
  };

  // Display name (the short, board-safe name shown further down under
  // Descriptions) auto-follows Product name until someone actually types
  // something different into it — same "keep following until diverged"
  // rule a URL slug field would use. Only ever touches the flat English
  // field, never descriptionTranslations — Product name has no per-
  // language variant of its own for this to sync from.
  const handleNameChange = (name) => {
    const stillFollowing = !draft.displayName || draft.displayName === draft.name;
    patch(stillFollowing ? { name, displayName: name } : { name });
  };

  // Changing Brand re-syncs currency to match — there's no separate
  // currency-editing control anywhere in this app (see productStore.js's
  // blankProduct comment), so the selected brand's own currency
  // (hq-admin.html's brand modal) is the only real source for it.
  const handleBrandChange = (brandId) => {
    patch({ brand: brandId, currency: getBrandById(brandId)?.currency || '$' });
  };

  return (
    <div>
      {/* Identity, classification & pricing — one section, not two. Order
          is Brand/Product name, then SKU/Category/Sub-category on one
          line (Category and Menu types are both mandatory, so they sit
          right under SKU rather than buried further down the page), then
          Menu types, then pricing last — pricing is read-only here
          anyway (see the lock note below), so it doesn't need to lead. */}
      <SectionCard>
        <div className="ph-sect-label" style={{ marginBottom: 12 }}>
          Identity &amp; pricing
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 16px', marginBottom: 14 }}>
          <Field label="Brand" required error={showErr(!draft.brand) ? 'Brand is required.' : undefined}>
            <Select
              value={draft.brand || undefined}
              onChange={handleBrandChange}
              options={brands.map((b) => ({ value: b.id, label: b.name }))}
              placeholder="Select brand"
              status={showErr(!draft.brand) ? 'error' : undefined}
            />
          </Field>
          <Field label="Product name" required error={showErr(!(draft.name || '').trim()) ? 'Product name is required.' : undefined}>
            <Input
              value={draft.name}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="Full product name"
              status={showErr(!(draft.name || '').trim()) ? 'error' : undefined}
            />
          </Field>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '14px 16px', marginBottom: 14 }}>
          <Field label="SKU" required error={showErr(!(draft.sku || '').trim()) ? 'SKU is required.' : undefined}>
            <Input
              size="small"
              value={draft.sku}
              onChange={(e) => patch({ sku: e.target.value })}
              style={{ fontFamily: 'ui-monospace,Menlo,Consolas,monospace' }}
              placeholder="e.g. BYR-CHK-001"
              status={showErr(!(draft.sku || '').trim()) ? 'error' : undefined}
            />
          </Field>
          <Field label="Category" required error={showErr(!draft.category) ? 'Category is required.' : undefined}>
            <Select
              size="small"
              value={draft.category || undefined}
              onChange={(v) => patch({ category: v })}
              options={catOptions}
              showSearch
              placeholder="Select category"
              status={showErr(!draft.category) ? 'error' : undefined}
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
            <Select
              size="small"
              value={draft.subCategory || undefined}
              onChange={(v) => patch({ subCategory: v })}
              options={subCatOptions}
              showSearch
              allowClear
              placeholder="Select sub-category"
              dropdownRender={(menu) => (
                <>
                  {menu}
                  <div style={{ padding: 8, borderTop: '1px solid #f0f0f0' }}>
                    {addingSubCat ? (
                      <div style={{ display: 'flex', gap: 6 }}>
                        <Input
                          size="small"
                          autoFocus
                          value={newSubCat}
                          onChange={(e) => setNewSubCat(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && confirmNewSubCategory()}
                          placeholder="New sub-category name…"
                        />
                        <Button size="small" type="primary" onClick={confirmNewSubCategory}>
                          Add
                        </Button>
                      </div>
                    ) : (
                      <Button type="text" size="small" onClick={() => setAddingSubCat(true)} icon={<MaterialIcon name="add" style={{ fontSize: 14 }} />}>
                        Add new sub-category
                      </Button>
                    )}
                  </div>
                </>
              )}
            />
          </Field>
        </div>

        <div style={{ marginBottom: 14 }}>
          <Field
            label="Menu types"
            required
            error={showErr(draft.menuTypes.length === 0) ? 'At least one menu type is required — the item will not appear on any board without one.' : undefined}
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
                      border: '1px solid ' + (showErr(draft.menuTypes.length === 0) ? '#ff4d4f' : on ? '#169bc2' : '#d9d9d9'),
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

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 16px' }}>
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
          <OfferBanner rrp={draft.rrp} offerPrice={draft.offerPrice} offerFrom={draft.offerFrom} offerUntil={draft.offerUntil} recurrence={draft.offerRecurrence} currency={draft.currency || brand?.currency || '$'} />
        </div>
      </SectionCard>

      {/* Status & merchandising */}
      <SectionCard>
        <div className="ph-sect-label" style={{ marginBottom: 12 }}>
          Status &amp; merchandising
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 16px' }}>
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
        {draft.featured && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 16px', marginTop: 14 }}>
            <Field label="Featured from">
              <ClearableDate
                value={draft.featuredFrom}
                onChange={(v) => patch({ featuredFrom: v, featuredUntil: v ? shiftEndOneHour(v) : draft.featuredUntil })}
                showTime
                blankHint={{ blank: 'Featured starts now.', set: 'Set — see date above.' }}
              />
            </Field>
            <Field label="Featured until">
              <ClearableDate
                value={draft.featuredUntil}
                onChange={(v) => patch({ featuredUntil: v })}
                showTime
                blankHint={{ blank: 'Featured runs until turned off.', set: 'Set — see date above.' }}
              />
            </Field>
          </div>
        )}
      </SectionCard>

      {/* Descriptions */}
      <SectionCard>
        <div className="ph-sect-label" style={{ marginBottom: 12 }}>
          Descriptions
        </div>
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 13, color: 'rgba(0,0,0,.65)', marginBottom: 6, display: 'block' }}>Language</label>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            {/* Fixed width sized to the longest language name in the registry
                ("British Sign Language") rather than stretching to fill the
                row — matches the compact width other selects on this page
                (e.g. Sub-category) use, instead of ballooning just because
                it happened to share a flex row with the AI button. */}
            <Select
              value={descLang}
              onChange={setDescLang}
              style={{ width: 230 }}
              options={addedLanguages.map((l) => ({ value: l.code, label: l.name }))}
            />
            <AiButton onClick={openAddLanguage} disabled={availableToAddLanguages.length === 0}>
              Add New Language
            </AiButton>
          </div>
          <p style={{ fontSize: 12, color: 'rgba(0,0,0,.45)', marginTop: 5 }}>
            Display name and the descriptions below are all shown for whichever language is selected here.
          </p>
        </div>
        <div style={{ marginBottom: 14 }}>
          <Field label="Display name" hint="Short board-safe name for menu boards.">
            <Input value={currentDisplayName} onChange={(e) => patchDisplayName(e.target.value)} placeholder="Short form" style={{ maxWidth: 420 }} />
          </Field>
        </div>
        <Field
          label="Short description"
          hint={`${shortLen}/90`}
        >
          <Input maxLength={90} value={currentShortDescription} onChange={(e) => patchShortDescription(e.target.value)} />
        </Field>
        <div style={{ marginTop: 14 }}>
          <Field label="Long description">
            <TextArea rows={4} value={currentLongDescription} onChange={(e) => patchLongDescription(e.target.value)} />
          </Field>
        </div>

        <Modal
          title="Add New Language"
          open={addLangOpen}
          onCancel={() => setAddLangOpen(false)}
          destroyOnClose
          footer={[
            <Button key="cancel" onClick={() => setAddLangOpen(false)}>Cancel</Button>,
            <AiButton key="translate" loading={translating} disabled={!pickedLang || !hasTranslationProvider} onClick={confirmAddLanguage}>
              Translate &amp; Add
            </AiButton>,
          ]}
        >
          <p style={{ fontSize: 13, color: 'rgba(0,0,0,.65)', marginBottom: 12 }}>
            Pick a language and the configured Translation provider will translate this product's
            Display name, Short and Long description into it.
          </p>
          {!hasTranslationProvider && (
            <p style={{ fontSize: 12, color: '#a8071a', background: '#fff2f0', border: '1px solid #ffccc7', borderRadius: 6, padding: '8px 10px', marginBottom: 12 }}>
              No Translation provider configured — add one in Settings &rarr; AI Integrations before translating.
            </p>
          )}
          <Select
            style={{ width: '100%' }}
            placeholder="Select a language"
            value={pickedLang}
            onChange={setPickedLang}
            options={availableToAddLanguages.map((l) => ({ value: l.code, label: l.name }))}
          />
        </Modal>

      </SectionCard>

      {/* Ingredients */}
      <SectionCard>
        <div className="ph-sect-label" style={{ marginBottom: 12 }}>
          Ingredients
        </div>
        <Field
          label="Ingredients"
          hint="Pick from ingredients already used on other products, or type a new one and press Enter to add it. Shows as an Ingredients column (with a filter) in HQ Admin and Retail Admin once any product has at least one — hidden otherwise."
        >
          <Select
            mode="tags"
            style={{ width: '100%' }}
            value={draft.ingredients}
            onChange={(ingredients) => patch({ ingredients })}
            placeholder="Select or type an ingredient"
            options={getKnownIngredients().map((i) => ({ value: i, label: i }))}
            optionFilterProp="label"
          />
        </Field>
      </SectionCard>

      {/* Additional Attributes */}
      <SectionCard>
        <div className="ph-sect-label" style={{ marginBottom: 12 }}>
          Additional Attributes
        </div>
        <AdditionalAttributes rows={draft.attributes} onChange={(attributes) => patch({ attributes })} />
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
