import { Select, Button, Typography } from 'antd';
import MaterialIcon from './MaterialIcon.jsx';
import { genId } from '../data/productStore.js';

const { Text } = Typography;

// Same AND/OR rule-builder mechanism as Campaign Targeting (ph-designer
// skill, components.md §16) — a bordered card is one AND group, rows
// inside it are OR'd together, "Add New AND Condition" starts a new
// sibling group. Scoped to Store / Location Data only: an offer targets
// stores, not visitors, queues, or webcams, so only the fields relevant
// to "which stores does this apply to" are offered here, not the full
// five-category list a campaign gets.
export const STORE_FIELDS = [
  { value: 'storeCode', label: 'Store Code(s)' },
  { value: 'fixedSegment', label: 'Fixed Store Segments' },
  { value: 'variableSegment', label: 'Variable Store Segments' },
  { value: 'storeState', label: 'Store State' },
];

export const OPERATORS = [
  { value: 'includes', label: 'includes selected' },
  { value: 'matches', label: 'matches exactly' },
  { value: 'excludesOr', label: 'excludes selected [OR]' },
  { value: 'excludesAnd', label: 'excludes selected [AND]' },
];

// Plain-English rendering of a targeting tree, for the hover tooltip on
// the Scheduled Offers table's Targeted pill (ph-designer skill
// components.md §16 vocabulary) — each AND-group's conditions joined
// with "or", groups themselves joined with "and", matching the same
// AND-of-ORs structure the builder above authors.
export function describeTargeting(groups) {
  if (!groups || !groups.length) return 'Applies at every store.';
  return groups
    .map((g) =>
      (g.conditions || [])
        .map((c) => {
          const fieldLabel = STORE_FIELDS.find((f) => f.value === c.field)?.label || c.field;
          const opLabel = OPERATORS.find((o) => o.value === c.operator)?.label || c.operator;
          const vals = (c.values || []).join(', ') || '—';
          return `${fieldLabel} ${opLabel} ${vals}`;
        })
        .join(' OR ')
    )
    .join(' AND ');
}

function blankCondition() {
  return { id: genId('cond'), field: 'storeCode', operator: 'includes', values: [] };
}

export default function OfferTargetingBuilder({ groups, onChange }) {
  const addGroup = () => onChange([...groups, { id: genId('grp'), conditions: [blankCondition()] }]);

  const removeGroup = (gid) => onChange(groups.filter((g) => g.id !== gid));

  const addCondition = (gid) =>
    onChange(groups.map((g) => (g.id === gid ? { ...g, conditions: [...g.conditions, blankCondition()] } : g)));

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

  if (groups.length === 0) {
    return (
      <div>
        <Text type="secondary" style={{ fontSize: 12 }}>
          No store targeting — this offer applies at every store.
        </Text>
        <div style={{ marginTop: 8 }}>
          <Button
            size="small"
            icon={<MaterialIcon name="add" style={{ fontSize: 14 }} />}
            onClick={addGroup}
            style={{ borderColor: '#169bc2', color: '#169bc2' }}
          >
            Add New &quot;AND&quot; Condition
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      {groups.map((g) => (
        <div key={g.id} style={{ border: '1px solid #f0f0f0', borderRadius: 8, padding: 12, marginBottom: 10 }}>
          {g.conditions.map((c, i) => (
            <div
              key={c.id}
              style={{
                display: 'flex',
                gap: 8,
                alignItems: 'center',
                marginBottom: i < g.conditions.length - 1 ? 8 : 0,
                flexWrap: 'wrap',
              }}
            >
              <Select
                size="small"
                style={{ width: 170 }}
                value={c.field}
                options={STORE_FIELDS}
                onChange={(v) => updateCondition(g.id, c.id, { field: v })}
              />
              <Select
                size="small"
                style={{ width: 190 }}
                value={c.operator}
                options={OPERATORS}
                onChange={(v) => updateCondition(g.id, c.id, { operator: v })}
              />
              <Select
                size="small"
                mode="tags"
                style={{ flex: 1, minWidth: 160 }}
                value={c.values}
                placeholder="Press Enter to add multiple values"
                onChange={(v) => updateCondition(g.id, c.id, { values: v })}
              />
              <Button
                type="text"
                size="small"
                icon={<MaterialIcon name="delete" style={{ fontSize: 14 }} />}
                onClick={() => removeCondition(g.id, c.id)}
              />
            </div>
          ))}
          <div style={{ height: 1, background: '#f0f0f0', margin: '10px 0' }} />
          <Button
            size="small"
            icon={<MaterialIcon name="add" style={{ fontSize: 14 }} />}
            onClick={() => addCondition(g.id)}
            style={{ borderColor: '#169bc2', color: '#169bc2' }}
          >
            Add new &quot;OR&quot; Condition
          </Button>
          <Button type="text" size="small" danger onClick={() => removeGroup(g.id)} style={{ marginLeft: 8 }}>
            Remove group
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
