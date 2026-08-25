import { Input, Switch, Button } from 'antd';
import MaterialIcon from './MaterialIcon.jsx';

// A single flat table of Label / Value / Unit / On display rows — for
// whatever a product needs beyond its dedicated fields (Ingredients has
// its own section now, see ProductDetailsTab.jsx). Previously this was a
// multi-group "Ingredients / Nutrition / Allergens / ..." builder
// (AttributeGroups.jsx); simplified to one section since that's all any
// product here has ever actually needed.
export default function AdditionalAttributes({ rows, onChange }) {
  const setRows = (next) => onChange(next);

  const addRow = () => setRows([...(rows || []), { label: '', value: '', unit: '', show: false }]);
  const removeRow = (ri) => setRows((rows || []).filter((_, i) => i !== ri));
  const updateRow = (ri, patch) =>
    setRows((rows || []).map((r, i) => (i === ri ? { ...r, ...patch } : r)));

  return (
    <div>
      {rows && rows.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 2fr 62px 74px 28px', gap: 8, fontSize: 11, color: 'rgba(0,0,0,.45)', textTransform: 'uppercase', letterSpacing: '.04em', paddingBottom: 4, borderBottom: '1px solid #f0f0f0' }}>
          <span>Label</span><span>Value</span><span>Unit</span><span>On display</span><span />
        </div>
      )}
      {(rows || []).map((r, ri) => (
        <div key={ri} style={{ display: 'grid', gridTemplateColumns: '1.1fr 2fr 62px 74px 28px', gap: 8, alignItems: 'center', padding: '7px 0', borderBottom: '1px solid #f0f0f0' }}>
          <Input size="small" value={r.label} onChange={(e) => updateRow(ri, { label: e.target.value })} placeholder="Label" />
          <Input size="small" value={r.value} onChange={(e) => updateRow(ri, { value: e.target.value })} placeholder="Value" />
          <Input size="small" value={r.unit} onChange={(e) => updateRow(ri, { unit: e.target.value })} placeholder="unit" />
          <Switch size="small" checked={!!r.show} onChange={(v) => updateRow(ri, { show: v })} />
          <Button type="text" size="small" onClick={() => removeRow(ri)} icon={<MaterialIcon name="close" style={{ fontSize: 14 }} />} />
        </div>
      ))}
      <button
        type="button"
        onClick={addRow}
        style={{ border: '1px dashed #d9d9d9', background: 'none', color: 'rgba(0,0,0,.65)', cursor: 'pointer', fontSize: 13, borderRadius: 6, padding: '7px 12px', width: '100%', marginTop: 10 }}
      >
        + Add row
      </button>
    </div>
  );
}
