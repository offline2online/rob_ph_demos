import { useState } from 'react';
import { Select, AutoComplete, Button, Tag, App } from 'antd';
import { getKnownStoreCodes } from '../data/registries.js';

// Brief §4.4.2 / requirements.md F3: mirrors the brand modal's Store
// Distribution block (menu-board-demo/hq-admin.html bStoreMode /
// bKnownStoreSelect / bManualStore / bStoreChipsWrap), modernised into one
// combobox. A product may only narrow the brand's reach, never widen it.
export default function StorePicker({ mode, stores, onChange }) {
  const { message } = App.useApp();
  const [input, setInput] = useState('');
  const known = getKnownStoreCodes();

  const addCode = (raw) => {
    const code = (raw || '').trim().toUpperCase();
    if (!code) return;
    if (stores.includes(code)) { setInput(''); return; }
    onChange({ mode, stores: [...stores, code] });
    message.success(known.includes(code) ? `${code} added` : `${code} added — new store code`);
    setInput('');
  };

  const removeCode = (code) => onChange({ mode, stores: stores.filter((s) => s !== code) });
  const addAllKnown = () => onChange({ mode, stores: [...new Set([...stores, ...known])] });
  const clearAll = () => onChange({ mode, stores: [] });

  return (
    <div>
      <label style={{ display: 'block', fontSize: 13, color: 'rgba(0,0,0,.65)', marginBottom: 6 }}>
        Which stores stock this product?
      </label>
      <Select
        value={mode}
        style={{ width: '100%', maxWidth: 420 }}
        onChange={(v) => onChange({ mode: v, stores })}
        options={[
          { value: 'all', label: 'All stores — wherever the brand is stocked' },
          { value: 'specific', label: 'Specific stores — only selected locations' },
        ]}
      />
      <p style={{ fontSize: 12, color: 'rgba(0,0,0,.45)', marginTop: 5 }}>
        {mode === 'all'
          ? "Follows the brand's own store distribution."
          : "Narrows the brand's distribution — this item only reaches the store codes listed below."}
      </p>

      {mode === 'specific' && (
        <div style={{ border: '1px solid #f0f0f0', borderRadius: 6, background: '#fafafa', padding: '14px 16px', marginTop: 10 }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <AutoComplete
              value={input}
              onChange={setInput}
              onSelect={(v) => addCode(v)}
              options={known.filter((c) => !stores.includes(c)).map((c) => ({ value: c }))}
              style={{ flex: 1, maxWidth: 260 }}
              placeholder="Type or pick a store code…"
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); addCode(input); }
              }}
            />
            <Button onClick={() => addCode(input)}>+ Add</Button>
            <Button onClick={addAllKnown}>Add all known</Button>
            <Button onClick={clearAll}>Clear all</Button>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', minHeight: 26 }}>
            {stores.length === 0 && (
              <span style={{ fontSize: 12, color: 'rgba(0,0,0,.45)' }}>
                No stores selected — this item will not appear anywhere. Add at least one store code above.
              </span>
            )}
            {stores.map((code) => (
              <Tag
                key={code}
                closable
                onClose={() => removeCode(code)}
                style={{ fontFamily: 'ui-monospace,Menlo,Consolas,monospace', background: '#f9f0ff', borderColor: '#d3adf7', color: '#531dab', fontWeight: 600 }}
              >
                {code}
              </Tag>
            ))}
          </div>
          <p style={{ fontSize: 12, color: 'rgba(0,0,0,.45)', marginTop: 8 }}>{stores.length} store{stores.length === 1 ? '' : 's'} selected.</p>
        </div>
      )}
    </div>
  );
}
