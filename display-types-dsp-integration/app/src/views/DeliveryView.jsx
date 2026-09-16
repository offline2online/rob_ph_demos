import React, { useState, useMemo } from "react";
import { T, MONO, Icon, Pill, Btn, SectionLabel, Note, Callout, Table, TRow, TCell, Tabs, Segmented, Kpi, Empty, small, fmtInt, JsonBlock } from "../ui.jsx";
import { proofOfPlay, TRIGGER_KINDS, UNPLAYED_REASONS, partnerById, providerOf, partnerColour } from "../model/sellside.js";
import { STORES, DISPLAYS, campaignById } from "../model/data.js";

const nameOf = (id, reservations) => campaignById(id)?.name || reservations.flatMap((r) => r.campaigns).find((c) => c.id === id)?.name || id;

export default function DeliveryView({ records, reservations, partners, exchange, types }) {
  const [tab, setTab] = useState("records");
  const [scope, setScope] = useState("all");
  const [store, setStore] = useState("all");
  const [partnerF, setPartnerF] = useState("all");
  const filtered = useMemo(() => records.filter((r) => (store === "all" || r.storeId === store) && (partnerF === "all" || r.partnerId === partnerF) && (scope === "all" || (scope === "sold" ? !!r.reservationId : !r.reservationId))), [records, store, partnerF, scope]);
  const played = filtered.filter((r) => r.playback.played);
  const impressions = played.reduce((s, r) => s + r.audience.multiplier, 0);
  const measured = played.filter((r) => r.audience.source === "sensor").length;
  const byTrigger = Object.keys(TRIGGER_KINDS).map((k) => [k, filtered.filter((r) => r.trigger.kind === k).length]).filter(([, n]) => n);
  const pop = proofOfPlay(filtered.filter((r) => r.reservationId));

  return (
    <div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
        <Segmented value={scope} onChange={setScope} options={[{ value: "all", label: "All plays" }, { value: "sold", label: "Sold positions" }, { value: "hq", label: "Headquarters" }]} />
        <select value={store} onChange={(e) => setStore(e.target.value)} style={{ ...small, width: 200 }}><option value="all">All stores</option>{STORES.map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}</select>
        <select value={partnerF} onChange={(e) => setPartnerF(e.target.value)} style={{ ...small, width: 200 }}><option value="all">All partners</option>{partners.filter((p) => !p.system).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        <span style={{ marginLeft: "auto", fontSize: 12, color: T.muted }}>Last 24h · <code>GET /v1/delivery</code></span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: 10, marginBottom: 14 }}>
        <Kpi icon="play_circle" tint={T.kpi.violet} label="Plays logged" value={fmtInt(filtered.length)} sub={`${fmtInt(played.length)} rendered`} />
        <Kpi icon="visibility" tint={T.kpi.emerald} label="Impressions" value={fmtInt(impressions)} sub="plays × audience multiplier" />
        <Kpi icon="sensors" tint={T.kpi.amber} label="Counted, not modelled" value={played.length ? `${Math.round((measured / played.length) * 100)}%` : "—"} sub="Vision/AI or MIST on the display" />
        <Kpi icon="tv_off" tint={T.kpi.red} label="Not rendered" value={fmtInt(filtered.length - played.length)} sub="reported, never billed" />
        <Kpi icon="receipt_long" tint={T.kpi.emerald} label="Billable impressions" value={fmtInt(filtered.filter((r) => r.billable).reduce((s, r) => s + r.audience.multiplier, 0))} sub="sold positions, proof of play" />
      </div>

      <Tabs value={tab} onChange={setTab} items={[
        { key: "records", label: "Playback records", icon: "list_alt", count: filtered.length },
        { key: "pop", label: "Proof of play & billing", icon: "receipt_long" },
        { key: "why", label: "Which campaign, and why", icon: "query_stats" },
        { key: "feed", label: "Partner feed", icon: "rss_feed" },
      ]} />

      {tab === "records" && (
        <>
          <Table cols="70px 1fr 1fr 1.4fr 1.5fr 90px 100px" header={["Time", "Store / display", "Position", "Campaign", "Trigger", "Audience", "Outcome"]}>
            {filtered.slice(0, 60).map((r, i) => {
              const s = STORES.find((x) => x.id === r.storeId); const d = DISPLAYS.find((x) => x.id === r.displayId); const t = types.find((x) => x.id === r.displayTypeId); const tk = TRIGGER_KINDS[r.trigger.kind];
              return (
                <TRow key={r.id} cols="70px 1fr 1fr 1.4fr 1.5fr 90px 100px" last={i === Math.min(60, filtered.length) - 1} style={{ opacity: r.playback.played ? 1 : 0.6 }}>
                  <TCell mono muted>{r.ts.slice(11, 16)}</TCell>
                  <TCell style={{ whiteSpace: "normal" }}>{s?.code}<div style={{ fontSize: 11, color: T.micro }}>{d?.name}</div></TCell>
                  <TCell style={{ whiteSpace: "normal", fontSize: 12 }}>{t?.name}<div style={{ fontSize: 11, color: T.micro }}>slot {r.slotIndex + 1}</div></TCell>
                  <TCell style={{ whiteSpace: "normal" }}>{nameOf(r.campaignId, reservations)}{r.advertiser && <div style={{ fontSize: 11, color: partnerColour(partnerById(partners, r.partnerId)) }}>{r.advertiser} · {partnerById(partners, r.partnerId)?.name}</div>}</TCell>
                  <TCell style={{ whiteSpace: "normal", fontSize: 11.5 }}><span style={{ color: tk.colour, fontWeight: 500 }}>{tk.label}</span><div style={{ color: T.micro }}>{r.trigger.ruleText}</div></TCell>
                  <TCell style={{ fontSize: 12 }}>×{r.audience.multiplier.toFixed(2)}<div style={{ fontSize: 10.5, color: r.audience.source === "sensor" ? T.success : T.micro }}>{r.audience.source === "sensor" ? `counted (${r.audience.passerby})` : "modelled"}</div></TCell>
                  <TCell>{r.playback.played ? <Pill color={T.success} bg="rgba(82,196,26,0.10)">played</Pill> : <Pill color={T.error} bg="rgba(255,77,79,0.08)" title={UNPLAYED_REASONS[r.playback.reason]}>{UNPLAYED_REASONS[r.playback.reason]}</Pill>}</TCell>
                </TRow>
              );
            })}
            {filtered.length === 0 && <div style={{ padding: 12, fontSize: 12.5, color: T.muted }}>No playback in this scope.</div>}
          </Table>
          {filtered.length > 60 && <div style={{ fontSize: 12, color: T.micro, marginTop: 6 }}>Showing 60 of {filtered.length}.</div>}
          <Note>Every record carries the campaign that played and <b>the trigger that activated it</b>: which targeted campaign matched and on which rule, that the baseline filled the position, or that Headquarters filled it because the sold creative was not usable. Partner and advertiser are stamped at write time.</Note>
        </>
      )}

      {tab === "pop" && (
        <>
          {pop.length === 0 ? <Empty icon="receipt_long">No sold positions in this scope.</Empty> : (
            <Table cols="1.4fr 1.2fr 70px 70px 1.4fr 110px 110px" header={["Reservation", "Advertiser · partner", "Wins", "Played", "Not rendered", "Impressions", "Billed"]}>
              {pop.map((b, i) => {
                const res = reservations.find((x) => x.id === b.reservationId); const pt = partnerById(partners, b.partnerId);
                const cpm = res?.clearing.cpm || 0;
                return (
                  <TRow key={b.reservationId} cols="1.4fr 1.2fr 70px 70px 1.4fr 110px 110px" last={i === pop.length - 1}>
                    <TCell mono>{b.reservationId}<div style={{ fontSize: 10.5, color: T.micro, fontFamily: "inherit" }}>{res?.window.from} · {res?.window.hours}h · {res?.clearing.kind}</div></TCell>
                    <TCell style={{ whiteSpace: "normal" }}>{b.advertiser}<div style={{ fontSize: 11, color: T.micro }}>{pt?.name}</div></TCell>
                    <TCell>{b.wins}</TCell>
                    <TCell style={{ color: T.success }}>{b.plays}</TCell>
                    <TCell style={{ whiteSpace: "normal", fontSize: 11.5, color: T.muted }}>{Object.entries(b.unplayed).map(([k, n]) => `${n} ${UNPLAYED_REASONS[k].toLowerCase()}`).join(", ") || "—"}</TCell>
                    <TCell>{fmtInt(b.impressions)}<div style={{ fontSize: 10.5, color: T.micro }}>{b.measured} counted · {b.modelled} modelled</div></TCell>
                    <TCell><b>{pt?.currency || "GBP"} {((b.impressions / 1000) * cpm).toFixed(2)}</b><div style={{ fontSize: 10.5, color: T.micro }}>@ {cpm.toFixed(2)} CPM</div></TCell>
                  </TRow>
                );
              })}
            </Table>
          )}
          <Callout tone="info" icon="gavel" style={{ marginTop: 12 }}>DOOH bills on <b>proof of play</b>, not on the win notice. The player logs each actual play; PH reconciles wins against plays and bills the multiplied impressions that genuinely rendered. Plays that did not happen — screen offline, store closed, loop cut short — are reported and not billed. As the exchange, PH is the system of record: disputes resolve against these logs.</Callout>
          <Note>Audience currency: <b>{exchange.audienceCurrency === "sensor_where_available" ? "counted where Vision/AI or MIST is on the display type, modelled otherwise" : "modelled only"}</b> (Exchange settings). Whether a counted multiplier is tradeable or only reportable is open question 34.</Note>
        </>
      )}

      {tab === "why" && (
        <>
          <SectionLabel style={{ marginTop: 0 }}>Triggers</SectionLabel>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 640 }}>
            {byTrigger.map(([k, n]) => (
              <div key={k} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12.5 }}>
                <span style={{ width: 210, color: TRIGGER_KINDS[k].colour, fontWeight: 500 }}>{TRIGGER_KINDS[k].label}</span>
                <div style={{ flex: 1, height: 14, background: T.surfaceMuted, borderRadius: 3, overflow: "hidden" }}><div style={{ width: `${(n / filtered.length) * 100}%`, height: "100%", background: TRIGGER_KINDS[k].colour }} /></div>
                <span style={{ width: 90, textAlign: "right", color: T.muted }}>{n} · {Math.round((n / filtered.length) * 100)}%</span>
              </div>
            ))}
          </div>
          <SectionLabel>Per store</SectionLabel>
          <Table cols="1.4fr 90px 90px 110px 1.6fr" header={["Store", "Plays", "Rendered", "Impressions", "Top trigger"]}>
            {STORES.filter((s) => store === "all" || s.id === store).map((s, i, arr) => {
              const rs = filtered.filter((r) => r.storeId === s.id); const pl = rs.filter((r) => r.playback.played);
              const top = Object.entries(rs.reduce((m, r) => ({ ...m, [r.trigger.kind]: (m[r.trigger.kind] || 0) + 1 }), {})).sort((a, b) => b[1] - a[1])[0];
              return <TRow key={s.id} cols="1.4fr 90px 90px 110px 1.6fr" last={i === arr.length - 1}><TCell>{s.code} · {s.name}</TCell><TCell>{rs.length}</TCell><TCell style={{ color: T.success }}>{pl.length}</TCell><TCell>{fmtInt(pl.reduce((x, r) => x + r.audience.multiplier, 0))}</TCell><TCell style={{ color: top ? TRIGGER_KINDS[top[0]].colour : T.micro }}>{top ? `${TRIGGER_KINDS[top[0]].label} (${top[1]})` : "—"}</TCell></TRow>;
            })}
          </Table>
          <Note>Ideal end state: associate transactions with campaign plays, closing the loop from impression to sale. That needs an identity join this project does not own (open question 36).</Note>
        </>
      )}

      {tab === "feed" && <PartnerFeed records={filtered} reservations={reservations} partners={partners} exchange={exchange} />}
    </div>
  );
}

/* What a partner sees: outcome and trigger, never the attribute values, and
   nothing below the reporting floor. */
function PartnerFeed({ records, reservations, partners, exchange }) {
  const [pid, setPid] = useState(partners.find((p) => !p.system)?.id);
  const p = partnerById(partners, pid);
  const mine = records.filter((r) => r.partnerId === pid);
  const groups = Object.values(mine.reduce((m, r) => { const k = `${r.reservationId}|${r.trigger.kind}|${r.trigger.campaignId || ""}`; m[k] = m[k] || { reservationId: r.reservationId, kind: r.trigger.kind, campaignId: r.trigger.campaignId, plays: 0, rendered: 0, impressions: 0 }; m[k].plays++; if (r.playback.played) { m[k].rendered++; m[k].impressions += r.audience.multiplier; } return m; }, {}));
  const floor = exchange.reportingFloorN;
  const feed = groups.map((g) => ({ reservationId: g.reservationId, trigger: g.kind === "targeted" ? { kind: "targeted", campaignId: g.campaignId } : { kind: g.kind }, plays: g.plays >= floor ? g.plays : null, rendered: g.plays >= floor ? g.rendered : null, impressions: g.plays >= floor ? Math.round(g.impressions) : null, suppressed: g.plays < floor ? `below reporting floor (n < ${floor})` : undefined }));
  return (
    <>
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12 }}>
        <select value={pid} onChange={(e) => setPid(e.target.value)} style={{ ...small, width: 220 }}>{partners.filter((x) => !x.system).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
        <span style={{ fontSize: 12, color: T.muted }}>As delivered to {p?.name} via <code>GET /v1/delivery</code>{p?.creds?.webhook ? ` and ${p.creds.webhook}` : ""}</span>
      </div>
      <JsonBlock value={{ partnerId: pid, period: "2026-09-16T00:00Z/2026-09-17T00:00Z", reportingFloor: floor, records: feed }} maxHeight={420} />
      <Note>A partner has no control over evaluation but full visibility of outcome: what fired and why. No attribute value crosses back — <code>env.temp_c ≥ 25</code> matched, never the temperature. Segments under the reporting floor are suppressed because thin segments repeatedly queried are an inference channel (open question 30).</Note>
    </>
  );
}
