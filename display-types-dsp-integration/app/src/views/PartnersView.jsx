import React, { useState, useMemo } from "react";
import { T, MONO, FONT, Icon, Pill, Btn, SectionLabel, Note, Callout, Grid, Fld, ctl, small, inputStyle, Table, TRow, TCell, Toggle, ToggleRow, Chips, Segmented, JsonBlock, Empty, uid, ADVERTISER_COLOUR } from "../ui.jsx";
import { tpIcon } from "../model/schema.js";
import { DSP_PROVIDERS, ONBOARDING_ORDER, BIDDER_FIELDS, AUCTION_TYPES, CURRENCIES, IAB_CATEGORIES, COMPANY_LISTS, ANY_PARTNER, RTB, partner as mkPartner, partnerById, providerOf, partnerColour, isDsp, missingCreds, effectiveLists, isBlocked, ATTRIBUTE_REGISTRY, ATTRIBUTE_FAMILIES, permittedVocabulary } from "../model/sellside.js";

const STATUS_STYLE = {
  connected: { label: "Connected", colour: T.success, icon: "check_circle" },
  draft: { label: "Not connected", colour: T.micro, icon: "radio_button_unchecked" },
  error: { label: "Connection error", colour: T.error, icon: "error" },
};
const EXCHANGE = "__exchange__";

export default function PartnersView({ partners, setPartners, companyLists, setCompanyLists, exchange, setExchange, types, goToType, sel, setSel }) {
  const [adding, setAdding] = useState(null);
  const [reveal, setReveal] = useState({});
  const onCompany = sel === COMPANY_LISTS;
  const onExchange = sel === EXCHANGE;
  const p = partners.find((x) => x.id === sel) || partners[0];
  const prov = providerOf(p);
  const setP = (patch) => setPartners(partners.map((x) => (x.id === p.id ? { ...x, ...patch } : x)));
  const setCred = (k, v) => setP({ creds: { ...p.creds, [k]: v } });

  const usage = useMemo(() => {
    const out = [];
    (types || []).forEach((t) => (t.phExtensions?.slots || []).forEach((sl, i) => {
      if (sl.owner === "advertiser" && (sl.partnerId || ANY_PARTNER) === p.id) out.push({ typeId: t.id, typeName: t.name, touchPoint: t.touchPoint, slot: i + 1, label: sl.label, advertiser: sl.advertiser });
    }));
    return out;
  }, [types, p.id]);

  const missing = p.system ? [] : missingCreds(p.provider, p.creds);
  const missingBidder = p.system || !isDsp(p) || prov?.apiTier === 2 ? [] : BIDDER_FIELDS.filter((f) => f.required && !String((p.bidder || {})[f.key] || "").trim()).map((f) => f.label);
  const canConnect = missing.length === 0;

  const addPartner = (providerKey) => {
    const def = DSP_PROVIDERS[providerKey];
    const id = uid(`p_${providerKey}`);
    setPartners([...partners, mkPartner({ id, provider: providerKey, name: def.label, status: "draft", creds: { ...(def.defaults || {}) }, currency: (def.defaults || {}).currency || "GBP", targeting: { enabledAttributes: ATTRIBUTE_REGISTRY.filter((a) => !a.visitor && !a.contributedBy).map((a) => a.key) } })]);
    setSel(id); setAdding(null);
  };
  const listMutators = (src, write) => ({
    add: (listKey, otherKey, name) => {
      const n = (name || "").trim(); if (!n) return;
      const cur = src[listKey] || []; if (cur.some((x) => x.name.toLowerCase() === n.toLowerCase())) return;
      write({ [listKey]: [...cur, { id: uid("l"), name: n }], [otherKey]: (src[otherKey] || []).filter((x) => x.name.toLowerCase() !== n.toLowerCase()) });
    },
    remove: (listKey, id) => write({ [listKey]: (src[listKey] || []).filter((x) => x.id !== id) }),
  });
  const companyMut = listMutators(companyLists, (patch) => setCompanyLists({ ...companyLists, ...patch }));
  const partnerMut = listMutators(p || {}, setP);
  const unlinkLists = () => setP({ listsLinked: false, allowList: companyLists.allowList.map((x) => ({ ...x, id: `l${x.id}` })), blockList: companyLists.blockList.map((x) => ({ ...x, id: `l${x.id}` })) });
  const relinkLists = () => setP({ listsLinked: true, allowList: [], blockList: [] });
  const disconnect = () => setP({ status: "draft", lastSync: null, seats: [] });
  const connect = () => setP({ status: "connected", lastSync: "Just now", seats: p.seats.length ? p.seats : [{ id: uid("s"), name: "New advertiser", approvalRequired: true }] });
  const alreadyAdded = (k) => partners.some((x) => x.provider === k);

  return (
    <div style={{ display: "flex", gap: 20, alignItems: "flex-start" }}>
      {/* ------------------------------------------------ partner list */}
      <div style={{ width: 260, flexShrink: 0 }}>
        <SectionLabel style={{ marginTop: 0 }}>Company</SectionLabel>
        <ListCard active={onExchange} onClick={() => { setSel(EXCHANGE); setAdding(null); }} icon="storefront" title="Exchange settings" sub={`${(exchange.client && exchange.client.name) || "Client"} is seller of record · OpenRTB ${exchange.openRtb.version}`} />
        <ListCard active={onCompany} onClick={() => { setSel(COMPANY_LISTS); setAdding(null); }} icon="rule" title="Advertiser lists" sub={`${companyLists.allowList.length} allowed · ${companyLists.blockList.length} blocked · ${partners.filter((x) => isDsp(x) && x.listsLinked !== false).length} adopting`} />

        <SectionLabel>Connected partners</SectionLabel>
        {partners.map((x) => {
          const st = STATUS_STYLE[x.status] || STATUS_STYLE.draft; const pr = providerOf(x);
          const a = !onCompany && !onExchange && x.id === p.id;
          return (
            <div key={x.id} onClick={() => { setSel(x.id); setAdding(null); }} style={{ padding: "10px 12px", marginBottom: 6, borderRadius: 6, cursor: "pointer", border: `1px solid ${a ? T.primary : T.borderSubtle}`, background: a ? T.primaryTint : "#fff" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Icon name={pr ? pr.icon : "inventory_2"} size={18} style={{ color: pr ? pr.colour : T.micro }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{x.name}</div>
                  <div style={{ fontSize: 11, color: T.micro }}>{pr ? `${pr.sub} · tier ${pr.apiTier}` : "No DSP in the path"}</div>
                </div>
                <Icon name={st.icon} size={15} style={{ color: st.colour }} />
              </div>
              {isDsp(x) && <div style={{ fontSize: 10.5, color: x.listsLinked !== false ? T.primary : T.warning, marginTop: 4, display: "flex", alignItems: "center", gap: 4 }}><Icon name={x.listsLinked !== false ? "link" : "link_off"} size={12} />{x.listsLinked !== false ? "Adopts company lists" : "Own advertiser lists"}</div>}
            </div>
          );
        })}

        <SectionLabel>Add a partner DSP</SectionLabel>
        <div style={{ fontSize: 11.5, color: T.micro, marginBottom: 8, lineHeight: 1.5 }}>Tier 1 — the DSP's own published interface, in onboarding order (REQUIREMENTS §7).</div>
        {ONBOARDING_ORDER.map((k) => [k, DSP_PROVIDERS[k]]).map(([k, def]) => (
          <div key={k} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", marginBottom: 6, border: `1px dashed ${T.border}`, borderRadius: 6, opacity: alreadyAdded(k) ? 0.5 : 1 }}>
            <span style={{ width: 16, fontSize: 11, color: T.micro, textAlign: "center", flexShrink: 0 }}>{ONBOARDING_ORDER.indexOf(k) + 1}</span>
            <Icon name={def.icon} size={18} style={{ color: def.colour }} />
            <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 13 }}>{def.label}</div><div style={{ fontSize: 11, color: T.micro }}>{def.sub}</div></div>
            <Btn variant="text" style={{ height: 26, fontSize: 12, padding: "0 8px" }} disabled={alreadyAdded(k)} onClick={() => setAdding(k)}>{alreadyAdded(k) ? "Added" : "Add"}</Btn>
          </div>
        ))}
        <div style={{ fontSize: 11.5, color: T.micro, margin: "10px 0 8px", lineHeight: 1.5 }}>Tier 2 — PH-native, per bilateral agreement. Strictly additive to tier 1.</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", border: `1px dashed ${T.aiViolet}`, borderRadius: 6 }}>
          <Icon name="handshake" size={18} style={{ color: T.aiViolet }} />
          <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 13 }}>PH-native partner</div><div style={{ fontSize: 11, color: T.micro }}>Direct / local — e.g. Blackmores</div></div>
          <Btn variant="text" style={{ height: 26, fontSize: 12, padding: "0 8px" }} onClick={() => setAdding("ph_native")}>Add</Btn>
        </div>
      </div>

      {/* ------------------------------------------------ detail */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {onExchange ? <ExchangePanel exchange={exchange} setExchange={setExchange} partners={partners} companyLists={companyLists} />
        : onCompany ? <CompanyListsPanel lists={companyLists} mut={companyMut} partners={partners} onOpenPartner={(id) => setSel(id)} />
        : adding ? <AddPartnerCard providerKey={adding} onCancel={() => setAdding(null)} onAdd={() => addPartner(adding)} />
        : (
          <>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
              <Icon name={prov ? prov.icon : "inventory_2"} size={26} style={{ color: prov ? prov.colour : T.micro, marginTop: 2 }} />
              <div style={{ flex: 1, minWidth: 200 }}>
                {p.system ? <div style={{ fontSize: 16, fontWeight: 600 }}>{p.name}</div> : <input value={p.name} onChange={(e) => setP({ name: e.target.value })} style={{ ...inputStyle, fontSize: 16, fontWeight: 600, height: 34 }} />}
                <div style={{ fontSize: 12, color: T.muted, marginTop: 4 }}>{prov ? prov.sub : "Advertisers sold direct, with no DSP in the path."}{p.lastSync && <> · {p.lastSync}</>}</div>
              </div>
              {prov && <Pill color={prov.apiTier === 2 ? T.aiViolet : T.text} bg="#fff" border={prov.apiTier === 2 ? T.aiViolet : T.border}>API tier {prov.apiTier}</Pill>}
              <Pill color={STATUS_STYLE[p.status].colour} bg="#fff" border={STATUS_STYLE[p.status].colour}><Icon name={STATUS_STYLE[p.status].icon} size={13} />{STATUS_STYLE[p.status].label}</Pill>
            </div>

            {p.system ? (
              <Callout tone="info" icon="inventory_2" style={{ marginTop: 16 }}>The house book. Advertisers sold direct by the commercial team, with no DSP and no auction — a position reserved here is filled from that advertiser's own campaigns. No credentials, cannot be disconnected.</Callout>
            ) : (
              <>
                <SectionLabel>Connection credentials{prov.apiTier === 1 && <span style={{ textTransform: "none", letterSpacing: 0 }}> — outbound (account path)</span>}</SectionLabel>
                <div style={{ fontSize: 12, color: T.muted, lineHeight: 1.6, marginBottom: 12 }}>{prov.blurb}</div>
                <Grid cols={2}>
                  {prov.fields.filter((f) => !f.when || f.when(p.creds)).map((f) => (
                    <Fld key={f.key} label={f.label} required={f.required} hint={f.hint}>
                      {f.type === "select" ? <select value={p.creds[f.key] || ""} onChange={(e) => setCred(f.key, e.target.value)} style={ctl}>{f.options.map((o) => <option key={o}>{o}</option>)}</select>
                      : f.multiline ? <textarea value={p.creds[f.key] || ""} onChange={(e) => setCred(f.key, e.target.value)} placeholder={f.placeholder} rows={3} style={{ ...ctl, height: "auto", fontFamily: MONO, fontSize: 12, resize: "vertical" }} />
                      : <div style={{ position: "relative" }}>
                          <input type={f.secret && !reveal[f.key] ? "password" : "text"} value={p.creds[f.key] || ""} onChange={(e) => setCred(f.key, e.target.value)} placeholder={f.placeholder} style={{ ...ctl, paddingRight: f.secret ? 34 : 11, fontFamily: f.secret ? MONO : FONT }} />
                          {f.secret && <Icon name={reveal[f.key] ? "visibility_off" : "visibility"} size={16} onClick={() => setReveal({ ...reveal, [f.key]: !reveal[f.key] })} style={{ position: "absolute", right: 9, top: 8, color: T.micro, cursor: "pointer" }} />}
                        </div>}
                    </Fld>
                  ))}
                </Grid>
                <div style={{ fontSize: 11.5, color: T.micro, marginTop: 4, fontFamily: MONO }}>Scope: {prov.scope}</div>
                <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap", alignItems: "center" }}>
                  <Btn variant="primary" disabled={!canConnect} onClick={connect} title={canConnect ? undefined : `Missing: ${missing.join(", ")}`}><Icon name="link" size={16} />{p.status === "connected" ? "Re-test connection" : "Connect"}</Btn>
                  {p.status !== "draft" && <Btn onClick={disconnect}><Icon name="link_off" size={16} />Disconnect</Btn>}
                  {!canConnect && <span style={{ fontSize: 12, color: T.error, display: "inline-flex", alignItems: "center", gap: 5 }}><Icon name="error" size={14} />Missing {missing.join(", ")}</span>}
                </div>
                <Note>Credentials are held once, on the partner — never on a display type or a slot. Rotating a key here fixes every position at once.{prov.apiTier === 1 && <> This is the <b>outbound</b> path: deal setup, seat discovery and reporting reconciliation. Demand itself arrives inbound, below.</>}</Note>

                {prov.apiTier === 1 && (
                  <>
                    <SectionLabel>Bidder integration — inbound (the bidding path)</SectionLabel>
                    <div style={{ fontSize: 12, color: T.muted, lineHeight: 1.6, marginBottom: 12 }}>Personalisation Hub is the exchange, so bidding runs the other way to the credentials above: we send the OpenRTB bid request to {p.name} and they bid back. Seat IDs are what the advertiser blacklist is matched against <b>on the bid</b>, before a win rather than after it.</div>
                    <Grid cols={2}>
                      {BIDDER_FIELDS.map((f) => <Fld key={f.key} label={f.label} required={f.required} hint={f.hint}><input value={(p.bidder || {})[f.key] || ""} onChange={(e) => setP({ bidder: { ...(p.bidder || {}), [f.key]: e.target.value } })} placeholder={f.placeholder} style={ctl} /></Fld>)}
                    </Grid>
                    {missingBidder.length > 0 ? <Callout tone="warning">Cannot receive bids yet — missing {missingBidder.join(", ")}. Positions sold through this partner fall back to Headquarters until then.</Callout>
                      : <Callout tone="success">Receives bid requests. Every request carries the <code>SupplyChain</code> object and venue/screen context from Exchange settings; every response is checked against floor, categories and the blacklist before it can win.</Callout>}
                    <SectionLabel>Deals</SectionLabel>
                    {(p.deals || []).length === 0 ? <Empty icon="handshake">No deal IDs yet. Preferred and programmatic-guaranteed buys carry the early revenue while open-auction fill is thin.</Empty> : (
                      <Table cols="1.4fr 1.2fr 100px 40px" header={["Deal ID", "Kind", "CPM", ""]}>
                        {p.deals.map((d, i) => <TRow key={d.id} cols="1.4fr 1.2fr 100px 40px" last={i === p.deals.length - 1}><TCell mono>{d.dealId}</TCell><TCell muted>{d.kind}</TCell><TCell>{d.cpm ? `${p.currency} ${d.cpm.toFixed(2)}` : "—"}</TCell><TCell><Icon name="close" size={15} style={{ cursor: "pointer", color: T.muted }} onClick={() => setP({ deals: p.deals.filter((x) => x.id !== d.id) })} /></TCell></TRow>)}
                      </Table>
                    )}
                    <Btn variant="text" style={{ paddingLeft: 0, marginTop: 6 }} onClick={() => setP({ deals: [...(p.deals || []), { id: uid("d"), dealId: `PH-${(p.provider || "").toUpperCase().slice(0, 5)}-PD-${String((p.deals || []).length + 1).padStart(4, "0")}`, kind: "Preferred deal", cpm: p.floorCpm || 5 }] })}><Icon name="add" size={16} />Add deal ID</Btn>
                  </>
                )}

                <SectionLabel>Inventory rules — applied pre-auction</SectionLabel>
                <Grid cols={3}>
                  <Fld label="Auction type"><select value={p.auctionType} onChange={(e) => setP({ auctionType: e.target.value })} style={ctl}>{AUCTION_TYPES.map((a) => <option key={a}>{a}</option>)}</select></Fld>
                  <Fld label="Floor price (CPM)" hint="Bids below the floor never win the position."><input type="number" step="0.10" value={p.floorCpm ?? ""} onChange={(e) => setP({ floorCpm: e.target.value === "" ? null : Number(e.target.value) })} placeholder="No floor" style={ctl} /></Fld>
                  <Fld label="Currency"><select value={p.currency} onChange={(e) => setP({ currency: e.target.value })} style={ctl}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select></Fld>
                </Grid>
                <Fld label="Permitted categories" hint="Empty means every category this partner offers is eligible."><Chips options={IAB_CATEGORIES} value={p.categories} onChange={(v) => setP({ categories: v })} disabledSet={p.exclusions} /></Fld>
                <div style={{ height: 14 }} />
                <Fld label="Competitive exclusions" hint="Blocked outright, whatever the bid. Overrides the permitted list."><Chips options={IAB_CATEGORIES} value={p.exclusions} onChange={(v) => setP({ exclusions: v, categories: p.categories.filter((c) => !v.includes(c)) })} tone={T.error} /></Fld>
              </>
            )}

            {/* --------------------- targeting permissions */}
            <SectionLabel>Targeting attributes this partner may use</SectionLabel>
            <TargetingPermissions p={p} setP={setP} />

            {/* --------------------- lists */}
            {isDsp(p) && (() => {
              const eff = effectiveLists(p, companyLists);
              return (
                <>
                  <SectionLabel>Advertiser whitelist / blacklist</SectionLabel>
                  <Callout tone={eff.linked ? "info" : "warning"} icon={eff.linked ? "link" : "link_off"} style={{ marginBottom: 12 }}
                    action={eff.linked ? <Btn variant="outline" style={{ height: 28, fontSize: 12.5 }} onClick={unlinkLists}><Icon name="link_off" size={15} />Unlink and edit</Btn> : <Btn style={{ height: 28, fontSize: 12.5 }} onClick={relinkLists}><Icon name="link" size={15} />Relink to company lists</Btn>}>
                    {eff.linked ? <><b>Adopting the company advertiser lists.</b> Edits made centrally reach this partner automatically. Unlink to keep a different set here — unlinking copies today's lists down, so nothing silently empties.</> : <><b>Unlinked — this partner keeps its own lists.</b> Changes to the company lists no longer reach it. Relinking discards what is below.</>}
                  </Callout>
                  <Grid cols={2}>
                    <ListEditor label="Whitelist — only these may win" tone={T.success} icon="verified" readOnly={eff.linked} items={eff.allowList} suggestions={p.seats || []} onAdd={(n) => partnerMut.add("allowList", "blockList", n)} onRemove={(id) => partnerMut.remove("allowList", id)} empty="Empty — a position set to whitelist-only would never fill." />
                    <ListEditor label="Blacklist — these may never win" tone={T.error} icon="block" readOnly={eff.linked} items={eff.blockList} suggestions={p.seats || []} onAdd={(n) => partnerMut.add("blockList", "allowList", n)} onRemove={(id) => partnerMut.remove("blockList", id)} empty="Empty — nothing is blocked on this partner." />
                  </Grid>
                  <Note>An advertiser cannot sit on both lists. <b>The blacklist always applies</b> — subtracted from every outcome on the bid, using the seat or advertiser identity in the bid response; no position can opt out. Blocking an advertiser withdraws it from every picker and flags any position already reserved to it.</Note>
                </>
              );
            })()}

            {/* --------------------- seats & approval */}
            <SectionLabel>Advertisers on this partner</SectionLabel>
            {p.status !== "connected" && !p.system ? <Empty icon="sell">Advertisers are pulled from the partner on connect. Connect first, or the slot picker has nothing to reserve a position to.</Empty> : (
              <>
                <Table cols="1.6fr 150px 1fr 40px" header={["Advertiser", "Approval required", "Effect", ""]}>
                  {p.seats.map((a, i) => {
                    const blocked = isDsp(p) && isBlocked(a.name, effectiveLists(p, companyLists));
                    return (
                      <TRow key={a.id} cols="1.6fr 150px 1fr 40px" last={i === p.seats.length - 1}>
                        <TCell><span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Icon name="sell" size={14} style={{ color: partnerColour(p) }} />{a.name}{blocked && <Pill color={T.error} bg="rgba(255,77,79,0.08)"><Icon name="block" size={11} />blocked</Pill>}</span></TCell>
                        <TCell><div style={{ display: "flex", alignItems: "center", gap: 8 }}><Toggle on={!!a.approvalRequired} onChange={(v) => setP({ seats: p.seats.map((s) => (s.id === a.id ? { ...s, approvalRequired: v } : s)) })} /><span style={{ fontSize: 11.5, color: T.muted }}>{a.approvalRequired ? "Set" : "Not set"}</span></div></TCell>
                        <TCell muted style={{ whiteSpace: "normal", fontSize: 11.5 }}>{a.approvalRequired ? "A campaign cannot publish until approved — it sits pending and is not eligible to render." : "Publish is immediate. Automated checks still apply."}</TCell>
                        <TCell><Icon name="close" size={15} style={{ cursor: "pointer", color: T.muted }} onClick={() => setP({ seats: p.seats.filter((s) => s.id !== a.id) })} /></TCell>
                      </TRow>
                    );
                  })}
                  {p.seats.length === 0 && <div style={{ padding: 12, fontSize: 12.5, color: T.muted }}>None yet.</div>}
                </Table>
                <Btn variant="text" style={{ paddingLeft: 0, marginTop: 6 }} onClick={() => setP({ seats: [...p.seats, { id: uid("s"), name: `Advertiser ${p.seats.length + 1}`, approvalRequired: true }] })}><Icon name="add" size={16} />Add advertiser</Btn>
                <Note>Advertiser creative may <b>never</b> contain price, offer terms or disclosures — those are PH-locked. A price baked into artwork is a compliance breach an automated dimension check will not catch; the approval flag is what puts a human in front of it.</Note>
              </>
            )}

            {/* --------------------- usage */}
            <SectionLabel>Positions sold through this partner</SectionLabel>
            {usage.length === 0 ? <Empty icon="view_week">No display type has an advertiser position pointing here yet. Cap a rotation on a display type, set a position's owner to <b>Advertiser</b>, then name this partner.</Empty> : (
              <Table cols="1fr 130px 60px 1fr 70px" header={["Display type", "Touch point", "Slot", "Position", ""]}>
                {usage.map((u, i) => (
                  <TRow key={i} cols="1fr 130px 60px 1fr 70px" last={i === usage.length - 1}>
                    <TCell>{u.typeName}</TCell>
                    <TCell muted><span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><Icon name={tpIcon(u.touchPoint)} size={14} />{u.touchPoint}</span></TCell>
                    <TCell muted>{u.slot}</TCell>
                    <TCell>{u.label}<span style={{ color: !u.advertiser || u.advertiser === RTB ? ADVERTISER_COLOUR : T.muted, marginLeft: 6 }}>{!u.advertiser || u.advertiser === RTB ? "RTB" : u.advertiser}</span></TCell>
                    <TCell><Btn variant="text" style={{ height: 26, fontSize: 12, padding: 0 }} onClick={() => goToType(u.typeId)}>Open</Btn></TCell>
                  </TRow>
                ))}
              </Table>
            )}
          </>
        )}
      </div>
    </div>
  );
}

const ListCard = ({ active, onClick, icon, title, sub }) => (
  <div onClick={onClick} style={{ padding: "10px 12px", marginBottom: 6, borderRadius: 6, cursor: "pointer", border: `1px solid ${active ? T.primary : T.borderSubtle}`, background: active ? T.primaryTint : "#fff" }}>
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <Icon name={icon} size={18} style={{ color: active ? T.primary : T.micro }} />
      <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 13.5, fontWeight: 500 }}>{title}</div><div style={{ fontSize: 11, color: T.micro, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sub}</div></div>
    </div>
  </div>
);

/* Per-partner attribute enablement against the same registry Live Visitor
   Profile owns. Visitor attributes are off by default. */
function TargetingPermissions({ p, setP }) {
  const enabled = new Set(p.targeting?.enabledAttributes || []);
  const toggleAttr = (k) => { const n = new Set(enabled); n.has(k) ? n.delete(k) : n.add(k); setP({ targeting: { ...(p.targeting || {}), enabledAttributes: [...n] } }); };
  const vocab = permittedVocabulary(p);
  return (
    <>
      <div style={{ fontSize: 12, color: T.muted, lineHeight: 1.6, marginBottom: 10 }}>
        Managed against the Live Visitor Profile registry. <b>Partners submit predicates; PH evaluates and decides</b> — no attribute value is ever returned, and a match resolves only to matched / not matched. What this partner sees from <code>GET /v1/targeting/attributes</code> is the {vocab.length}-attribute vocabulary below, never a rejection.
      </div>
      {Object.entries(ATTRIBUTE_FAMILIES).map(([fk, fam]) => {
        const attrs = ATTRIBUTE_REGISTRY.filter((a) => a.family === fk);
        return (
          <div key={fk} style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}><Icon name={fam.icon} size={15} style={{ color: fk === "visitor" ? T.error : T.primary }} /><b>{fam.label}</b><span style={{ color: T.micro }}>— {fam.hint}</span></div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {attrs.map((a) => {
                const own = a.contributedBy === p.id;
                const foreign = a.contributedBy && !own;
                const on = own || enabled.has(a.key);
                return (
                  <span key={a.key} onClick={() => !own && toggleAttr(a.key)} title={foreign ? `Contributed by another partner — private to it by default (open question 31)` : a.key}
                    style={{ cursor: own ? "default" : "pointer", display: "inline-flex", alignItems: "center", gap: 4, height: 24, padding: "0 10px", borderRadius: 9999, fontSize: 12, opacity: foreign && !on ? 0.5 : 1,
                             border: `1px solid ${on ? (a.visitor ? T.error : own ? T.aiViolet : T.primary) : T.border}`, background: on ? (a.visitor ? "rgba(255,77,79,0.08)" : own ? "rgba(151,71,255,0.10)" : T.primaryTint) : "#fff", color: on ? (a.visitor ? T.error : own ? T.aiViolet : T.primary) : T.text }}>
                    {on && <Icon name={own ? "upload" : "check"} size={13} />}{a.label}{own && <span style={{ fontSize: 10, color: T.micro }}> · contributed</span>}
                  </span>
                );
              })}
            </div>
          </div>
        );
      })}
      <Note>A partner can also <b>contribute</b> the attribute it wants to target — weather and stock arrive this way today, as ordinary Live Visitor Profile connectors, namespaced and private to the contributor. PH is expected to take weather and stock over as defaults later (stock via the Products & Assets program).</Note>
    </>
  );
}

/* Company-level: the exchange itself (REQUIREMENTS §7). */
function ExchangePanel({ exchange, setExchange, partners, companyLists }) {
  const set = (patch) => setExchange({ ...exchange, ...patch });
  const setClient = (k, v) => set({ client: { ...exchange.client, [k]: v } });
  const setSj = (k, v) => set({ sellersJson: { ...exchange.sellersJson, [k]: v } });
  const client = exchange.client || { name: "", domain: "", contactEmail: "" };
  const bidders = partners.filter((p) => isDsp(p) && providerOf(p)?.apiTier === 1);
  const ready = bidders.filter((p) => p.status === "connected" && BIDDER_FIELDS.filter((f) => f.required).every((f) => String((p.bidder || {})[f.key] || "").trim()));
  const domain = client.domain || "<client-domain>";
  const sellersJson = { contact_email: client.contactEmail || undefined, version: "1.0", sellers: [{ seller_id: exchange.sellersJson.sellerId, name: exchange.sellersJson.isConfidential ? undefined : client.name, domain: exchange.sellersJson.isConfidential ? undefined : client.domain, seller_type: exchange.sellersJson.sellerType, is_confidential: exchange.sellersJson.isConfidential ? 1 : 0 }] };
  const schain = { complete: 1, ver: "1.0", nodes: [{ asi: client.domain, sid: exchange.sellersJson.sellerId, hp: exchange.supplyChain.hp }] };
  const incomplete = !client.name || !client.domain || !exchange.sellersJson.sellerId;
  return (
    <>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <Icon name="storefront" size={26} style={{ color: T.primary, marginTop: 2 }} />
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 16, fontWeight: 600 }}>Exchange settings</div>
          <div style={{ fontSize: 12, color: T.muted, marginTop: 4 }}>This instance of Personalisation Hub runs inside <b>{client.name || "your"}</b>'s own VPC. {client.name || "The client"} owns the screens, is the <b>seller of record</b> and operates the exchange that DSPs bid into. Personalisation Hub is the software, not a party to the sale — fill this in for the organisation running this instance.</div>
        </div>
        <Pill color={ready.length ? T.success : T.warning} bg="#fff" border={ready.length ? T.success : T.warning}><Icon name="ads_click" size={13} />{ready.length} of {bidders.length} bidders receiving requests</Pill>
      </div>

      <SectionLabel>Seller of record — this organisation</SectionLabel>
      <div style={{ fontSize: 12, color: T.muted, lineHeight: 1.6, marginBottom: 12 }}>Buyers validate <code>sellers.json</code> and the <code>SupplyChain</code> object on every bid request before they will spend at scale; neither is optional. Both are generated from the details below and published under the client's own domain, so the buyer sees the client — not Personalisation Hub — as the seller.</div>
      {incomplete && <Callout tone="warning" icon="warning">Organisation name, domain and seller ID are needed before any bid request can carry a valid SupplyChain node. Until then bidders are not sent requests.</Callout>}
      <Grid cols={2}>
        <Fld label="Organisation (seller of record)" hint="The legal entity running this instance and receiving the media spend."><input value={client.name} onChange={(e) => setClient("name", e.target.value)} placeholder="e.g. Demo Retail Group" style={ctl} /></Fld>
        <Fld label="Domain" hint="sellers.json is published here and becomes the SupplyChain asi."><input value={client.domain} onChange={(e) => setClient("domain", e.target.value)} placeholder="e.g. demoretail.example" style={{ ...ctl, fontFamily: MONO }} /></Fld>
        <Fld label="Seller ID" hint="The client's own identifier for itself as a seller; becomes the SupplyChain sid."><input value={exchange.sellersJson.sellerId} onChange={(e) => setSj("sellerId", e.target.value)} style={{ ...ctl, fontFamily: MONO }} /></Fld>
        <Fld label="Ad-ops contact email" hint="Published as contact_email in sellers.json."><input value={client.contactEmail} onChange={(e) => setClient("contactEmail", e.target.value)} placeholder="adops@…" style={ctl} /></Fld>
        <Fld label="Seller type"><select value={exchange.sellersJson.sellerType} onChange={(e) => setSj("sellerType", e.target.value)} style={ctl}>{["PUBLISHER", "INTERMEDIARY", "BOTH"].map((o) => <option key={o}>{o}</option>)}</select></Fld>
        <Fld label="Confidential listing"><div style={{ display: "flex", alignItems: "center", gap: 8, height: 32 }}><Toggle on={exchange.sellersJson.isConfidential} onChange={(v) => setSj("isConfidential", v)} /><span style={{ fontSize: 12, color: T.muted }}>Hide name and domain in the published file</span></div></Fld>
      </Grid>
      <Grid cols={2}>
        <Fld label={<span>Published at <code>https://{domain}/sellers.json</code></span>}><JsonBlock value={sellersJson} maxHeight={200} /></Fld>
        <Fld label="SupplyChain object on every bid request"><JsonBlock value={schain} maxHeight={200} /></Fld>
      </Grid>

      <SectionLabel>Bid request — OpenRTB DOOH</SectionLabel>
      <Grid cols={4}>
        <Fld label="OpenRTB version" hint="To confirm against each DSP's current supply docs."><select value={exchange.openRtb.version} onChange={(e) => set({ openRtb: { ...exchange.openRtb, version: e.target.value } })} style={ctl}>{["2.5", "2.6", "3.0"].map((v) => <option key={v}>{v}</option>)}</select></Fld>
        <Fld label="DOOH object"><div style={{ display: "flex", alignItems: "center", gap: 8, height: 32 }}><Toggle on={exchange.openRtb.dooh} onChange={(v) => set({ openRtb: { ...exchange.openRtb, dooh: v } })} /><span style={{ fontSize: 12, color: T.muted }}>Venue & moment, no user ID</span></div></Fld>
        <Fld label="Venue taxonomy"><select value={exchange.openRtb.venueTaxonomy} onChange={(e) => set({ openRtb: { ...exchange.openRtb, venueTaxonomy: e.target.value } })} style={ctl}>{["OpenOOH 1.1.0", "OpenOOH 1.2.0"].map((v) => <option key={v}>{v}</option>)}</select></Fld>
        <Fld label="Impression multiplier"><div style={{ display: "flex", alignItems: "center", gap: 8, height: 32 }}><Toggle on={exchange.openRtb.impressionMultiplier} onChange={(v) => set({ openRtb: { ...exchange.openRtb, impressionMultiplier: v } })} /><span style={{ fontSize: 12, color: T.muted }}><code>imp.qty</code> on requests</span></div></Fld>
      </Grid>
      <Callout tone="info" icon="privacy_tip">A DOOH bid request describes a <b>venue and a moment</b>, not a person: no cookies, no device graph, no user ID. Everything the sell side evaluates about a visitor is resolved inside the client's own instance and never crosses into the exchange.</Callout>

      <SectionLabel>Pre-auction enforcement — applied before a bid can win</SectionLabel>
      {[["floor", "Floor price", "Per partner. Bids below the floor are discarded."], ["categories", "Permitted categories & competitive exclusions", "Per partner. A creative outside the permitted set never wins."], ["blocklist", "Advertiser blacklist on the bid", `Company lists (${companyLists.blockList.length} blocked) matched against the seat / advertiser identity in the bid response. Applying it after a win is a credit note, not brand safety.`], ["venueExclusions", "Venue & category exclusions", "Positions in excluded venue types are never offered."]].map(([k, l, h]) => (
        <ToggleRow key={k} label={l} hint={h} on={exchange.preAuction[k]} onChange={(v) => set({ preAuction: { ...exchange.preAuction, [k]: v } })} icon={{ floor: "price_check", categories: "category", blocklist: "block", venueExclusions: "location_off" }[k]} />
      ))}

      <SectionLabel>Play window, audience and reporting</SectionLabel>
      <Grid cols={3}>
        <Fld label="Play window (hours)" hint="Open question 27. The auction clears ahead of the window so assets can be distributed and cached."><input type="number" value={exchange.playWindowHours} onChange={(e) => set({ playWindowHours: Number(e.target.value) })} style={ctl} /></Fld>
        <Fld label="Audience currency" hint="Open question 34 — whether a sensor-derived multiplier is tradeable or only reportable.">
          <select value={exchange.audienceCurrency} onChange={(e) => set({ audienceCurrency: e.target.value })} style={ctl}><option value="sensor_where_available">Counted (Vision/AI, MIST) where available, modelled otherwise</option><option value="modelled_only">Modelled only</option></select>
        </Fld>
        <Fld label="Partner reporting floor (N plays)" hint="Open question 30. Segments below N are not disclosed per trigger — thin segments repeatedly queried are an inference channel."><input type="number" value={exchange.reportingFloorN} onChange={(e) => set({ reportingFloorN: Number(e.target.value) })} style={ctl} /></Fld>
      </Grid>

      <SectionLabel>Bidders</SectionLabel>
      <Table cols="1.4fr 1.6fr 90px 90px 110px" header={["Partner", "Endpoint", "QPS", "Timeout", "State"]}>
        {bidders.map((p, i) => {
          const ok = ready.includes(p);
          return <TRow key={p.id} cols="1.4fr 1.6fr 90px 90px 110px" last={i === bidders.length - 1}>
            <TCell><span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Icon name={providerOf(p).icon} size={15} style={{ color: providerOf(p).colour }} />{p.name}</span></TCell>
            <TCell mono muted>{p.bidder?.bidderEndpoint || "—"}</TCell><TCell muted>{p.bidder?.qps || "—"}</TCell><TCell muted>{p.bidder?.timeoutMs ? `${p.bidder.timeoutMs} ms` : "—"}</TCell>
            <TCell><Pill color={ok ? T.success : T.warning} bg="#fff" border={ok ? T.success : T.warning}>{ok ? "Receiving" : "Not ready"}</Pill></TCell>
          </TRow>;
        })}
        {bidders.length === 0 && <div style={{ padding: 12, fontSize: 12.5, color: T.muted }}>No tier-1 DSP added yet.</div>}
      </Table>
      <Note>Each buyer also requires a test / certification period against live traffic before real spend, and a QPS ceiling the exchange must respect. What differs between DV360, Amazon and The Trade Desk is the onboarding process, not the protocol.</Note>
    </>
  );
}

function CompanyListsPanel({ lists, mut, partners, onOpenPartner }) {
  const dsps = partners.filter(isDsp);
  const adopting = dsps.filter((x) => x.listsLinked !== false);
  const own = dsps.filter((x) => x.listsLinked === false);
  return (
    <>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <Icon name="rule" size={26} style={{ color: T.primary, marginTop: 2 }} />
        <div style={{ flex: 1, minWidth: 200 }}><div style={{ fontSize: 16, fontWeight: 600 }}>Company advertiser lists</div><div style={{ fontSize: 12, color: T.muted, marginTop: 4 }}>Defined once and adopted by every connected DSP that has not unlinked.</div></div>
        <Pill color={T.primary} bg="#fff" border={T.primary}><Icon name="link" size={13} />{adopting.length} of {dsps.length} adopting</Pill>
      </div>
      <SectionLabel>Lists</SectionLabel>
      <Grid cols={2}>
        <ListEditor label="Whitelist — only these may win" tone={T.success} icon="verified" items={lists.allowList} suggestions={[]} onAdd={(n) => mut.add("allowList", "blockList", n)} onRemove={(id) => mut.remove("allowList", id)} empty="Empty — a position set to whitelist-only would never fill." />
        <ListEditor label="Blacklist — these may never win" tone={T.error} icon="block" items={lists.blockList} suggestions={[]} onAdd={(n) => mut.add("blockList", "allowList", n)} onRemove={(id) => mut.remove("blockList", id)} empty="Empty — nothing is blocked anywhere by default." />
      </Grid>
      <Note>A DSP's advertiser universe is not enumerable from here, so type any name. An advertiser cannot sit on both lists. <b>The blacklist always applies</b> wherever these lists are adopted — subtracted from open bidding and from the whitelist alike — and no position can opt out of it. The whitelist is the part a position chooses to use.</Note>
      <SectionLabel>Where these apply</SectionLabel>
      {dsps.length === 0 ? <Empty>No DSP partner connected yet. A partner added later adopts these lists automatically.</Empty> : (
        <div style={{ border: `1px solid ${T.borderSubtle}`, borderRadius: 6, overflow: "hidden" }}>
          {dsps.map((x, i) => {
            const linked = x.listsLinked !== false; const eff = effectiveLists(x, lists);
            return (
              <div key={x.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", fontSize: 12.5, borderBottom: i < dsps.length - 1 ? `1px solid ${T.borderSubtle}` : "none" }}>
                <Icon name={providerOf(x).icon} size={17} style={{ color: providerOf(x).colour }} />
                <span style={{ flex: 1, minWidth: 0 }}>{x.name}</span>
                <span style={{ color: linked ? T.primary : T.warning, display: "inline-flex", alignItems: "center", gap: 5 }}><Icon name={linked ? "link" : "link_off"} size={14} />{linked ? "Adopting" : "Own lists"}</span>
                <span style={{ color: T.micro, width: 128, textAlign: "right" }}>{eff.allowList.length} allowed · {eff.blockList.length} blocked</span>
                <Btn variant="text" style={{ height: 26, fontSize: 12, padding: 0 }} onClick={() => onOpenPartner(x.id)}>Open</Btn>
              </div>
            );
          })}
        </div>
      )}
      {own.length > 0 && <Note>{own.length === 1 ? `${own[0].name} has` : `${own.length} partners have`} unlinked, so nothing edited here reaches {own.length === 1 ? "it" : "them"} until relinked. That is the point of unlinking, but it is also the easy thing to forget.</Note>}
    </>
  );
}

function ListEditor({ label, tone, icon, items, suggestions, onAdd, onRemove, empty, readOnly }) {
  const [draft, setDraft] = useState("");
  const has = (n) => items.some((x) => x.name.toLowerCase() === n.trim().toLowerCase());
  const add = (name) => { const n = (name || "").trim(); if (!n || has(n)) return; onAdd(n); setDraft(""); };
  const unused = (suggestions || []).filter((sg) => !has(sg.name));
  return (
    <div style={{ border: `1px solid ${T.borderSubtle}`, borderRadius: 6, padding: 12, background: readOnly ? T.surfaceAlt : "#fff" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: tone, marginBottom: 10 }}><Icon name={icon} size={15} />{label}<span style={{ marginLeft: "auto", color: T.micro }}>{items.length}</span></div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
        {items.map((x) => <span key={x.id} style={{ display: "inline-flex", alignItems: "center", gap: 5, height: 24, padding: "0 6px 0 10px", borderRadius: 9999, fontSize: 12, border: `1px solid ${tone}`, color: tone }}>{x.name}{!readOnly && <Icon name="close" size={13} onClick={() => onRemove(x.id)} style={{ cursor: "pointer", opacity: 0.7 }} />}</span>)}
        {items.length === 0 && <span style={{ fontSize: 11.5, color: T.micro }}>{empty}</span>}
      </div>
      {readOnly ? <div style={{ fontSize: 11.5, color: T.micro, display: "flex", alignItems: "center", gap: 5 }}><Icon name="lock" size={13} />Inherited — unlink this partner to edit.</div> : (
        <div style={{ display: "flex", gap: 6 }}>
          <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(draft); } }} placeholder="Add an advertiser…" style={small} />
          <Btn variant="outline" style={{ height: 28, fontSize: 12.5, padding: "0 10px" }} disabled={!draft.trim() || has(draft)} onClick={() => add(draft)}>Add</Btn>
        </div>
      )}
      {!readOnly && unused.length > 0 && <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 8, alignItems: "center" }}><span style={{ fontSize: 11, color: T.micro }}>Seats:</span>{unused.map((sg) => <span key={sg.id} onClick={() => add(sg.name)} style={{ cursor: "pointer", fontSize: 11.5, height: 20, padding: "0 8px", borderRadius: 9999, border: `1px dashed ${T.border}`, color: T.muted, display: "inline-flex", alignItems: "center" }}>+ {sg.name}</span>)}</div>}
    </div>
  );
}

function AddPartnerCard({ providerKey, onCancel, onAdd }) {
  const def = DSP_PROVIDERS[providerKey];
  return (
    <div style={{ border: `1px solid ${T.borderSubtle}`, borderRadius: 8, overflow: "hidden" }}>
      <div style={{ padding: "12px 16px", background: T.surfaceAlt, borderBottom: `1px solid ${T.borderSubtle}`, display: "flex", alignItems: "center", gap: 10 }}>
        <Icon name={def.icon} size={20} style={{ color: def.colour }} />
        <div><div style={{ fontSize: 14, fontWeight: 500 }}>Add {def.label}</div><div style={{ fontSize: 11.5, color: T.muted }}>{def.sub}</div></div>
      </div>
      <div style={{ padding: 16 }}>
        <div style={{ fontSize: 13, color: T.muted, lineHeight: 1.6, marginBottom: 14 }}>{def.blurb}</div>
        <SectionLabel style={{ marginTop: 0 }}>You will need</SectionLabel>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.9, color: T.text }}>{def.fields.filter((f) => f.required).map((f) => <li key={f.key}>{f.label}</li>)}{def.apiTier === 1 && <li>Bidder endpoint and seat IDs (inbound path)</li>}</ul>
        <div style={{ display: "flex", gap: 8, marginTop: 18 }}><Btn variant="primary" onClick={onAdd}><Icon name="add" size={16} />Add partner</Btn><Btn onClick={onCancel}>Cancel</Btn></div>
        <Note>The partner is created as <b>Not connected</b> and stays out of the slot picker's reserved list until the credentials test, so a position can never be sold to demand that cannot be delivered. It adopts the company advertiser lists automatically.</Note>
      </div>
    </div>
  );
}
