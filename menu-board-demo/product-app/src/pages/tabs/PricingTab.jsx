import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Input, InputNumber, Table, Button, App, Tag } from 'antd';
import MaterialIcon from '../../components/MaterialIcon.jsx';
import ClearableDate from '../../components/ClearableDate.jsx';
import OfferBanner from '../../components/OfferBanner.jsx';
import { upsertProduct, appendPriceLogEntries } from '../../data/productStore.js';

function Field({ label, children, hint }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <label style={{ fontSize: 13, color: 'rgba(0,0,0,.65)', marginBottom: 6 }}>{label}</label>
      {children}
      {hint && <p style={{ fontSize: 12, color: 'rgba(0,0,0,.45)', marginTop: 5 }}>{hint}</p>}
    </div>
  );
}

// `when` may be a real ISO timestamp (current writes) or a legacy
// pre-formatted "DD Mon YYYY HH:mm" string (entries written before this
// changed) — both parse fine via `new Date(...)`, so one code path
// renders both a correctly-split date and a time, instead of the old
// naive `split(' ')` which silently dropped the year and the time.
function parseWhen(v) {
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function fmtDateVal(v) {
  if (!v) return '—';
  const d = new Date(v);
  if (isNaN(d.getTime())) return String(v);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) +
    (v.includes('T') ? ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '');
}

export default function PricingTab({ draft, baseline, setDraft, setBaseline }) {
  const { message } = App.useApp();
  const [unlocked, setUnlocked] = useState(false);
  const [reason, setReason] = useState('');
  const [searchParams, setSearchParams] = useSearchParams();
  // Arriving here from the "Local offer" pill on the HQ Admin grid — jump
  // straight to only the store-originated log entries so HQ staff can see
  // which store(s) are running a different price, without wading through
  // every HQ Admin edit too.
  const localOnly = searchParams.get('filter') === 'local';
  const clearLocalFilter = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('filter');
    setSearchParams(next, { replace: true });
  };

  const rrpChanged = String(draft.rrp) !== String(baseline.rrp);
  const offerChanged = String(draft.offerPrice || '') !== String(baseline.offerPrice || '');
  const fromChanged = String(draft.offerFrom || '') !== String(baseline.offerFrom || '');
  const untilChanged = String(draft.offerUntil || '') !== String(baseline.offerUntil || '');
  const menuBoardCopyChanged = String(draft.showOnMenuBoard || '') !== String(baseline.showOnMenuBoard || '');
  const dirty = rrpChanged || offerChanged || fromChanged || untilChanged || menuBoardCopyChanged;
  const canSave = dirty && reason.trim() !== '';

  const changeSummary = [
    rrpChanged ? `RRP $${baseline.rrp || '0.00'} → $${draft.rrp}` : null,
    offerChanged ? `Offer price $${baseline.offerPrice || '0.00'} → $${draft.offerPrice}` : null,
    fromChanged ? `Offer from ${fmtDateVal(baseline.offerFrom)} → ${fmtDateVal(draft.offerFrom)}` : null,
    untilChanged ? `Offer until ${fmtDateVal(baseline.offerUntil)} → ${fmtDateVal(draft.offerUntil)}` : null,
    menuBoardCopyChanged ? `Menu board copy updated` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const discardChange = () => {
    setDraft((d) => ({
      ...d,
      rrp: baseline.rrp,
      offerPrice: baseline.offerPrice,
      offerFrom: baseline.offerFrom,
      offerUntil: baseline.offerUntil,
      showOnMenuBoard: baseline.showOnMenuBoard,
    }));
    setReason('');
  };

  const [savingPrice, setSavingPrice] = useState(false);

  const confirmSave = async () => {
    if (!canSave) return;
    const changes = [];
    if (rrpChanged) changes.push({ fieldName: 'RRP', oldValue: baseline.rrp || '—', newValue: draft.rrp });
    if (offerChanged) changes.push({ fieldName: 'Offer price', oldValue: baseline.offerPrice || '—', newValue: draft.offerPrice });
    if (fromChanged) changes.push({ fieldName: 'Offer from', oldValue: fmtDateVal(baseline.offerFrom), newValue: fmtDateVal(draft.offerFrom) });
    if (untilChanged) changes.push({ fieldName: 'Offer until', oldValue: fmtDateVal(baseline.offerUntil), newValue: fmtDateVal(draft.offerUntil) });
    if (menuBoardCopyChanged) changes.push({ fieldName: 'Show on Menu Board', oldValue: baseline.showOnMenuBoard || '—', newValue: draft.showOnMenuBoard || '—' });
    const withLog = appendPriceLogEntries(draft, changes, reason);
    setSavingPrice(true);
    try {
      const saved = await upsertProduct(withLog);
      setBaseline(saved);
      setDraft(saved);
      setReason('');
      message.success('Price change saved');
    } catch (e) {
      message.error('Save failed: ' + (e.message || e));
    } finally {
      setSavingPrice(false);
    }
  };

  // Newest first — explicit rather than relying on append order, so the
  // log stays correctly ordered even if entries ever arrive out of order
  // (e.g. a store writing its own entries independently of HQ Admin).
  const log = useMemo(() => {
    return [...(draft.priceLog || [])].sort((a, b) => {
      const ta = parseWhen(a.when)?.getTime() ?? 0;
      const tb = parseWhen(b.when)?.getTime() ?? 0;
      return tb - ta;
    });
  }, [draft.priceLog]);
  const hqCount = log.filter((e) => e.src === 'HQ Admin').length;
  const storeCount = log.length - hqCount;
  const filteredLog = localOnly ? log.filter((e) => e.src !== 'HQ Admin') : log;

  const columns = useMemo(
    () => [
      {
        title: 'Date',
        dataIndex: 'when',
        width: 130,
        render: (v) => {
          const d = parseWhen(v);
          return (
            <div>
              <div>{d ? d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : v}</div>
              <div style={{ fontSize: 12, color: 'rgba(0,0,0,.45)' }}>{d ? d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : ''}</div>
            </div>
          );
        },
      },
      {
        title: (
          <span>
            Changed in <MaterialIcon name="filter_alt" style={{ fontSize: 13, color: 'rgba(0,0,0,.45)' }} />
          </span>
        ),
        dataIndex: 'src',
        width: 140,
        render: (v, row) => (
          <div>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: v === 'HQ Admin' ? '#169bc2' : '#722ed1' }} />
              <span style={{ color: v === 'HQ Admin' ? '#09759c' : '#531dab' }}>{v}</span>
            </span>
            {row.store && <div style={{ fontFamily: 'ui-monospace,Menlo,Consolas,monospace', fontSize: 12, color: 'rgba(0,0,0,.45)' }}>{row.store}</div>}
          </div>
        ),
      },
      {
        title: (
          <span>
            Changed by <MaterialIcon name="filter_alt" style={{ fontSize: 13, color: 'rgba(0,0,0,.45)' }} />
          </span>
        ),
        dataIndex: 'by',
        width: 120,
      },
      {
        title: (
          <span>
            Field <MaterialIcon name="filter_alt" style={{ fontSize: 13, color: 'rgba(0,0,0,.45)' }} />
          </span>
        ),
        dataIndex: 'fieldName',
        width: 100,
      },
      { title: 'Old', dataIndex: 'old', align: 'right', width: 80, render: (v) => <span style={{ fontVariantNumeric: 'tabular-nums' }}>{v}</span> },
      { title: 'New', dataIndex: 'neu', align: 'right', width: 80, render: (v) => <span style={{ fontVariantNumeric: 'tabular-nums' }}>{v}</span> },
      {
        title: 'Change',
        align: 'right',
        width: 90,
        render: (_, row) => {
          const o = parseFloat(row.old);
          const n = parseFloat(row.neu);
          if (isNaN(o) || isNaN(n)) return <span>—</span>;
          const diff = n - o;
          if (diff === 0) return <span>—</span>;
          const up = diff > 0;
          return (
            <span style={{ fontWeight: 500, fontVariantNumeric: 'tabular-nums', color: up ? '#cf1322' : '#389e0d' }}>
              {up ? '▲' : '▼'} ${Math.abs(diff).toFixed(2)}
            </span>
          );
        },
      },
      { title: 'Reason', dataIndex: 'reason' },
    ],
    []
  );

  return (
    <div>
      <div className="ph-sect">
        <div className="ph-sect-label" style={{ marginBottom: 12 }}>
          RRP &amp; Offer Pricing
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 16px' }}>
          <Field label="RRP">
            <InputNumber
              value={draft.rrp}
              onChange={(v) => setDraft((d) => ({ ...d, rrp: v }))}
              prefix="$"
              style={{ width: '100%', ...(rrpChanged ? { background: '#e8fdff' } : {}) }}
              min={0}
              step={0.01}
            />
          </Field>
          <Field label="Offer price">
            <InputNumber
              value={draft.offerPrice}
              onChange={(v) => setDraft((d) => ({ ...d, offerPrice: v }))}
              prefix="$"
              style={{ width: '100%', ...(offerChanged ? { background: '#e8fdff' } : {}) }}
              min={0}
              step={0.01}
            />
          </Field>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 16px', marginTop: 14 }}>
          <Field label="Schedule offer from" hint="Blank means the offer starts now.">
            <ClearableDate value={draft.offerFrom} onChange={(v) => setDraft((d) => ({ ...d, offerFrom: v }))} showTime blankHint={{ blank: '', set: '' }} />
          </Field>
          <Field label="Schedule offer until" hint="Blank means the offer runs until removed.">
            <ClearableDate value={draft.offerUntil} onChange={(v) => setDraft((d) => ({ ...d, offerUntil: v }))} showTime blankHint={{ blank: '', set: '' }} />
          </Field>
        </div>
        <div style={{ marginTop: 14 }}>
          <Field label="Show on Menu Board" hint="Optional promo copy shown alongside this product's price on the menu board, e.g. &ldquo;Limited time only!&rdquo; Leave blank to show nothing extra.">
            <Input
              value={draft.showOnMenuBoard}
              onChange={(e) => setDraft((d) => ({ ...d, showOnMenuBoard: e.target.value }))}
              placeholder="e.g. Limited time only!"
              style={menuBoardCopyChanged ? { background: '#e8fdff' } : undefined}
            />
          </Field>
        </div>
        <div style={{ marginTop: 14 }}>
          <OfferBanner rrp={draft.rrp} offerPrice={draft.offerPrice} offerFrom={draft.offerFrom} offerUntil={draft.offerUntil} />
        </div>
        <div style={{ marginTop: 14 }}>
          <Field label="Reason for this change" hint="Required to save — recorded in the price change log below.">
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why is this pricing changing?"
            />
          </Field>
        </div>
      </div>

      <div className="ph-sect">
        <div className="ph-sect-label">Currency &amp; tax</div>
        <p style={{ fontSize: 12, color: 'rgba(0,0,0,.45)', margin: '4px 0 12px' }}>
          Set once for the product. These are not part of a price change and never differ between scheduled offers.
        </p>
        {!unlocked && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#fafafa', border: '1px solid #f0f0f0', borderRadius: 6, padding: '10px 12px', fontSize: 13, color: 'rgba(0,0,0,.65)', marginBottom: 14 }}>
            <MaterialIcon name="lock" style={{ fontSize: 15 }} />
            <span style={{ flex: 1 }}>Locked. Currency and tax class were set when the product was created and apply to every price, offer and scheduled change.</span>
            <Button size="small" onClick={() => setUnlocked(true)}>
              Unlock to change
            </Button>
          </div>
        )}
        {unlocked && (
          <div style={{ background: '#fff2f0', border: '1px solid #ffccc7', color: '#a8071a', borderRadius: 6, padding: '10px 12px', fontSize: 13, marginBottom: 14 }}>
            Changing these rewrites how every historical and scheduled price is interpreted.
          </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 16px', maxWidth: 500 }}>
          <Field label="Currency">
            <Input disabled={!unlocked} value={draft.currency} onChange={(e) => setDraft((d) => ({ ...d, currency: e.target.value }))} />
          </Field>
          <Field label="Tax class">
            <Input disabled={!unlocked} value={draft.taxClass} onChange={(e) => setDraft((d) => ({ ...d, taxClass: e.target.value }))} />
          </Field>
        </div>
      </div>

      <div className="ph-sect">
        <div className="ph-sect-label" style={{ marginBottom: 12 }}>
          Price Change History
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <span style={{ fontSize: 12, color: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', gap: 8 }}>
            {log.length} price change{log.length === 1 ? '' : 's'} · {hqCount} from HQ Admin, {storeCount} from stores
            {localOnly && (
              <Tag color="purple" closable onClose={(e) => { e.preventDefault(); clearLocalFilter(); }}>
                Showing store pricing only
              </Tag>
            )}
          </span>
          <Button type="link" style={{ padding: 0 }}>
            Export history
          </Button>
        </div>
        <Table
          rowKey={(r, i) => i}
          dataSource={filteredLog}
          columns={columns}
          size="middle"
          bordered={false}
          pagination={{ pageSize: 25, showSizeChanger: true, pageSizeOptions: ['25', '50', '100'] }}
        />
      </div>

      <div className="ph-savebar">
        <span style={{ fontSize: 13, color: 'rgba(0,0,0,.65)' }}>
          {dirty
            ? (reason.trim() ? `Unsaved price change — ${changeSummary}` : `Unsaved price change — enter a reason above to enable saving`)
            : 'No changes to save. Editing RRP, offer price, dates or the menu board copy enables the save and writes an entry to the log.'}
        </span>
        <div style={{ flex: 1 }} />
        <Button disabled={!dirty} onClick={discardChange}>
          Discard change
        </Button>
        <Button type="primary" disabled={!canSave} onClick={confirmSave} loading={savingPrice}>
          Save price change
        </Button>
      </div>
    </div>
  );
}
