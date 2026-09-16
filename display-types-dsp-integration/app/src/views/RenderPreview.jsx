import React, { useState, useMemo } from "react";
import { T, MONO, Icon, Pill, Btn, SectionLabel, Note, Callout, Grid, Fld, ctl, small, Segmented, Empty, Tabs, ZONE_COLOURS } from "../ui.jsx";
import { isWebTP, isCapped, slotCount, visibilityDeadlineMs, PLATFORM_DEFAULTS, loopLengthSeconds, TRUST_ZONES } from "../model/schema.js";
import { CAMPAIGNS, campaignById, PAIRED_DEVICES, CONNECTION_STATES, MOBILE_TEMPLATE_DEFS } from "../model/data.js";
import { CONNECTED_ASSET } from "../assets.js";

/* The render ladder (REQUIREMENTS §1): Default → Localised → Personalised →
   Interactive. This screen shows the same surface at every tier side by
   side, the pairing sequence, and where each channel freezes. */

const TIERS = [
  { key: "default", n: 1, label: "Default", icon: "public", hint: "No data resolved. Paints immediately with the campaign's default creative." },
  { key: "localised", n: 2, label: "Localised", icon: "storefront", hint: "Store / location context, no identity needed. Most impressions live here." },
  { key: "personalised", n: 3, label: "Personalised", icon: "person", hint: "Identity + populated attributes, including from a paired device profile." },
  { key: "interactive", n: 4, label: "Interactive", icon: "touch_app", hint: "Live WebSocket — the customer engages via a paired device." },
];
const CHANNELS = [
  { key: "signage", label: "Digital signage", icon: "tv", max: 4, note: "Full ladder, streaming upgrades in place." },
  { key: "web", label: "Responsive web", icon: "devices", max: 4, note: "Full ladder, streaming upgrades in place." },
  { key: "mobile", label: "Mobile store site / PWA", icon: "smartphone", max: 4, note: "Full ladder and hosts the personal agent." },
  { key: "messaging", label: "Messaging", icon: "sms", max: 2, note: "Collapses to sequential messages." },
  { key: "email", label: "Email / social", icon: "mail", max: 2, note: "Frozen at send / publish time — no live tier upgrade." },
];
const SAMPLE = {
  default: { headline: "Zinger Box", sub: "Now with extra crunch", cta: null, price: "£12.95" },
  localised: { headline: "Zinger Box", sub: "Hot & ready at Oxford St until 22:00", cta: "Scan to order", price: "£12.95" },
  personalised: { headline: "Welcome back, Alex", sub: "Zinger Box — Gold members earn double points today", cta: "Add to your order", price: "£12.95" },
  interactive: { headline: "Added to your order", sub: "Wicked Wings 6pk suggested with it", cta: "Pay on your phone", price: "£12.95" },
};

export default function RenderPreview({ types, playlists }) {
  const candidates = types.filter((t) => !isWebTP(t.touchPoint) || t.element?.plays !== "static");
  const [typeId, setTypeId] = useState(candidates.find((t) => t.qrControl?.enabled)?.id || candidates[0]?.id);
  const [tab, setTab] = useState("tiers");
  const t = types.find((x) => x.id === typeId) || candidates[0];
  const pl = playlists.find((x) => x.id === t?.defaultPlaylistId);
  if (!t) return <Empty>No display type to preview.</Empty>;
  return (
    <div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
        <Fld label="Display type"><select value={typeId} onChange={(e) => setTypeId(e.target.value)} style={{ ...small, width: 260 }}>{candidates.map((x) => <option key={x.id} value={x.id}>{x.name} · {x.touchPoint}</option>)}</select></Fld>
        <div style={{ fontSize: 12, color: T.muted, paddingTop: 16 }}>{pl ? `${pl.name} · ${pl.items.length} items · ${loopLengthSeconds(pl)}s loop` : "no playlist"}{isCapped(t) && ` · ${slotCount(t)} slots`}</div>
      </div>
      <Tabs value={tab} onChange={setTab} items={[{ key: "tiers", label: "Tier preview", icon: "stairs" }, { key: "deadline", label: "Deadlines & rotation", icon: "timer" }, { key: "pairing", label: "Pairing simulation", icon: "qr_code_2" }, { key: "channels", label: "Channel preview", icon: "hub" }]} />
      {tab === "tiers" && <TierPreview t={t} />}
      {tab === "deadline" && <DeadlinePreview t={t} pl={pl} />}
      {tab === "pairing" && <PairingSim t={t} />}
      {tab === "channels" && <ChannelPreview t={t} />}
    </div>
  );
}

/* One surface, drawn at a tier. */
function Surface({ t, tier, late, paired, width = 250, device }) {
  const W = t.displayCanvasSize.width, H = t.displayCanvasSize.height;
  const aspect = isWebTP(t.touchPoint) ? 16 / 9 : W / H;
  const height = Math.round(width / aspect);
  const s = SAMPLE[tier];
  const locked = t.multiZone?.enabled ? t.multiZone.zones.filter((z) => z.trustZone === "ph_locked") : [];
  const qc = t.qrControl;
  return (
    <div style={{ width, height: Math.max(90, Math.min(height, 260)), background: t.backgroundColor, borderRadius: 4, position: "relative", overflow: "hidden", border: `1px solid ${T.border}`, boxSizing: "border-box", color: "#fff", fontFamily: "Roboto, sans-serif" }}>
      {locked.map((z, i) => <div key={z.id} style={{ position: "absolute", left: `${z.x}%`, top: `${z.y}%`, width: `${z.width}%`, height: `${z.height}%`, border: `1px dashed ${T.error}`, background: "rgba(255,77,79,0.08)", display: "flex", alignItems: "flex-end", justifyContent: "center", padding: 3, boxSizing: "border-box" }}><span style={{ fontSize: 7, color: "rgba(255,255,255,0.7)", display: "inline-flex", alignItems: "center", gap: 2 }}><Icon name="lock" size={8} style={{ color: T.error }} />menu · PH-locked</span></div>)}
      <div style={{ position: "absolute", left: locked.length ? `${Math.max(0, ...locked.map((z) => z.x + z.width))}%` : 0, top: 0, right: 0, bottom: 0, padding: "8% 6%", display: "flex", flexDirection: "column", justifyContent: "center", gap: 3, boxSizing: "border-box", opacity: late ? 0.55 : 1, transition: "opacity .2s" }}>
        <div style={{ fontSize: Math.max(10, width / 18), fontWeight: 700, lineHeight: 1.1 }}>{s.headline}</div>
        <div style={{ fontSize: Math.max(7, width / 32), opacity: 0.85, lineHeight: 1.2 }}>{s.sub}</div>
        {s.cta && tier !== "default" && <div style={{ marginTop: 3, alignSelf: "flex-start", fontSize: Math.max(7, width / 34), padding: "2px 7px", borderRadius: 9999, background: T.primary }}>{s.cta}</div>}
        <div style={{ position: "absolute", left: "6%", bottom: "7%", fontSize: Math.max(9, width / 20), fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 3 }}><Icon name="lock" size={Math.max(8, width / 30)} style={{ color: T.error }} />{s.price}</div>
      </div>
      {qc?.enabled && !isWebTP(t.touchPoint) && (
        <div style={{ position: "absolute", right: "2%", bottom: "3%", width: `${Math.max(12, (qc.phantomArea.width / W) * 100)}%`, aspectRatio: "1 / 1", background: paired ? "#fff" : T.info, borderRadius: 2, display: "flex", alignItems: "center", justifyContent: "center", border: paired ? `2px solid ${qc.connectedIconColour}` : "none", boxSizing: "border-box" }}>
          {paired ? <Icon name={(PAIRED_DEVICES.find((x) => x.key === device) || PAIRED_DEVICES[0]).icon} size={Math.max(10, width / 14)} style={{ color: qc.connectedIconColour }} /> : <Icon name="qr_code_2" size={Math.max(10, width / 12)} style={{ color: "#fff" }} />}
        </div>
      )}
      {late && <div style={{ position: "absolute", top: 4, right: 4, fontSize: 8, padding: "1px 5px", borderRadius: 9999, background: "rgba(0,0,0,0.6)", color: T.warning }}>arrived late — waits for next slot</div>}
    </div>
  );
}

function TierPreview({ t }) {
  const [lateP, setLateP] = useState(false);
  return (
    <>
      <div style={{ fontSize: 12, color: T.muted, lineHeight: 1.6, marginBottom: 12 }}>The same surface at each render tier. A surface paints at tier 1 immediately and <b>enhances in place</b> as better-targeted content resolves — never a blank wait. Price stays in the PH-locked region at every tier: the agent turns the dial, it never writes the number.</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: 14 }}>
        {TIERS.map((tier) => (
          <div key={tier.key} style={{ border: `1px solid ${T.borderSubtle}`, borderRadius: 8, padding: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
              <span style={{ width: 20, height: 20, borderRadius: 9999, background: T.primary, color: "#fff", fontSize: 11, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{tier.n}</span>
              <b style={{ fontSize: 13 }}>{tier.label}</b>
              {tier.key === "personalised" && <Segmented size="sm" value={lateP ? "late" : "in"} onChange={(v) => setLateP(v === "late")} options={[{ value: "in", label: "in window" }, { value: "late", label: "late" }]} />}
            </div>
            <Surface t={t} tier={tier.key} late={tier.key === "personalised" && lateP} paired={tier.key === "interactive"} width={250} />
            <div style={{ fontSize: 11.5, color: T.muted, marginTop: 8, lineHeight: 1.5 }}>{tier.hint}{tier.key === "personalised" && lateP && <> <b>Late:</b> the attribute resolved after this slot's visibility deadline, so the slot rendered at tier 2 and the personalised creative waits for the next rotation position — never swapped underneath a customer who is looking.</>}</div>
          </div>
        ))}
      </div>
      <Note>Personalisation is not guaranteed: given how blank a typical attribute envelope is, tiers 1–2 carry most impressions. Nothing above waits on tier 3 — navigation and rotation controls are never blocked.</Note>
    </>
  );
}

/* Rotation timeline: every slot's deadline, and which source can make it. */
function DeadlinePreview({ t, pl }) {
  const [sources, setSources] = useState([{ name: "Store context (Localised)", ms: 120 }, { name: "Loyalty profile (Personalised)", ms: 900 }, { name: "Partner weather feed", ms: 2500 }, { name: "Paired device profile", ms: 6000 }]);
  const [nav, setNav] = useState(null);
  const items = (pl?.items || []).filter((i) => i.enabled !== false).sort((a, b) => a.priority - b.priority);
  const cap = isCapped(t) ? slotCount(t) : items.length;
  const shown = items.slice(0, cap || items.length);
  const total = shown.reduce((s, i) => s + i.playbackDuration * 1000, 0) + PLATFORM_DEFAULTS.firstPaintBudgetMs;
  return (
    <>
      <div style={{ fontSize: 12, color: T.muted, lineHeight: 1.6, marginBottom: 12 }}>Visibility deadlines drive resolution, not a global timeout. Slot n's deadline is <code>first_paint_budget + Σ playbackDuration</code> of the slots before it — so a slow, high-value source can still win a later position. Click a slot to simulate the customer navigating to it manually: the deadline collapses to now and what is in view freezes.</div>
      <div style={{ border: `1px solid ${T.borderSubtle}`, borderRadius: 8, padding: 14, overflowX: "auto" }}>
        <div style={{ display: "flex", gap: 4, minWidth: 600 }}>
          <div style={{ width: `${(PLATFORM_DEFAULTS.firstPaintBudgetMs / total) * 100}%`, minWidth: 40, height: 34, background: T.surfaceMuted, borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: T.muted }}>paint {PLATFORM_DEFAULTS.firstPaintBudgetMs}ms</div>
          {shown.map((it, i) => {
            const dl = visibilityDeadlineMs(pl, i); const c = campaignById(it.campaignId); const isNav = nav === i;
            return (
              <div key={it.id} onClick={() => setNav(isNav ? null : i)} title={`Slot ${i + 1} — deadline ${dl}ms`} style={{ width: `${((it.playbackDuration * 1000) / total) * 100}%`, minWidth: 60, height: 34, background: isNav ? T.warning : c?.thumb || T.primary, borderRadius: 4, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontSize: 10, color: "#fff", cursor: "pointer", overflow: "hidden", padding: "0 4px", boxSizing: "border-box", border: isNav ? `2px solid ${T.text}` : "none" }}>
                <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%" }}>{i + 1} · {c?.name}</span>
                <span style={{ opacity: 0.85 }}>{isNav ? "navigated · deadline now · frozen" : `deadline ${dl >= 1000 ? (dl / 1000).toFixed(1) + "s" : dl + "ms"}`}</span>
              </div>
            );
          })}
        </div>
        <SectionLabel>Which source makes which slot</SectionLabel>
        <div style={{ display: "grid", gridTemplateColumns: `220px repeat(${shown.length}, minmax(60px, 1fr))`, gap: 4, fontSize: 12, minWidth: 600 }}>
          <div />
          {shown.map((it, i) => <div key={it.id} style={{ textAlign: "center", color: T.micro, fontSize: 11 }}>slot {i + 1}</div>)}
          {sources.map((s, si) => (
            <React.Fragment key={si}>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input value={s.name} onChange={(e) => setSources(sources.map((x, k) => (k === si ? { ...x, name: e.target.value } : x)))} style={{ ...small, height: 24, fontSize: 11.5, flex: 1 }} />
                <input type="number" value={s.ms} onChange={(e) => setSources(sources.map((x, k) => (k === si ? { ...x, ms: Number(e.target.value) } : x)))} style={{ ...small, height: 24, fontSize: 11.5, width: 66 }} /><span style={{ fontSize: 10, color: T.micro }}>ms</span>
              </div>
              {shown.map((it, i) => {
                const dl = nav === i ? 0 : visibilityDeadlineMs(pl, i);
                const ok = s.ms <= dl;
                return <div key={it.id} style={{ height: 24, borderRadius: 4, background: ok ? "rgba(82,196,26,0.15)" : "rgba(255,77,79,0.08)", color: ok ? T.success : T.error, display: "flex", alignItems: "center", justifyContent: "center" }}><Icon name={ok ? "check" : "close"} size={14} /></div>;
              })}
            </React.Fragment>
          ))}
        </div>
      </div>
      <Note>A rule (or a variant) on an attribute that has not resolved by the slot's deadline is false, not pending — that slot renders the best tier available. Deferred visibility buys time: dwell time and page position are personalisation levers. Open question 18: does the frozen slot upgrade the instant the customer navigates away, or only on the next scheduled rotation?</Note>
    </>
  );
}

/* Pairing: Unpaired → Scanned → Paired, display and phone side by side. */
function PairingSim({ t }) {
  const [step, setStep] = useState(0);
  const [device, setDevice] = useState("phone");
  const [conn, setConn] = useState("connected_display");
  const steps = ["Unpaired — QR visible", "Scanned — socket opens", "Paired — profile synced, tier 3", "Customer acts — order state back"];
  const tier = step === 0 ? "localised" : step === 1 ? "localised" : step === 2 ? "personalised" : "interactive";
  const tpl = MOBILE_TEMPLATE_DEFS.find((m) => m.name === t.qrControl?.mobileSiteTemplate) || MOBILE_TEMPLATE_DEFS[0];
  const visibleItems = tpl.items.filter((it) => it.states.includes(conn));
  if (!t.qrControl?.enabled && !isWebTP(t.touchPoint)) return <Empty icon="qr_code_2">This display type has no QR Control (phantom zone). Enable it on the Display Types screen to simulate pairing.</Empty>;
  if (isWebTP(t.touchPoint)) return <Empty icon="devices">On web the pairing overlay lives on the Layout template, which is out of this release. Pick a signage or kiosk display type.</Empty>;
  return (
    <>
      <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
        {steps.map((s, i) => <div key={i} onClick={() => setStep(i)} style={{ flex: 1, minWidth: 150, padding: "8px 10px", borderRadius: 6, cursor: "pointer", fontSize: 12, border: `1px solid ${i === step ? T.primary : T.borderSubtle}`, background: i === step ? T.primaryTint : "#fff", color: i === step ? T.primary : T.text, display: "flex", gap: 6, alignItems: "center" }}><span style={{ width: 18, height: 18, borderRadius: 9999, background: i <= step ? T.primary : T.border, color: "#fff", fontSize: 10, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{i + 1}</span>{s}</div>)}
      </div>
      <div style={{ display: "flex", gap: 24, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 12, color: T.micro, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 6 }}>Display · {tier}</div>
          <Surface t={t} tier={tier} paired={step >= 2} width={360} device={device} />
          <div style={{ marginTop: 8, display: "flex", gap: 6, alignItems: "center", fontSize: 12 }}>
            <span style={{ color: T.muted }}>Device class</span>
            {PAIRED_DEVICES.map((x) => <span key={x.key} onClick={() => setDevice(x.key)} style={{ cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 3, padding: "2px 8px", borderRadius: 9999, border: `1px solid ${device === x.key ? T.primary : T.border}`, color: device === x.key ? T.primary : T.muted, background: device === x.key ? T.primaryTint : "#fff" }}><Icon name={x.icon} size={13} />{x.label}</span>)}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 12, color: T.micro, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 6 }}>Phone · {tpl.name}</div>
          <div style={{ width: 190, height: 330, borderRadius: 18, border: `2px solid ${T.text}`, background: "#fff", overflow: "hidden", display: "flex", flexDirection: "column" }}>
            <div style={{ padding: "10px 12px", background: T.text, color: "#fff", fontSize: 11, fontWeight: 500 }}>{tpl.header.replace("${BrandName}", "KFC").replace("${StoreName}", "Oxford St")}</div>
            {step === 0 ? <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6, color: T.muted, fontSize: 11 }}><Icon name="qr_code_scanner" size={40} style={{ color: T.primary }} />Scan the QR on the display</div>
            : step === 1 ? <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6, color: T.muted, fontSize: 11 }}><Icon name="sync" size={34} style={{ color: T.primary }} />Session {"s_" + t.id.slice(0, 4)}… pairing<div style={{ fontSize: 10 }}>agent reads PH's published catalogue</div></div>
            : <div style={{ flex: 1, padding: 10, display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ fontSize: 11, color: T.success, display: "flex", alignItems: "center", gap: 4 }}><Icon name="check_circle" size={13} />Paired to Counter board</div>
                <div style={{ fontSize: 10, color: T.micro }}>Profile + selected SKUs shared over the socket; PH validated against the live eligible set.</div>
                {visibleItems.map((it) => <div key={it.name} style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 8px", borderRadius: 6, border: `1px solid ${T.borderSubtle}`, fontSize: 11 }}><Icon name={it.icon} size={14} style={{ color: T.primary }} />{it.name}</div>)}
                {step === 3 && <div style={{ marginTop: "auto", padding: 8, borderRadius: 6, background: T.primaryTint, fontSize: 10.5, color: T.primary }}>Order updated · £12.95 (PH-locked) · recommendations refreshed</div>}
              </div>}
          </div>
          <div style={{ marginTop: 8, fontSize: 11.5, color: T.muted }}>Connection state <select value={conn} onChange={(e) => setConn(e.target.value)} style={{ ...small, height: 24, fontSize: 11, width: 170, display: "inline-block", marginLeft: 6 }}>{CONNECTION_STATES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</select></div>
        </div>
        <div style={{ flex: 1, minWidth: 220, fontSize: 12, color: T.muted, lineHeight: 1.7 }}>
          <b style={{ color: T.text }}>What happens</b>
          <ol style={{ margin: "4px 0 0", paddingLeft: 18 }}>
            <li>Session ID generated per page load; QR rendered in the phantom area.</li>
            <li>WebSocket pairs phone ⇄ page. The QR is replaced in place by the connected-device indicator.</li>
            <li>Agent reads the published catalogue, shares profile + selected SKUs; PH validates against the live eligible set; page re-renders at tier 3.</li>
            <li>Loop continues bidirectionally: order state back, recommendations updated.</li>
          </ol>
          <div style={{ marginTop: 8 }}>Connection state is a <b>second, orthogonal axis</b>: CTAs and menu items resolve on it (a "Join the Queue" CTA belongs in Connected Display State regardless of tier). A dropped socket reverts to the last stable tier — never an empty surface.</div>
        </div>
      </div>
    </>
  );
}

function ChannelPreview({ t }) {
  return (
    <>
      <div style={{ fontSize: 12, color: T.muted, lineHeight: 1.6, marginBottom: 12 }}>The same surface per channel, and where the ladder freezes (spec §6.8).</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 12 }}>
        {CHANNELS.map((ch) => (
          <div key={ch.key} style={{ border: `1px solid ${T.borderSubtle}`, borderRadius: 8, padding: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8, fontSize: 13 }}><Icon name={ch.icon} size={17} style={{ color: T.primary }} /><b>{ch.label}</b></div>
            <div style={{ display: "flex", gap: 3, marginBottom: 8 }}>
              {TIERS.map((tier) => <div key={tier.key} title={tier.label} style={{ flex: 1, height: 8, borderRadius: 2, background: tier.n <= ch.max ? T.primary : T.surfaceMuted }} />)}
            </div>
            <div style={{ fontSize: 11, color: T.micro, marginBottom: 8 }}>{ch.max === 4 ? "Full ladder · live upgrades" : `Freezes at tier ${ch.max} · ${ch.max === 2 ? "localised at send time" : ""}`}</div>
            {ch.key === "email" || ch.key === "messaging" ? (
              <div style={{ border: `1px solid ${T.borderSubtle}`, borderRadius: 6, padding: 10, fontSize: 11, background: T.surfaceAlt }}>
                <div style={{ fontWeight: 600 }}>{SAMPLE.localised.headline}</div>
                <div style={{ color: T.muted, marginTop: 2 }}>{ch.key === "messaging" ? "Message 1 of 2 · " : ""}{SAMPLE.localised.sub}</div>
                <div style={{ marginTop: 6, display: "inline-flex", alignItems: "center", gap: 3, fontWeight: 600 }}><Icon name="lock" size={11} style={{ color: T.error }} />{SAMPLE.localised.price}</div>
              </div>
            ) : <Surface t={t} tier="personalised" width={206} paired={ch.key !== "signage" ? false : true} />}
            <div style={{ fontSize: 11.5, color: T.muted, marginTop: 8 }}>{ch.note}</div>
          </div>
        ))}
      </div>
    </>
  );
}
