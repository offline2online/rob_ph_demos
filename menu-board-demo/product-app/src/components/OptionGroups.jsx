import { Input, Switch, Button, Segmented, InputNumber } from 'antd';
import MaterialIcon from './MaterialIcon.jsx';

// Brief §4.7: replaces the Customisation Options / Available Colours
// accordions. Group: name, selection type, required, min/max. Option:
// label, price delta, default, availability, optional linked SKU. Setting a
// default in a single-select group clears the previous default.
export default function OptionGroups({ groups, onChange }) {
  const setGroups = (next) => onChange(next);

  const addGroup = () =>
    setGroups([...groups, { name: 'New group', type: 'single', required: false, min: 0, max: 1, opts: [] }]);
  const removeGroup = (gi) => setGroups(groups.filter((_, i) => i !== gi));
  const patchGroup = (gi, patch) => setGroups(groups.map((g, i) => (i === gi ? { ...g, ...patch } : g)));
  const addOpt = (gi) =>
    setGroups(
      groups.map((g, i) => (i === gi ? { ...g, opts: [...g.opts, { label: '', delta: '0.00', def: false, avail: true, sku: '' }] } : g))
    );
  const removeOpt = (gi, oi) =>
    setGroups(groups.map((g, i) => (i === gi ? { ...g, opts: g.opts.filter((_, j) => j !== oi) } : g)));
  const updateOpt = (gi, oi, patch) =>
    setGroups(
      groups.map((g, i) => {
        if (i !== gi) return g;
        let opts = g.opts.map((o, j) => (j === oi ? { ...o, ...patch } : o));
        // single-select: setting a default clears siblings
        if (patch.def === true && g.type === 'single') {
          opts = opts.map((o, j) => (j === oi ? o : { ...o, def: false }));
        }
        return { ...g, opts };
      })
    );

  return (
    <div>
      {groups.map((g, gi) => (
        <div key={gi} style={{ border: '1px solid #f0f0f0', borderRadius: 6, marginBottom: 12, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: '#fafafa', borderBottom: '1px solid #f0f0f0', flexWrap: 'wrap' }}>
            <Input value={g.name} onChange={(e) => patchGroup(gi, { name: e.target.value })} variant="borderless" style={{ fontWeight: 600, fontSize: 14, maxWidth: 200 }} />
            <Segmented
              size="small"
              value={g.type}
              onChange={(v) => patchGroup(gi, { type: v })}
              options={[{ label: 'Single select', value: 'single' }, { label: 'Multi select', value: 'multi' }]}
            />
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'rgba(0,0,0,.65)' }}>
              <Switch size="small" checked={!!g.required} onChange={(v) => patchGroup(gi, { required: v })} /> Required
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'rgba(0,0,0,.65)' }}>
              Min <InputNumber size="small" min={0} value={g.min} onChange={(v) => patchGroup(gi, { min: v })} style={{ width: 56 }} />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'rgba(0,0,0,.65)' }}>
              Max <InputNumber size="small" min={0} value={g.max} onChange={(v) => patchGroup(gi, { max: v })} style={{ width: 56 }} />
            </label>
            <div style={{ flex: 1 }} />
            <Button type="text" size="small" danger onClick={() => removeGroup(gi)} icon={<MaterialIcon name="delete" style={{ fontSize: 15 }} />} />
          </div>
          <div style={{ padding: '6px 12px 12px' }}>
            {g.opts.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 90px 78px 84px 1fr 28px', gap: 8, fontSize: 11, color: 'rgba(0,0,0,.45)', textTransform: 'uppercase', letterSpacing: '.04em', paddingBottom: 4, borderBottom: '1px solid #f0f0f0' }}>
                <span>Label</span><span>Price change</span><span>Default</span><span>Available</span><span>Linked SKU</span><span />
              </div>
            )}
            {g.opts.map((o, oi) => (
              <div key={oi} style={{ display: 'grid', gridTemplateColumns: '1.6fr 90px 78px 84px 1fr 28px', gap: 8, alignItems: 'center', padding: '7px 0', borderBottom: '1px solid #f0f0f0' }}>
                <Input size="small" value={o.label} onChange={(e) => updateOpt(gi, oi, { label: e.target.value })} placeholder="Option label" />
                <Input size="small" value={o.delta} onChange={(e) => updateOpt(gi, oi, { delta: e.target.value })} prefix="+$" />
                <Switch size="small" checked={!!o.def} onChange={(v) => updateOpt(gi, oi, { def: v })} />
                <Switch size="small" checked={o.avail !== false} onChange={(v) => updateOpt(gi, oi, { avail: v })} />
                <Input size="small" value={o.sku} onChange={(e) => updateOpt(gi, oi, { sku: e.target.value })} placeholder="Optional" style={{ fontFamily: 'ui-monospace,Menlo,Consolas,monospace' }} />
                <Button type="text" size="small" onClick={() => removeOpt(gi, oi)} icon={<MaterialIcon name="close" style={{ fontSize: 14 }} />} />
              </div>
            ))}
            <button
              type="button"
              onClick={() => addOpt(gi)}
              style={{ border: '1px dashed #d9d9d9', background: 'none', color: 'rgba(0,0,0,.65)', cursor: 'pointer', fontSize: 13, borderRadius: 6, padding: '7px 12px', width: '100%', marginTop: 10 }}
            >
              + Add option
            </button>
          </div>
        </div>
      ))}
      <Button onClick={addGroup} icon={<MaterialIcon name="add" style={{ fontSize: 16 }} />}>
        Add option group
      </Button>
    </div>
  );
}
