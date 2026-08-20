import { Input, Switch, Button } from 'antd';
import MaterialIcon from './MaterialIcon.jsx';

// Brief §4.6: replaces the Ingredients/Nutrition/Sizing accordions. Any
// number of named, inline-renamed groups; rows of Label · Value · Unit ·
// On display. No group is mandatory, none is hard-coded.
export default function AttributeGroups({ groups, onChange }) {
  const setGroups = (next) => onChange(next);

  const addGroup = () => setGroups([...groups, { name: 'New group', rows: [] }]);
  const removeGroup = (gi) => setGroups(groups.filter((_, i) => i !== gi));
  const renameGroup = (gi, name) => setGroups(groups.map((g, i) => (i === gi ? { ...g, name } : g)));
  const addRow = (gi) =>
    setGroups(groups.map((g, i) => (i === gi ? { ...g, rows: [...g.rows, { label: '', value: '', unit: '', show: false }] } : g)));
  const removeRow = (gi, ri) =>
    setGroups(groups.map((g, i) => (i === gi ? { ...g, rows: g.rows.filter((_, j) => j !== ri) } : g)));
  const updateRow = (gi, ri, patch) =>
    setGroups(
      groups.map((g, i) =>
        i === gi ? { ...g, rows: g.rows.map((r, j) => (j === ri ? { ...r, ...patch } : r)) } : g
      )
    );

  return (
    <div>
      <p style={{ fontSize: 12, color: 'rgba(0,0,0,.45)', marginBottom: 12 }}>
        A QSR item builds Ingredients / Allergens / Nutrition. Fashion builds Fabric / Care / Fit. Pharmacy builds
        Dosage / Warnings. Create whatever groups this product needs.
      </p>
      {groups.map((g, gi) => (
        <div key={gi} style={{ border: '1px solid #f0f0f0', borderRadius: 6, marginBottom: 12, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: '#fafafa', borderBottom: '1px solid #f0f0f0' }}>
            <Input
              value={g.name}
              onChange={(e) => renameGroup(gi, e.target.value)}
              variant="borderless"
              style={{ fontWeight: 600, fontSize: 14, maxWidth: 220 }}
            />
            <div style={{ flex: 1 }} />
            <Button type="text" size="small" danger onClick={() => removeGroup(gi)} icon={<MaterialIcon name="delete" style={{ fontSize: 15 }} />} />
          </div>
          <div style={{ padding: '6px 12px 12px' }}>
            {g.rows.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 2fr 62px 74px 28px', gap: 8, fontSize: 11, color: 'rgba(0,0,0,.45)', textTransform: 'uppercase', letterSpacing: '.04em', paddingBottom: 4, borderBottom: '1px solid #f0f0f0' }}>
                <span>Label</span><span>Value</span><span>Unit</span><span>On display</span><span />
              </div>
            )}
            {g.rows.map((r, ri) => (
              <div key={ri} style={{ display: 'grid', gridTemplateColumns: '1.1fr 2fr 62px 74px 28px', gap: 8, alignItems: 'center', padding: '7px 0', borderBottom: '1px solid #f0f0f0' }}>
                <Input size="small" value={r.label} onChange={(e) => updateRow(gi, ri, { label: e.target.value })} placeholder="Label" />
                <Input size="small" value={r.value} onChange={(e) => updateRow(gi, ri, { value: e.target.value })} placeholder="Value" />
                <Input size="small" value={r.unit} onChange={(e) => updateRow(gi, ri, { unit: e.target.value })} placeholder="unit" />
                <Switch size="small" checked={!!r.show} onChange={(v) => updateRow(gi, ri, { show: v })} />
                <Button type="text" size="small" onClick={() => removeRow(gi, ri)} icon={<MaterialIcon name="close" style={{ fontSize: 14 }} />} />
              </div>
            ))}
            <button
              type="button"
              onClick={() => addRow(gi)}
              style={{ border: '1px dashed #d9d9d9', background: 'none', color: 'rgba(0,0,0,.65)', cursor: 'pointer', fontSize: 13, borderRadius: 6, padding: '7px 12px', width: '100%', marginTop: 10 }}
            >
              + Add row
            </button>
          </div>
        </div>
      ))}
      <Button onClick={addGroup} icon={<MaterialIcon name="add" style={{ fontSize: 16 }} />}>
        Add attribute group
      </Button>
    </div>
  );
}
