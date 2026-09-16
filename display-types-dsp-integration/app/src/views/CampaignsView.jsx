import React, { useState, useMemo } from "react";
import { T, MONO, Icon, Pill, Btn, SectionLabel, Note, Callout, Grid, Fld, ctl, small, inputStyle, Table, TRow, TCell, Tabs, Segmented, JsonBlock, Empty, Kpi, uid, ADVERTISER_COLOUR } from "../ui.jsx";
import { visibilityDeadlineMs, slotCount, isCapped, PLATFORM_DEFAULTS, tpIcon } from "../model/schema.js";
import { reservation as mkReservation, campaign as mkCampaign, resolveReservation, reservationProblems, eligibilitySummary, partnerById, providerOf, partnerColour, permittedVocabulary, attrByKey, OPS, ruleText, ATTRIBUTE_REGISTRY } from "../model/sellside.js";
import { STORES, DISPLAYS } from "../model/data.js";

const STATUS = {
  active: { label: "Active", colour: T.success },
  pending_approval: { label: "Pending approval", colour: T.warning },
  scheduled: { label: "Scheduled", colour: T.primary },
  ended: { label: "Ended", colour: T.micro },
};
const CACHE = { cached: { label: "Cached", colour: T.success, icon: "cloud_done" }, pending: { label: "Pending", colour: T.warning, icon: "cloud_sync" }, failed: { label: "Failed", colour: T.error, icon: "cloud_off" } };

export default function CampaignsView({ reservations, setReservations, partners, setPartners, types, playlists, sel, setSel, goToPartner }) {
  const [tab, setTab] = useState("set");
  const [filter, setFilter] = useState("all");
  const r = reservations.find((x) => x.id === sel) || reservations[0];
  const setR = (patch) => setReservations(reservations.map((x) => (x.id === r.id ? { ...x, ...patch } : x)));
  const p = partnerById(partners, r?.partnerId);
  const pendingAll = reservations.flatMap((x) => x.campaigns.filter((c) => c.approval === "pending").map((c) => ({ res: x, c })));
  const list = reservations.filter((x) => filter === "all" || (filter === "pending" ? x.campaigns.some((c) => c.approval === "pending") : x.status === filter));

  const addReservation = () => {
    const pt = partners.find((x) => x.status === "connected" && !x.system) || partners[0];
    const id = uid("res");
    setReservations([...reservations, mkReservation({ id, partnerId: pt.id, advertiser: pt.seats[0]?.name || "", positions: [], window: { from: "2026-09-20", to: "2026-09-21", hours: 24 }, status: "scheduled",
      campaigns: [mkCampaign({ id: uid("cmp"), role: "baseline", name: "Baseline", priority: 999, approval: pt.seats[0]?.approvalRequired ? "pending" : "not_required" })] })]);
    setSel(id);
  };

  if (!r) return <Empty>No reservations yet.</Empty>;

  return (
    <div style={{ display: "flex", gap: 20, alignItems: "flex-start" }}>
      {/* --------------------------------------------- list */}
      <div style={{ width: 236, flexShrink: 0 }}>
        <Btn variant="primary" style={{ width: "100%", justifyContent: "center", marginBottom: 10 }} onClick={addReservation}><Icon name="add" size={16} />New reservation</Btn>
        <Segmented size="sm" value={filter} onChange={setFilter} options={[{ value: "all", label: `All (${reservations.length})` }, { value: "active", label: "Active" }, { value: "pending", label: `Approval (${pendingAll.length})` }]} />
        <div style={{ marginTop: 8, border: `1px solid ${T.borderSubtle}`, borderRadius: 8, overflow: "hidden" }}>
          {list.map((x) => {
            const a = x.id === r.id; const pt = partnerById(partners, x.partnerId); const st = STATUS[x.status];
            const pend = x.campaigns.filter((c) => c.approval === "pending").length;
            return (
              <div key={x.id} onClick={() => setSel(x.id)} style={{ padding: "9px 12px", cursor: "pointer", borderBottom: `1px solid ${T.borderSubtle}`, background: a ? T.primaryTint : "transparent" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <Icon name={providerOf(pt)?.icon || "inventory_2"} size={15} style={{ color: partnerColour(pt) }} />
                  <span style={{ fontSize: 13, color: a ? T.primary : T.text, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{x.advertiser || <i>unnamed</i>}</span>
                  <span style={{ width: 8, height: 8, borderRadius: 9999, background: st.colour }} title={st.label} />
                </div>
                <div style={{ fontSize: 11, color: T.muted, marginTop: 3, marginLeft: 21, fontFamily: MONO }}>{x.id}</div>
                <div style={{ fontSize: 11, color: T.muted, marginLeft: 21 }}>{x.window.from} · {x.window.hours}h · {x.campaigns.length - 1} targeted{pend ? <span style={{ color: T.warning }}> · {pend} pending</span> : null}</div>
              </div>
            );
          })}
          {list.length === 0 && <div style={{ padding: 12, fontSize: 12.5, color: T.muted }}>Nothing here.</div>}
        </div>
        <Note>A reservation is one sold position set for one play window: exactly one baseline campaign plus zero or more targeted campaigns that override it.</Note>
      </div>

      {/* --------------------------------------------- detail */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
          <Icon name={providerOf(p)?.icon || "inventory_2"} size={26} style={{ color: partnerColour(p), marginTop: 2 }} />
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <select value={r.partnerId || ""} onChange={(e) => { const np = partnerById(partners, e.target.value); setR({ partnerId: e.target.value, advertiser: np?.seats[0]?.name || "" }); }} style={{ ...inputStyle, width: 200 }}>{partners.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
              <select value={r.advertiser || ""} onChange={(e) => setR({ advertiser: e.target.value })} style={{ ...inputStyle, width: 180 }}>{(p?.seats || []).map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}</select>
              <span style={{ fontFamily: MONO, fontSize: 12, color: T.micro }}>{r.id}</span>
            </div>
            <div style={{ fontSize: 12, color: T.muted, marginTop: 4 }}>{r.clearing.kind}{r.clearing.cpm ? ` · ${p?.currency || "GBP"} ${r.clearing.cpm.toFixed(2)} CPM` : ""}{r.clearing.dealId ? ` · ${r.clearing.dealId}` : " · open auction"}</div>
          </div>
          <Pill color={STATUS[r.status].colour} bg="#fff" border={STATUS[r.status].colour}>{STATUS[r.status].label}</Pill>
        </div>

        <Tabs value={tab} onChange={setTab} items={[
          { key: "set", label: "Campaign set", icon: "layers", count: r.campaigns.length },
          { key: "positions", label: "Positions & window", icon: "view_week", count: r.positions.length },
          { key: "assets", label: "Assets & distribution", icon: "cloud_sync" },
          { key: "approval", label: "Approval queue", icon: "fact_check", count: pendingAll.length },
          { key: "data", label: "Data", icon: "data_object" },
        ]} />

        {tab === "set" && <CampaignSet r={r} setR={setR} p={p} types={types} playlists={playlists} />}
        {tab === "positions" && <Positions r={r} setR={setR} types={types} />}
        {tab === "assets" && <Assets r={r} setR={setR} types={types} />}
        {tab === "approval" && <ApprovalQueue reservations={reservations} setReservations={setReservations} partners={partners} pending={pendingAll} onOpen={(id) => { setSel(id); setTab("set"); }} />}
        {tab === "data" && (
          <>
            <div style={{ fontSize: 12, color: T.muted, lineHeight: 1.5, marginBottom: 10 }}>What <code>POST /v1/campaigns</code> holds for this reservation — the tier-2 shape from REQUIREMENTS §6. Rules are predicates over this partner's permitted vocabulary; PH evaluates them and never returns a value.</div>
            <JsonBlock value={{ reservationId: r.id, partnerId: r.partnerId, advertiser: r.advertiser, positions: r.positions, storeSet: r.storeSet, window: r.window, campaigns: r.campaigns.map((c) => ({ id: c.id, role: c.role, ...(c.role === "targeted" ? { priority: c.priority, rules: c.rules } : {}), assetSet: c.assetSetId, approval: c.approval })) }} maxHeight={520} />
          </>
        )}
      </div>
    </div>
  );
}

/* --------------------------------------------- campaign set + evaluator */

function CampaignSet({ r, setR, p, types, playlists }) {
  const vocab = permittedVocabulary(p || { targeting: { enabledAttributes: [] } });
  const problems = reservationProblems(r);
  const targeted = r.campaigns.filter((c) => c.role === "targeted").sort((a, b) => a.priority - b.priority);
  const baseline = r.campaigns.find((c) => c.role === "baseline");
  const setC = (id, patch) => setR({ campaigns: r.campaigns.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
  const setRule = (cid, i, patch) => { const c = r.campaigns.find((x) => x.id === cid); setC(cid, { rules: { all: c.rules.all.map((q, k) => (k === i ? { ...q, ...patch } : q)) } }); };
  const seat = (p?.seats || []).find((s) => s.name === r.advertiser);

  /* Evaluator state: which position, and the attribute values / latencies. */
  const [posIdx, setPosIdx] = useState(0);
  const [attrs, setAttrs] = useState(() => Object.fromEntries(vocab.map((a) => [a.key, { value: a.type === "number" ? 22 : a.values ? a.values[0] : "", resolvedAtMs: 300 }])));
  const [manualNav, setManualNav] = useState(false);
  const pos = r.positions[posIdx] || r.positions[0];
  const dt = pos ? types.find((t) => t.id === pos.displayTypeId) : null;
  const pl = dt ? playlists.find((x) => x.id === dt.defaultPlaylistId) : null;
  const deadlineMs = manualNav ? 0 : pos ? visibilityDeadlineMs(pl, pos.slotIndex) : PLATFORM_DEFAULTS.firstPaintBudgetMs;
  const result = resolveReservation(r, { attrs, deadlineMs });
  const usedAttrs = [...new Set(targeted.flatMap((c) => c.rules.all.map((q) => q.attr)))].map(attrByKey).filter(Boolean);

  const CampaignCard = ({ c }) => {
    const won = result.winner?.id === c.id;
    const tr = result.trace.find((t) => t.campaign?.id === c.id);
    return (
      <div style={{ border: `1px solid ${won ? T.success : c.role === "baseline" ? T.primary : T.borderSubtle}`, borderRadius: 8, marginBottom: 8, background: won ? "rgba(82,196,26,0.05)" : "#fff", overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", background: T.surfaceAlt, borderBottom: `1px solid ${T.borderSubtle}` }}>
          <Pill color={c.role === "baseline" ? T.primary : ADVERTISER_COLOUR} bg={c.role === "baseline" ? T.primaryTint : "rgba(124,58,237,0.10)"}>{c.role}</Pill>
          <input value={c.name} onChange={(e) => setC(c.id, { name: e.target.value })} style={{ ...small, flex: 1, fontWeight: 500 }} />
          {c.role === "targeted" && <div style={{ display: "flex", alignItems: "center", gap: 4 }}><span style={{ fontSize: 11, color: T.micro }}>priority</span><input type="number" value={c.priority} onChange={(e) => setC(c.id, { priority: Number(e.target.value) })} style={{ ...small, width: 60 }} /></div>}
          {c.role === "baseline" && <span style={{ fontSize: 11, color: T.micro }}>pinned lowest</span>}
          <select value={c.assetSetId || ""} onChange={(e) => setC(c.id, { assetSetId: e.target.value || null })} style={{ ...small, width: 150 }}><option value="">asset set…</option>{r.assetSets.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
          <ApprovalPill c={c} seat={seat} onChange={(v) => setC(c.id, { approval: v })} />
          {c.role === "targeted" && <Icon name="delete" size={16} style={{ cursor: "pointer", color: T.error }} onClick={() => setR({ campaigns: r.campaigns.filter((x) => x.id !== c.id) })} />}
        </div>
        <div style={{ padding: "10px 12px" }}>
          {c.role === "targeted" ? (
            <>
              {c.rules.all.map((q, i) => {
                const a = attrByKey(q.attr); const ops = OPS[a?.type || "string"];
                return (
                  <div key={i} style={{ display: "grid", gridTemplateColumns: "44px 1.4fr 1fr 1.2fr 24px", gap: 6, alignItems: "center", marginBottom: 6 }}>
                    <span style={{ fontSize: 11, color: T.micro, textAlign: "right" }}>{i === 0 ? "WHERE" : "AND"}</span>
                    <select value={q.attr} onChange={(e) => { const na = attrByKey(e.target.value); setRule(c.id, i, { attr: e.target.value, op: OPS[na?.type || "string"][0][0], value: na?.values ? na.values[0] : na?.type === "number" ? 0 : "" }); }} style={{ ...small, fontSize: 12 }}>
                      {vocab.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
                      {!vocab.some((x) => x.key === q.attr) && <option value={q.attr}>{a?.label || q.attr} (not permitted)</option>}
                    </select>
                    <select value={q.op} onChange={(e) => setRule(c.id, i, { op: e.target.value })} style={{ ...small, fontSize: 12 }}>{ops.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                    {a?.values && q.op !== "in" ? <select value={q.value} onChange={(e) => setRule(c.id, i, { value: e.target.value })} style={{ ...small, fontSize: 12 }}>{a.values.map((v) => <option key={v}>{v}</option>)}</select>
                      : <input type={a?.type === "number" ? "number" : "text"} value={q.value} onChange={(e) => setRule(c.id, i, { value: a?.type === "number" ? Number(e.target.value) : e.target.value })} style={{ ...small, fontSize: 12 }} placeholder={q.op === "in" ? "a, b, c" : ""} />}
                    <Icon name="close" size={15} style={{ cursor: "pointer", color: T.muted }} onClick={() => setC(c.id, { rules: { all: c.rules.all.filter((_, k) => k !== i) } })} />
                  </div>
                );
              })}
              <Btn variant="outline" style={{ height: 26, fontSize: 12 }} disabled={vocab.length === 0} onClick={() => { const a = vocab[0]; setC(c.id, { rules: { all: [...c.rules.all, { attr: a.key, op: OPS[a.type][0][0], value: a.values ? a.values[0] : a.type === "number" ? 25 : "" }] } }); }}><Icon name="add" size={14} />Add "AND" condition</Btn>
            </>
          ) : <div style={{ fontSize: 12, color: T.muted }}>Always eligible. Renders whenever no targeted campaign's rules are true at the deadline — and inside a programmatic play window, fills every moment the targeted campaigns do not.</div>}
          {tr && (
            <div style={{ marginTop: 8, fontSize: 11.5, display: "flex", alignItems: "flex-start", gap: 6, color: won ? T.success : tr.outcome === "pending_approval" ? T.warning : tr.outcome === "unusable" ? T.error : T.muted }}>
              <Icon name={won ? "check_circle" : tr.outcome === "not_needed" ? "remove_circle_outline" : tr.outcome === "pending_approval" ? "hourglass_top" : tr.outcome === "unresolved" ? "timer_off" : tr.outcome === "unusable" ? "error" : "cancel"} size={14} style={{ marginTop: 1 }} />
              <span><b>{won ? "Wins" : { rule_false: "Rule false", unresolved: "Unresolved by deadline", pending_approval: "Pending approval", outranked: "Outranked", not_needed: "Not needed", unusable: "Unusable" }[tr.outcome]}</b> — {tr.detail}</span>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div style={{ display: "flex", gap: 20, alignItems: "flex-start", flexWrap: "wrap" }}>
      <div style={{ flex: 1.4, minWidth: 380 }}>
        {problems.map((m, i) => <Callout key={i} tone="error" style={{ marginBottom: 8 }}>{m}</Callout>)}
        {baseline && <CampaignCard c={baseline} />}
        {!baseline && <Btn variant="outline" style={{ marginBottom: 8 }} onClick={() => setR({ campaigns: [mkCampaign({ id: uid("cmp"), role: "baseline", name: "Baseline", priority: 999 }), ...r.campaigns] })}><Icon name="add" size={15} />Add the baseline campaign</Btn>}
        <div style={{ fontSize: 12, color: T.micro, textTransform: "uppercase", letterSpacing: "0.5px", margin: "12px 0 8px" }}>Targeted overrides — highest priority true wins</div>
        {targeted.map((c) => <CampaignCard key={c.id} c={c} />)}
        <Btn variant="outline" style={{ height: 28, fontSize: 12.5 }} onClick={() => setR({ campaigns: [...r.campaigns, mkCampaign({ id: uid("cmp"), role: "targeted", name: `Targeted ${targeted.length + 1}`, priority: (Math.max(0, ...targeted.map((c) => c.priority)) || 0) + 10, approval: seat?.approvalRequired ? "pending" : "not_required" })] })}><Icon name="add" size={15} />Add targeted campaign</Btn>
        <Note>Named <b>baseline</b>, not default, on purpose: <code>campaignCreativeSettings</code> already uses <code>default</code> for the device-pairing axis. Precedence is explicit — the partner sets priority within its own set; most-specific-wins is unpredictable and unarguable-with.</Note>
      </div>

      {/* ------------------------------------------- which would win */}
      <div style={{ width: 330, flexShrink: 0, border: `1px solid ${T.borderSubtle}`, borderRadius: 8, padding: 14, background: T.surfaceAlt }}>
        <div style={{ fontSize: 12, color: T.micro, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 10 }}>Which would win?</div>
        <Fld label="Position">
          <select value={posIdx} onChange={(e) => setPosIdx(Number(e.target.value))} style={small}>
            {r.positions.map((q, i) => { const t = types.find((x) => x.id === q.displayTypeId); return <option key={i} value={i}>{t?.name || q.displayTypeId} · slot {q.slotIndex + 1}</option>; })}
            {r.positions.length === 0 && <option>No positions — add one on the Positions tab</option>}
          </select>
        </Fld>
        <div style={{ margin: "10px 0", padding: "8px 10px", borderRadius: 6, background: "#fff", border: `1px solid ${T.borderSubtle}`, fontSize: 12, lineHeight: 1.6 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: T.muted }}>Visibility deadline</span><b>{manualNav ? "0 ms (collapsed)" : `${deadlineMs} ms`}</b></div>
          <div style={{ fontSize: 11, color: T.micro }}>{manualNav ? "The customer navigated to this position manually — the deadline collapses to now." : pos ? `first-paint ${PLATFORM_DEFAULTS.firstPaintBudgetMs} ms + durations of the ${pos.slotIndex} preceding slot${pos.slotIndex === 1 ? "" : "s"} in ${pl?.name || "the playlist"}` : ""}</div>
          <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 8 }}><input type="checkbox" checked={manualNav} onChange={(e) => setManualNav(e.target.checked)} /><span style={{ fontSize: 11.5 }}>Simulate manual navigation</span></div>
        </div>
        <div style={{ fontSize: 11.5, color: T.muted, marginBottom: 6 }}>Attributes at the display, and when each resolved</div>
        {usedAttrs.length === 0 && <div style={{ fontSize: 12, color: T.micro, marginBottom: 8 }}>No rules reference an attribute yet.</div>}
        {usedAttrs.map((a) => {
          const v = attrs[a.key] || { value: "", resolvedAtMs: 300 };
          const late = v.resolvedAtMs === null || v.resolvedAtMs > deadlineMs;
          return (
            <div key={a.key} style={{ display: "grid", gridTemplateColumns: "1fr 92px 84px", gap: 6, alignItems: "center", marginBottom: 6 }}>
              <span style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={a.key}>{a.label}</span>
              {a.values ? <select value={v.value} onChange={(e) => setAttrs({ ...attrs, [a.key]: { ...v, value: e.target.value } })} style={{ ...small, height: 26, fontSize: 11.5 }}>{a.values.map((x) => <option key={x}>{x}</option>)}</select>
                : <input type={a.type === "number" ? "number" : "text"} value={v.value} onChange={(e) => setAttrs({ ...attrs, [a.key]: { ...v, value: a.type === "number" ? Number(e.target.value) : e.target.value } })} style={{ ...small, height: 26, fontSize: 11.5 }} />}
              <select value={v.resolvedAtMs === null ? "never" : v.resolvedAtMs} onChange={(e) => setAttrs({ ...attrs, [a.key]: { ...v, resolvedAtMs: e.target.value === "never" ? null : Number(e.target.value) } })} style={{ ...small, height: 26, fontSize: 11.5, color: late ? T.error : T.success }}>
                {[100, 300, 800, 2000, 5000, 12000].map((ms) => <option key={ms} value={ms}>{ms} ms</option>)}<option value="never">never</option>
              </select>
            </div>
          );
        })}
        <div style={{ marginTop: 12, padding: 12, borderRadius: 6, background: "#fff", border: `1px solid ${result.fallback === "hq" ? T.error : T.success}` }}>
          <div style={{ fontSize: 11, color: T.micro, textTransform: "uppercase", letterSpacing: "0.5px" }}>Renders</div>
          <div style={{ fontSize: 15, fontWeight: 600, marginTop: 2, color: result.fallback === "hq" ? T.error : T.text }}>{result.fallback === "hq" ? "Next eligible HQ campaign" : result.winner?.name}</div>
          <div style={{ fontSize: 11.5, color: T.muted, marginTop: 2 }}>{result.fallback === "baseline" ? "baseline — no targeted rule true at the deadline" : result.fallback === "hq" ? "no usable baseline — never dark" : `targeted, priority ${result.winner?.priority}`}</div>
        </div>
        <Note>A rule on an attribute that has not resolved by the deadline is <b>false, not pending</b>. A campaign gated on a slow source is likelier to lose to its baseline in slot 1 than in slot 5 — try a later position.</Note>
      </div>
    </div>
  );
}

const ApprovalPill = ({ c, seat, onChange }) => {
  const req = !!seat?.approvalRequired;
  if (!req && c.approval !== "pending") return <Pill color={T.micro} bg="rgba(0,0,0,0.04)" title="Advertiser has no approval-required flag — publish is immediate">auto</Pill>;
  return c.approval === "pending"
    ? <Pill color={T.warning} bg="rgba(250,173,20,0.12)" title="Held out of rotation until approved"><Icon name="hourglass_top" size={12} />pending</Pill>
    : <Pill color={T.success} bg="rgba(82,196,26,0.12)" title="Approved"><Icon name="check" size={12} />approved</Pill>;
};

/* --------------------------------------------- positions & window */

function Positions({ r, setR, types }) {
  const sellable = types.filter((t) => isCapped(t) && (t.phExtensions.slots || []).some((s) => s.owner === "advertiser"));
  const addPos = () => { const t = sellable[0]; if (!t) return; const i = t.phExtensions.slots.findIndex((s) => s.owner === "advertiser"); setR({ positions: [...r.positions, { displayTypeId: t.id, slotIndex: i }] }); };
  return (
    <>
      <SectionLabel style={{ marginTop: 0 }}>Positions — display type × slot</SectionLabel>
      <Table cols="1.6fr 1fr 1.4fr 40px" header={["Display type", "Slot", "Slot owner / assignment", ""]}>
        {r.positions.map((q, i) => {
          const t = types.find((x) => x.id === q.displayTypeId); const sl = t?.phExtensions.slots[q.slotIndex];
          const ok = sl && sl.owner === "advertiser";
          return (
            <TRow key={i} cols="1.6fr 1fr 1.4fr 40px" last={i === r.positions.length - 1}>
              <TCell><select value={q.displayTypeId} onChange={(e) => setR({ positions: r.positions.map((x, k) => (k === i ? { displayTypeId: e.target.value, slotIndex: 0 } : x)) })} style={{ ...small, fontSize: 12 }}>{types.filter(isCapped).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></TCell>
              <TCell><select value={q.slotIndex} onChange={(e) => setR({ positions: r.positions.map((x, k) => (k === i ? { ...x, slotIndex: Number(e.target.value) } : x)) })} style={{ ...small, fontSize: 12 }}>{(t?.phExtensions.slots || []).map((s, k) => <option key={k} value={k}>Slot {k + 1} — {s.label}</option>)}</select></TCell>
              <TCell style={{ color: ok ? T.text : T.error }}>{sl ? (ok ? <span style={{ color: ADVERTISER_COLOUR }}>Advertiser position</span> : `${sl.owner} — not sellable`) : "—"}</TCell>
              <TCell><Icon name="close" size={15} style={{ cursor: "pointer", color: T.muted }} onClick={() => setR({ positions: r.positions.filter((_, k) => k !== i) })} /></TCell>
            </TRow>
          );
        })}
        {r.positions.length === 0 && <div style={{ padding: 12, fontSize: 12.5, color: T.muted }}>No positions. Only a capped rotation with an Advertiser-owned slot is sellable.</div>}
      </Table>
      <Btn variant="text" style={{ paddingLeft: 0, marginTop: 6 }} disabled={!sellable.length} onClick={addPos}><Icon name="add" size={16} />Add position</Btn>

      <SectionLabel>Store set & play window</SectionLabel>
      <Grid cols={3}>
        <Fld label="Stores"><Segmented value={r.storeSet.mode} onChange={(v) => setR({ storeSet: { ...r.storeSet, mode: v } })} options={[{ value: "all", label: "Whole estate" }, { value: "list", label: "Selected stores" }]} /></Fld>
        <Fld label="Window from"><input type="date" value={r.window.from || ""} onChange={(e) => setR({ window: { ...r.window, from: e.target.value } })} style={ctl} /></Fld>
        <Fld label="Window length (hours)" hint="A play window, not an impression. The auction clears ahead of it so assets can be distributed and cached."><input type="number" value={r.window.hours} onChange={(e) => setR({ window: { ...r.window, hours: Number(e.target.value) } })} style={ctl} /></Fld>
      </Grid>
      {r.storeSet.mode === "list" && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
          {STORES.map((s) => { const on = r.storeSet.storeIds.includes(s.id); return <span key={s.id} onClick={() => setR({ storeSet: { ...r.storeSet, storeIds: on ? r.storeSet.storeIds.filter((x) => x !== s.id) : [...r.storeSet.storeIds, s.id] } })} style={{ cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4, height: 24, padding: "0 10px", borderRadius: 9999, fontSize: 12, border: `1px solid ${on ? T.primary : T.border}`, background: on ? T.primaryTint : "#fff", color: on ? T.primary : T.text }}>{on && <Icon name="check" size={13} />}{s.code} · {s.name}</span>; })}
        </div>
      )}
      <Grid cols={3}>
        <Fld label="Clearing"><select value={r.clearing.kind} onChange={(e) => setR({ clearing: { ...r.clearing, kind: e.target.value } })} style={ctl}>{["Open RTB", "Preferred deal", "Programmatic guaranteed", "Direct"].map((k) => <option key={k}>{k}</option>)}</select></Fld>
        <Fld label="CPM"><input type="number" step="0.1" value={r.clearing.cpm ?? ""} onChange={(e) => setR({ clearing: { ...r.clearing, cpm: e.target.value === "" ? null : Number(e.target.value) } })} style={ctl} /></Fld>
        <Fld label="Deal ID"><input value={r.clearing.dealId || ""} onChange={(e) => setR({ clearing: { ...r.clearing, dealId: e.target.value || null } })} style={{ ...ctl, fontFamily: MONO }} /></Fld>
      </Grid>
      <Fld label="Status"><Segmented value={r.status} onChange={(v) => setR({ status: v })} options={Object.entries(STATUS).map(([k, v]) => ({ value: k, label: v.label }))} /></Fld>
      <Note>The advertiser is known at write time for a play-window auction, so every render event is stamped with partner and advertiser as it is written — no post-hoc attribution path (open questions 19–20, resolved for signage).</Note>
    </>
  );
}

/* --------------------------------------------- assets & per-display cache */

function Assets({ r, setR, types }) {
  const el = eligibilitySummary(r, DISPLAYS);
  const setDist = (id, v) => setR({ distribution: { ...r.distribution, [id]: v } });
  const retryAll = () => { const d = { ...r.distribution }; el.inScope.forEach((x) => { if ((d[x.id] || "pending") !== "cached") d[x.id] = "cached"; }); setR({ distribution: d }); };
  return (
    <>
      <SectionLabel style={{ marginTop: 0 }}>Creative asset sets — <code style={{ textTransform: "none" }}>POST /v1/campaigns/{"{id}"}/assets</code></SectionLabel>
      <Table cols="1.4fr 80px 90px 90px 1.6fr" header={["Asset set", "Kind", "Size", "Duration", "Validation"]}>
        {r.assetSets.map((a, i) => (
          <TRow key={a.id} cols="1.4fr 80px 90px 90px 1.6fr" last={i === r.assetSets.length - 1}>
            <TCell><span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Icon name={a.kind === "video" ? "videocam" : "image"} size={15} style={{ color: T.muted }} />{a.name}</span></TCell>
            <TCell muted>{a.kind}</TCell><TCell muted>{a.sizeMb} MB</TCell><TCell muted>{a.durationS}s</TCell>
            <TCell style={{ whiteSpace: "normal", color: a.validated ? T.success : T.error, fontSize: 12 }}>{a.validated ? <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}><Icon name="check_circle" size={14} />Matches canvas / element spec</span> : <span style={{ display: "inline-flex", gap: 4, alignItems: "flex-start" }}><Icon name="report" size={14} />{a.issue}</span>}</TCell>
          </TRow>
        ))}
        {r.assetSets.length === 0 && <div style={{ padding: 12, fontSize: 12.5, color: T.muted }}>No assets uploaded yet.</div>}
      </Table>
      <Btn variant="text" style={{ paddingLeft: 0, marginTop: 6 }} onClick={() => setR({ assetSets: [...r.assetSets, { id: uid("as"), name: `Asset set ${r.assetSets.length + 1}`, kind: "image", sizeMb: 1.5, durationS: 8, validated: true }] })}><Icon name="upload" size={16} />Upload asset set</Btn>
      <Note>Validated against the display type's canvas or element spec on upload. Automated checks catch dimensions and duration; a price baked into artwork is what the approval flag is for.</Note>

      <SectionLabel>Distribution — eligible only where cached</SectionLabel>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10, marginBottom: 12 }}>
        <Kpi icon="tv" tint={T.kpi.violet} label="Displays in scope" value={el.total} />
        <Kpi icon="cloud_done" tint={T.kpi.emerald} label="Cached · eligible" value={el.cached} sub={el.total ? `${Math.round((el.cached / el.total) * 100)}% of estate` : ""} />
        <Kpi icon="cloud_sync" tint={T.kpi.amber} label="Pending" value={el.pending} />
        <Kpi icon="cloud_off" tint={T.kpi.red} label="Failed" value={el.failed} />
      </div>
      {el.total > 0 && el.cached < el.total && <Callout tone="warning" style={{ marginBottom: 10 }} action={<Btn variant="outline" style={{ height: 26, fontSize: 12 }} onClick={retryAll}>Retry distribution</Btn>}>Partial-estate delivery: this win is eligible on {el.cached} of {el.total} displays. Reporting has to express what was actually sold (open question 29) — the baseline still fills the other {el.total - el.cached} from Headquarters.</Callout>}
      <Table cols="1.4fr 1fr 1fr 110px 130px" header={["Display", "Store", "Display type", "Status", "Cache state"]}>
        {el.inScope.map((d, i) => {
          const s = STORES.find((x) => x.id === d.storeId); const t = types.find((x) => x.id === d.displayTypeId); const st = r.distribution[d.id] || "pending"; const c = CACHE[st];
          return (
            <TRow key={d.id} cols="1.4fr 1fr 1fr 110px 130px" last={i === el.inScope.length - 1}>
              <TCell>{d.name}</TCell><TCell muted>{s?.code}</TCell><TCell muted>{t?.name}</TCell>
              <TCell><span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: 8, height: 8, borderRadius: 9999, background: d.status === "online" ? T.success : T.error }} />{d.status}</span></TCell>
              <TCell><select value={st} onChange={(e) => setDist(d.id, e.target.value)} style={{ ...small, height: 26, fontSize: 12, color: c.colour }}>{Object.entries(CACHE).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></TCell>
            </TRow>
          );
        })}
        {el.inScope.length === 0 && <div style={{ padding: 12, fontSize: 12.5, color: T.muted }}>No displays in scope — add a position and a store set first.</div>}
      </Table>
      <Note>Sequence (§7): auction clears ahead of the window → creative retrieved and validated → distributed to the players in scope → each display confirms its cache → the window opens and the win is eligible <b>only on displays that confirmed</b>. In-store connectivity is limited and DOOH creative is frequently video, so an impression-time auction has nowhere to deliver from.</Note>
    </>
  );
}

/* --------------------------------------------- approval queue */

function ApprovalQueue({ reservations, setReservations, partners, pending, onOpen }) {
  const decide = (resId, cid, approval) => setReservations(reservations.map((x) => (x.id === resId ? { ...x, campaigns: x.campaigns.map((c) => (c.id === cid ? { ...c, approval } : c)), status: x.status === "pending_approval" && approval === "approved" && x.campaigns.every((c) => c.id === cid || c.approval !== "pending") ? "active" : x.status } : x)));
  if (!pending.length) return <Empty icon="fact_check">Nothing waiting for approval. Campaigns for advertisers with the approval-required flag land here before they can render.</Empty>;
  return (
    <>
      <div style={{ fontSize: 12, color: T.muted, lineHeight: 1.6, marginBottom: 10 }}>Every campaign here belongs to an advertiser whose <b>approval-required</b> flag is set. Pending campaigns sit in the campaign table and are not eligible to render. Check the creative for price, offer terms or disclosures — those are PH-locked and never permitted in advertiser artwork.</div>
      <Table cols="1.2fr 1.2fr 1fr 1.4fr 170px" header={["Campaign", "Advertiser / partner", "Reservation", "Creative check", ""]}>
        {pending.map(({ res, c }, i) => {
          const pt = partnerById(partners, res.partnerId); const as = res.assetSets.find((a) => a.id === c.assetSetId);
          return (
            <TRow key={c.id} cols="1.2fr 1.2fr 1fr 1.4fr 170px" last={i === pending.length - 1} style={{ alignItems: "start" }}>
              <TCell style={{ whiteSpace: "normal" }}><b>{c.name}</b><div style={{ fontSize: 11, color: T.micro }}>{c.role}{c.role === "targeted" && ` · priority ${c.priority}`}{c.rules.all.length > 0 && <div>{c.rules.all.map(ruleText).join(" AND ")}</div>}</div></TCell>
              <TCell style={{ whiteSpace: "normal" }}>{res.advertiser}<div style={{ fontSize: 11, color: T.micro }}>{pt?.name}</div></TCell>
              <TCell><Btn variant="text" style={{ padding: 0, height: 24, fontSize: 12, fontFamily: MONO }} onClick={() => onOpen(res.id)}>{res.id}</Btn></TCell>
              <TCell style={{ whiteSpace: "normal", fontSize: 12, color: as ? (as.validated ? T.success : T.error) : T.micro }}>{as ? (as.validated ? "Automated checks passed — human review of copy needed" : as.issue) : "No asset set attached"}</TCell>
              <TCell><div style={{ display: "flex", gap: 6, paddingTop: 2 }}><Btn variant="primary" style={{ height: 26, fontSize: 12, padding: "0 10px" }} onClick={() => decide(res.id, c.id, "approved")}>Approve</Btn><Btn variant="danger" style={{ height: 26, fontSize: 12, padding: "0 10px" }} onClick={() => decide(res.id, c.id, "rejected")}>Reject</Btn></div></TCell>
            </TRow>
          );
        })}
      </Table>
      <Note>Store-authored campaigns are still open (question 12): HQ review required, or immediate publish by default?</Note>
    </>
  );
}
