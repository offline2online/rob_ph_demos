import React, { useState, useMemo } from "react";
import { T, MONO, Icon, Pill, Btn, SectionLabel, Note, Callout, Grid, Fld, ctl, small, Table, TRow, TCell, Tabs, Segmented, Kpi, Empty, JsonBlock, fmtInt, Chips } from "../ui.jsx";
import { isCapped, slotCount, shareOfVoice, loopLengthSeconds, tpIcon } from "../model/schema.js";
import { forecast, partnerById, permittedVocabulary, attrByKey, OPS, ruleText } from "../model/sellside.js";
import { SLOT_OWNERS } from "../model/schema.js";
import { MATCH_RATES } from "../model/data.js";

const OPENOOH = ["Retail → Grocery", "Retail → Malls", "Retail → Convenience", "Retail → Pharmacies", "Transit → Airports", "Transit → Train Stations", "Leisure → Quick Service Restaurants"];

export default function InventoryView({ stores, setStores, displays, setDisplays, types, playlists, partners, reservations, exchange }) {
  const [tab, setTab] = useState("venues");
  return (
    <div>
      <Tabs value={tab} onChange={setTab} items={[
        { key: "venues", label: "Venues & screens", icon: "location_on", count: displays.length },
        { key: "inventory", label: "Sellable inventory", icon: "inventory_2" },
        { key: "forecast", label: "Forecast", icon: "insights" },
        { key: "bid", label: "Bid request", icon: "data_object" },
      ]} />
      {tab === "venues" && <Venues stores={stores} setStores={setStores} displays={displays} setDisplays={setDisplays} types={types} playlists={playlists} />}
      {tab === "inventory" && <Inventory types={types} displays={displays} stores={stores} partners={partners} reservations={reservations} playlists={playlists} exchange={exchange} />}
      {tab === "forecast" && <Forecast types={types} displays={displays} stores={stores} partners={partners} playlists={playlists} exchange={exchange} />}
      {tab === "bid" && <BidRequest types={types} displays={displays} stores={stores} playlists={playlists} exchange={exchange} />}
    </div>
  );
}

/* --------------------------------------------------- venues & screens */

function Venues({ stores, setStores, displays, setDisplays, types, playlists }) {
  const setStore = (id, patch) => setStores(stores.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  const missing = stores.filter((s) => !s.venue?.openOoh || s.venue.lat == null).length;
  return (
    <>
      {missing > 0 ? <Callout tone="warning" style={{ marginBottom: 12 }}>{missing} store{missing > 1 ? "s" : ""} missing venue metadata — a DOOH bid request cannot be built for their displays (open question 35).</Callout>
        : <Callout tone="success" style={{ marginBottom: 12 }}>Every store carries an OpenOOH venue type and geo. This is what a DOOH bid request describes: a venue and a moment, never a person.</Callout>}
      <SectionLabel style={{ marginTop: 0 }}>Stores — venue metadata</SectionLabel>
      <Table cols="90px 1.3fr 1.6fr 1.2fr 110px 100px" header={["Code", "Store", "OpenOOH venue type", "Geo (lat, lng)", "Hours", "Displays"]}>
        {stores.map((s, i) => (
          <TRow key={s.id} cols="90px 1.3fr 1.6fr 1.2fr 110px 100px" last={i === stores.length - 1}>
            <TCell mono>{s.code}</TCell>
            <TCell>{s.name}<div style={{ fontSize: 11, color: T.micro }}>{s.region} · {s.segments.join(", ")}</div></TCell>
            <TCell><select value={s.venue.openOoh} onChange={(e) => setStore(s.id, { venue: { ...s.venue, openOoh: e.target.value } })} style={{ ...small, height: 26, fontSize: 12 }}>{OPENOOH.map((v) => <option key={v}>{v}</option>)}</select></TCell>
            <TCell mono muted>{s.venue.lat.toFixed(4)}, {s.venue.lng.toFixed(4)}</TCell>
            <TCell muted>{String(s.hours.open).padStart(2, "0")}:00–{String(s.hours.close).padStart(2, "0")}:00</TCell>
            <TCell>{displays.filter((d) => d.storeId === s.id).length}</TCell>
          </TRow>
        ))}
      </Table>

      <SectionLabel>Displays — screen & loop context</SectionLabel>
      <Table cols="1.2fr 90px 1.3fr 110px 90px 90px 80px 1fr" header={["Display", "Store", "Display type", "Resolution", "Orientation", "Loop", "SOV", "Sensors / tags"]}>
        {displays.map((d, i) => {
          const s = stores.find((x) => x.id === d.storeId); const t = types.find((x) => x.id === d.displayTypeId); const pl = playlists.find((x) => x.id === t?.defaultPlaylistId);
          const sov = t ? shareOfVoice(t) : null;
          return (
            <TRow key={d.id} cols="1.2fr 90px 1.3fr 110px 90px 90px 80px 1fr" last={i === displays.length - 1}>
              <TCell><span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span style={{ width: 8, height: 8, borderRadius: 9999, background: d.status === "online" ? T.success : T.error }} />{d.name}</span><div style={{ fontSize: 11, color: T.micro, marginLeft: 14 }}>{d.lastSeen}</div></TCell>
              <TCell mono muted>{s?.code}</TCell>
              <TCell><span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><Icon name={tpIcon(t?.touchPoint)} size={14} style={{ color: T.muted }} />{t?.name}</span></TCell>
              <TCell muted>{t ? `${t.displayCanvasSize.width}×${t.displayCanvasSize.height}` : "—"}</TCell>
              <TCell muted>{d.orientation}</TCell>
              <TCell muted>{pl ? `${loopLengthSeconds(pl)}s` : "—"}</TCell>
              <TCell muted>{sov ? `1/${slotCount(t)}` : "—"}</TCell>
              <TCell style={{ whiteSpace: "normal" }}>
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  <span onClick={() => setDisplays(displays.map((x) => (x.id === d.id ? { ...x, sensors: { ...x.sensors, vision: !x.sensors.vision } } : x)))} style={{ cursor: "pointer", fontSize: 10.5, padding: "1px 7px", borderRadius: 9999, border: `1px solid ${d.sensors.vision ? T.success : T.border}`, color: d.sensors.vision ? T.success : T.micro }}>Vision/AI</span>
                  <span onClick={() => setDisplays(displays.map((x) => (x.id === d.id ? { ...x, sensors: { ...x.sensors, mist: !x.sensors.mist } } : x)))} style={{ cursor: "pointer", fontSize: 10.5, padding: "1px 7px", borderRadius: 9999, border: `1px solid ${d.sensors.mist ? T.success : T.border}`, color: d.sensors.mist ? T.success : T.micro }}>MIST</span>
                  {d.tags.map((tg) => <span key={tg} style={{ fontSize: 10.5, padding: "1px 7px", borderRadius: 9999, background: T.surfaceMuted, color: T.muted }}>{tg}</span>)}
                </div>
              </TCell>
            </TRow>
          );
        })}
      </Table>
      <Note>Resolution, aspect and orientation come from the display type; loop length is the default playlist's total duration; <b>share of voice is 1 / maximumCampaignsPlayedInRotation</b> — the cap is the SOV denominator. A display with Vision/AI or MIST reports a <b>counted</b> audience multiplier where most of the market estimates one.</Note>
    </>
  );
}

/* --------------------------------------------------- sellable inventory */

function Inventory({ types, displays, stores, partners, reservations, playlists, exchange }) {
  const rows = [];
  types.filter(isCapped).forEach((t) => {
    (t.phExtensions.slots || []).forEach((sl, i) => {
      if (sl.owner !== "advertiser") return;
      const ds = displays.filter((d) => d.displayTypeId === t.id);
      const sold = reservations.filter((r) => r.status !== "ended" && r.positions.some((p) => p.displayTypeId === t.id && p.slotIndex === i));
      rows.push({ t, i, sl, displays: ds.length, stores: new Set(ds.map((d) => d.storeId)).size, sold, partner: sl.partnerId && sl.partnerId !== "__any__" ? partnerById(partners, sl.partnerId) : null });
    });
  });
  return (
    <>
      <div style={{ fontSize: 12, color: T.muted, lineHeight: 1.6, marginBottom: 12 }}><code>GET /v1/inventory</code> — sellable positions as <b>display type × slot × store set × window</b>. A position exists only where a rotation is capped and the slot is owned by Advertiser; the window is the exchange's play window ({exchange.playWindowHours}h), not an impression.</div>
      <Table cols="1.4fr 100px 1.2fr 90px 90px 1.4fr 110px" header={["Display type · slot", "SOV", "Sold through", "Displays", "Stores", "Windows sold", "Next window"]}>
        {rows.map((r, i) => (
          <TRow key={`${r.t.id}-${r.i}`} cols="1.4fr 100px 1.2fr 90px 90px 1.4fr 110px" last={i === rows.length - 1}>
            <TCell><span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><Icon name={tpIcon(r.t.touchPoint)} size={14} style={{ color: T.muted }} />{r.t.name}</span><div style={{ fontSize: 11, color: T.micro }}>slot {r.i + 1} · {r.sl.label}</div></TCell>
            <TCell muted>1/{slotCount(r.t)}</TCell>
            <TCell style={{ whiteSpace: "normal", fontSize: 12 }}>{r.partner ? r.partner.name : "Any connected DSP"}<div style={{ fontSize: 11, color: T.micro }}>{!r.sl.advertiser || r.sl.advertiser === "__rtb__" ? "open RTB" : r.sl.advertiser === "__allow__" ? "whitelist only" : `reserved · ${r.sl.advertiser}`}</div></TCell>
            <TCell>{r.displays}</TCell><TCell>{r.stores}</TCell>
            <TCell style={{ whiteSpace: "normal", fontSize: 12 }}>{r.sold.length ? r.sold.map((s) => <div key={s.id}><span style={{ fontFamily: MONO, fontSize: 11 }}>{s.id}</span> · {s.advertiser} · {s.window.from}</div>) : <span style={{ color: T.micro }}>unsold</span>}</TCell>
            <TCell><Pill color={r.sold.some((s) => s.window.from === "2026-09-16") ? T.warning : T.success} bg="#fff" border={r.sold.some((s) => s.window.from === "2026-09-16") ? T.warning : T.success}>{r.sold.some((s) => s.window.from === "2026-09-16") ? "taken" : "available"}</Pill></TCell>
          </TRow>
        ))}
        {rows.length === 0 && <div style={{ padding: 12, fontSize: 12.5, color: T.muted }}>No sellable positions — cap a rotation and give a slot to Advertiser.</div>}
      </Table>
      <Note>"Is slot 2 free across London for a fortnight" has no yes/no answer: availability is a forecast, and targeting changes it. Use the Forecast tab with the campaign's rules before promising delivery.</Note>
    </>
  );
}

/* ------------------------------------------------------------- forecast */

function Forecast({ types, displays, stores, partners, playlists, exchange }) {
  const sellable = types.filter(isCapped);
  const [typeId, setTypeId] = useState(sellable[0]?.id);
  const [storeIds, setStoreIds] = useState([]);
  const [days, setDays] = useState(1);
  const [pid, setPid] = useState(partners.find((p) => !p.system)?.id);
  const [rules, setRules] = useState([{ attr: "env.temp_c", op: "gte", value: 25 }]);
  const t = types.find((x) => x.id === typeId); const pl = playlists.find((x) => x.id === t?.defaultPlaylistId);
  const p = partnerById(partners, pid); const vocab = permittedVocabulary(p || { targeting: { enabledAttributes: [] } });
  const f = t ? forecast({ displayType: t, playlist: pl, storeIds, windowDays: days, rules, audienceMultiplier: exchange.audienceCurrency === "modelled_only" ? 1.4 : 1.9 }, { stores, displays, matchRates: MATCH_RATES }) : null;
  return (
    <>
      <div style={{ fontSize: 12, color: T.muted, lineHeight: 1.6, marginBottom: 12 }}><code>POST /v1/inventory/forecast</code> — projected plays and impressions for a spec <b>plus its targeting rules</b>. A campaign gated on over 25°C in October delivers a fraction of its baseline; the forecast takes the rules as input for exactly this reason.</div>
      <div style={{ display: "flex", gap: 20, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 360 }}>
          <Grid cols={3}>
            <Fld label="Display type"><select value={typeId} onChange={(e) => setTypeId(e.target.value)} style={ctl}>{sellable.map((x) => <option key={x.id} value={x.id}>{x.name} (1/{slotCount(x)})</option>)}</select></Fld>
            <Fld label="Window (days)"><input type="number" min="1" value={days} onChange={(e) => setDays(Number(e.target.value))} style={ctl} /></Fld>
            <Fld label="Partner (vocabulary)"><select value={pid} onChange={(e) => { setPid(e.target.value); setRules([]); }} style={ctl}>{partners.filter((x) => !x.system).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Fld>
          </Grid>
          <Fld label="Store set (empty = whole estate)"><Chips options={stores.map((s) => s.code)} value={storeIds.map((id) => stores.find((s) => s.id === id)?.code)} onChange={(codes) => setStoreIds(codes.map((c) => stores.find((s) => s.code === c)?.id).filter(Boolean))} /></Fld>
          <div style={{ height: 14 }} />
          <Fld label="Targeting rules">
            {rules.map((q, i) => { const a = attrByKey(q.attr); const ops = OPS[a?.type || "string"]; return (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1.2fr 24px", gap: 6, alignItems: "center", marginBottom: 6 }}>
                <select value={q.attr} onChange={(e) => { const na = attrByKey(e.target.value); setRules(rules.map((x, k) => (k === i ? { attr: e.target.value, op: OPS[na?.type || "string"][0][0], value: na?.values ? na.values[0] : 0 } : x))); }} style={small}>{vocab.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}</select>
                <select value={q.op} onChange={(e) => setRules(rules.map((x, k) => (k === i ? { ...x, op: e.target.value } : x)))} style={small}>{ops.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                {a?.values ? <select value={q.value} onChange={(e) => setRules(rules.map((x, k) => (k === i ? { ...x, value: e.target.value } : x)))} style={small}>{a.values.map((v) => <option key={v}>{v}</option>)}</select> : <input type="number" value={q.value} onChange={(e) => setRules(rules.map((x, k) => (k === i ? { ...x, value: Number(e.target.value) } : x)))} style={small} />}
                <Icon name="close" size={15} style={{ cursor: "pointer", color: T.muted }} onClick={() => setRules(rules.filter((_, k) => k !== i))} />
              </div>); })}
            <Btn variant="outline" style={{ height: 26, fontSize: 12 }} disabled={!vocab.length} onClick={() => { const a = vocab[0]; setRules([...rules, { attr: a.key, op: OPS[a.type][0][0], value: a.values ? a.values[0] : 25 }]); }}><Icon name="add" size={14} />Add rule</Btn>
          </Fld>
        </div>
        {f && (
          <div style={{ width: 320, flexShrink: 0 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <Kpi icon="tv" tint={T.kpi.violet} label="Displays" value={f.displays} />
              <Kpi icon="play_circle" tint={T.kpi.emerald} label="Baseline plays" value={fmtInt(f.plays)} sub={`${days} day${days > 1 ? "s" : ""}`} />
              <Kpi icon="visibility" tint={T.kpi.amber} label="Baseline impressions" value={fmtInt(f.impressions)} />
              <Kpi icon="filter_alt" tint={T.kpi.red} label="Targeted impressions" value={fmtInt(f.targetedImpressions)} sub={`~${Math.round(f.matchRate * 100)}% of moments match`} />
            </div>
            <Callout tone={f.matchRate < 0.3 ? "warning" : "info"} style={{ marginTop: 10 }}>{f.matchRate < 0.3 ? <>These rules are expected to be true in about <b>{Math.round(f.matchRate * 100)}%</b> of moments. The baseline carries the rest — sell the guarantee on baseline, not targeted, delivery.</> : <>Targeted delivery is a projection from historical match rates, not a guarantee.</>}</Callout>
            <Note>plays = open hours × 3600 / loop length × share of voice, per display in scope; impressions = plays × audience multiplier ({exchange.audienceCurrency === "modelled_only" ? "modelled" : "counted where available"}).</Note>
          </div>
        )}
      </div>
    </>
  );
}

/* ---------------------------------------------------------- bid request */

function BidRequest({ types, displays, stores, playlists, exchange }) {
  const [did, setDid] = useState(displays[0]?.id);
  const d = displays.find((x) => x.id === did); const s = stores.find((x) => x.id === d?.storeId); const t = types.find((x) => x.id === d?.displayTypeId); const pl = playlists.find((x) => x.id === t?.defaultPlaylistId);
  const sov = t ? shareOfVoice(t) : null;
  const req = d && t && s ? {
    id: "req_" + d.id + "_w" + Date.now().toString(36).slice(-4),
    imp: [{ id: "1", dooh: { w: t.displayCanvasSize.width, h: t.displayCanvasSize.height, mimes: ["video/mp4", "image/jpeg"], maxduration: pl?.items[0]?.playbackDuration || 10 }, qty: { multiplier: d.sensors.vision ? 2.1 : 1.4, sourcetype: d.sensors.vision ? 1 : 2, vendor: d.sensors.vision ? "personalisationhub.com/vision-ai" : "personalisationhub.com/model" }, dt: Date.now(), bidfloor: 4.5, bidfloorcur: "GBP", pmp: { private_auction: 0, deals: [{ id: "PH-DV360-PG-0012", bidfloor: 6.0 }] }, ext: { playWindowHours: exchange.playWindowHours, slotIndex: 1, shareOfVoice: sov, loopLengthSec: loopLengthSeconds(pl), assetsMustBeCachedBy: "window.open - 4h" } }],
    dooh: { id: d.id, name: `${s.name} — ${d.name}`, venuetype: [s.venue.openOoh], venuetypetax: exchange.openRtb.venueTaxonomy, publisher: { id: exchange.sellersJson.sellerId, name: exchange.sellersJson.name, domain: exchange.sellersJson.domain } },
    device: { geo: { lat: s.venue.lat, lon: s.venue.lng, type: 1 }, devicetype: 8 },
    source: { ext: { schain: { complete: 1, ver: "1.0", nodes: [{ asi: exchange.supplyChain.asi, sid: exchange.supplyChain.sid, hp: exchange.supplyChain.hp }] } } },
    bcat: [], badv: ["redbull.com", "monsterenergy.com"], at: 1, tmax: 300, cur: ["GBP"],
    user: undefined,
  } : null;
  return (
    <>
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12 }}>
        <select value={did} onChange={(e) => setDid(e.target.value)} style={{ ...small, width: 260 }}>{displays.map((x) => <option key={x.id} value={x.id}>{stores.find((q) => q.id === x.storeId)?.code} · {x.name}</option>)}</select>
        <span style={{ fontSize: 12, color: T.muted }}>OpenRTB {exchange.openRtb.version} DOOH bid request PH would construct for one play window on this display</span>
      </div>
      {req ? <JsonBlock value={req} maxHeight={520} /> : <Empty>Pick a display.</Empty>}
      <Note>No <code>user</code> object — DOOH is one-to-many. Venue type from the store, geo from the store, screen and loop context from the display type, the impression multiplier from the display's sensors, <code>badv</code> from the company blacklist (enforced again on the response), and the SupplyChain node from Exchange settings. Exact object and version support per DSP is on the "to confirm before building" list in REQUIREMENTS §7.</Note>
    </>
  );
}
