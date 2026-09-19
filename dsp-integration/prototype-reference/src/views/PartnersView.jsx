import React, { useState, useMemo, useEffect } from "react";
import { T, MONO, FONT, Icon, Pill, Btn, SectionLabel, Note, Callout, Grid, Fld, ctl, small, inputStyle, Table, TRow, TCell, Toggle, Segmented, SubPanel, Empty, uid, ADVERTISER_COLOUR, useViewportWidth, SaveBar, InfoTip } from "../ui.jsx";
import { tpIcon } from "../model/schema.js";
import { DSP_PROVIDERS, ONBOARDING_ORDER, BIDDER_FIELDS, IAB_CATEGORIES, CURRENCIES, COMPANY_LISTS, ANY_PARTNER, RTB, ALLOW_LIST, partner as mkPartner, partnerById, providerOf, partnerColour, isDsp, missingCreds, effectiveLists, isBlocked, TARGETING_SOURCES, TARGETING_VARIABLES, ALL_DSPS, variableAccess, advertiserSetting } from "../model/sellside.js";

const STATUS_STYLE = {
  connected: { label: "Connected", colour: T.success, icon: "check_circle" },
  draft: { label: "Not connected", colour: T.micro, icon: "radio_button_unchecked" },
  error: { label: "Connection error", colour: T.error, icon: "error" },
};
const EXCHANGE = "__exchange__";
const VARIABLES = "__variables__";

/* Every ISO 4217 currency the browser knows, with its name. */
const ALL_CURRENCIES = (() => {
  let codes = [];
  try { codes = Intl.supportedValuesOf("currency"); } catch (e) { codes = CURRENCIES; }
  let dn = null;
  try { dn = new Intl.DisplayNames(["en-GB"], { type: "currency" }); } catch (e) { dn = null; }
  return codes.map((code) => ({ code, name: (dn && dn.of(code)) || code }));
})();

const bidderReady = (p) => BIDDER_FIELDS.filter((f) => f.required).every((f) => String((p.bidder || {})[f.key] || "").trim());

export default function PartnersView({ partners: savedPartners, setPartners: savePartners, companyLists: savedLists, setCompanyLists: saveLists, exchange: savedExchange, setExchange: saveExchange, types, playlists, goToType, sel, setSel: selectRaw, onDirtyChange }) {
  /* Every edit on this section goes to a draft; nothing reaches the saved
     records until Save changes. Cancel restores the saved state. */
  const [partners, setPartners] = useState(savedPartners);
  const [companyLists, setCompanyLists] = useState(savedLists);
  const [exchange, setExchange] = useState(savedExchange);
  const dirty = JSON.stringify([partners, companyLists, exchange]) !== JSON.stringify([savedPartners, savedLists, savedExchange]);
  useEffect(() => { if (onDirtyChange) onDirtyChange(dirty); }, [dirty]);
  const saveAll = () => { savePartners(partners); saveLists(companyLists); saveExchange(exchange); };
  const cancelAll = () => { setPartners(savedPartners); setCompanyLists(savedLists); setExchange(savedExchange); };
  const leaveOk = () => { if (!dirty) return true; if (!window.confirm("You have unsaved changes. Discard them?")) return false; cancelAll(); return true; };
  const setSel = (v) => { if (!leaveOk()) return; setAddingRaw(null); selectRaw(v); };
  const [adding, setAddingRaw] = useState(null);
  const setAdding = (v) => { if (v && !leaveOk()) return; setAddingRaw(v); };
  const [reveal, setReveal] = useState({});
  const canvasW = useViewportWidth();
  const listCollapsed = canvasW < 900;
  const onCompany = sel === COMPANY_LISTS;
  const onExchange = sel === EXCHANGE;
  const onVariables = sel === VARIABLES;
  const onCompanyItem = onCompany || onExchange || onVariables;
  const p = partners.find((x) => x.id === sel) || partners[0];
  const prov = providerOf(p);
  const setP = (patch) => setPartners(partners.map((x) => (x.id === p.id ? { ...x, ...patch } : x)));
  const setCred = (k, v) => setP({ creds: { ...p.creds, [k]: v } });

  const missing = p.system ? [] : missingCreds(p.provider, p.creds);
  const missingBidder = p.system || !isDsp(p) || prov?.apiTier === 2 ? [] : BIDDER_FIELDS.filter((f) => f.required && !String((p.bidder || {})[f.key] || "").trim()).map((f) => f.label);
  const canConnect = missing.length === 0;
  const canGoLive = p.status === "connected" && missingBidder.length === 0;

  const addPartner = (providerKey) => {
    const def = DSP_PROVIDERS[providerKey];
    const id = uid(`p_${providerKey}`);
    setPartners([...partners, mkPartner({ id, provider: providerKey, name: def.label, status: "draft", mode: "test", creds: { ...(def.defaults || {}) }, currency: (def.defaults || {}).currency || "GBP" })]);
    selectRaw(id); setAddingRaw(null);
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
  const disconnect = () => setP({ status: "draft", mode: "test", lastSync: null, seats: [] });
  const connect = () => setP({ status: "connected", lastSync: "Just now", seats: p.seats.length ? p.seats : [{ id: uid("s"), name: "New advertiser" }] });
  const dspRows = ONBOARDING_ORDER.map((key) => {
    const def = DSP_PROVIDERS[key];
    const x = partners.find((q) => q.provider === key) || null;
    const setUp = !!x && x.status === "connected";
    const errored = !!x && x.status === "error";
    const state = setUp ? { icon: "check_circle", colour: T.success, label: x.mode === "live" ? "Live" : "Set up · Test", setUp: true }
      : errored ? { icon: "error", colour: T.error, label: "Connection error", setUp: true }
      : { icon: "add_circle", colour: T.micro, label: x ? "Not set up yet — finish credentials" : "Not set up yet", setUp: false };
    return { key, def, partner: x, state };
  });
  const otherPartners = partners.filter((x) => !ONBOARDING_ORDER.includes(x.provider));
  const advertiserCount = new Set(partners.flatMap((x) => (x.seats || []).map((s) => s.name.toLowerCase()))).size;

  return (
    <div style={{ display: "flex", gap: 20, alignItems: "flex-start" }}>
      {/* ------------------------------------------------ partner list */}
      <div style={{ width: listCollapsed ? 64 : 260, flexShrink: 0, position: "sticky", top: 20, maxHeight: "calc(100vh - 40px)", overflowY: "auto", overflowX: "hidden", transition: "width .15s" }}>
        {!listCollapsed && <SectionLabel style={{ marginTop: 0 }}>Company</SectionLabel>}
        <ListCard collapsed={listCollapsed} active={onExchange} onClick={() => { setSel(EXCHANGE); setAdding(null); }} icon="storefront" title="Exchange settings" sub={`${(exchange.client && exchange.client.name) || "Client"} is seller of record`} />
        <ListCard collapsed={listCollapsed} active={onCompany} onClick={() => { setSel(COMPANY_LISTS); setAdding(null); }} icon="rule" title="Advertiser settings" sub={`${advertiserCount} advertisers · floor ${companyLists.currency || "AUD"} ${companyLists.floorCpm ?? "—"} CPM`} />
        <ListCard collapsed={listCollapsed} active={onVariables} onClick={() => { setSel(VARIABLES); setAdding(null); }} icon="tune" title="Shared Targeting Variables" sub={`${TARGETING_VARIABLES.length} platform variables`} />

        {!listCollapsed && <SectionLabel>Partner DSPs</SectionLabel>}
        {dspRows.map(({ key, def, partner: x, state }) => {
          const a = !onCompanyItem && (x ? x.id === p.id && !adding : adding === key);
          const onPick = () => { if (x) { setSel(x.id); } else { setAdding(key); } };
          if (listCollapsed) {
            return (
              <div key={key} onClick={onPick} title={`${x ? x.name : def.label} — ${state.label}`}
                style={{ display: "flex", justifyContent: "center", padding: "10px 0", marginBottom: 6, borderRadius: 6, cursor: "pointer", border: `1px ${x ? "solid" : "dashed"} ${a ? T.primary : x ? T.borderSubtle : T.border}`, background: a ? T.primaryTint : "#fff", opacity: x ? 1 : 0.75 }}>
                <Icon name={def.icon} size={18} style={{ color: def.colour }} />
                <Icon name={state.icon} size={12} style={{ color: state.colour, marginLeft: 4 }} />
              </div>
            );
          }
          return (
            <div key={key} onClick={onPick}
              style={{ padding: "10px 12px", marginBottom: 6, borderRadius: 6, cursor: "pointer", border: `1px ${x ? "solid" : "dashed"} ${a ? T.primary : x ? T.borderSubtle : T.border}`, background: a ? T.primaryTint : "#fff" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Icon name={def.icon} size={18} style={{ color: def.colour }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{x ? x.name : def.label}</div>
                  <div style={{ fontSize: 11, color: state.colour === T.micro ? T.micro : state.colour }}>{state.label}</div>
                </div>
                <Icon name={state.icon} size={state.icon === "add_circle" ? 17 : 15} style={{ color: state.colour }} />
              </div>
              {x && isDsp(x) && state.setUp && <div style={{ fontSize: 10.5, color: x.listsLinked !== false ? T.primary : T.warning, marginTop: 4, display: "flex", alignItems: "center", gap: 4 }}><Icon name={x.listsLinked !== false ? "link" : "link_off"} size={12} />{x.listsLinked !== false ? "Adopts company lists" : "Own advertiser lists"}</div>}
            </div>
          );
        })}
        {otherPartners.map((x) => {
          const st = STATUS_STYLE[x.status] || STATUS_STYLE.draft; const pr = providerOf(x);
          const a = !onCompanyItem && x.id === p.id && !adding;
          return (
            <div key={x.id} onClick={() => { setSel(x.id); setAdding(null); }} title={listCollapsed ? x.name : undefined}
              style={{ padding: listCollapsed ? "10px 0" : "10px 12px", marginBottom: 6, borderRadius: 6, cursor: "pointer", border: `1px solid ${a ? T.primary : T.borderSubtle}`, background: a ? T.primaryTint : "#fff" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: listCollapsed ? "center" : "flex-start" }}>
                <Icon name={pr ? pr.icon : "inventory_2"} size={18} style={{ color: pr ? pr.colour : T.micro }} />
                {!listCollapsed && <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 13.5, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{x.name}</div><div style={{ fontSize: 11, color: T.micro }}>{pr ? pr.sub : "No DSP in the path"}</div></div>}
                <Icon name={st.icon} size={listCollapsed ? 12 : 15} style={{ color: st.colour }} />
              </div>
            </div>
          );
        })}
      </div>

      {/* ------------------------------------------------ detail */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {onExchange ? <ExchangePanel exchange={exchange} setExchange={setExchange} />
        : onCompany ? <CompanyListsPanel lists={companyLists} setLists={setCompanyLists} mut={companyMut} partners={partners} types={types} playlists={playlists} onOpenPartner={(id) => setSel(id)} onOpenType={goToType} />
        : onVariables ? <VariablesPanel partners={partners} lists={companyLists} setLists={setCompanyLists} />
        : adding ? <AddPartnerCard providerKey={adding} onCancel={() => setAdding(null)} onAdd={() => addPartner(adding)} />
        : (
          <>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
              <Icon name={prov ? prov.icon : "inventory_2"} size={26} style={{ color: prov ? prov.colour : T.micro, marginTop: 2 }} />
              <div style={{ flex: 1, minWidth: 200 }}>
                {p.system ? <div style={{ fontSize: 16, fontWeight: 600 }}>{p.name}</div> : <input value={p.name} onChange={(e) => setP({ name: e.target.value })} style={{ ...inputStyle, fontSize: 16, fontWeight: 600, height: 34 }} />}
                <div style={{ fontSize: 12, color: T.muted, marginTop: 4 }}>{prov ? prov.sub : "Advertisers sold direct, with no DSP in the path."}{p.lastSync && <> · {p.lastSync}</>}</div>
              </div>
              <Pill color={STATUS_STYLE[p.status].colour} bg="#fff" border={STATUS_STYLE[p.status].colour}><Icon name={STATUS_STYLE[p.status].icon} size={13} />{STATUS_STYLE[p.status].label}</Pill>
            </div>

            {!p.system && prov && (() => {
              const issues = [];
              if (p.status === "error") issues.push({ tone: "error", icon: "error", text: <><b>Connection error:</b> {p.lastSync || "the last connection test failed"}. Re-enter the credentials below and re-test the connection.</> });
              if (missing.length) issues.push({ tone: "error", icon: "error", text: <><b>Missing credentials:</b> {missing.join(", ")}.</> });
              if (prov.apiTier === 1 && missingBidder.length) issues.push({ tone: "warning", icon: "warning", text: <><b>Cannot receive bids yet:</b> missing {missingBidder.join(", ")}.</> });
              if (issues.length === 0) return <Callout tone="success" icon="check_circle" style={{ marginTop: 16 }}>No issues — {(p.mode || "test") === "live" ? "live and receiving bid requests." : "ready to receive bid requests in Test mode."}</Callout>;
              return <div style={{ marginTop: 16 }}>{issues.map((x, i) => <Callout key={i} tone={x.tone} icon={x.icon} style={{ marginBottom: 8 }}>{x.text}</Callout>)}</div>;
            })()}

            {p.system ? (
              <Callout tone="info" icon="inventory_2" style={{ marginTop: 16 }}>The house book: advertisers sold direct, with no DSP and no auction.</Callout>
            ) : (
              <>
                {prov.apiTier === 1 && (
                  <>
                    <SectionLabel tip="Test: the DSP receives bid requests during its certification period, with no real spend. Live: winning bids play and are billed. Live is available once the DSP is connected and its bidder integration is complete.">Mode</SectionLabel>
                    <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                      <Segmented value={p.mode || "test"} onChange={(v) => { if (v === "live" && !canGoLive) return; setP({ mode: v }); }}
                        options={[{ value: "test", label: "Test", icon: "science" }, { value: "live", label: "Live", icon: "bolt", title: canGoLive ? undefined : "Connect and complete the bidder integration first" }]} />
                    </div>
                  </>
                )}

                <SectionLabel tip={prov.blurb}>Connection credentials</SectionLabel>
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
                <div style={{ display: "flex", gap: 8, marginTop: 4, flexWrap: "wrap", alignItems: "center" }}>
                  <Btn variant="primary" disabled={!canConnect} onClick={connect} title={canConnect ? undefined : `Missing: ${missing.join(", ")}`}><Icon name="link" size={16} />{p.status === "connected" ? "Re-test connection" : "Connect"}</Btn>
                  {p.status !== "draft" && <Btn onClick={disconnect}><Icon name="link_off" size={16} />Disconnect</Btn>}
                </div>

                {prov.apiTier === 1 && (
                  <>
                    <SectionLabel tip="Where we send OpenRTB bid requests for this DSP, and the seats its bids come from. QPS and timeout use platform defaults.">Bidder integration</SectionLabel>
                    <Grid cols={2}>
                      {BIDDER_FIELDS.filter((f) => !f.advanced).map((f) => <Fld key={f.key} label={f.label} required={f.required} hint={f.hint}><input value={(p.bidder || {})[f.key] || ""} onChange={(e) => setP({ bidder: { ...(p.bidder || {}), [f.key]: e.target.value } })} placeholder={f.placeholder} style={ctl} /></Fld>)}
                    </Grid>

                  </>
                )}

              </>
            )}

            {/* --------------------- lists */}
            {isDsp(p) && (() => {
              const eff = effectiveLists(p, companyLists);
              return (
                <>
                  <SectionLabel tip="The blacklist always applies and no position can opt out of it. Unlinking copies the company lists here; relinking discards this DSP's own lists.">Advertiser whitelist / blacklist</SectionLabel>
                  {eff.linked ? (
                    <Callout tone="info" icon="link"
                      action={<Btn variant="outline" style={{ height: 28, fontSize: 12.5 }} onClick={unlinkLists}><Icon name="link_off" size={15} />Unlink and edit</Btn>}>
                      <b>Centrally managed.</b> This DSP uses the company lists.{" "}
                      <span onClick={() => setSel(COMPANY_LISTS)} style={{ color: T.primary, cursor: "pointer", textDecoration: "underline" }}>View lists in Advertiser settings</span>
                    </Callout>
                  ) : (
                    <>
                      <Callout tone="warning" icon="link_off" style={{ marginBottom: 12 }}
                        action={<Btn style={{ height: 28, fontSize: 12.5 }} onClick={relinkLists}><Icon name="link" size={15} />Relink to company lists</Btn>}>
                        <b>Unlinked — this DSP has its own lists.</b> Company changes no longer reach it; relinking discards these.
                      </Callout>
                      <Grid cols={2}>
                        <ListEditor label="Whitelist — only these may win" tone={T.success} icon="verified" items={eff.allowList} suggestions={p.seats || []} onAdd={(n) => partnerMut.add("allowList", "blockList", n)} onRemove={(id) => partnerMut.remove("allowList", id)} empty="Empty — a position set to whitelist-only would never fill." />
                        <ListEditor label="Blacklist — these may never win" tone={T.error} icon="block" items={eff.blockList} suggestions={p.seats || []} onAdd={(n) => partnerMut.add("blockList", "allowList", n)} onRemove={(id) => partnerMut.remove("blockList", id)} empty="Empty — nothing is blocked on this DSP." />
                      </Grid>
                    </>
                  )}
                </>
              );
            })()}
          </>
        )}
        {!adding && <SaveBar dirty={dirty} onSave={saveAll} onCancel={cancelAll} />}
      </div>
    </div>
  );
}

const ListCard = ({ active, onClick, icon, title, sub, collapsed }) => (
  <div onClick={onClick} title={collapsed ? title : undefined}
    style={{ padding: collapsed ? "10px 0" : "10px 12px", marginBottom: 6, borderRadius: 6, cursor: "pointer", border: `1px solid ${active ? T.primary : T.borderSubtle}`, background: active ? T.primaryTint : "#fff" }}>
    <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: collapsed ? "center" : "flex-start" }}>
      <Icon name={icon} size={18} style={{ color: active ? T.primary : T.micro }} />
      {!collapsed && <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 13.5, fontWeight: 500 }}>{title}</div><div style={{ fontSize: 11, color: T.micro, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sub}</div></div>}
    </div>
  </div>
);

/* Company-level: the exchange itself. Only what a retailer must supply —
   seller type, confidentiality and the OpenRTB/DOOH options are fixed
   platform defaults. */
function ExchangePanel({ exchange, setExchange }) {
  const set = (patch) => setExchange({ ...exchange, ...patch });
  const setClient = (k, v) => set({ client: { ...exchange.client, [k]: v } });
  const setSj = (k, v) => set({ sellersJson: { ...exchange.sellersJson, [k]: v } });
  const client = exchange.client || { name: "", domain: "", contactEmail: "" };
  const incomplete = !client.name || !client.domain || !exchange.sellersJson.sellerId || !client.contactEmail;
  const url = `https://${client.domain || "<your-domain>"}/sellers.json`;
  return (
    <>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <Icon name="storefront" size={26} style={{ color: T.primary, marginTop: 2 }} />
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 16, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>Exchange settings<InfoTip text="Sets up your organisation as the seller of record for its screens. Configurable here: organisation name, domain, seller ID and ad-ops contact email, all required. Once saved and complete, sellers.json is published at https://[domain]/sellers.json and every bid request carries your domain and seller ID in its SupplyChain; until then no DSP is sent bid requests. Not configurable (platform defaults): seller type (Publisher), OpenRTB 2.6, the DOOH object, the OpenOOH venue taxonomy, QPS and bid timeout." /></div>
        </div>
        <Pill color={incomplete ? T.warning : T.success} bg="#fff" border={incomplete ? T.warning : T.success}><Icon name={incomplete ? "warning" : "check_circle"} size={13} />{incomplete ? "Incomplete" : "Published"}</Pill>
      </div>

      <SectionLabel tip="All four fields are needed before any DSP is sent bid requests.">Seller of record</SectionLabel>
      <Grid cols={2}>
        <Fld label="Organisation" required><input value={client.name} onChange={(e) => setClient("name", e.target.value)} placeholder="e.g. Demo Retail Group" style={ctl} /></Fld>
        <Fld label="Domain" required hint="sellers.json is published at https://[domain]/sellers.json and the domain is sent on every bid request."><input value={client.domain} onChange={(e) => setClient("domain", e.target.value)} placeholder="e.g. demoretail.example" style={{ ...ctl, fontFamily: MONO }} /></Fld>
        <Fld label="Seller ID" required><input value={exchange.sellersJson.sellerId} onChange={(e) => setSj("sellerId", e.target.value)} style={{ ...ctl, fontFamily: MONO }} /></Fld>
        <Fld label="Ad-ops contact email" required><input value={client.contactEmail} onChange={(e) => setClient("contactEmail", e.target.value)} placeholder="adops@…" style={ctl} /></Fld>
      </Grid>
      {incomplete
        ? <Callout tone="warning" icon="warning">Complete all four fields before any DSP can be sent bid requests.</Callout>
        : <Callout tone="success" icon="public">sellers.json is published at <code>{url}</code>.</Callout>}
    </>
  );
}

/* Company-wide advertiser settings: pricing, the advertisers using the
   platform (auto-approve and floor multiplier), lists and inventory. */
function CompanyListsPanel({ lists, setLists, mut, partners, types, playlists, onOpenPartner, onOpenType }) {
  const dsps = partners.filter(isDsp);
  const setPricing = (k, v) => setLists({ ...lists, [k]: v });
  const plName = (id) => (playlists || []).find((x) => x.id === id)?.name || "—";
  
  const inventory = useMemo(() => {
    const out = [];
    (types || []).forEach((t) => (t.phExtensions?.slots || []).forEach((sl, i) => {
      if (sl.owner !== "advertiser") return;
      const pid = sl.partnerId || ANY_PARTNER;
      const pr = pid === ANY_PARTNER ? null : partnerById(partners, pid);
      const open = !sl.advertiser || sl.advertiser === RTB;
      const allow = sl.advertiser === ALLOW_LIST;
      out.push({
        typeId: t.id, typeName: t.name, touchPoint: t.touchPoint, slot: i + 1, label: sl.label,
        playlist: plName(t.defaultPlaylistId),
        partnerName: pr ? pr.name : "Any connected DSP",
        tags: open ? [{ text: "All advertisers", all: true }]
          : allow ? [{ text: `Whitelist (${(lists.allowList || []).length})`, all: true }]
          : [{ text: sl.advertiser, all: false }],
      });
    }));
    return out;
  }, [types, partners, playlists, lists.allowList]);

  const floor = lists.floorCpm;
  const numIn = (k, step, ph) => <input type="number" step={step} value={lists[k] ?? ""} onChange={(e) => setPricing(k, e.target.value === "" ? null : Number(e.target.value))} placeholder={ph} style={ctl} />;

  return (
    <>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <Icon name="rule" size={26} style={{ color: T.primary, marginTop: 2 }} />
        <div style={{ flex: 1, minWidth: 200 }}><div style={{ fontSize: 16, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>Advertiser settings<InfoTip text="Company-wide advertiser settings, applied to every DSP. Configurable here: Pricing (currency, floor CPM, personalised and interactive multipliers) and List management (advertiser and IAB category whitelists and blacklists). Read-only here: Where these apply (which DSPs use these lists or keep their own; unlink or relink on the DSP's page) and Available Inventory (advertiser-owned slots, set on Display Types). Per-advertiser campaign approval and floor multipliers are on the Advertisers screen." /></div></div>
      </div>

      <SectionLabel tip="Multipliers stack: effective floor = floor CPM × personalised × interactive × the advertiser's floor multiplier (set on the Advertisers screen). Bids below the effective floor never win.">Pricing</SectionLabel>
      <Grid cols={4}>
        <Fld label="Currency" hint="Used for the floor CPM, every effective floor and billing. Bid requests carry it as the bid floor currency."><select value={lists.currency || "AUD"} onChange={(e) => setPricing("currency", e.target.value)} style={ctl}>{ALL_CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.code} — {c.name}</option>)}</select></Fld>
        <Fld label="Floor price (CPM)" hint="Cost per thousand assumed views (VAC-d). The minimum any bid must meet; bids below it never win.">{numIn("floorCpm", "1", "100")}</Fld>
        <Fld label="Personalised multiplier" hint="Applied when the visitor is checked in or otherwise identified, so the advert is one-to-one for that individual. Multiplies the floor CPM.">{numIn("personalisedMultiplier", "0.05", "1.5")}</Fld>
        <Fld label="Interactive multiplier" hint="Applied when the visitor interacts with the campaign and engages with the advertiser on that display, for example by scanning an interactive QR Control campaign. Multiplies the floor CPM.">{numIn("interactiveMultiplier", "0.05", "3")}</Fld>
      </Grid>

      <SectionLabel tip="Nothing can sit on both lists. The blacklist always applies and no position can opt out of it. The whitelist is only used by positions set to whitelist-only.">List management</SectionLabel>
      <Grid cols={2}>
        <ListEditor label="Advertisers — whitelist" tone={T.success} icon="verified" items={lists.allowList} suggestions={[]} onAdd={(n) => mut.add("allowList", "blockList", n)} onRemove={(id) => mut.remove("allowList", id)} empty="Empty — a position set to whitelist-only would never fill." />
        <ListEditor label="Advertisers — blacklist" tone={T.error} icon="block" items={lists.blockList} suggestions={[]} onAdd={(n) => mut.add("blockList", "allowList", n)} onRemove={(id) => mut.remove("blockList", id)} empty="Empty — nothing is blocked by default." />
        <ListEditor label="Categories — whitelist" tone={T.success} icon="category" items={lists.categoryAllowList || []} suggestions={IAB_CATEGORIES.map((c) => ({ id: c, name: c }))} onAdd={(n) => mut.add("categoryAllowList", "categoryBlockList", n)} onRemove={(id) => mut.remove("categoryAllowList", id)} empty="Empty — every category is eligible." addLabel="Add a category…" suggestLabel="Categories:" />
        <ListEditor label="Categories — blacklist" tone={T.error} icon="block" items={lists.categoryBlockList || []} suggestions={IAB_CATEGORIES.map((c) => ({ id: c, name: c }))} onAdd={(n) => mut.add("categoryBlockList", "categoryAllowList", n)} onRemove={(id) => mut.remove("categoryBlockList", id)} empty="Empty — no category is blocked by default." addLabel="Add a category…" suggestLabel="Categories:" />
      </Grid>

      <SectionLabel tip="Whether each DSP uses the company lists above or has unlinked to keep its own.">Where these apply</SectionLabel>
      {dsps.length === 0 ? <Empty>No DSP connected yet. A partner added later adopts these lists automatically.</Empty> : (
        <div style={{ border: `1px solid ${T.borderSubtle}`, borderRadius: 6, overflow: "hidden" }}>
          {dsps.map((x, i) => {
            const linked = x.listsLinked !== false;
            return (
              <div key={x.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", fontSize: 12.5, borderBottom: i < dsps.length - 1 ? `1px solid ${T.borderSubtle}` : "none" }}>
                <Icon name={providerOf(x).icon} size={17} style={{ color: providerOf(x).colour }} />
                <span style={{ flex: 1, minWidth: 0 }}>{x.name}</span>
                <span style={{ color: linked ? T.primary : T.warning, display: "inline-flex", alignItems: "center", gap: 5 }}><Icon name={linked ? "link" : "link_off"} size={14} />{linked ? "Adopting" : "Own lists"}{!linked && <InfoTip size={14} text={`Edits to the company lists don't reach ${x.name} until it is relinked.`} />}</span>
                <Btn variant="text" style={{ height: 26, fontSize: 12, padding: 0 }} onClick={() => onOpenPartner(x.id)}>Open</Btn>
              </div>
            );
          })}
        </div>
      )}

      <SectionLabel tip="Every advertiser-owned slot across the estate that connected DSPs can bid on. Slots are made available by setting their owner to Advertiser on a display type.">Available Inventory</SectionLabel>
      {inventory.length === 0 ? <Empty icon="view_week">No advertiser positions yet. Set a slot's owner to <b>Advertiser</b> on a display type.</Empty> : (
        <Table cols="1.3fr 1.2fr 46px 1fr 62px" header={["Display type", "Playlist", "Slot", "Position", ""]}>
          {inventory.map((u, i) => (
            <TRow key={`${u.typeId}-${u.slot}`} cols="1.3fr 1.2fr 46px 1fr 62px" last={i === inventory.length - 1}>
              <TCell><span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><Icon name={tpIcon(u.touchPoint)} size={14} style={{ color: T.muted }} />{u.typeName}</span></TCell>
              <TCell muted>{u.playlist}</TCell>
              <TCell muted>{u.slot}</TCell>
              <TCell>{u.label}<div style={{ fontSize: 11, color: T.micro }}>{u.partnerName}</div></TCell>
              <TCell><Btn variant="text" style={{ height: 26, fontSize: 12, padding: 0 }} onClick={() => onOpenType(u.typeId)}>Open</Btn></TCell>
            </TRow>
          ))}
        </Table>
      )}

    </>
  );
}

/* The platform's existing targeting variables — default platform variables
   only, read-only — with which DSPs may target each one. Picked from a
   multi-select (All connected DSPs, or individual DSPs) so the table scales
   as more DSPs are added. */
function VariablesPanel({ partners, lists, setLists }) {
  const dsps = partners.filter(isDsp);
  const setAccess = (key, val) => setLists({ ...lists, variableAccess: { ...(lists.variableAccess || {}), [key]: val } });
  const cols = "1.2fr 1.8fr";
  return (
    <>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <Icon name="tune" size={26} style={{ color: T.primary, marginTop: 2 }} />
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 16, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>Shared Targeting Variables<InfoTip text="Variables shared through the API with connected DSPs. Once a variable is enabled for a DSP, that DSP's advertisers can use it in targeting conditions for more advanced campaign targeting; the platform evaluates the condition and never returns the value. They are the same variables as a campaign's Targeting tab. Choose which DSPs may use each one below; default platform variables only in this release." /></div>
        </div>
      </div>
      {Object.entries(TARGETING_SOURCES).map(([sk, src]) => {
        const vars = TARGETING_VARIABLES.filter((v) => v.source === sk);
        return (
          <div key={sk}>
            <SectionLabel tip={sk === "visitor" ? "About the identified visitor, from the Visitor API. Not available to any DSP by default." : "About the store and the moment; the same for everyone in front of the screen. Available to all connected DSPs by default."}><span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Icon name={src.icon} size={15} />{src.label}</span></SectionLabel>
            <Table cols={cols} header={["Variable", <span key="h" style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>DSPs that may target it<InfoTip size={14} text="All connected DSPs includes any DSP connected later. A DSP submits a condition; the platform answers matched or not matched and never returns the value." /></span>]} style={{ overflow: "visible" }}>
              {vars.map((v, i) => (
                <TRow key={v.key} cols={cols} last={i === vars.length - 1} style={{ overflow: "visible" }}>
                  <TCell style={{ overflow: "visible" }}><span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>{v.label}<InfoTip text={v.tip || `e.g. ${v.values}`} /></span></TCell>
                  <TCell style={{ overflow: "visible", whiteSpace: "normal" }}><DspPicker value={variableAccess(lists, v.key)} dsps={dsps} onChange={(val) => setAccess(v.key, val)} /></TCell>
                </TRow>
              ))}
            </Table>
          </div>
        );
      })}
    </>
  );
}

/* Multi-select: "All connected DSPs" or individual configured DSPs, shown as
   pills. value is ALL_DSPS or an array of partner ids. */
function DspPicker({ value, dsps, onChange }) {
  const [open, setOpen] = useState(false);
  const all = value === ALL_DSPS;
  const ids = all ? [] : value;
  const toggle = (id) => onChange(ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);
  const pill = (key, label, colour, icon) => (
    <span key={key} style={{ display: "inline-flex", alignItems: "center", gap: 4, height: 22, padding: "0 8px", borderRadius: 9999, fontSize: 11.5, border: `1px solid ${colour}`, color: colour, background: "#fff" }}>
      {icon && <Icon name={icon} size={12} />}{label}
    </span>
  );
  return (
    <div style={{ position: "relative" }}>
      <div onClick={() => setOpen(!open)} style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 4, minHeight: 28, padding: "3px 28px 3px 6px", border: `1px solid ${open ? T.primary : T.border}`, borderRadius: 6, cursor: "pointer", position: "relative", background: "#fff" }}>
        {all && pill("all", "All connected DSPs", T.primary, "select_all")}
        {!all && ids.map((id) => { const x = dsps.find((d) => d.id === id); return x ? pill(id, x.name, providerOf(x).colour, providerOf(x).icon) : null; })}
        {!all && ids.length === 0 && <span style={{ fontSize: 12, color: T.micro, padding: "0 2px" }}>None</span>}
        <Icon name={open ? "expand_less" : "expand_more"} size={16} style={{ position: "absolute", right: 6, top: 5, color: T.muted }} />
      </div>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 20 }} />
          <div style={{ position: "absolute", top: "calc(100% + 4px)", right: 0, minWidth: 280, zIndex: 21, background: "#fff", border: `1px solid ${T.border}`, borderRadius: 6, boxShadow: "0 6px 16px rgba(0,0,0,0.08)", padding: 4 }}>
            <Opt checked={all} onClick={() => onChange(all ? [] : ALL_DSPS)} label="All connected DSPs" sub="Includes DSPs connected later" />
            <div style={{ height: 1, background: T.borderSubtle, margin: "4px 0" }} />
            {dsps.map((d) => <Opt key={d.id} checked={all || ids.includes(d.id)} disabled={all} onClick={() => toggle(d.id)} label={d.name} sub={d.status === "connected" ? null : d.status === "error" ? "Connection error" : "Not connected"} icon={providerOf(d).icon} colour={providerOf(d).colour} />)}
            {dsps.length === 0 && <div style={{ padding: 8, fontSize: 12, color: T.muted }}>No DSPs configured yet.</div>}
          </div>
        </>
      )}
    </div>
  );
}
const Opt = ({ checked, disabled, onClick, label, sub, icon, colour }) => (
  <div onClick={disabled ? undefined : onClick} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", borderRadius: 4, cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.5 : 1, fontSize: 12.5 }}>
    <Icon name={checked ? "check_box" : "check_box_outline_blank"} size={17} style={{ color: checked ? T.primary : T.micro }} />
    {icon && <Icon name={icon} size={15} style={{ color: colour }} />}
    <span style={{ flex: 1, minWidth: 0 }}>{label}{sub && <div style={{ fontSize: 11, color: T.micro }}>{sub}</div>}</span>
  </div>
);

function AddPartnerCard({ providerKey, onCancel, onAdd }) {
  const def = DSP_PROVIDERS[providerKey];
  return (
    <div style={{ border: `1px solid ${T.borderSubtle}`, borderRadius: 8, overflow: "hidden" }}>
      <div style={{ padding: "12px 16px", background: T.surfaceAlt, borderBottom: `1px solid ${T.borderSubtle}`, display: "flex", alignItems: "center", gap: 10 }}>
        <Icon name={def.icon} size={20} style={{ color: def.colour }} />
        <div><div style={{ fontSize: 14, fontWeight: 500, display: "flex", alignItems: "center", gap: 6 }}>Add {def.label}<InfoTip text="The DSP starts in Test mode and adopts the company advertiser lists automatically." /></div><div style={{ fontSize: 11.5, color: T.muted }}>{def.sub}</div></div>
      </div>
      <div style={{ padding: 16 }}>
        <div style={{ fontSize: 13, color: T.muted, lineHeight: 1.6, marginBottom: 14 }}>{def.blurb}</div>
        <SectionLabel style={{ marginTop: 0 }}>You will need</SectionLabel>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.9, color: T.text }}>{def.fields.filter((f) => f.required).map((f) => <li key={f.key}>{f.label}</li>)}{def.apiTier === 1 && <li>Bidder endpoint and seat IDs</li>}</ul>
        <div style={{ display: "flex", gap: 8, marginTop: 18 }}><Btn variant="primary" onClick={onAdd}><Icon name="add" size={16} />Add partner</Btn><Btn onClick={onCancel}>Cancel</Btn></div>
      </div>
    </div>
  );
}

function ListEditor({ label, tone, icon, items, suggestions, onAdd, onRemove, empty, readOnly, addLabel = "Add an advertiser…", suggestLabel = "Seats:" }) {
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
      {readOnly ? <div style={{ fontSize: 11.5, color: T.micro, display: "flex", alignItems: "center", gap: 5 }}><Icon name="lock" size={13} />Inherited — unlink to edit.</div> : (
        <div style={{ display: "flex", gap: 6 }}>
          <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(draft); } }} placeholder={addLabel} style={small} />
          <Btn variant="outline" style={{ height: 28, fontSize: 12.5, padding: "0 10px" }} disabled={!draft.trim() || has(draft)} onClick={() => add(draft)}>Add</Btn>
        </div>
      )}
      {!readOnly && unused.length > 0 && <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 8, alignItems: "center" }}><span style={{ fontSize: 11, color: T.micro }}>{suggestLabel}</span>{unused.map((sg) => <span key={sg.id} onClick={() => add(sg.name)} style={{ cursor: "pointer", fontSize: 11.5, height: 20, padding: "0 8px", borderRadius: 9999, border: `1px dashed ${T.border}`, color: T.muted, display: "inline-flex", alignItems: "center" }}>+ {sg.name}</span>)}</div>}
    </div>
  );
}

