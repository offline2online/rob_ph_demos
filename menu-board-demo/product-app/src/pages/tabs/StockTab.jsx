import StorePicker from '../../components/StorePicker.jsx';

function SectionCard({ children }) {
  return <div className="ph-sect">{children}</div>;
}

export default function StockTab({ draft, patch }) {
  return (
    <div>
      {/* Store availability */}
      <SectionCard>
        <div className="ph-sect-label" style={{ marginBottom: 12 }}>
          Store availability
        </div>
        <StorePicker mode={draft.storeMode} stores={draft.stores} onChange={({ mode, stores }) => patch({ storeMode: mode, stores })} />
      </SectionCard>
    </div>
  );
}
