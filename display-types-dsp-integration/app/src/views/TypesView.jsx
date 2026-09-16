import React, { useState, useMemo } from "react";
import { T, Icon, Pill, Btn, Label, Panel, DefaultSelect, IconSelect, Toggle, SubSettings, Note, Row, Col, Grid, Fld, ctl, small, swatch, inputStyle, Callout, JsonBlock, Segmented, ZONE_COLOURS, ADVERTISER_COLOUR, uid } from "../ui.jsx";
import {
  TOUCH_POINTS, isWebTP, tpIcon, ASSET_POSITIONS, ASSET_FILLS, CAMPAIGN_TRANSITIONS, AUTO_ROTATION, AUTO_PLAY, ROTATION_CAPS, UNLIMITED,
  PHANTOM_POSITIONS, PHANTOM_SIZING_MODES, QR_POSITIONS, PLATFORM_DEFAULTS, FEATURES, COMPANY_FEATURE_AVAILABILITY, MIST_ZONES, VISION_MODES, DETECTION_PRESETS,
  WEB_ELEMENT_GROUPS, WEB_ELEMENTS, webEl, elementConfig, caps, SLOT_OWNERS, STORE_SCOPES, TRUST_ZONES, displayType, slot, resizeSlots, rotationCap, isCapped, slotCount, capLabel, toDisplayTypeRecord, setIn, BREAKPOINTS, playlist as mkPlaylist, shareOfVoice,
} from "../model/schema.js";
import { ANY_PARTNER, RTB, ALLOW_LIST, partnerById, providerOf, partnerColour, isDsp, effectiveLists, isBlocked, ownerAssignment } from "../model/sellside.js";
import { MOBILE_TEMPLATES, PAIRED_DEVICES, DISPLAYS, STORES } from "../model/data.js";
import { CONNECTED_ASSET } from "../assets.js";

/* Structural markers shown against a display type in the list. */
const STRUCTURE_MARKERS = [
  { key: "phantom", icon: "qr_code_2", label: "QR Control (phantom zone) enabled", test: (t) => t.qrControl.enabled },
  { key: "zones", icon: "grid_view", label: "Multi-zone layout", test: (t) => t.multiZone.enabled },
  { key: "slots", icon: "view_week", label: "Capped rotation with assigned slots", test: (t) => isCapped(t) },
  { key: "locked", icon: "lock", label: "Has a PH-locked region", test: (t) => (t.multiZone.zones || []).some((z) => z.trustZone === "ph_locked") || (t.phExtensions.slots || []).some((s) => s.trustZone === "ph_locked") },
];

const SLOT_GRID = "22px 0.9fr 86px 1.25fr 84px";

export default function TypesView({ types, setTypes, playlists, setPlaylists, sel, setSel, partners, companyLists, goToPartners, goToPlaylist }) {
  const [open, setOpen] = useState({ playlist: true, qr: true, features: false, zones: true, data: false });
  const [pendingEl, setPendingEl] = useState(null);
  const [filter, setFilter] = useState("all");
  const d = types.find((t) => t.id === sel) || types[0];
  const set = (patch) => setTypes(types.map((t) => (t.id === d.id ? { ...t, ...patch } : t)));
  const setPath = (path, value) => setTypes(types.map((t) => (t.id === d.id ? setIn(t, path, value) : t)));
  const toggle = (k) => setOpen({ ...open, [k]: !open[k] });
  const plName = (id) => playlists.find((p) => p.id === id)?.name || "—";
  const c = caps(d);
  const ps = d.playlistSettings;
  const cap = rotationCap(d);
  const slots = d.phExtensions.slots || [];
  const assigned = DISPLAYS.filter((x) => x.displayTypeId === d.id);

  const advertiserSlots = slots.filter((sl) => sl.owner === "advertiser");
  const brokenSlots = advertiserSlots.filter((sl) => { const p = sl.partnerId && sl.partnerId !== ANY_PARTNER ? partnerById(partners, sl.partnerId) : null; return p && p.status !== "connected"; });

  const ensureZonePlaylist = (n) => {
    const name = `${d.name} / Zone ${n}`;
    const found = playlists.find((p) => p.name === name);
    if (found) return found.id;
    const id = `pl_zone_${d.id}_${n}`;
    setPlaylists((prev) => (prev.some((p) => p.id === id) ? prev : [...prev, mkPlaylist({ id, name, autoCreatedFor: d.id })]));
    return id;
  };
  const setCap = (v) => {
    const n = v === null ? null : Number(v);
    const eff = n === null ? PLATFORM_DEFAULTS.playlistSettings.maximumCampaignsPlayedInRotation : n;
    setTypes(types.map((t) => (t.id === d.id ? { ...t, playlistSettings: { ...t.playlistSettings, maximumCampaignsPlayedInRotation: n }, phExtensions: { ...t.phExtensions, slots: eff === UNLIMITED ? [] : resizeSlots(t.phExtensions.slots, eff) } } : t)));
  };
  const setZone = (i, patch) => setPath("multiZone.zones", d.multiZone.zones.map((z, k) => (k === i ? { ...z, ...patch } : z)));
  const setSlot = (i, patch) => setPath("phExtensions.slots", slots.map((q, k) => (k === i ? { ...q, ...patch } : q)));

  const addType = () => {
    const id = uid("dt");
    const pid = `pl_${id}`;
    setPlaylists([...playlists, mkPlaylist({ id: pid, name: "New Display Type Playlist", autoCreatedFor: id })]);
    setTypes([...types, displayType({ id, name: "", touchPoint: "Digital Signage", defaultPlaylistId: pid })]);
    setSel(id);
  };
  const duplicate = () => {
    const id = uid("dt");
    setTypes([...types, { ...JSON.parse(JSON.stringify(d)), id, name: `${d.name} (copy)`, updatedAt: null }]);
    setSel(id);
  };
  const removeType = () => {
    if (assigned.length) return;
    const next = types.filter((t) => t.id !== d.id);
    setTypes(next); setSel(next[0]?.id);
  };

  const visible = types.filter((t) => filter === "all" || t.touchPoint === filter);

  return (
    <div style={{ display: "flex", gap: 20, alignItems: "flex-start", flexWrap: "wrap" }}>
      {/* ------------------------------------------------ list */}
      <div style={{ width: 190, flexShrink: 0 }}>
        <Btn variant="primary" style={{ width: "100%", justifyContent: "center", marginBottom: 10 }} onClick={addType}><Icon name="add" size={16} />New display type</Btn>
        <select value={filter} onChange={(e) => setFilter(e.target.value)} style={{ ...small, marginBottom: 8 }}>
          <option value="all">All touch points ({types.length})</option>
          {TOUCH_POINTS.map((t) => <option key={t.name} value={t.name}>{t.name} ({types.filter((x) => x.touchPoint === t.name).length})</option>)}
        </select>
        <div style={{ border: `1px solid ${T.borderSubtle}`, borderRadius: 8, overflow: "hidden" }}>
          {visible.map((t) => {
            const a = t.id === d.id;
            const n = DISPLAYS.filter((x) => x.displayTypeId === t.id).length;
            return (
              <div key={t.id} onClick={() => setSel(t.id)} style={{ padding: "10px 12px", cursor: "pointer", borderBottom: `1px solid ${T.borderSubtle}`, background: a ? T.primaryTint : "transparent" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
                  <Icon name={tpIcon(t.touchPoint)} size={17} style={{ color: a ? T.primary : T.muted }} />
                  <span style={{ fontSize: 13, color: a ? T.primary : T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{t.name || <i style={{ color: T.micro }}>Unnamed</i>}</span>
                </div>
                <div style={{ fontSize: 11, color: T.muted, marginTop: 3, marginLeft: 24 }}>
                  {isWebTP(t.touchPoint) ? `${webEl(t.element?.type).name} · ${t.element?.breakpoints.desktop.viewportWidth}px` : `${t.displayCanvasSize.width}×${t.displayCanvasSize.height}`}
                  {isCapped(t) && <> · {slotCount(t)} slots</>}
                  {n > 0 && <> · {n} display{n > 1 ? "s" : ""}</>}
                </div>
                <div style={{ display: "flex", gap: 5, marginTop: 5, marginLeft: 24, flexWrap: "wrap" }}>
                  {STRUCTURE_MARKERS.filter((m) => m.test(t)).map((m) => (
                    <span key={m.key} title={m.label} style={{ width: 20, height: 20, borderRadius: 4, background: m.key === "locked" ? "rgba(255,77,79,0.10)" : T.primaryTint, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                      <Icon name={m.icon} size={13} style={{ color: m.key === "locked" ? T.error : T.primary }} />
                    </span>
                  ))}
                  {FEATURES.filter((f) => COMPANY_FEATURE_AVAILABILITY[f.key] && t.enabledFeatures[f.key]?.enabled).map((f) => (
                    <span key={f.key} title={f.label} style={{ width: 20, height: 20, borderRadius: 4, background: "rgba(82,196,26,0.12)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                      <Icon name={f.icon} size={13} style={{ color: T.success }} />
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ------------------------------------------------ form */}
      <div style={{ width: 372, flexShrink: 0 }}>
        <div style={{ marginBottom: 16 }}>
          <Label>Touch Point</Label>
          <IconSelect value={d.touchPoint} onChange={(v) => set({ touchPoint: v, element: isWebTP(v) ? (d.element || elementConfig("hero")) : d.element })} options={TOUCH_POINTS} />
          {isWebTP(d.touchPoint) && (
            <div style={{ marginTop: 14 }}>
              <Label required>Element Type</Label>
              <select value={d.element?.type} onChange={(e) => { if (e.target.value !== d.element?.type) setPendingEl(e.target.value); }} style={inputStyle}>
                {WEB_ELEMENT_GROUPS.map((g) => <optgroup key={g} label={g}>{WEB_ELEMENTS.filter((x) => x.group === g).map((x) => <option key={x.key} value={x.key}>{x.name}</option>)}</optgroup>)}
              </select>
              <div style={{ padding: 10, marginTop: 8, borderRadius: 6, background: T.surfaceAlt, border: `1px solid ${T.borderSubtle}`, fontSize: 11.5, color: T.muted, lineHeight: 1.5 }}>
                {webEl(d.element?.type).desc}
                <div style={{ marginTop: 5, color: T.micro }}>Plays: <b style={{ color: T.text }}>{webEl(d.element?.type).plays}</b> · {c.campaigns ? (c.grid ? "all campaigns render together" : c.rotation ? "one at a time, rotates" : "single campaign") : "renders no campaigns"}</div>
              </div>
              {pendingEl && (
                <Callout tone="warning" style={{ marginTop: 10 }}>
                  <b>Change element type to {webEl(pendingEl).name}?</b>
                  <div style={{ marginTop: 4, color: T.muted }}>Layout settings are specific to the element type — slot count, columns, items shown, aspect ratio and width mode reset to the defaults for {webEl(pendingEl).name}.</div>
                  <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                    <Btn variant="primary" style={{ height: 28, fontSize: 12.5 }} onClick={() => {
                      const el = elementConfig(pendingEl);
                      const n = (WEB_ELEMENTS.find((x) => x.key === pendingEl) || {}).plays === "static" ? UNLIMITED : (ELEMENT_SLOTS[pendingEl] || 1);
                      setTypes(types.map((t) => (t.id === d.id ? { ...t, element: el, playlistSettings: { ...t.playlistSettings, maximumCampaignsPlayedInRotation: n }, phExtensions: { ...t.phExtensions, slots: n === UNLIMITED ? [] : resizeSlots([], n) }, ...(t.phExtensions.nameAuto ? { name: webEl(pendingEl).name } : {}) } : t)));
                      setPendingEl(null);
                    }}>Change and reset</Btn>
                    <Btn style={{ height: 28, fontSize: 12.5 }} onClick={() => setPendingEl(null)}>Cancel</Btn>
                  </div>
                </Callout>
              )}
            </div>
          )}
        </div>

        <div style={{ marginBottom: 16 }}>
          <Label required>{isWebTP(d.touchPoint) ? "Element Name" : "Display Type Name"}</Label>
          <input value={d.name} autoFocus={!d.name} placeholder="Name this display type" onChange={(e) => setTypes(types.map((t) => (t.id === d.id ? { ...t, name: e.target.value, phExtensions: { ...t.phExtensions, nameAuto: false } } : t)))}
            style={{ ...inputStyle, borderColor: d.name ? T.border : T.warning }} />
          {isWebTP(d.touchPoint) && d.phExtensions.nameAuto && <div style={{ fontSize: 11.5, color: T.muted, marginTop: 4 }}>Following the element selection. Edit to set your own name.</div>}
        </div>

        <div style={{ marginBottom: 16 }}>
          <Label>Description</Label>
          <textarea value={d.description || ""} onChange={(e) => set({ description: e.target.value })} rows={3} style={{ ...inputStyle, height: "auto", resize: "vertical", lineHeight: 1.5 }} />
        </div>

        {!isWebTP(d.touchPoint) && (
          <div style={{ marginBottom: 16 }}>
            <Label required info="The native resolution of the canvas the player renders to. Assets are generated at this size.">Display Canvas Size (Resolution)</Label>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ color: T.muted }}>W</span>
              <input type="number" value={d.displayCanvasSize.width} onChange={(e) => setPath("displayCanvasSize.width", Number(e.target.value))} style={{ ...inputStyle, width: 110 }} />
              <span style={{ color: T.muted }}>H</span>
              <input type="number" value={d.displayCanvasSize.height} onChange={(e) => setPath("displayCanvasSize.height", Number(e.target.value))} style={{ ...inputStyle, width: 110 }} />
              <span style={{ fontSize: 11.5, color: T.micro }}>{d.displayCanvasSize.width >= d.displayCanvasSize.height ? "landscape" : "portrait"}</span>
            </div>
          </div>
        )}

        <div style={{ marginBottom: 16 }}>
          <Label>Background Color</Label>
          <input type="color" value={d.backgroundColor} onChange={(e) => set({ backgroundColor: e.target.value })} style={{ width: 48, height: 48, border: `1px solid ${T.border}`, borderRadius: 8, padding: 4, cursor: "pointer", background: "#fff" }} />
        </div>

        {c.campaigns ? (
          <div>
            <Label right={d.defaultPlaylistId && <Btn variant="text" style={{ height: 22, fontSize: 12, padding: 0 }} onClick={() => goToPlaylist(d.defaultPlaylistId)}>Open playlist<Icon name="arrow_forward" size={13} /></Btn>}>Default Playlist</Label>
            <select value={d.defaultPlaylistId || ""} onChange={(e) => set({ defaultPlaylistId: e.target.value })} style={inputStyle}>
              {playlists.map((p) => <option key={p.id} value={p.id}>{p.name}{p.autoCreatedFor === d.id ? " (auto-created)" : ""}</option>)}
            </select>
          </div>
        ) : (
          <Callout tone="info" icon="article"><b>{webEl(d.element?.type).name}</b> renders no campaigns, so it has no playlist. Its content is authored directly.</Callout>
        )}

        {/* ---- PLAYLIST SETTINGS ---- */}
        {c.campaigns && (
          <Panel title="Playlist Settings" open={open.playlist} onToggle={() => toggle("playlist")}
            badge={<InheritBadge n={Object.values(ps).filter((v) => v !== null && v !== undefined).length} />}>
            <Row>
              <Col><Label>Asset Position</Label><DefaultSelect value={ps.assetPosition} onChange={(v) => setPath("playlistSettings.assetPosition", v)} fallback={PLATFORM_DEFAULTS.playlistSettings.assetPosition} options={ASSET_POSITIONS} /></Col>
              <Col><Label>Asset Fill</Label><DefaultSelect value={ps.assetFill} onChange={(v) => setPath("playlistSettings.assetFill", v)} fallback={PLATFORM_DEFAULTS.playlistSettings.assetFill} options={ASSET_FILLS} /></Col>
            </Row>
            <Row>
              <Col><Label>Maximum Campaigns Played In Rotation</Label>
                <DefaultSelect value={ps.maximumCampaignsPlayedInRotation} onChange={setCap} fallback={capLabel(PLATFORM_DEFAULTS.playlistSettings.maximumCampaignsPlayedInRotation)}
                  options={ROTATION_CAPS.map((n) => ({ value: String(n), label: capLabel(n) }))} />
                <div style={{ fontSize: 11, color: T.micro, marginTop: 4 }}>Stored as <code>{String(ps.maximumCampaignsPlayedInRotation === null ? "null" : ps.maximumCampaignsPlayedInRotation)}</code> · −1 = unlimited{isCapped(d) && <> · share of voice 1/{slotCount(d)}</>}</div>
              </Col>
              <Col><Label>Campaign Transition</Label><DefaultSelect value={ps.campaignTransition} onChange={(v) => setPath("playlistSettings.campaignTransition", v)} fallback={PLATFORM_DEFAULTS.playlistSettings.campaignTransition} options={CAMPAIGN_TRANSITIONS} /></Col>
            </Row>
            {c.rotation ? (
              <Row>
                <Col><Label>Campaign Auto-Rotation</Label><DefaultSelect value={ps.campaignAutoRotation} onChange={(v) => setPath("playlistSettings.campaignAutoRotation", v)} fallback={PLATFORM_DEFAULTS.playlistSettings.campaignAutoRotation} options={AUTO_ROTATION} /></Col>
                <Col><Label>Campaign Auto-Play</Label><DefaultSelect value={ps.campaignAutoPlay} onChange={(v) => setPath("playlistSettings.campaignAutoPlay", v)} fallback={PLATFORM_DEFAULTS.playlistSettings.campaignAutoPlay} options={AUTO_PLAY} /></Col>
              </Row>
            ) : (
              <Note>{c.grid ? "All campaigns render together in this element, so rotation and transition do not apply. The cap sets how many cells are rendered." : "This element renders no campaigns, so playback settings do not apply."}</Note>
            )}
            <Note><span style={{ color: T.muted }}>Default (…)</span> = inherited from the company default. A dark value is an override on this display type. Each display assigned here can override any of these again — and a later change here never reaches a display that has.</Note>

            {isCapped(d) && (
              <div style={{ marginTop: 16 }}>
                <Label info="A capped rotation is what makes a position sellable or delegable. Ownership stamps onto every render event and cannot be backfilled.">Slot assignment</Label>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
                  {slots.map((sl, i) => {
                    const o = SLOT_OWNERS[sl.owner];
                    const rtb = sl.owner === "advertiser" && (!sl.advertiser || sl.advertiser === RTB);
                    const p = sl.owner === "advertiser" && sl.partnerId && sl.partnerId !== ANY_PARTNER ? partnerById(partners, sl.partnerId) : null;
                    const broken = sl.owner === "advertiser" && p && p.status !== "connected";
                    const col = p && !p.system ? partnerColour(p) : o.colour;
                    return (
                      <div key={i} style={{ border: `1px solid ${broken ? T.error : col}`, borderStyle: rtb ? "dashed" : "solid", borderRadius: 6, padding: "6px 10px", background: o.bg, minWidth: 96, position: "relative" }}>
                        <div style={{ fontSize: 10.5, color: T.micro }}>Slot {i + 1}</div>
                        <div style={{ fontSize: 12, color: broken ? T.error : col, fontWeight: 500, display: "flex", alignItems: "center", gap: 4 }}><Icon name={p && providerOf(p) ? providerOf(p).icon : o.icon} size={13} />{o.label}</div>
                        <div style={{ fontSize: 11, color: broken ? T.error : T.muted, marginTop: 2 }}>{ownerAssignment(sl, partners, companyLists)}</div>
                        {sl.trustZone === "ph_locked" && <Icon name="lock" size={12} title="PH-locked" style={{ position: "absolute", top: 6, right: 6, color: T.error }} />}
                      </div>
                    );
                  })}
                </div>
                <div style={{ border: `1px solid ${T.borderSubtle}`, borderRadius: 6, overflow: "hidden" }}>
                  <div style={{ display: "grid", gridTemplateColumns: SLOT_GRID, background: T.surfaceAlt, borderBottom: `1px solid ${T.borderSubtle}`, fontSize: 12, fontWeight: 600, color: T.muted }}>
                    {["#", "Label", "Owner", "Assigned to", "Trust zone"].map((h) => <div key={h} style={{ padding: "7px 8px" }}>{h}</div>)}
                  </div>
                  {slots.map((sl, i) => {
                    const o = SLOT_OWNERS[sl.owner];
                    const pid = sl.partnerId || ANY_PARTNER;
                    const p = pid === ANY_PARTNER ? null : partnerById(partners, pid);
                    const seats = p ? (p.seats || []) : [];
                    const eff = effectiveLists(p, companyLists);
                    const sellableSeats = seats.filter((x) => !isBlocked(x.name, eff));
                    const namedButBlocked = sl.owner === "advertiser" && sl.advertiser && sl.advertiser !== RTB && sl.advertiser !== ALLOW_LIST && isBlocked(sl.advertiser, eff);
                    const broken = sl.owner === "advertiser" && p && p.status !== "connected";
                    return (
                      <div key={i} style={{ display: "grid", gridTemplateColumns: SLOT_GRID, alignItems: "start", borderBottom: i < slots.length - 1 ? `1px solid ${T.borderSubtle}` : "none" }}>
                        <div style={{ padding: "9px 8px", color: T.micro, fontSize: 12 }}>{i + 1}</div>
                        <div style={{ padding: "5px 6px" }}><input value={sl.label} onChange={(e) => setSlot(i, { label: e.target.value })} style={{ ...small, height: 26, fontSize: 12.5 }} /></div>
                        <div style={{ padding: "5px 6px" }}>
                          <select value={sl.owner} onChange={(e) => setSlot(i, { owner: e.target.value, partnerId: e.target.value === "advertiser" ? ANY_PARTNER : null, advertiser: e.target.value === "advertiser" ? RTB : null, storeScope: e.target.value === "retail" ? "Store staff" : null, quota: e.target.value === "retail" ? { mode: "count", value: 1 } : null })}
                            style={{ ...small, height: 26, fontSize: 12, color: o.colour }}>
                            {Object.values(SLOT_OWNERS).map((v) => <option key={v.key} value={v.key}>{v.label}</option>)}
                          </select>
                        </div>
                        <div style={{ padding: "5px 6px" }}>
                          {sl.owner === "advertiser" ? (
                            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                              <select value={pid} onChange={(e) => {
                                const np = e.target.value; const next = partnerById(partners, np); const nextEff = effectiveLists(next, companyLists);
                                const keep = (sl.advertiser === ALLOW_LIST && nextEff.allowList.length > 0) || (next && (next.seats || []).some((x) => x.name === sl.advertiser) && !isBlocked(sl.advertiser, nextEff));
                                setSlot(i, { partnerId: np, advertiser: keep ? sl.advertiser : RTB });
                              }} style={{ ...small, height: 26, fontSize: 12, color: broken ? T.error : (p && !p.system ? partnerColour(p) : ADVERTISER_COLOUR) }}>
                                <option value={ANY_PARTNER}>Any connected DSP</option>
                                {partners.map((x) => <option key={x.id} value={x.id}>{x.name}{x.status !== "connected" ? " (not connected)" : ""}</option>)}
                              </select>
                              <select value={sl.advertiser || RTB} onChange={(e) => setSlot(i, { advertiser: e.target.value })} disabled={pid === ANY_PARTNER}
                                style={{ ...small, height: 26, fontSize: 12, background: pid === ANY_PARTNER ? T.surfaceAlt : "#fff", color: !sl.advertiser || sl.advertiser === RTB ? ADVERTISER_COLOUR : T.text }}>
                                <option value={RTB}>{eff.blockList.length ? `RTB bidding — any except ${eff.blockList.length} blocked` : "RTB bidding (open)"}</option>
                                {isDsp(p) && <option value={ALLOW_LIST} disabled={eff.allowList.length === 0}>{eff.allowList.length ? `Whitelist only (${eff.allowList.length})` : "Whitelist only — list empty"}</option>}
                                {sellableSeats.map((a) => <option key={a.id} value={a.name}>{a.name}</option>)}
                                {namedButBlocked && <option value={sl.advertiser}>{sl.advertiser} — blocked</option>}
                              </select>
                              {namedButBlocked && <div style={{ fontSize: 10.5, color: T.error, display: "flex", gap: 3 }}><Icon name="block" size={11} />On the blacklist — this position cannot fill.</div>}
                              {broken && <div style={{ fontSize: 10.5, color: T.error, display: "flex", gap: 3 }}><Icon name="error" size={11} />Not connected</div>}
                            </div>
                          ) : sl.owner === "retail" ? (
                            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                              <select value={sl.storeScope || "Store staff"} onChange={(e) => setSlot(i, { storeScope: e.target.value })} style={{ ...small, height: 26, fontSize: 12 }}>
                                {STORE_SCOPES.map((x) => <option key={x}>{x}</option>)}
                              </select>
                              <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                                <span style={{ fontSize: 10.5, color: T.micro }}>Quota</span>
                                <input type="number" min="1" value={sl.quota?.value ?? 1} onChange={(e) => setSlot(i, { quota: { mode: sl.quota?.mode || "count", value: Number(e.target.value) } })} style={{ ...small, height: 24, fontSize: 11.5, width: 48, padding: "0 6px" }} />
                                <select value={sl.quota?.mode || "count"} onChange={(e) => setSlot(i, { quota: { mode: e.target.value, value: sl.quota?.value ?? 1 } })} style={{ ...small, height: 24, fontSize: 11.5, padding: "0 4px" }}>
                                  <option value="count">campaigns</option><option value="percent">% of plays</option>
                                </select>
                              </div>
                            </div>
                          ) : <span style={{ fontSize: 11.5, color: T.micro, display: "block", paddingTop: 5 }}>Based on priority</span>}
                        </div>
                        <div style={{ padding: "5px 6px" }}>
                          <select value={sl.trustZone || "agent_addressable"} onChange={(e) => setSlot(i, { trustZone: e.target.value })}
                            style={{ ...small, height: 26, fontSize: 11.5, color: TRUST_ZONES[sl.trustZone || "agent_addressable"].colour }}>
                            {Object.values(TRUST_ZONES).map((z) => <option key={z.key} value={z.key}>{z.key === "ph_locked" ? "PH-locked" : "Agent"}</option>)}
                          </select>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 5, fontSize: 11.5, color: T.muted, lineHeight: 1.5 }}>
                  <span><b style={{ color: T.primary }}>Headquarters</b> — filled from the eligible HQ campaigns by campaign priority.</span>
                  <span><b style={{ color: ADVERTISER_COLOUR }}>Advertiser</b> — demand reaches the position through a partner DSP: RTB by default, or reserved to one of that partner's advertisers.</span>
                  <span><b style={{ color: T.warning }}>Stores</b> — delegated to store level within a quota, enforced at render time as well as authoring time.</span>
                  <span><b style={{ color: T.error }}>PH-locked</b> — price, offer terms, disclosures. No external creative, agent or store campaign can address it.</span>
                </div>
                {brokenSlots.length > 0 && (
                  <Callout tone="error" style={{ marginTop: 10 }} action={<Btn variant="outline" style={{ height: 26, fontSize: 12 }} onClick={goToPartners}>Fix connection</Btn>}>
                    {brokenSlots.length} advertiser {brokenSlots.length === 1 ? "position is" : "positions are"} assigned to a partner that is not connected. {brokenSlots.length === 1 ? "It" : "They"} fall back to the next eligible Headquarters campaign until the connection is fixed.
                  </Callout>
                )}
              </div>
            )}
          </Panel>
        )}

        {/* ---- QR CONTROL (PHANTOM ZONE) — as on the platform form ---- */}
        {!isWebTP(d.touchPoint) && (
          <Panel title="QR Control (Phantom Zone)" open={open.qr} onToggle={() => toggle("qr")}
            badge={d.qrControl.enabled ? <Pill color={T.success} bg="rgba(82,196,26,0.12)">enabled</Pill> : <Pill color={T.muted} bg="rgba(0,0,0,0.04)">off</Pill>}>
            <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 14 }}>
              <span style={{ fontSize: 13.5 }}>Enable QR Control (Phantom Zone)</span>
              <Toggle on={d.qrControl.enabled} onChange={(v) => setPath("qrControl.enabled", v)} />
            </div>
            {d.qrControl.enabled ? (
              <>
                <Row>
                  <Col><Label info="Pixels on the display canvas. The phantom area sits outside campaign rotation, so whatever it holds survives every campaign transition.">Phantom Area(s) Size</Label>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ color: T.muted, fontSize: 13 }}>W</span><input type="number" value={d.qrControl.phantomArea.width} onChange={(e) => setPath("qrControl.phantomArea.width", Number(e.target.value))} style={{ ...inputStyle, width: 66 }} />
                      <span style={{ color: T.muted, fontSize: 13 }}>H</span><input type="number" value={d.qrControl.phantomArea.height} onChange={(e) => setPath("qrControl.phantomArea.height", Number(e.target.value))} style={{ ...inputStyle, width: 66 }} />
                    </div></Col>
                  <Col><Label>Phantom Area(s) Position</Label>
                    <DefaultSelect value={d.qrControl.phantomArea.position} onChange={(v) => setPath("qrControl.phantomArea.position", v)} fallback={PLATFORM_DEFAULTS.qrControl.phantomArea.position} options={PHANTOM_POSITIONS} /></Col>
                </Row>
                <Row>
                  <Col><Label>Phantom Area(s) Sizing Mode</Label>
                    <select value={d.qrControl.phantomArea.sizingMode} onChange={(e) => setPath("qrControl.phantomArea.sizingMode", e.target.value)} style={inputStyle}>{PHANTOM_SIZING_MODES.map((o) => <option key={o}>{o}</option>)}</select></Col>
                  <Col />
                </Row>
                <Row>
                  <Col><Label info="Pixels. Rendered inside the phantom area.">QR Code Size</Label><input type="number" value={d.qrControl.qrCode.size} onChange={(e) => setPath("qrControl.qrCode.size", Number(e.target.value))} style={inputStyle} /></Col>
                  <Col><Label>QR Code Colour</Label><input type="color" value={d.qrControl.qrCode.colour} onChange={(e) => setPath("qrControl.qrCode.colour", e.target.value)} style={swatch} /></Col>
                </Row>
                <Row>
                  <Col><Label>QR Code Position</Label><DefaultSelect value={d.qrControl.qrCode.position} onChange={(v) => setPath("qrControl.qrCode.position", v)} fallback={PLATFORM_DEFAULTS.qrControl.qrCode.position} options={QR_POSITIONS} /></Col>
                  <Col><Label>Connected Icon/Logo Colour</Label><input type="color" value={d.qrControl.connectedIconColour} onChange={(e) => setPath("qrControl.connectedIconColour", e.target.value)} style={swatch} /></Col>
                </Row>
                <Row>
                  <Col><Label info="Which mobile experience opens when this QR is scanned. The same platform serves a different experience per display type.">Mobile site template</Label>
                    <select value={d.qrControl.mobileSiteTemplate} onChange={(e) => setPath("qrControl.mobileSiteTemplate", e.target.value)} style={inputStyle}>{MOBILE_TEMPLATES.map((m) => <option key={m}>{m}</option>)}</select></Col>
                  <Col />
                </Row>
                <Note>States: <b>Unpaired</b> (QR visible) → <b>Scanned</b> (socket opens) → <b>Paired</b> (the QR is replaced in place by a connected-device indicator in the colour above, reflecting the device class). The overlay holds position through every rotation — see the preview's Idle / Connected switch.</Note>
              </>
            ) : (
              <div style={{ fontSize: 12.5, color: T.muted, lineHeight: 1.5 }}>No phantom zone on this display type, so no QR pairing. Rotation uses the full canvas.</div>
            )}
          </Panel>
        )}

        {/* ---- ENABLED FEATURES ---- */}
        {!isWebTP(d.touchPoint) && (
          <Panel title="Enabled Features" open={open.features} onToggle={() => toggle("features")}
            badge={<Pill color={T.muted} bg="rgba(0,0,0,0.04)">{FEATURES.filter((f) => d.enabledFeatures[f.key]?.enabled).length} on</Pill>}>
            <div style={{ fontSize: 12.5, color: T.muted, marginBottom: 6, lineHeight: 1.5 }}>Company (availability) → Display Type (default) → Display (override). Defaults inherited by every device assigned to this display type, including each feature's own settings. A display can override any of them on its Enabled Features tab.</div>
            {FEATURES.filter((f) => f.touchPoints.includes(d.touchPoint)).map((f) => {
              const av = COMPANY_FEATURE_AVAILABILITY[f.key];
              const cfg = d.enabledFeatures[f.key] || { enabled: false };
              const setCfg = (patch) => setPath(`enabledFeatures.${f.key}`, { ...cfg, ...patch });
              return (
                <div key={f.key} style={{ padding: "11px 0", borderBottom: `1px solid ${T.borderSubtle}`, opacity: av ? 1 : 0.45 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <Icon name={f.icon} size={18} style={{ color: av ? T.text : T.micro }} />
                    <span style={{ flex: 1, minWidth: 0, fontSize: 13.5 }}>{f.label}</span>
                    <Toggle on={!!cfg.enabled} disabled={!av} onChange={(v) => setCfg({ enabled: v })} />
                  </div>
                  <div style={{ fontSize: 11.5, color: T.muted, marginTop: 5, marginLeft: 28, lineHeight: 1.45 }}>{av ? f.hint : "Not enabled for this company — contact Platform Admin."}</div>
                  {av && cfg.enabled && f.key === "proximityMist" && (
                    <SubSettings><Grid cols={2} style={{ marginBottom: 0 }}>
                      <Fld label="Mode"><select value={cfg.mode} onChange={(e) => setCfg({ mode: e.target.value })} style={ctl}><option value="zone">Zone</option><option value="vbeacon">vBeacon</option></select></Fld>
                      <Fld label="Zone"><select value={cfg.zone} onChange={(e) => setCfg({ zone: e.target.value })} style={ctl}>{MIST_ZONES.map((z) => <option key={z}>{z}</option>)}</select></Fld>
                    </Grid></SubSettings>
                  )}
                  {av && cfg.enabled && f.key === "visionAi" && (
                    <SubSettings>
                      <Grid cols={2}>
                        <Fld label="Mode"><select value={cfg.mode} onChange={(e) => setCfg({ mode: e.target.value })} style={ctl}>{VISION_MODES.map((v) => <option key={v}>{v}</option>)}</select></Fld>
                        <Fld label="Detection preset"><select value={cfg.preset || "Balanced"} onChange={(e) => setCfg({ preset: e.target.value, ...(DETECTION_PRESETS[e.target.value].fps ? DETECTION_PRESETS[e.target.value] : {}), note: undefined })} style={ctl}>{Object.keys(DETECTION_PRESETS).map((k) => <option key={k}>{k}</option>)}</select></Fld>
                      </Grid>
                      <Grid cols={4} style={{ marginBottom: 0 }}>
                        {[["streamQuality", "Stream px"], ["fps", "FPS"], ["frameSkip", "Frame skip"], ["missThreshold", "Miss threshold"]].map(([k, l]) => (
                          <Fld key={k} label={l}><input type="number" value={cfg[k] ?? ""} onChange={(e) => setCfg({ [k]: Number(e.target.value), preset: "Custom" })} style={ctl} /></Fld>
                        ))}
                      </Grid>
                      <Note>{DETECTION_PRESETS[cfg.preset || "Balanced"].note} Passerby count doubles as the counted audience multiplier for programmatic proof of play.</Note>
                    </SubSettings>
                  )}
                </div>
              );
            })}
            <Note>Diagnostic overlays (debug boxes) are never inheritable — they are set per display, temporarily, and do not appear here.</Note>
          </Panel>
        )}

        {/* ---- MULTI-ZONE LAYOUT ---- */}
        {!isWebTP(d.touchPoint) && (
          <Panel title="Multi-Zone Layout" open={open.zones} onToggle={() => toggle("zones")} badge={d.multiZone.enabled ? <Pill color={T.primary} bg={T.primaryTint}>{d.multiZone.zones.length} zones</Pill> : null}>
            <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 14 }}>
              <span style={{ fontSize: 13.5 }}>Enable zones</span>
              <Toggle on={d.multiZone.enabled} onChange={(v) => set({ multiZone: { enabled: v, zones: v && d.multiZone.zones.length === 0 ? [{ id: "z1", name: "Zone 1", x: 0, y: 0, width: 50, height: 100, playlistId: ensureZonePlaylist(1), trustZone: "agent_addressable" }, { id: "z2", name: "Zone 2", x: 50, y: 0, width: 50, height: 100, playlistId: ensureZonePlaylist(2), trustZone: "agent_addressable" }] : d.multiZone.zones } })} />
            </div>
            {!d.multiZone.enabled ? (
              <div style={{ fontSize: 12.5, color: T.muted, lineHeight: 1.5 }}>Single zone — the display runs the Default Playlist across the full canvas.</div>
            ) : (
              <>
                <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
                  <span style={{ fontSize: 12, color: T.muted, marginRight: 4 }}>Quick split:</span>
                  {[2, 3, 4, 6].map((n) => <Btn key={n} style={{ height: 26, fontSize: 12, padding: "0 10px" }} onClick={() => setPath("multiZone.zones", Array.from({ length: n }, (_, i) => ({ id: `z${i + 1}`, name: `Zone ${i + 1}`, x: +(i * (100 / n)).toFixed(1), y: 0, width: +(100 / n).toFixed(1), height: 100, playlistId: ensureZonePlaylist(i + 1), trustZone: d.multiZone.zones[i]?.trustZone || "agent_addressable" })))}>{n}</Btn>)}
                </div>
                {d.multiZone.zones.map((z, i) => (
                  <div key={z.id} style={{ border: `1px solid ${z.trustZone === "ph_locked" ? "rgba(255,77,79,0.35)" : T.borderSubtle}`, borderRadius: 6, padding: 10, marginBottom: 8, background: z.trustZone === "ph_locked" ? "rgba(255,77,79,0.03)" : "#fff" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                      <span style={{ width: 10, height: 10, borderRadius: 2, background: ZONE_COLOURS[i % 6] }} />
                      <input value={z.name} onChange={(e) => setZone(i, { name: e.target.value })} style={{ ...small, flex: 1 }} />
                      <Segmented size="sm" value={z.trustZone || "agent_addressable"} onChange={(v) => setZone(i, { trustZone: v })} options={[{ value: "agent_addressable", label: "Agent", icon: "smart_toy" }, { value: "ph_locked", label: "Locked", icon: "lock" }]} />
                      {d.multiZone.zones.length > 1 && <Icon name="close" size={16} style={{ color: T.muted, cursor: "pointer" }} onClick={() => setPath("multiZone.zones", d.multiZone.zones.filter((_, k) => k !== i))} />}
                    </div>
                    <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                      {[["x", "X %"], ["y", "Y %"]].map(([k, l]) => <div key={k} style={{ flex: 1 }}><div style={{ fontSize: 11, color: T.muted, marginBottom: 2 }}>{l}</div><input type="number" value={z[k]} onChange={(e) => setZone(i, { [k]: Number(e.target.value) })} style={small} /></div>)}
                      <div style={{ flex: 1 }}><div style={{ fontSize: 11, color: T.muted, marginBottom: 2 }}>Width px</div><input type="number" value={Math.round((z.width / 100) * d.displayCanvasSize.width)} onChange={(e) => setZone(i, { width: (Number(e.target.value) / d.displayCanvasSize.width) * 100 })} style={small} /></div>
                      <div style={{ flex: 1 }}><div style={{ fontSize: 11, color: T.muted, marginBottom: 2 }}>Height px</div><input type="number" value={Math.round((z.height / 100) * d.displayCanvasSize.height)} onChange={(e) => setZone(i, { height: (Number(e.target.value) / d.displayCanvasSize.height) * 100 })} style={small} /></div>
                    </div>
                    <div style={{ fontSize: 11, color: T.muted, marginBottom: 3 }}>Playlist</div>
                    <select value={z.playlistId} onChange={(e) => setZone(i, { playlistId: e.target.value })} style={small}>{playlists.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
                  </div>
                ))}
                <Btn variant="outline" style={{ height: 28, fontSize: 12.5 }} onClick={() => setPath("multiZone.zones", [...d.multiZone.zones, { id: uid("z"), name: `Zone ${d.multiZone.zones.length + 1}`, x: 0, y: 0, width: 25, height: 100, playlistId: ensureZonePlaylist(d.multiZone.zones.length + 1), trustZone: "agent_addressable" }])}><Icon name="add" size={15} />Add zone</Btn>
                <Note>Each zone runs its own playlist and rotation (<code>activeCampaignsByZone</code> at runtime). A <b>Locked</b> zone is the PH-locked commercial region — price, terms, disclosures — enforced physically by the layout: a bought creative cannot render into a region it was never given.</Note>
              </>
            )}
          </Panel>
        )}

        {/* ---- DATA ---- */}
        <Panel title="Data — display type record" open={open.data} onToggle={() => toggle("data")} badge={<Pill color={T.muted} bg="rgba(0,0,0,0.04)">JSON</Pill>}>
          <div style={{ fontSize: 12, color: T.muted, lineHeight: 1.5, marginBottom: 10 }}>
            The record as it is stored: the platform's existing display-type fields (<code>displayCanvasSize</code>, <code>playlistSettings.maximumCampaignsPlayedInRotation</code>, <code>qrControl</code>, <code>enabledFeatures</code>, <code>multiZone</code>) plus this project's additions under <code>phExtensions</code>. <code>null</code> = inherits the platform default.
          </div>
          <JsonBlock value={toDisplayTypeRecord(d)} />
        </Panel>

        <div style={{ display: "flex", gap: 8, marginTop: 20, alignItems: "center", flexWrap: "wrap" }}>
          <Btn variant="primary" onClick={() => set({ updatedAt: new Date().toISOString() })}>Save Changes</Btn>
          <Btn>Cancel</Btn>
          <span style={{ flex: 1 }} />
          <Btn variant="text" onClick={duplicate}><Icon name="content_copy" size={15} />Duplicate</Btn>
          <Btn variant="danger" disabled={assigned.length > 0} title={assigned.length ? `${assigned.length} displays are assigned to this type` : "Delete display type"} onClick={removeType}><Icon name="delete" size={15} /></Btn>
        </div>
        {d.updatedAt && <div style={{ fontSize: 11, color: T.micro, marginTop: 6 }}>Last saved {new Date(d.updatedAt).toLocaleString("en-GB")}</div>}
      </div>

      {/* ------------------------------------------------ preview */}
      <div style={{ flex: 1, minWidth: 240 }}>
        <Preview d={d} plName={plName} setPath={setPath} partners={partners} companyLists={companyLists} playlists={playlists} />
        <AssignedDisplays d={d} />
      </div>
    </div>
  );
}

const ELEMENT_SLOTS = { hero: 1, carousel: 4, grid: 6, list: 4, product: 6, ctas: 3, faq: 5 };

const InheritBadge = ({ n }) => (n > 0 ? <Pill color={T.primary} bg={T.primaryTint}>{n} override{n > 1 ? "s" : ""}</Pill> : <Pill color={T.muted} bg="rgba(0,0,0,0.04)">all inherited</Pill>);

/* Displays currently assigned to this type, and whether they override it. */
function AssignedDisplays({ d }) {
  const list = DISPLAYS.filter((x) => x.displayTypeId === d.id);
  if (!list.length) return null;
  return (
    <div style={{ marginTop: 18, maxWidth: 360 }}>
      <div style={{ fontSize: 12, color: T.micro, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 8 }}>Displays using this type</div>
      {list.map((x) => {
        const s = STORES.find((q) => q.id === x.storeId);
        return (
          <div key={x.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: `1px solid ${T.borderSubtle}`, fontSize: 12.5 }}>
            <span style={{ width: 8, height: 8, borderRadius: 9999, background: x.status === "online" ? T.success : T.error }} />
            <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{x.name} <span style={{ color: T.muted }}>· {s?.code}</span></span>
            <span style={{ fontSize: 11, color: T.micro }}>{x.overrides ? "overrides" : "inherits"}</span>
          </div>
        );
      })}
      <Note>A type-level edit reaches only the displays that inherit. A display that has overridden a setting keeps its override — nothing here resets it.</Note>
    </div>
  );
}

/* -------------------------- display preview ------------------------------ */

export function Preview({ d, plName, setPath, partners, companyLists, playlists, compact }) {
  const [sigPaired, setSigPaired] = useState(false);
  const [device, setDevice] = useState("phone");
  if (isWebTP(d.touchPoint)) return <WebPreview d={d} plName={plName} setPath={setPath} partners={partners} companyLists={companyLists} />;
  const W = d.displayCanvasSize.width, H = d.displayCanvasSize.height;
  const aspect = W / H;
  const boxW = compact ? 240 : 300, boxH = compact ? 240 : 300;
  const width = Math.min(boxW, Math.round(boxH * aspect));
  const height = Math.max(60, Math.round(width / aspect));
  const qc = d.qrControl;
  const pos = qc.phantomArea.position || PLATFORM_DEFAULTS.qrControl.phantomArea.position;
  const pw = (qc.phantomArea.width / W) * 100, ph = (qc.phantomArea.height / H) * 100;
  const place = { "Bottom Right": { right: "1.5%", bottom: "3%" }, "Bottom Left": { left: "1.5%", bottom: "3%" }, "Top Right": { right: "1.5%", top: "3%" }, "Top Left": { left: "1.5%", top: "3%" }, "Center": { left: `${50 - pw / 2}%`, top: `${50 - ph / 2}%` } }[pos];
  const qrPos = qc.qrCode.position || PLATFORM_DEFAULTS.qrControl.qrCode.position;
  const qrAlign = { Center: "center", "Top Left": "flex-start", "Top Right": "flex-end", "Bottom Left": "flex-start", "Bottom Right": "flex-end" }[qrPos];
  const qrJustify = qrPos.startsWith("Top") ? "flex-start" : qrPos.startsWith("Bottom") ? "flex-end" : "center";
  const dev = PAIRED_DEVICES.find((x) => x.key === device) || PAIRED_DEVICES[0];
  const pl = playlists?.find((p) => p.id === d.defaultPlaylistId);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, gap: 10, flexWrap: "wrap" }}>
        <div style={{ fontSize: 12, color: T.micro, textTransform: "uppercase", letterSpacing: "0.5px" }}>Display Preview</div>
        {qc.enabled && <Segmented size="sm" value={sigPaired ? "paired" : "idle"} onChange={(v) => setSigPaired(v === "paired")} options={[{ value: "idle", label: "Idle" }, { value: "paired", label: "Connected" }]} />}
      </div>
      <div style={{ width, height, background: d.backgroundColor, borderRadius: 4, position: "relative", overflow: "hidden", border: `1px dashed ${T.border}`, boxSizing: "border-box" }}>
        {d.multiZone.enabled ? d.multiZone.zones.map((z, i) => (
          <div key={z.id} style={{ position: "absolute", left: `${z.x}%`, top: `${z.y}%`, width: `${z.width}%`, height: `${z.height}%`, border: `2px dashed ${z.trustZone === "ph_locked" ? T.error : ZONE_COLOURS[i % 6]}`, background: `${ZONE_COLOURS[i % 6]}1a`, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 3, boxSizing: "border-box", overflow: "hidden" }}>
            <div style={{ color: "#fff", fontSize: 10, fontWeight: 600, textAlign: "center", display: "flex", alignItems: "center", gap: 3 }}>{z.trustZone === "ph_locked" && <Icon name="lock" size={10} style={{ color: T.error }} />}{z.name}</div>
            <div style={{ color: "rgba(255,255,255,0.75)", fontSize: 8.5, marginTop: 2, textAlign: "center" }}>{Math.round((z.width / 100) * W)}×{Math.round((z.height / 100) * H)}px</div>
            <div style={{ color: "rgba(255,255,255,0.6)", fontSize: 8, marginTop: 1, textAlign: "center", lineHeight: 1.25 }}>{plName(z.playlistId)}</div>
          </div>
        )) : (
          <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
            <div style={{ color: "rgba(255,255,255,0.85)", fontSize: 13, fontWeight: 500, textAlign: "center", padding: "0 12px" }}>{plName(d.defaultPlaylistId)}</div>
            <div style={{ color: "rgba(255,255,255,0.45)", fontSize: 11, marginTop: 4 }}>{pl ? `${pl.items.length} campaigns in rotation` : "single zone · full canvas"}</div>
          </div>
        )}
        {qc.enabled && (
          <div style={{ position: "absolute", ...place, width: `${pw}%`, height: `${ph}%`, minWidth: 26, minHeight: 26, background: sigPaired ? "#fff" : T.info, borderRadius: 3, display: "flex", alignItems: qrAlign, justifyContent: qrJustify, flexDirection: "column", padding: "6%", boxSizing: "border-box", boxShadow: "0 2px 8px rgba(0,0,0,0.35)", border: sigPaired ? `2px solid ${qc.connectedIconColour}` : "none" }}>
            {sigPaired ? (
              <img src={CONNECTED_ASSET} alt="Connected" style={{ width: "88%", display: "block", filter: "none" }} />
            ) : (
              <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: `${Math.min(100, (qc.qrCode.size / qc.phantomArea.width) * 100)}%`, aspectRatio: "1 / 1", background: "#fff", borderRadius: 2 }}>
                <Icon name="qr_code_2" size={Math.max(12, Math.min(40, (qc.qrCode.size / W) * width * 1.5))} style={{ color: qc.qrCode.colour }} />
              </span>
            )}
          </div>
        )}
      </div>
      <div style={{ marginTop: 10, fontSize: 12, color: T.muted, maxWidth: boxW, lineHeight: 1.6 }}>
        {W} × {H} · {d.multiZone.enabled ? `${d.multiZone.zones.length} zones` : "single zone"} · {qc.enabled ? `QR control in a ${qc.phantomArea.width}×${qc.phantomArea.height} phantom area, ${pos.toLowerCase()}` : "no phantom zone"}
        {isCapped(d) && <> · {slotCount(d)}-slot rotation</>}
      </div>

      {qc.enabled && sigPaired && !compact && (
        <div style={{ marginTop: 10, border: `1px solid ${T.borderSubtle}`, borderRadius: 6, padding: 10, maxWidth: boxW }}>
          <div style={{ display: "flex", gap: 5 }}>
            {PAIRED_DEVICES.map((x) => (
              <div key={x.key} onClick={() => setDevice(x.key)} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 2, padding: "6px 3px", borderRadius: 5, cursor: "pointer", fontSize: 10, textAlign: "center", border: `1px solid ${device === x.key ? T.primary : T.border}`, background: device === x.key ? T.primaryTint : "#fff", color: device === x.key ? T.primary : T.muted }}>
                <Icon name={x.icon} size={16} />{x.label}
              </div>
            ))}
          </div>
          <Note>Session paired with a {dev.label.toLowerCase()} — live WebSocket open. The item the customer engages renders its <code>selected</code> creative; the others render <code>unselected</code>.</Note>
        </div>
      )}

      {!compact && (
        <div style={{ marginTop: 18, display: "flex", flexDirection: "column", alignItems: "center", gap: 6, maxWidth: boxW }}>
          <div style={{ width: 120, height: 66, border: `3px solid ${T.text}`, borderRadius: 2, background: "#fff", boxShadow: "0 0 6px rgba(0,0,0,0.15)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            {d.image ? <img src={d.image} alt="" style={{ maxWidth: "100%", maxHeight: "100%" }} /> : <Icon name="image" size={22} style={{ color: T.border }} />}
          </div>
          <div style={{ fontSize: 16, fontWeight: 600, color: T.micro }}>Display Type Image</div>
          <Btn variant="text" style={{ fontWeight: 600, color: T.text, padding: 0, height: 24 }} onClick={() => setPath && setPath("image", d.image ? null : "data:image/svg+xml;utf8," + encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='120' height='66'><rect width='120' height='66' fill='${d.backgroundColor}'/><text x='60' y='38' font-family='Roboto' font-size='11' fill='white' text-anchor='middle'>${(d.name || "").slice(0, 18)}</text></svg>`))}>{d.image ? "Remove Picture" : "Update Picture"}</Btn>
        </div>
      )}
    </div>
  );
}

/* Web elements preview as a rendered element inside a browser frame. */
function WebPreview({ d, plName, setPath, partners, companyLists }) {
  const [bp, setBp] = useState("desktop");
  const el = webEl(d.element?.type);
  const c = caps(d);
  const B = d.element.breakpoints[bp];
  const B0 = BREAKPOINTS.find((x) => x.key === bp);
  const frameW = Math.max(140, Math.round(300 * (B.viewportWidth / 1200)));
  const cols = c.grid ? B.columns : 1;
  const total = isCapped(d) ? slotCount(d) : (c.grid ? 6 : 3);
  const shown = Math.min(total, B.items || total);
  const aspectPad = { "16:9": 56, "4:3": 75, "1:1": 100, "3:4": 133, auto: 70 }[d.element.itemAspect] || 75;
  const inset = d.element.widthMode === "contained" ? 10 : 0;
  const slots = d.phExtensions.slots || [];

  const Cell = ({ i, h }) => {
    const sl = slots[i];
    const o = sl ? SLOT_OWNERS[sl.owner] : null;
    return (
      <div style={{ flex: 1, minWidth: 0, height: h, borderRadius: 3, background: o ? o.bg : "rgba(22,155,194,0.12)", border: `1px ${sl?.trustZone === "ph_locked" ? "solid " + T.error : "solid " + (o ? o.colour : T.primaryAccent)}`, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2, overflow: "hidden", padding: 2, boxSizing: "border-box" }}>
        <Icon name={sl?.trustZone === "ph_locked" ? "lock" : el.icon} size={13} style={{ color: sl?.trustZone === "ph_locked" ? T.error : o ? o.colour : T.primary }} />
        {h > 34 && <div style={{ fontSize: 8, color: o ? o.colour : T.primary, textAlign: "center", lineHeight: 1.2 }}>{sl ? ownerAssignment(sl, partners, companyLists) : `Campaign ${i + 1}`}</div>}
      </div>
    );
  };

  const body = () => {
    if (el.key === "order") return <div style={{ border: `1px solid ${T.error}`, background: "rgba(255,77,79,0.06)", borderRadius: 3, padding: 8, display: "flex", flexDirection: "column", gap: 4 }}><div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 9, color: T.error }}><Icon name="lock" size={11} />PH-locked — basket, totals, terms</div>{[45, 80, 65].map((w, i) => <div key={i} style={{ height: i ? 5 : 8, width: `${w}%`, background: `rgba(0,0,0,${i ? 0.12 : 0.25})`, borderRadius: 2 }} />)}</div>;
    if (el.key === "qr_control") return <div style={{ display: "flex", justifyContent: "center", padding: 6 }}><div style={{ width: 54, height: 54, borderRadius: 6, background: T.info, display: "flex", alignItems: "center", justifyContent: "center" }}><Icon name="qr_code_2" size={34} style={{ color: "#fff" }} /></div></div>;
    if (el.key === "text" || el.key === "footer" || el.key === "faq") return <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>{[70, 100, 92, 60].map((w, i) => <div key={i} style={{ height: i === 0 ? 9 : 5, width: `${w}%`, background: `rgba(0,0,0,${i === 0 ? 0.22 : 0.1})`, borderRadius: 2 }} />)}</div>;
    if (c.grid) {
      const rows = Math.ceil(shown / cols);
      const cellH = Math.max(26, Math.round(((frameW - (cols - 1) * (d.element.gap / 3)) / cols) * (aspectPad / 100)));
      return <div style={{ display: "flex", flexDirection: "column", gap: d.element.gap / 3 }}>{Array.from({ length: rows }, (_, r) => <div key={r} style={{ display: "flex", gap: d.element.gap / 3 }}>{Array.from({ length: cols }, (_, k) => { const i = r * cols + k; return i < shown ? <Cell key={k} i={i} h={cellH} /> : <div key={k} style={{ flex: 1 }} />; })}</div>)}</div>;
    }
    const inView = c.carousel ? (B.columns || 1) : 1;
    const peek = c.carousel ? (B.peek ?? 0) : 0;
    const unit = 100 / (inView + (peek / 100) * 2);
    const itemH = Math.max(30, Math.round(((frameW * unit) / 100) * (aspectPad / 100)));
    return (
      <div>
        <div style={{ display: "flex", gap: d.element.gap / 3, overflow: "hidden" }}>
          {peek > 0 && <div style={{ width: `${unit * (peek / 100)}%`, flexShrink: 0, height: itemH, borderRadius: 3, background: "rgba(22,155,194,0.07)", border: `1px solid ${T.borderSubtle}` }} />}
          {Array.from({ length: inView }, (_, k) => <div key={k} style={{ width: `${unit}%`, flexShrink: 0 }}><Cell i={k} h={itemH} /></div>)}
          {peek > 0 && <div style={{ width: `${unit * (peek / 100)}%`, flexShrink: 0, height: itemH, borderRadius: 3, background: "rgba(22,155,194,0.07)", border: `1px solid ${T.borderSubtle}` }} />}
        </div>
        {c.rotation && shown > 1 && <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 6 }}><Icon name="chevron_left" size={14} style={{ color: T.muted }} /><div style={{ display: "flex", gap: 4 }}>{Array.from({ length: Math.max(1, Math.ceil(total / inView)) }, (_, k) => <span key={k} style={{ width: 5, height: 5, borderRadius: 9999, background: k === 0 ? T.primary : "transparent", border: `1px solid ${k === 0 ? T.primary : T.border}` }} />)}</div><Icon name="chevron_right" size={14} style={{ color: T.muted }} /></div>}
      </div>
    );
  };

  const setB = (k, v) => setPath(`element.breakpoints.${bp}.${k}`, v);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, gap: 8, flexWrap: "wrap" }}>
        <div style={{ fontSize: 12, color: T.micro, textTransform: "uppercase", letterSpacing: "0.5px" }}>Element Preview</div>
        <Segmented size="sm" value={bp} onChange={setBp} options={BREAKPOINTS.map((b) => ({ value: b.key, label: "", icon: b.icon, title: b.label }))} />
      </div>
      <div style={{ width: frameW, border: `1px solid ${T.border}`, borderRadius: 8, overflow: "hidden", background: "#fff", transition: "width .15s" }}>
        <div style={{ height: 18, background: T.surfaceAlt, borderBottom: `1px solid ${T.borderSubtle}`, display: "flex", alignItems: "center", gap: 3, padding: "0 7px" }}>{["#ff5f57", "#febc2e", "#28c840"].map((c2) => <span key={c2} style={{ width: 6, height: 6, borderRadius: 9999, background: c2 }} />)}</div>
        <div style={{ position: "relative", padding: `10px ${inset + 8}px`, background: "#fff" }}>{body()}</div>
      </div>

      {setPath && (
        <div style={{ marginTop: 12, border: `1px solid ${T.borderSubtle}`, borderRadius: 8, padding: 12, maxWidth: 320 }}>
          <div style={{ fontSize: 12, marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}><Icon name={B0.icon} size={15} style={{ color: T.primary }} /><b>{B0.label}</b><span style={{ color: T.muted }}>breakpoint</span></div>
          <Grid cols={2} gap={8}>
            <Fld label="Viewport width (px)"><input type="number" value={B.viewportWidth} onChange={(e) => setB("viewportWidth", Number(e.target.value))} style={small} /></Fld>
            <Fld label="Element height (px)"><input type="number" value={B.height} onChange={(e) => setB("height", Number(e.target.value))} style={small} /></Fld>
            {c.grid && <Fld label="Columns"><select value={B.columns} onChange={(e) => setB("columns", Number(e.target.value))} style={small}>{[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}</select></Fld>}
            {c.carousel && <Fld label="Items in view"><select value={B.columns} onChange={(e) => setB("columns", Number(e.target.value))} style={small}>{[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}</select></Fld>}
            {c.carousel && <Fld label="Peek %"><select value={B.peek ?? 0} onChange={(e) => setB("peek", Number(e.target.value))} style={small}>{[0, 5, 10, 15, 20, 25, 30].map((n) => <option key={n} value={n}>{n}%</option>)}</select></Fld>}
            {c.slots && <Fld label="Items shown" hint="Separate from columns — fewer items on mobile means fewer campaigns must resolve before it paints."><select value={B.items} onChange={(e) => setB("items", Number(e.target.value))} style={small}>{Array.from({ length: 12 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}</select></Fld>}
          </Grid>
          <Grid cols={3} gap={8} style={{ marginBottom: 0 }}>
            <Fld label="Width"><select value={d.element.widthMode} onChange={(e) => setPath("element.widthMode", e.target.value)} style={small}><option value="contained">Contained</option><option value="full">Full bleed</option></select></Fld>
            <Fld label="Aspect"><select value={d.element.itemAspect} onChange={(e) => setPath("element.itemAspect", e.target.value)} style={small}>{["16:9", "4:3", "1:1", "3:4", "auto"].map((a) => <option key={a}>{a}</option>)}</select></Fld>
            <Fld label="Gap"><input type="number" value={d.element.gap} onChange={(e) => setPath("element.gap", Number(e.target.value))} style={small} /></Fld>
          </Grid>
        </div>
      )}
      <div style={{ marginTop: 10, fontSize: 11.5, color: T.muted, lineHeight: 1.5, maxWidth: 320 }}>
        <b>{el.name}</b> · {d.element.widthMode === "full" ? "full bleed" : `contained ${d.element.maxWidth}px`}{c.grid && ` · ${cols} col${cols > 1 ? "s" : ""} at ${bp}`}
        <div style={{ marginTop: 4, color: T.primary }}>{c.campaigns ? (c.grid ? `${shown} of ${total} item${total > 1 ? "s" : ""} rendered at ${bp}` : "1 item rendered") : "Renders no campaigns"}</div>
        <div style={{ marginTop: 4 }}>QR pairing on web is configured on the Layout template, not the element — out of this release.</div>
      </div>
    </div>
  );
}
