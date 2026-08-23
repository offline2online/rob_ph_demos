import { InputNumber } from 'antd';
import StorePicker from '../../components/StorePicker.jsx';
import { getBrandById } from '../../data/registries.js';

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

export default function StockTab({ draft, patch }) {
  const brand = getBrandById(draft.brand);

  return (
    <div>
      {/* Store availability */}
      <SectionCard>
        <div className="ph-sect-label" style={{ marginBottom: 12 }}>
          Store availability
        </div>
        <StorePicker mode={draft.storeMode} stores={draft.stores} onChange={({ mode, stores }) => patch({ storeMode: mode, stores })} />
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
    </div>
  );
}
