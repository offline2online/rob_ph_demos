import { Select, Button, Empty } from 'antd';
import MaterialIcon from './MaterialIcon.jsx';
import { genId } from '../data/productStore.js';
import { getKnownTargetingValues } from '../data/registries.js';

// Same AND/OR rule-builder mechanism and category → field → operator →
// value(s) row shape as Campaign Targeting — verified live against
// demo.personalisationhub.com 24 Aug 2026: a grey-filled group is one AND
// group, rows inside it are OR'd together, "Add New AND Condition" starts
// a new sibling group. This is the general targeting-criteria pattern —
// reused by both the Pricing tab's per-offer targeting and Product
// Assets' per-image/video targeting, not offer-specific despite the
// history of the name. Only Store / Location Data and Visitor / Customer
// Data are offered: Campaign Targeting's other three categories
// (Queueing / Aggregate Visitor Data, Interaction / Campaign Data,
// Computer Vision / Webcam Data) describe playback/creative concepts
// neither an offer's price nor a product asset has any use for.
export const CATEGORIES = [
  { value: 'store', label: 'Store / Location Data' },
  { value: 'visitor', label: 'Visitor / Customer Data' },
];

// Full 13-field list, verified live on Campaign Targeting's own Store /
// Location Data category. Not every field has a live data source flowing
// through this repo's PH API integration yet (see _offerTargetingMatches
// in menu-board.html/retail-admin.html for which ones actually resolve
// today) — they're offered here regardless, same as the live product,
// so a rule can be authored and will simply start matching the moment
// real data for that field arrives.
const STORE_FIELDS = [
  { value: 'storeCode', label: 'Store Code(s)' },
  { value: 'storeName', label: 'Store Name(s)' },
  { value: 'storeSegmentConsolidated', label: 'Store Segment (Consolidated)' },
  { value: 'fixedSegment', label: 'Fixed Store Segments' },
  { value: 'variableSegment', label: 'Variable Store Segments' },
  { value: 'displayTag', label: 'Display Tag(s)' },
  { value: 'languagesSpokenByStaff', label: 'Languages Spoken by Staff' },
  { value: 'displayId', label: 'Display ID' },
  { value: 'displayType', label: 'Display Type(s)' },
  { value: 'displayName', label: 'Display Name(s)' },
  { value: 'storeSuburb', label: 'Store Suburb' },
  { value: 'storeState', label: 'Store State' },
  { value: 'storeCountry', label: 'Store Country' },
];

// Full 16-field list, verified live on Campaign Targeting's own
// Visitor / Customer Data category. Only First Name and SKU(s) have real
// mock PH API data behind them in this repo (mock-ph-api.json) — the rest
// are offered for the same forward-compatible reason as the store fields
// above.
const VISITOR_FIELDS = [
  { value: 'firstName', label: 'First Name' },
  { value: 'companyName', label: 'Company Name' },
  { value: 'purchaseIntent', label: 'Purchase Intent' },
  { value: 'visitorType', label: 'Visitor Type (Individual)' },
  { value: 'reasonForVisit', label: 'Reason for Visit (Individual)' },
  { value: 'deviceType', label: 'Device Type (Individual)' },
  { value: 'age', label: 'Age' },
  { value: 'gender', label: 'Gender' },
  { value: 'audienceSegments', label: 'Audience / Segments' },
  { value: 'productTypes', label: 'Product Type(s)' },
  { value: 'planTypes', label: 'Plan Type(s)' },
  { value: 'planValues', label: 'Plan Value(s)' },
  { value: 'pageViews', label: 'Page Views' },
  { value: 'events', label: 'Events' },
  { value: 'productHoldings', label: 'Product Holdings' },
  { value: 'purchaseHistory', label: 'Purchase History' },
  { value: 'skus', label: 'SKU(s)' },
];

export const FIELDS_BY_CATEGORY = { store: STORE_FIELDS, visitor: VISITOR_FIELDS };

export const OPERATORS = [
  { value: 'includes', label: 'includes selected' },
  { value: 'matches', label: 'matches exactly' },
  { value: 'excludesOr', label: 'excludes selected [OR]' },
  { value: 'excludesAnd', label: 'excludes selected [AND]' },
];

function fieldsFor(category) {
  return FIELDS_BY_CATEGORY[category] || STORE_FIELDS;
}

// Plain-English rendering of a targeting tree, for the hover tooltip on
// the Scheduled Offers table's Targeted pill — each AND-group's
// conditions joined with "or", groups themselves joined with "and".
// Conditions saved before the category dimension existed have no
// `category` field — they were all store-only, so default to 'store'.
export function describeTargeting(groups) {
  if (!groups || !groups.length) return 'Applies at every store.';
  return groups
    .map((g) =>
      (g.conditions || [])
        .map((c) => {
          const category = c.category || 'store';
          const fieldLabel = fieldsFor(category).find((f) => f.value === c.field)?.label || c.field;
          const opLabel = OPERATORS.find((o) => o.value === c.operator)?.label || c.operator;
          const vals = (c.values || []).join(', ') || '—';
          return `${fieldLabel} ${opLabel} ${vals}`;
        })
        .join(' OR ')
    )
    .join(' AND ');
}

function blankCondition(defaultCategory) {
  return { id: genId('cond'), category: defaultCategory, field: '', operator: 'includes', values: [] };
}

// `categories` restricts which Category options a caller offers — default
// is both (Store / Location Data + Visitor / Customer Data, matching
// offer and asset targeting). Brand/product Distribution scopes this to
// Store / Location Data only (`categories={[CATEGORIES[0]]}`), since
// which visitor is standing at a store has no bearing on which stores a
// brand or product is distributed to. When only one category is offered,
// the Category picker itself is hidden — there's nothing to choose — and
// every condition is pinned to it.
export default function TargetingBuilder({
  groups,
  onChange,
  emptyDescription = 'No targeting rules defined. Applies at every store, to every visitor.',
  categories = CATEGORIES,
}) {
  const singleCategory = categories.length === 1 ? categories[0].value : null;
  const makeBlankCondition = () => blankCondition(singleCategory || 'store');

  const addGroup = () => onChange([...groups, { id: genId('grp'), conditions: [makeBlankCondition()] }]);

  const addCondition = (gid) =>
    onChange(groups.map((g) => (g.id === gid ? { ...g, conditions: [...g.conditions, makeBlankCondition()] } : g)));

  // Removing a group's last condition removes the group itself — an AND
  // group with zero OR conditions inside it isn't a rule, it's nothing.
  const removeCondition = (gid, cid) =>
    onChange(
      groups
        .map((g) => (g.id === gid ? { ...g, conditions: g.conditions.filter((c) => c.id !== cid) } : g))
        .filter((g) => g.conditions.length > 0)
    );

  const updateCondition = (gid, cid, fields) =>
    onChange(
      groups.map((g) =>
        g.id === gid ? { ...g, conditions: g.conditions.map((c) => (c.id === cid ? { ...c, ...fields } : c)) } : g
      )
    );

  // Switching category clears field/operator/values — same behaviour as
  // the live product, since a field from the old category rarely means
  // anything under the new one.
  const changeCategory = (gid, cid, category) =>
    updateCondition(gid, cid, { category, field: '', operator: '', values: [] });

  if (groups.length === 0) {
    return (
      <div>
        <div style={{ padding: '28px 0 24px' }}>
          <Empty
            image={<MaterialIcon name="inbox" style={{ fontSize: 40, color: '#d9d9d9' }} />}
            description={emptyDescription}
          />
        </div>
        <Button
          size="small"
          icon={<MaterialIcon name="add" style={{ fontSize: 14 }} />}
          onClick={addGroup}
          style={{ borderColor: '#169bc2', color: '#169bc2' }}
        >
          Add New &quot;AND&quot; Condition
        </Button>
      </div>
    );
  }

  return (
    <div>
      {groups.map((g) => (
        <div key={g.id} style={{ background: 'rgba(0,0,0,0.06)', borderRadius: 4, padding: 12, marginBottom: 10 }}>
          {g.conditions.map((c, i) => (
            <div key={c.id}>
              {i > 0 && (
                <div style={{ textAlign: 'center', fontSize: 12, fontWeight: 600, color: 'rgba(0,0,0,.45)', margin: '8px 0' }}>
                  OR
                </div>
              )}
              <div
                style={{
                  display: 'flex',
                  gap: 8,
                  alignItems: 'center',
                  flexWrap: 'wrap',
                }}
              >
                {!singleCategory && (
                  <Select
                    size="small"
                    style={{ width: 170 }}
                    value={c.category || 'store'}
                    options={categories}
                    onChange={(v) => changeCategory(g.id, c.id, v)}
                  />
                )}
              <Select
                size="small"
                style={{ width: 190 }}
                value={c.field || undefined}
                placeholder="Field"
                showSearch
                filterOption={(input, option) => (option?.label ?? '').toLowerCase().includes(input.toLowerCase())}
                options={fieldsFor(c.category || 'store')}
                onChange={(v) => updateCondition(g.id, c.id, { field: v })}
              />
              <Select
                size="small"
                style={{ width: 190 }}
                value={c.operator || undefined}
                placeholder="Operator"
                options={OPERATORS}
                onChange={(v) => updateCondition(g.id, c.id, { operator: v })}
              />
              <Select
                size="small"
                mode="tags"
                style={{ flex: 1, minWidth: 160 }}
                value={c.values}
                placeholder="Press Enter to add multiple values"
                filterOption={(input, option) => (option?.label ?? '').toLowerCase().includes(input.toLowerCase())}
                options={getKnownTargetingValues(c.category || 'store', c.field).map((v) => ({ value: v, label: v }))}
                onChange={(v) => updateCondition(g.id, c.id, { values: v })}
              />
              <Button
                type="text"
                size="small"
                icon={<MaterialIcon name="delete" style={{ fontSize: 14 }} />}
                onClick={() => removeCondition(g.id, c.id)}
              />
            </div>
            </div>
          ))}
          <div style={{ height: 1, background: '#f0f0f0', margin: '10px 0' }} />
          <Button
            size="small"
            icon={<MaterialIcon name="add" style={{ fontSize: 14 }} />}
            onClick={() => addCondition(g.id)}
            style={{ borderColor: '#169bc2', color: '#169bc2', borderStyle: 'dashed' }}
          >
            Add new &quot;OR&quot; Condition
          </Button>
        </div>
      ))}
      <Button
        size="small"
        icon={<MaterialIcon name="add" style={{ fontSize: 14 }} />}
        onClick={addGroup}
        style={{ borderColor: '#169bc2', color: '#169bc2' }}
      >
        Add New &quot;AND&quot; Condition
      </Button>
    </div>
  );
}
