import { useEffect, useState } from 'react';
import { Table } from 'antd';
import StorePicker from '../../components/StorePicker.jsx';
import { getLocalOffersForSku } from '../../data/productStore.js';

function SectionCard({ children }) {
  return <div className="ph-sect">{children}</div>;
}

function fmtDateVal(v) {
  if (!v) return '—';
  const d = new Date(v);
  if (isNaN(d.getTime())) return String(v);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) +
    (v.includes('T') ? ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '');
}

// Store name isn't tracked anywhere in this app yet (retail-admin.html's
// own _storeProfile is never actually populated from a real "stores"
// registry either) — the store's own code is the only identifier
// available, so that's what this shows rather than inventing a name.
const localOfferColumns = (currency) => [
  { title: 'Store', dataIndex: 'storeCode', width: 100, render: (v) => <span style={{ fontFamily: 'ui-monospace,Menlo,Consolas,monospace', fontWeight: 600 }}>{v}</span> },
  {
    title: 'Offer price',
    dataIndex: 'offerPrice',
    width: 110,
    render: (v) => (v != null && parseFloat(v) > 0 ? `${currency}${parseFloat(v).toFixed(2)}` : '—'),
  },
  {
    title: 'RRP override',
    dataIndex: 'price',
    width: 110,
    render: (v) => (v != null ? `${currency}${parseFloat(v).toFixed(2)}` : '—'),
  },
  {
    title: 'Schedule',
    render: (_, row) => `${row.offerFrom ? fmtDateVal(row.offerFrom) : 'Now'} → ${row.offerUntil ? fmtDateVal(row.offerUntil) : 'No end date'}`,
  },
  { title: 'Show on Menu Board', dataIndex: 'showOnMenuBoard', render: (v) => v || <span style={{ color: 'rgba(0,0,0,.35)' }}>—</span> },
];

export default function StockTab({ draft, patch }) {
  const [localOffers, setLocalOffers] = useState([]);
  const [loadingLocalOffers, setLoadingLocalOffers] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoadingLocalOffers(true);
    getLocalOffersForSku(draft.sku)
      .then((rows) => { if (!cancelled) setLocalOffers(rows); })
      .finally(() => { if (!cancelled) setLoadingLocalOffers(false); });
    return () => { cancelled = true; };
  }, [draft.sku]);

  return (
    <div>
      {/* Store availability */}
      <SectionCard>
        <div className="ph-sect-label" style={{ marginBottom: 12 }}>
          Store availability
        </div>
        <StorePicker mode={draft.storeMode} stores={draft.stores} onChange={({ mode, stores }) => patch({ storeMode: mode, stores })} />
      </SectionCard>

      {/* Which stores currently have their own price/offer for this item —
          retail-admin.html's storePricing/{store} records, read across
          every store rather than one at a time, so it's obvious at a
          glance where a local promotion is running instead of having to
          check each store individually. */}
      <SectionCard>
        <div className="ph-sect-label" style={{ marginBottom: 12 }}>
          Local Store Pricing
        </div>
        <p style={{ fontSize: 12, color: 'rgba(0,0,0,.45)', margin: '0 0 12px' }}>
          Stores currently running their own price for this item, set from Retail Admin — HQ's own RRP/offer above are unaffected by these.
        </p>
        <Table
          rowKey="storeCode"
          dataSource={localOffers}
          columns={localOfferColumns(draft.currency || '$')}
          size="small"
          bordered={false}
          pagination={false}
          loading={loadingLocalOffers}
          locale={{
            emptyText: (
              <div style={{ padding: '18px 0', color: 'rgba(0,0,0,.45)', fontSize: 13 }}>
                No stores currently have their own price for this item.
              </div>
            ),
          }}
        />
      </SectionCard>
    </div>
  );
}
