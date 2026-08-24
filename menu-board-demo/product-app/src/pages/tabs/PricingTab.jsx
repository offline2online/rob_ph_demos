import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Input, InputNumber, Table, Button, App, Tag, Switch, Modal } from 'antd';
import MaterialIcon from '../../components/MaterialIcon.jsx';
import ClearableDate from '../../components/ClearableDate.jsx';
import { getOfferState, pickEffectiveOffer } from '../../components/OfferBanner.jsx';
import OfferTargetingBuilder from '../../components/OfferTargetingBuilder.jsx';
import { upsertProduct, appendPriceLogEntries, genId } from '../../data/productStore.js';

function Field({ label, required, children, hint }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <label style={{ fontSize: 13, color: 'rgba(0,0,0,.65)', marginBottom: 6 }}>
        {required && <span style={{ color: '#ff4d4f' }}>* </span>}
        {label}
      </label>
      {children}
      {hint && <p style={{ fontSize: 12, color: 'rgba(0,0,0,.45)', marginTop: 5 }}>{hint}</p>}
    </div>
  );
}

function blankOffer() {
  return { id: genId('offer'), enabled: true, description: '', offerPrice: '', offerFrom: '', offerUntil: '', targeting: [] };
}

const OFFER_STATE_STYLE = {
  live: { background: '#f6ffed', border: '1px solid #b7eb8f', color: '#237804' },
  scheduled: { background: '#fffbe6', border: '1px solid #ffe58f', color: '#874d00' },
  ended: { background: '#fff2f0', border: '1px solid #ffccc7', color: '#a8071a' },
  none: { background: '#fafafa', border: '1px solid #f0f0f0', color: 'rgba(0,0,0,.45)' },
  off: { background: '#fafafa', border: '1px solid #f0f0f0', color: 'rgba(0,0,0,.45)' },
};
const OFFER_STATE_LABEL = { live: 'Live', scheduled: 'Scheduled', ended: 'Ended', none: 'Not scheduled', off: 'Off' };

// Add/Edit Offer popup — same mechanism as Campaign Scheduling's "Add New
// Schedule" (ph-designer skill components.md §16.1): the table only shows
// each record's distinguishing fields, everything else is captured in a
// modal. The store-targeting rule-builder lives inside this same modal,
// scoped to and clearly labelled for the one offer being edited, so it's
// never ambiguous which offer a given targeting rule belongs to.
function OfferFormModal({ open, initialOffer, onCancel, onSave }) {
  const [form, setForm] = useState(initialOffer);
  useEffect(() => {
    if (open) setForm(initialOffer);
  }, [open, initialOffer]);

  const canSave = !!form && form.description.trim() !== '' && form.offerPrice !== '' && form.offerPrice != null;

  return (
    <Modal
      open={open}
      onCancel={onCancel}
      title={form?.isNew ? 'Add Offer' : 'Edit Offer'}
      width={640}
      footer={[
        <Button key="cancel" onClick={onCancel}>
          Cancel
        </Button>,
        <Button key="save" type="primary" disabled={!canSave} onClick={() => onSave(form)}>
          Save Changes
        </Button>,
      ]}
    >
      {form && (
        <div>
          <Field label="Offer description" required hint="Describes this offer and is recorded in the price change log when saved.">
            <Input
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="e.g. Summer sale — 20% off for two weeks"
            />
          </Field>
          <div style={{ maxWidth: 240, marginTop: 14 }}>
            <Field label="Offer price" required>
              <InputNumber
                value={form.offerPrice}
                onChange={(v) => setForm((f) => ({ ...f, offerPrice: v }))}
                prefix="$"
                style={{ width: '100%' }}
                min={0}
                step={0.01}
              />
            </Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 16px', marginTop: 14 }}>
            <Field label="Schedule offer from" hint="Blank means the offer starts now.">
              <ClearableDate value={form.offerFrom} onChange={(v) => setForm((f) => ({ ...f, offerFrom: v }))} showTime blankHint={{ blank: '', set: '' }} />
            </Field>
            <Field label="Schedule offer until" hint="Blank means the offer runs until removed.">
              <ClearableDate value={form.offerUntil} onChange={(v) => setForm((f) => ({ ...f, offerUntil: v }))} showTime blankHint={{ blank: '', set: '' }} />
            </Field>
          </div>
          <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid #f0f0f0' }}>
            <div style={{ fontSize: 11, color: 'rgba(0,0,0,.45)', letterSpacing: '0.08em', fontWeight: 500, marginBottom: 4, textTransform: 'uppercase' }}>
              Store targeting for this offer
            </div>
            <p style={{ fontSize: 12, color: 'rgba(0,0,0,.45)', margin: '0 0 10px' }}>
              These rules apply only to &ldquo;{form.description.trim() || 'this offer'}&rdquo; — not to any other offer on this product.
            </p>
            <OfferTargetingBuilder groups={form.targeting || []} onChange={(groups) => setForm((f) => ({ ...f, targeting: groups }))} />
          </div>
        </div>
      )}
    </Modal>
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

  // Resets on landing here for a given product, not on every render — a
  // reason typed for one product must never leak onto the next.
  useEffect(() => {
    setReason('');
  }, [draft.id]);

  const rrpChanged = String(draft.rrp) !== String(baseline.rrp);
  const menuBoardCopyChanged = String(draft.showOnMenuBoard || '') !== String(baseline.showOnMenuBoard || '');
  const offersChanged = JSON.stringify(draft.offers || []) !== JSON.stringify(baseline.offers || []);
  const dirty = rrpChanged || menuBoardCopyChanged || offersChanged;
  const canSave = dirty && reason.trim() !== '';

  const changeSummary = [
    rrpChanged ? `RRP $${baseline.rrp || '0.00'} → $${draft.rrp}` : null,
    offersChanged ? `Offers updated (${(draft.offers || []).length} defined)` : null,
    menuBoardCopyChanged ? `Menu board copy updated` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const discardChange = () => {
    setDraft((d) => ({
      ...d,
      rrp: baseline.rrp,
      offers: baseline.offers || [],
      showOnMenuBoard: baseline.showOnMenuBoard,
    }));
    setReason('');
  };

  const removeOffer = (id) => setDraft((d) => ({ ...d, offers: (d.offers || []).filter((o) => o.id !== id) }));
  const updateOffer = (id, fields) =>
    setDraft((d) => ({ ...d, offers: (d.offers || []).map((o) => (o.id === id ? { ...o, ...fields } : o)) }));

  const [offerModalOpen, setOfferModalOpen] = useState(false);
  const [editingOffer, setEditingOffer] = useState(null);
  const openAddOfferModal = () => {
    setEditingOffer({ ...blankOffer(), isNew: true });
    setOfferModalOpen(true);
  };
  const openEditOfferModal = (offer) => {
    setEditingOffer({ ...offer, isNew: false });
    setOfferModalOpen(true);
  };
  const closeOfferModal = () => {
    setOfferModalOpen(false);
    setEditingOffer(null);
  };
  // A brand new offer always saves switched on — that's the whole point of
  // adding one. Editing an existing offer leaves its on/off state exactly
  // as it was; the modal has no on/off control of its own, the table's
  // Switch column does, and saving a description/price tweak shouldn't
  // silently reactivate something that was deliberately turned off.
  const handleOfferModalSave = (form) => {
    const { isNew, ...offer } = form;
    setDraft((d) => {
      const offers = d.offers || [];
      if (isNew) return { ...d, offers: [...offers, { ...offer, enabled: true }] };
      return { ...d, offers: offers.map((o) => (o.id === offer.id ? { ...o, ...offer } : o)) };
    });
    closeOfferModal();
  };

  const [savingPrice, setSavingPrice] = useState(false);

  const confirmSave = async () => {
    if (!canSave) return;
    const changes = [];
    if (rrpChanged) changes.push({ fieldName: 'RRP', oldValue: baseline.rrp || '—', newValue: draft.rrp });
    if (offersChanged) {
      changes.push({
        fieldName: 'Offers',
        oldValue: `${(baseline.offers || []).length} offer(s)`,
        newValue: `${(draft.offers || []).length} offer(s)`,
      });
    }
    if (menuBoardCopyChanged) changes.push({ fieldName: 'Show on Menu Board', oldValue: baseline.showOnMenuBoard || '—', newValue: draft.showOnMenuBoard || '—' });

    // The grid, its price-column filter, and the Product Details banner
    // only know the legacy flat offerPrice/offerFrom/offerUntil/
    // offerDescription fields, not offers[] — derive "the one that
    // currently matters" and write it back into those fields so none of
    // that downstream code needs to change to understand multiple offers.
    const effective = pickEffectiveOffer(draft.offers) || {};
    const withLegacy = {
      ...draft,
      offerPrice: effective.offerPrice || '',
      offerFrom: effective.offerFrom || '',
      offerUntil: effective.offerUntil || '',
      offerDescription: effective.description || '',
    };
    const withLog = appendPriceLogEntries(withLegacy, changes, reason);
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

  // Table columns are the offer's own distinguishing fields, same rule as
  // Campaign Scheduling's table (ph-designer skill components.md §16.1) —
  // enough to tell offers apart at a glance without opening any of them.
  const offerColumns = useMemo(
    () => [
      {
        title: 'On',
        width: 52,
        render: (_, row) => (
          <Switch size="small" checked={row.enabled !== false} onChange={(v) => updateOffer(row.id, { enabled: v })} />
        ),
      },
      {
        title: 'Description',
        dataIndex: 'description',
        render: (v) => v || <span style={{ color: 'rgba(0,0,0,.35)' }}>—</span>,
      },
      {
        title: 'Price',
        dataIndex: 'offerPrice',
        width: 90,
        render: (v) => (v !== '' && v != null ? `$${parseFloat(v).toFixed(2)}` : '—'),
      },
      {
        title: 'Status',
        width: 110,
        render: (_, row) => {
          const dateState = getOfferState(draft.rrp, row.offerPrice, row.offerFrom, row.offerUntil);
          const state = row.enabled === false ? 'off' : dateState;
          return (
            <span style={{ borderRadius: 4, padding: '2px 8px', fontSize: 12, ...OFFER_STATE_STYLE[state] }}>
              {OFFER_STATE_LABEL[state]}
            </span>
          );
        },
      },
      {
        title: 'Schedule',
        width: 230,
        render: (_, row) => (
          <span style={{ fontSize: 13 }}>
            {row.offerFrom ? fmtDateVal(row.offerFrom) : 'Now'} → {row.offerUntil ? fmtDateVal(row.offerUntil) : 'No end date'}
          </span>
        ),
      },
      {
        title: 'Store Targeting',
        width: 130,
        render: (_, row) => {
          const n = (row.targeting || []).length;
          return n === 0 ? 'All stores' : `${n} rule${n === 1 ? '' : 's'}`;
        },
      },
      {
        title: '',
        width: 84,
        render: (_, row) => (
          <div style={{ display: 'flex', gap: 2 }}>
            <Button type="text" size="small" icon={<MaterialIcon name="edit" style={{ fontSize: 15 }} />} onClick={() => openEditOfferModal(row)} />
            <Button type="text" size="small" danger icon={<MaterialIcon name="delete" style={{ fontSize: 15 }} />} onClick={() => removeOffer(row.id)} />
          </div>
        ),
      },
    ],
    [draft.rrp]
  );

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
          // Only price fields carry a real $ delta — "Offers" logs a count
          // like "1 offer(s)", which parseFloat happily reads as 1 and
          // would otherwise render a nonsensical "▲ $1.00".
          if (row.fieldName !== 'RRP' && row.fieldName !== 'Offer price') return <span>—</span>;
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
          RRP
        </div>
        <div style={{ marginBottom: 14 }}>
          <Field label="Reason for this change" required hint="Describes this price change and is recorded in the price change log below.">
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Cost increase from supplier"
            />
          </Field>
        </div>
        <div style={{ maxWidth: 240 }}>
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
      </div>

      <div className="ph-sect">
        <div className="ph-sect-label" style={{ marginBottom: 12 }}>
          Offers
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <span style={{ fontSize: 12, color: 'rgba(0,0,0,.45)' }}>
            <b>{(draft.offers || []).length}</b> Offer{(draft.offers || []).length === 1 ? '' : 's'} Defined
          </span>
          <Button
            type="text"
            icon={<MaterialIcon name="add" style={{ fontSize: 15 }} />}
            onClick={openAddOfferModal}
            style={{ color: '#169bc2', padding: 0 }}
          >
            Add New Offer
          </Button>
        </div>
        <Table
          rowKey="id"
          dataSource={draft.offers || []}
          columns={offerColumns}
          size="middle"
          bordered={false}
          pagination={false}
          locale={{
            emptyText: (
              <div style={{ padding: '22px 0', color: 'rgba(0,0,0,.45)', fontSize: 13 }}>
                No Offer(s) Defined. This product sells at RRP everywhere until you add one.
              </div>
            ),
          }}
        />
      </div>

      <OfferFormModal open={offerModalOpen} initialOffer={editingOffer} onCancel={closeOfferModal} onSave={handleOfferModalSave} />

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
            : 'No changes to save. Editing RRP, offers or the menu board copy enables the save and writes an entry to the log.'}
        </span>
        <div style={{ flex: 1 }} />
        <Button disabled={!dirty} onClick={discardChange}>
          Cancel
        </Button>
        <Button type="primary" disabled={!canSave} onClick={confirmSave} loading={savingPrice}>
          Save Changes
        </Button>
      </div>
    </div>
  );
}
