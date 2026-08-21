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
    type: 'image',
    src,
  }));
}

export function migrateItem(raw, brandCurrency) {
  if (raw.status) {
    // Already migrated — but toItemDoc() always flattens images back to
    // plain src strings on save (for the grid/menu-board.html, which read
    // images[0] as a URL directly), so a second edit must still re-inflate
    // them into the rich per-image shape this UI works with. mapImages()
    // is idempotent — a no-op if images are already rich objects.
    return { ...raw, images: mapImages(raw) };
  }

  return {
    ...raw,
    displayName: raw.displayName || '',
    status: raw.active === false ? 'Inactive' : 'Active',
    featured: raw.featured || false,
    featurePriority: raw.featurePriority || '',
    subCategory: raw.subCategory || '',
    availability: raw.availability || 'Available',
    availFrom: raw.availFrom || '',
    availTo: raw.availTo || '',
    storeMode: raw.storeMode || 'all',
    stores: raw.stores || [],
    lowStockThreshold: raw.lowStockThreshold != null ? raw.lowStockThreshold : '',
    currency: raw.currency || brandCurrency || '$',
    taxClass: raw.taxClass || '',
    currencyLocked: raw.currencyLocked !== false,
    rrp: raw.price != null ? String(raw.price) : '',
    offerPrice: raw.offerPrice != null ? String(raw.offerPrice) : '',
    offerFrom: raw.offerFrom || '',
    offerUntil: raw.offerUntil || '',
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
    // The grid thumbnail and every menu board just read images[0] as "the"
    // photo — none of them know about isDefault, which only exists on the
    // rich per-image objects this app works with. So the default image has
    // to be moved to position 0 here, on the way back to the flat URL array
    // everything else reads, or marking an image "default" would have no
    // visible effect anywhere outside this tab.
    images: (() => {
      const imgs = product.images || [];
      const defaultIdx = imgs.findIndex((img) => img && typeof img === 'object' && img.isDefault);
      const ordered = defaultIdx > 0
        ? [imgs[defaultIdx], ...imgs.filter((_, i) => i !== defaultIdx)]
        : imgs;
      return ordered.map((img) => (typeof img === 'string' ? img : img.src)).filter(Boolean);
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
