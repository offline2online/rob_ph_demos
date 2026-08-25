// Maps the real menu-board-demo/hq-admin.html item schema (GS1-aligned,
// see saveItem() around line 3405) to the extended Product page shape, and
// back again on save. Purely additive/derived — never drops a field the
// rest of the app (grid, menu-board.html, location-api.html) still reads.

function mapAttrGroups(raw) {
  if (raw.attrGroups) return raw.attrGroups;
  const groups = [];
  const rawIng = raw['gs1:recipeIngredient'] || [];
  const ingredientNames = rawIng.length
    ? rawIng.map((r) => (typeof r === 'string' ? r : r.productName || r.name || '')).filter(Boolean)
    : (raw.ingredients || []);
  if (ingredientNames.length) {
    groups.push({ name: 'Ingredients', rows: [{ label: 'Ingredients', value: ingredientNames.join(', '), unit: '', show: false }] });
  }
  const nutrition = [
    { key: 'calories', label: 'Calories', unit: 'kcal' },
    { key: 'fat', label: 'Fat', unit: 'g' },
    { key: 'carbs', label: 'Carbs', unit: 'g' },
    { key: 'protein', label: 'Protein', unit: 'g' },
  ].filter((f) => raw[f.key] != null);
  if (nutrition.length) {
    groups.push({
      name: 'Nutrition',
      rows: nutrition.map((f) => ({ label: f.label, value: String(raw[f.key]), unit: f.unit, show: false })),
    });
  }
  return groups;
}

function mapOptionGroups(raw) {
  if (raw.optionGroups) return raw.optionGroups;
  const opts = raw['gs1:customizationOptions'] || [];
  if (!opts.length) return [];
  const byType = { ADD: [], SUBTRACT: [] };
  opts.forEach((o) => {
    const t = o['gs1:modificationType'] === 'SUBTRACT' ? 'SUBTRACT' : 'ADD';
    byType[t].push(o);
  });
  const groups = [];
  if (byType.ADD.length) {
    groups.push({
      name: 'Add extras', type: 'multi', required: false, min: 0, max: byType.ADD.length,
      opts: byType.ADD.map((o) => ({ label: o.name || '', delta: (parseFloat(o['gs1:priceAdjustment']) || 0).toFixed(2), def: false, avail: true, sku: '' })),
    });
  }
  if (byType.SUBTRACT.length) {
    groups.push({
      name: 'Remove', type: 'multi', required: false, min: 0, max: byType.SUBTRACT.length,
      opts: byType.SUBTRACT.map((o) => ({ label: o.name || '', delta: (parseFloat(o['gs1:priceAdjustment']) || 0).toFixed(2), def: false, avail: true, sku: '' })),
    });
  }
  return groups;
}

function mapImages(raw) {
  // imagesRich is the source of truth once it exists — metadata only (no
  // src; see toItemDoc()'s comment for why `images` itself has to stay a
  // flat array of plain URL strings — the grid thumbnail, menu-board.html
  // and location-api.html all read images[0] as a URL, not an object).
  // Without a separate field to round-trip through, every save silently
  // reset every image's variant name, tags, rights and A/B-testing flag
  // back to fresh defaults on next load — the flat array carries none of
  // that, so there was nowhere for it to survive a save at all. Paired
  // back up positionally with `images` (same order, src stripped out to
  // avoid storing every photo's base64 data twice and blowing Firestore's
  // 1MB document limit).
  if (raw.imagesRich && raw.imagesRich.length && raw.images && raw.imagesRich.length === raw.images.length) {
    return raw.imagesRich.map((meta, i) => ({ ...meta, src: raw.images[i] }));
  }
  if (raw.images && raw.images.length && typeof raw.images[0] === 'object') return raw.images;
  return (raw.images || []).map((src, i) => ({
    id: `img-${raw.id}-${i}`,
    variant: String.fromCharCode(65 + i),
    name: '',
    tags: [],
    isDefault: i === 0,
    availableForTesting: false,
    bgRemoved: false,
    enhanced: false,
    rightsOn: false,
    rights: {},
    targeting: [],
    type: 'image',
    src,
  }));
}

// Same default productStore.js's blankProduct() uses — a product saved
// before badge templates existed just gets this, which resolves (via
// registries.js's getBadgeTemplateById) to the same hardcoded look
// menu-board.html rendered every note with previously.
const DEFAULT_MENU_BOARD_NOTE_TEMPLATE_ID = 'default';

// A product saved before multi-offer support has only the flat
// offerPrice/offerFrom/offerUntil/offerDescription fields — wrap that as a
// single-entry offers[] so it shows up as "Offer 1" instead of vanishing
// the first time this product is opened on the Pricing tab.
function legacyOffer(raw) {
  if (raw.offerPrice == null || raw.offerPrice === '') return [];
  return [{
    id: 'offer-legacy-' + raw.id,
    enabled: true,
    description: raw.offerDescription || '',
    offerPrice: String(raw.offerPrice),
    offerFrom: raw.offerFrom || '',
    offerUntil: raw.offerUntil || '',
    showOnMenuBoard: raw.showOnMenuBoard || '',
    targeting: [],
  }];
}

export function migrateItem(raw, brandCurrency) {
  if (raw.status) {
    // Already migrated — but toItemDoc() always flattens images back to
    // plain src strings on save (for the grid/menu-board.html, which read
    // images[0] as a URL directly), so a second edit must still re-inflate
    // them into the rich per-image shape this UI works with. mapImages()
    // is idempotent — a no-op if images are already rich objects.
    return {
      ...raw,
      images: mapImages(raw),
      offers: raw.offers || legacyOffer(raw),
      // Falls back to whatever showOnMenuBoard already held — before the
      // per-offer note existed, that flat field WAS the user's real
      // fallback text, so a product migrating through this for the first
      // time must carry it forward rather than silently losing it. Checked
      // against `undefined`, not falsiness — a product that's already been
      // through this migration once and genuinely has no fallback note (a
      // real '') must stay that way, not keep re-absorbing whatever
      // showOnMenuBoard currently holds (which may be an offer's own note,
      // overriding it) on every subsequent load.
      menuBoardNote: raw.menuBoardNote !== undefined ? raw.menuBoardNote : (raw.showOnMenuBoard || ''),
      menuBoardNoteTemplateId: raw.menuBoardNoteTemplateId || DEFAULT_MENU_BOARD_NOTE_TEMPLATE_ID,
    };
  }

  return {
    ...raw,
    displayName: raw.displayName || '',
    status: raw.active === false ? 'Inactive' : 'Active',
    featured: raw.featured || false,
    featurePriority: raw.featurePriority || '',
    featuredFrom: raw.featuredFrom || '',
    featuredUntil: raw.featuredUntil || '',
    subCategory: raw.subCategory || '',
    storeMode: raw.storeMode || 'all',
    stores: raw.stores || [],
    distributionMode: raw.distributionMode || 'all',
    distributionTargeting: raw.distributionTargeting || [],
    lowStockThreshold: raw.lowStockThreshold != null ? raw.lowStockThreshold : '',
    currency: raw.currency || brandCurrency || '$',
    taxClass: raw.taxClass || '',
    currencyLocked: raw.currencyLocked !== false,
    rrp: raw.price != null ? String(raw.price) : '',
    offerPrice: raw.offerPrice != null ? String(raw.offerPrice) : '',
    offerFrom: raw.offerFrom || '',
    offerUntil: raw.offerUntil || '',
    offerDescription: raw.offerDescription || '',
    offers: raw.offers || legacyOffer(raw),
    menuBoardNote: raw.menuBoardNote !== undefined ? raw.menuBoardNote : (raw.showOnMenuBoard || ''),
    menuBoardNoteTemplateId: raw.menuBoardNoteTemplateId || DEFAULT_MENU_BOARD_NOTE_TEMPLATE_ID,
    showOnMenuBoard: raw.showOnMenuBoard || '',
    menuTypes: raw.menuTypes || [],
    attrGroups: mapAttrGroups(raw),
    optionGroups: mapOptionGroups(raw),
    images: mapImages(raw),
    priceLog: raw.priceLog || [],
  };
}

// Derives the legacy GS1-aligned fields the rest of the app (grid,
// menu-board.html, location-api.html) still reads directly, from the new
// structured attrGroups/optionGroups — so nothing downstream regresses.
export function toItemDoc(product) {
  const ingredientsRow = (product.attrGroups || []).find((g) => g.name === 'Ingredients');
  const ingredientNames = ingredientsRow
    ? ingredientsRow.rows.flatMap((r) => (r.value || '').split(',').map((s) => s.trim()).filter(Boolean))
    : [];
  const nutritionRow = (product.attrGroups || []).find((g) => g.name === 'Nutrition');
  const nutritionVal = (label) => {
    const row = nutritionRow?.rows.find((r) => r.label === label);
    return row && row.value !== '' ? parseFloat(row.value) : null;
  };

  const addExtras = (product.optionGroups || []).find((g) => g.name === 'Add extras');
  const removeGroup = (product.optionGroups || []).find((g) => g.name === 'Remove');
  const gs1CustOpts = [
    ...(addExtras?.opts || []).map((o) => ({ '@type': 'PropertyValue', name: o.label, value: 'Added', 'gs1:modificationType': 'ADD', 'gs1:priceAdjustment': (o.delta >= 0 ? '+' : '') + o.delta })),
    ...(removeGroup?.opts || []).map((o) => ({ '@type': 'PropertyValue', name: o.label, value: 'Removed', 'gs1:modificationType': 'SUBTRACT', 'gs1:priceAdjustment': (o.delta >= 0 ? '-' : '') + Math.abs(o.delta) })),
  ];

  const price = parseFloat(product.rrp);
  const offerPrice = parseFloat(product.offerPrice);

  return {
    ...product,
    '@context': 'https://gs1.org/voc/',
    '@type': 'Product',
    productName: product.name,
    description: product.shortDescription,
    price: isNaN(price) ? 0 : price,
    offerPrice: isNaN(offerPrice) ? null : offerPrice,
    active: product.status === 'Active',
    // The grid thumbnail, retail-admin's stock grid and every menu board
    // panel other than the Feature Hero Spotlight's own primary panel just
    // read images[0] as "the" photo and render it as an <img> — none of
    // them know about isDefault, or should ever end up trying to paint a
    // video into a plain <img> tag. So it's specifically the default
    // *image* (never a default video) that gets moved to position 0 here,
    // on the way back to the flat URL array everything else reads — a
    // product can have a default image AND a separate default video at
    // the same time (ProductAssetsTab.jsx's setDefault() now scopes
    // "only one default" to each type independently), and only the
    // primary hero panel is allowed to go looking for the video one.
    images: (() => {
      const imgs = product.images || [];
      const defaultIdx = imgs.findIndex((img) => img && typeof img === 'object' && img.isDefault && img.type !== 'video');
      const ordered = defaultIdx > 0
        ? [imgs[defaultIdx], ...imgs.filter((_, i) => i !== defaultIdx)]
        : imgs;
      return ordered.map((img) => (typeof img === 'string' ? img : img.src)).filter(Boolean);
    })(),
    // Per-image metadata (variant, tags, rights, isDefault,
    // availableForTesting, bgRemoved, enhanced) that `images` above can't
    // carry — this app's own source of truth for the Assets tab. Deliberately
    // excludes `src`: it's index-aligned with `images` (same reordering, same
    // filter) and reconstructed from it on read, so a product's photos never
    // get stored twice in the same document.
    imagesRich: (() => {
      const imgs = product.images || [];
      const defaultIdx = imgs.findIndex((img) => img && typeof img === 'object' && img.isDefault && img.type !== 'video');
      const ordered = defaultIdx > 0
        ? [imgs[defaultIdx], ...imgs.filter((_, i) => i !== defaultIdx)]
        : imgs;
      return ordered
        .filter((img) => img && typeof img === 'object' && img.src)
        .map(({ src, ...meta }) => meta);
    })(),
    calories: nutritionVal('Calories'),
    fat: nutritionVal('Fat'),
    carbs: nutritionVal('Carbs'),
    protein: nutritionVal('Protein'),
    ingredients: ingredientNames,
    'gs1:recipeIngredient': ingredientNames.map((n) => ({ '@type': 'Product', productName: n })),
    'gs1:customizationOptions': gs1CustOpts,
    'gs1:netPrice': { '@type': 'gs1:PriceSpecification', 'gs1:price': (isNaN(price) ? 0 : price).toFixed(2), 'gs1:priceCurrency': product.currency || '$' },
    updatedAt: new Date().toISOString(),
  };
}
