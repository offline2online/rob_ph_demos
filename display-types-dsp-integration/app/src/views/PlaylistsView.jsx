import React, { useState, useMemo } from "react";
import { T, Icon, Pill, Btn, Note, Callout, Table, TRow, TCell, small, inputStyle, Segmented, Fld, Grid, JsonBlock, OutlinePill, Chips, uid, SubPanel, Empty, ZONE_COLOURS } from "../ui.jsx";
import { playlist as mkPlaylist, playlistItem, scene as mkScene, textElement, textVariant, CAMPAIGN_TYPES, PLAYLIST_SCHEDULE_MODES, loopLengthSeconds, visibilityDeadlineMs, PLATFORM_DEFAULTS, ANIMATIONS, EXIT_ANIMATIONS, TRUST_ZONES, isCapped, slotCount } from "../model/schema.js";
import { CAMPAIGNS, campaignById } from "../model/data.js";
import { ATTRIBUTE_REGISTRY, OPS } from "../model/sellside.js";

/* Where a playlist is referenced from. */
export function usageOf(playlistId, types) {
  const out = [];
  types.forEach((t) => {
    if (t.defaultPlaylistId === playlistId) out.push({ type: t, where: "Default playlist" });
    if (t.multiZone?.enabled) t.multiZone.zones.forEach((z) => { if (z.playlistId === playlistId) out.push({ type: t, where: z.name }); });
  });
  return out;
}

const CREATIVE_STATES = [
  { key: "default", label: "Default", hint: "Unpaired display — the ordinary rotation." },
  { key: "selected", label: "Selected", hint: "A paired customer is engaging THIS item." },
  { key: "unselected", label: "Unselected", hint: "A paired customer is engaging a different item." },
];

export default function PlaylistsView({ playlists, setPlaylists, scenes, setScenes, types, sel, setSel, goToType }) {
  const [tab, setTab] = useState("items");
  const [creating, setCreating] = useState(false);
  const [newPl, setNewPl] = useState("");
  const [confirmDel, setConfirmDel] = useState(null);
  const usage = useMemo(() => Object.fromEntries(playlists.map((p) => [p.id, usageOf(p.id, types)])), [playlists, types]);
  const p = playlists.find((x) => x.id === sel) || playlists[0];
  const setP = (patch) => setPlaylists(playlists.map((x) => (x.id === p.id ? { ...x, ...patch } : x)));
  const setItem = (id, patch) => setP({ items: p.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) });
  const u = usage[p?.id] || [];
  const unusedCount = playlists.filter((x) => usage[x.id].length === 0).length;
  const sorted = [...(p?.items || [])].sort((a, b) => a.priority - b.priority);
  const capOwners = u.map((x) => x.type).filter(isCapped);
  const minCap = capOwners.length ? Math.min(...capOwners.map(slotCount)) : null;

  const create = () => { if (!newPl.trim()) return; const id = uid("pl"); setPlaylists([...playlists, mkPlaylist({ id, name: newPl.trim() })]); setSel(id); setNewPl(""); setCreating(false); };
  const remove = () => { if (u.length) return; if (confirmDel !== p.id) { setConfirmDel(p.id); return; } const next = playlists.filter((x) => x.id !== p.id); setPlaylists(next); setSel(next[0]?.id); setConfirmDel(null); };
  const addItem = () => {
    const used = new Set(p.items.map((i) => i.campaignId));
    const c = CAMPAIGNS.find((x) => !used.has(x.id)) || CAMPAIGNS[0];
    setP({ items: [...p.items, playlistItem({ id: uid("pi"), campaignId: c.id, priority: (Math.max(0, ...p.items.map((i) => i.priority)) || 0) + 1, campaignType: c.strategy === "TRIGGERED" ? ["TRIGGERED"] : ["LOCALISED", "ON_ROTATION"] })] });
  };
  const move = (id, dir) => {
    const ordered = sorted.map((i) => i.id);
    const k = ordered.indexOf(id); const j = k + dir;
    if (j < 0 || j >= ordered.length) return;
    const a = sorted[k], b = sorted[j];
    setP({ items: p.items.map((i) => (i.id === a.id ? { ...i, priority: b.priority } : i.id === b.id ? { ...i, priority: a.priority } : i)) });
  };

  if (!p) return <Empty>No playlists yet.</Empty>;

  return (
    <div style={{ display: "flex", gap: 20, alignItems: "flex-start", flexWrap: "wrap" }}>
      {/* ---------------------------------------------- list */}
      <div style={{ width: 250, flexShrink: 0 }}>
        {creating ? (
          <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
            <input autoFocus value={newPl} onChange={(e) => setNewPl(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") create(); if (e.key === "Escape") setCreating(false); }} placeholder="Playlist name" style={inputStyle} />
            <Btn variant="primary" onClick={create}>Add</Btn>
          </div>
        ) : <Btn variant="primary" style={{ width: "100%", justifyContent: "center", marginBottom: 10 }} onClick={() => setCreating(true)}><Icon name="add" size={16} />New playlist</Btn>}
        <div style={{ fontSize: 12.5, marginBottom: 8 }}><b>{playlists.length}</b> playlists · <b>{unusedCount}</b> unused</div>
        <div style={{ border: `1px solid ${T.borderSubtle}`, borderRadius: 8, overflow: "hidden" }}>
          {playlists.map((x) => {
            const a = x.id === p.id; const n = usage[x.id].length;
            return (
              <div key={x.id} onClick={() => setSel(x.id)} style={{ padding: "9px 12px", cursor: "pointer", borderBottom: `1px solid ${T.borderSubtle}`, background: a ? T.primaryTint : "transparent" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <Icon name="playlist_play" size={16} style={{ color: a ? T.primary : T.muted }} />
                  <span style={{ fontSize: 13, color: a ? T.primary : T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{x.name}</span>
                </div>
                <div style={{ fontSize: 11, color: T.muted, marginTop: 3, marginLeft: 22 }}>{x.items.length} item{x.items.length !== 1 ? "s" : ""} · {loopLengthSeconds(x)}s loop · {n ? `${n} assignment${n > 1 ? "s" : ""}` : "unused"}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ---------------------------------------------- detail */}
      <div style={{ flex: 1, minWidth: 460 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <input value={p.name} onChange={(e) => setP({ name: e.target.value })} style={{ ...inputStyle, fontSize: 16, fontWeight: 600, height: 36, flex: 1, minWidth: 220 }} />
          {p.autoCreatedFor && <Pill color={T.muted} bg="rgba(0,0,0,0.04)">auto-created with {types.find((t) => t.id === p.autoCreatedFor)?.name || p.autoCreatedFor}</Pill>}
          <Btn variant="danger" disabled={u.length > 0} title={u.length ? "Assigned to a display type — reassign before deleting" : "Delete playlist"} style={{ height: 28, padding: "0 10px", fontSize: 12.5 }} onClick={remove}>{confirmDel === p.id ? "Confirm" : <Icon name="delete" size={15} />}</Btn>
        </div>

        <div style={{ display: "flex", gap: 14, marginTop: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
          <Fld label="Scheduled against">
            <select value={p.schedule.mode} onChange={(e) => setP({ schedule: { ...p.schedule, mode: e.target.value } })} style={small}>{PLAYLIST_SCHEDULE_MODES.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}</select>
          </Fld>
          {p.schedule.mode === "custom" && <>
            <Fld label="From"><input type="time" value={p.schedule.from || "08:00"} onChange={(e) => setP({ schedule: { ...p.schedule, from: e.target.value } })} style={small} /></Fld>
            <Fld label="To"><input type="time" value={p.schedule.to || "20:00"} onChange={(e) => setP({ schedule: { ...p.schedule, to: e.target.value } })} style={small} /></Fld>
          </>}
          <div style={{ marginLeft: "auto", fontSize: 12.5, color: T.muted, paddingTop: 18 }}>Loop <b style={{ color: T.text }}>{loopLengthSeconds(p)}s</b> · {p.items.length} items{minCap !== null && <> · capped at <b style={{ color: T.text }}>{minCap}</b> on {capOwners.length} type{capOwners.length > 1 ? "s" : ""}</>}</div>
        </div>

        <div style={{ display: "flex", borderBottom: `1px solid ${T.borderSubtle}`, margin: "14px 0" }}>
          {[["items", "Items", "queue_music"], ["scenes", "Scenes", "movie"], ["usage", "Assigned to", "dashboard_customize"], ["data", "Data", "data_object"]].map(([k, l, ic]) => (
            <div key={k} onClick={() => setTab(k)} style={{ padding: "10px 8px", marginRight: 12, fontSize: 14, fontWeight: tab === k ? 500 : 400, color: tab === k ? T.primary : T.text, borderBottom: `2px solid ${tab === k ? T.primary : "transparent"}`, background: tab === k ? T.primaryTint : "transparent", cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}><Icon name={ic} size={16} />{l}{k === "usage" && u.length > 0 && <span style={{ fontSize: 11, color: T.micro }}>({u.length})</span>}</div>
          ))}
        </div>

        {tab === "items" && (
          <>
            {minCap !== null && p.items.length > minCap && <Callout tone="warning" style={{ marginBottom: 10 }}>This playlist has {p.items.length} items but the tightest display type using it caps rotation at {minCap}. Only the first {minCap} by priority play in a loop; the rest wait for a slot.</Callout>}
            <Table cols="30px 1.6fr 74px 88px 1.2fr 1.4fr 96px" header={["#", "Campaign", "Priority", "Duration", "Campaign type", "Creative (default / selected / unselected)", ""]}>
              {sorted.map((it, i) => {
                const c = campaignById(it.campaignId);
                const deadline = visibilityDeadlineMs(p, i);
                const past = minCap !== null && i >= minCap;
                return (
                  <TRow key={it.id} cols="30px 1.6fr 74px 88px 1.2fr 1.4fr 96px" last={i === sorted.length - 1} style={{ opacity: it.enabled === false || past ? 0.55 : 1, alignItems: "start" }}>
                    <TCell muted>{i + 1}</TCell>
                    <TCell style={{ whiteSpace: "normal" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ width: 22, height: 14, borderRadius: 2, background: c?.thumb || "#999", flexShrink: 0 }} />
                        <select value={it.campaignId} onChange={(e) => setItem(it.id, { campaignId: e.target.value })} style={{ ...small, height: 26, fontSize: 12 }}>{CAMPAIGNS.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
                      </div>
                      <div style={{ fontSize: 10.5, color: T.micro, marginTop: 3, display: "flex", gap: 6, alignItems: "center" }}>
                        <OutlinePill style={{ height: 18, fontSize: 10.5, padding: "0 7px" }}>{c?.strategy}</OutlinePill>
                        {c?.locked && <span style={{ color: T.error, display: "inline-flex", alignItems: "center", gap: 2 }}><Icon name="lock" size={11} />PH-locked</span>}
                        <span>deadline {deadline >= 1000 ? `${(deadline / 1000).toFixed(1)}s` : `${deadline}ms`}</span>
                      </div>
                    </TCell>
                    <TCell><input type="number" value={it.priority} onChange={(e) => setItem(it.id, { priority: Number(e.target.value) })} style={{ ...small, height: 26, fontSize: 12, padding: "0 6px" }} /></TCell>
                    <TCell><div style={{ display: "flex", alignItems: "center", gap: 3 }}><input type="number" min="1" value={it.playbackDuration} onChange={(e) => setItem(it.id, { playbackDuration: Number(e.target.value) })} style={{ ...small, height: 26, fontSize: 12, padding: "0 6px", width: 52 }} /><span style={{ fontSize: 11, color: T.micro }}>s</span></div></TCell>
                    <TCell style={{ whiteSpace: "normal" }}>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
                        {CAMPAIGN_TYPES.map((t) => { const on = it.campaignType.includes(t); return <span key={t} onClick={() => setItem(it.id, { campaignType: on ? it.campaignType.filter((x) => x !== t) : [...it.campaignType, t] })} style={{ cursor: "pointer", fontSize: 10, padding: "1px 6px", borderRadius: 9999, border: `1px solid ${on ? T.primary : T.border}`, color: on ? T.primary : T.micro, background: on ? T.primaryTint : "#fff" }}>{t}</span>; })}
                      </div>
                    </TCell>
                    <TCell style={{ whiteSpace: "normal" }}>
                      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                        {CREATIVE_STATES.map((s) => (
                          <div key={s.key} style={{ display: "flex", alignItems: "center", gap: 4 }} title={s.hint}>
                            <span style={{ fontSize: 10, color: T.micro, width: 58 }}>{s.label}</span>
                            <select value={it.campaignCreativeSettings[s.key]?.sceneId || ""} onChange={(e) => setItem(it.id, { campaignCreativeSettings: { ...it.campaignCreativeSettings, [s.key]: { sceneId: e.target.value || null } } })} style={{ ...small, height: 22, fontSize: 11, padding: "0 6px", color: it.campaignCreativeSettings[s.key]?.sceneId ? T.text : T.micro }}>
                              <option value="">{s.key === "default" ? "Campaign creative" : "Same as default"}</option>
                              {scenes.map((sc) => <option key={sc.id} value={sc.id}>{sc.name}</option>)}
                            </select>
                          </div>
                        ))}
                      </div>
                    </TCell>
                    <TCell>
                      <div style={{ display: "flex", gap: 2 }}>
                        <Icon name="arrow_upward" size={16} onClick={() => move(it.id, -1)} style={{ cursor: "pointer", color: T.muted }} />
                        <Icon name="arrow_downward" size={16} onClick={() => move(it.id, 1)} style={{ cursor: "pointer", color: T.muted }} />
                        <Icon name={it.enabled === false ? "visibility_off" : "visibility"} size={16} onClick={() => setItem(it.id, { enabled: it.enabled === false })} style={{ cursor: "pointer", color: T.muted }} />
                        <Icon name="delete" size={16} onClick={() => setP({ items: p.items.filter((x) => x.id !== it.id) })} style={{ cursor: "pointer", color: T.error }} />
                      </div>
                    </TCell>
                  </TRow>
                );
              })}
              {sorted.length === 0 && <div style={{ padding: 14, fontSize: 12.5, color: T.muted }}>No items. Add a campaign to start the rotation.</div>}
            </Table>
            <div style={{ marginTop: 10 }}><Btn variant="outline" style={{ height: 28, fontSize: 12.5 }} onClick={addItem}><Icon name="add" size={15} />Add item</Btn></div>
            <Note>
              <b>Deadline</b> is the visibility deadline of that rotation position — first-paint budget ({PLATFORM_DEFAULTS.firstPaintBudgetMs}ms) plus the durations before it. A slower attribute source can still win a later position even if it can never make first paint; dwell time is a personalisation lever, not just a layout setting.
              <b> Creative</b> states map onto device pairing: unpaired renders <code>default</code>; the item a paired customer engages renders <code>selected</code>; concurrent items render <code>unselected</code>.
            </Note>
          </>
        )}

        {tab === "scenes" && <ScenesEditor scenes={scenes} setScenes={setScenes} playlist={p} />}

        {tab === "usage" && (
          u.length === 0 ? <Empty icon="link_off">Not assigned to any display type or zone. It can be deleted, or assigned from a display type's Default Playlist / zone playlist.</Empty> : (
            <Table cols="1.4fr 1fr 90px" header={["Display type", "Where", ""]}>
              {u.map((x, i) => (
                <TRow key={i} cols="1.4fr 1fr 90px" last={i === u.length - 1}>
                  <TCell><b>{x.type.name}</b></TCell>
                  <TCell muted>{x.where}{isCapped(x.type) && <> · cap {slotCount(x.type)}</>}</TCell>
                  <TCell><Btn variant="text" style={{ height: 24, padding: 0, fontSize: 12 }} onClick={() => goToType(x.type.id)}>Open<Icon name="arrow_forward" size={14} /></Btn></TCell>
                </TRow>
              ))}
            </Table>
          )
        )}

        {tab === "data" && (
          <>
            <div style={{ fontSize: 12, color: T.muted, lineHeight: 1.5, marginBottom: 10 }}>The playlist record: items carry <code>campaignId</code>, <code>priority</code>, <code>playbackDuration</code>, <code>campaignType</code> and <code>campaignCreativeSettings</code> exactly as the player consumes them. Scenes are referenced by id and stored separately (see the Scenes tab).</div>
            <JsonBlock value={p} maxHeight={520} />
          </>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- scenes */

function ScenesEditor({ scenes, setScenes, playlist }) {
  const referenced = new Set(playlist.items.flatMap((i) => Object.values(i.campaignCreativeSettings).map((s) => s?.sceneId).filter(Boolean)));
  const [selId, setSelId] = useState([...referenced][0] || scenes[0]?.id);
  const [selText, setSelText] = useState(null);
  const sc = scenes.find((s) => s.id === selId) || scenes[0];
  const setSc = (patch) => setScenes(scenes.map((s) => (s.id === sc.id ? { ...s, ...patch } : s)));
  const setText = (id, patch) => setSc({ text: sc.text.map((t) => (t.id === id ? { ...t, ...patch } : t)) });
  const tx = sc?.text.find((t) => t.id === selText) || null;
  const list = [...scenes].sort((a, b) => (referenced.has(b.id) ? 1 : 0) - (referenced.has(a.id) ? 1 : 0));
  if (!sc) return <Empty>No scenes yet.</Empty>;

  return (
    <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
      <div style={{ width: 200, flexShrink: 0 }}>
        <div style={{ border: `1px solid ${T.borderSubtle}`, borderRadius: 8, overflow: "hidden" }}>
          {list.map((s) => (
            <div key={s.id} onClick={() => { setSelId(s.id); setSelText(null); }} style={{ padding: "8px 10px", cursor: "pointer", borderBottom: `1px solid ${T.borderSubtle}`, background: s.id === sc.id ? T.primaryTint : "transparent", display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 22, height: 14, borderRadius: 2, background: s.background.value, flexShrink: 0 }} />
              <span style={{ fontSize: 12.5, color: s.id === sc.id ? T.primary : T.text, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</span>
              {referenced.has(s.id) && <Icon name="link" size={13} style={{ color: T.micro }} title="Used by this playlist" />}
            </div>
          ))}
        </div>
        <Btn variant="outline" style={{ height: 28, fontSize: 12.5, marginTop: 8 }} onClick={() => { const id = uid("sc"); setScenes([...scenes, mkScene({ id, name: "New scene" })]); setSelId(id); }}><Icon name="add" size={15} />New scene</Btn>
      </div>

      <div style={{ flex: 1, minWidth: 300 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 10 }}>
          <input value={sc.name} onChange={(e) => setSc({ name: e.target.value })} style={{ ...inputStyle, flex: 1 }} />
          <select value={sc.background.type} onChange={(e) => setSc({ background: { ...sc.background, type: e.target.value } })} style={{ ...inputStyle, width: 110 }}><option value="colour">Colour</option><option value="image">Image</option><option value="video">Video</option></select>
          <input type="color" value={/^#/.test(sc.background.value) ? sc.background.value : "#111111"} onChange={(e) => setSc({ background: { ...sc.background, value: e.target.value } })} style={{ width: 36, height: 32, border: `1px solid ${T.border}`, borderRadius: 6, padding: 2, background: "#fff" }} />
        </div>
        {/* canvas */}
        <div style={{ position: "relative", width: "100%", aspectRatio: "16 / 9", background: sc.background.value, borderRadius: 6, overflow: "hidden", border: `1px solid ${T.border}` }} onClick={() => setSelText(null)}>
          {sc.background.type !== "colour" && <div style={{ position: "absolute", right: 8, top: 8, fontSize: 10, color: "rgba(255,255,255,0.7)", display: "flex", alignItems: "center", gap: 3 }}><Icon name={sc.background.type === "video" ? "videocam" : "image"} size={12} />{sc.background.assetId || sc.background.type}</div>}
          {sc.text.map((t) => (
            <div key={t.id} onClick={(e) => { e.stopPropagation(); setSelText(t.id); }}
              style={{ position: "absolute", left: `${t.x}%`, top: `${t.y}%`, width: `${t.width}%`, minHeight: `${t.height}%`, color: t.font.colour, fontWeight: t.font.weight, fontSize: Math.max(9, t.font.size / 5), textAlign: t.font.align, lineHeight: 1.1, cursor: "pointer", padding: 2, boxSizing: "border-box",
                       outline: `1px ${selText === t.id ? "solid" : "dashed"} ${t.trustZone === "ph_locked" ? T.error : selText === t.id ? T.primary : "rgba(255,255,255,0.35)"}`, background: selText === t.id ? "rgba(22,155,194,0.15)" : "transparent" }}>
              {t.trustZone === "ph_locked" && <Icon name="lock" size={10} style={{ color: T.error, marginRight: 3 }} />}{t.content || <i style={{ opacity: 0.5 }}>empty</i>}
              {t.variants.length > 0 && <span style={{ fontSize: 8, marginLeft: 4, color: "#fff", background: T.aiViolet, borderRadius: 9999, padding: "0 4px" }}>{t.variants.length} variant{t.variants.length > 1 ? "s" : ""}</span>}
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
          <Btn variant="outline" style={{ height: 28, fontSize: 12.5 }} onClick={() => { const id = uid("t"); setSc({ text: [...sc.text, textElement({ id, content: "New text", y: 10 + sc.text.length * 14 })] }); setSelText(id); }}><Icon name="add" size={15} />Add text element</Btn>
          <span style={{ fontSize: 11.5, color: T.micro }}>{sc.text.length} text element{sc.text.length !== 1 ? "s" : ""} · click one to edit</span>
        </div>

        {tx && (
          <div style={{ marginTop: 12, border: `1px solid ${T.borderSubtle}`, borderRadius: 8, padding: 12 }}>
            <Grid cols={2} gap={10}>
              <Fld label="Content"><input value={tx.content} onChange={(e) => setText(tx.id, { content: e.target.value })} style={small} /></Fld>
              <Fld label="Trust zone" hint={TRUST_ZONES[tx.trustZone].hint}>
                <Segmented size="sm" value={tx.trustZone} onChange={(v) => setText(tx.id, { trustZone: v })} options={[{ value: "agent_addressable", label: "Agent-addressable", icon: "smart_toy" }, { value: "ph_locked", label: "PH-locked", icon: "lock" }]} />
              </Fld>
            </Grid>
            <Grid cols={4} gap={8}>
              {[["x", "X %"], ["y", "Y %"], ["width", "W %"], ["height", "H %"]].map(([k, l]) => <Fld key={k} label={l}><input type="number" value={tx[k]} onChange={(e) => setText(tx.id, { [k]: Number(e.target.value) })} style={small} /></Fld>)}
            </Grid>
            <Grid cols={4} gap={8}>
              <Fld label="Size (px)"><input type="number" value={tx.font.size} onChange={(e) => setText(tx.id, { font: { ...tx.font, size: Number(e.target.value) } })} style={small} /></Fld>
              <Fld label="Weight"><select value={tx.font.weight} onChange={(e) => setText(tx.id, { font: { ...tx.font, weight: Number(e.target.value) } })} style={small}>{[400, 500, 700].map((w) => <option key={w} value={w}>{w}</option>)}</select></Fld>
              <Fld label="Colour"><input type="color" value={/^#/.test(tx.font.colour) ? tx.font.colour : "#ffffff"} onChange={(e) => setText(tx.id, { font: { ...tx.font, colour: e.target.value } })} style={{ ...small, padding: 2 }} /></Fld>
              <Fld label="Align"><select value={tx.font.align} onChange={(e) => setText(tx.id, { font: { ...tx.font, align: e.target.value } })} style={small}>{["left", "center", "right"].map((a) => <option key={a}>{a}</option>)}</select></Fld>
            </Grid>
            <Grid cols={4} gap={8} style={{ marginBottom: 6 }}>
              <Fld label="Entrance"><select value={tx.animation.entrance} onChange={(e) => setText(tx.id, { animation: { ...tx.animation, entrance: e.target.value } })} style={small}>{ANIMATIONS.map((a) => <option key={a}>{a}</option>)}</select></Fld>
              <Fld label="Exit"><select value={tx.animation.exit} onChange={(e) => setText(tx.id, { animation: { ...tx.animation, exit: e.target.value } })} style={small}>{EXIT_ANIMATIONS.map((a) => <option key={a}>{a}</option>)}</select></Fld>
              <Fld label="Delay (ms)"><input type="number" value={tx.animation.delayMs} onChange={(e) => setText(tx.id, { animation: { ...tx.animation, delayMs: Number(e.target.value) } })} style={small} /></Fld>
              <Fld label="Duration (ms)"><input type="number" value={tx.animation.durationMs} onChange={(e) => setText(tx.id, { animation: { ...tx.animation, durationMs: Number(e.target.value) } })} style={small} /></Fld>
            </Grid>

            <SubPanel title={<span>Variants — personalisation binding point <span style={{ color: T.micro, fontWeight: 400 }}>({tx.variants.length})</span></span>} defaultOpen={tx.variants.length > 0}
              right={tx.trustZone === "ph_locked" ? <Pill color={T.error} bg="rgba(255,77,79,0.08)"><Icon name="lock" size={12} />PH-only</Pill> : null}>
              {tx.variants.map((v) => {
                const a = ATTRIBUTE_REGISTRY.find((x) => x.key === v.when.attr);
                const ops = OPS[a?.type || "string"];
                return (
                  <div key={v.id} style={{ display: "grid", gridTemplateColumns: "1.3fr 0.8fr 1fr 1.5fr 24px", gap: 6, alignItems: "center", marginBottom: 6 }}>
                    <select value={v.when.attr} onChange={(e) => setText(tx.id, { variants: tx.variants.map((x) => (x.id === v.id ? { ...x, when: { ...x.when, attr: e.target.value, op: OPS[(ATTRIBUTE_REGISTRY.find((q) => q.key === e.target.value) || {}).type || "string"][0][0] } } : x)) })} style={{ ...small, fontSize: 11.5 }}>
                      <option value="">attribute…</option>{ATTRIBUTE_REGISTRY.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
                    </select>
                    <select value={v.when.op} onChange={(e) => setText(tx.id, { variants: tx.variants.map((x) => (x.id === v.id ? { ...x, when: { ...x.when, op: e.target.value } } : x)) })} style={{ ...small, fontSize: 11.5 }}>{ops.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                    {a?.values ? <select value={v.when.value} onChange={(e) => setText(tx.id, { variants: tx.variants.map((x) => (x.id === v.id ? { ...x, when: { ...x.when, value: e.target.value } } : x)) })} style={{ ...small, fontSize: 11.5 }}>{a.values.map((q) => <option key={q}>{q}</option>)}</select>
                      : <input value={v.when.value} onChange={(e) => setText(tx.id, { variants: tx.variants.map((x) => (x.id === v.id ? { ...x, when: { ...x.when, value: e.target.value } } : x)) })} style={{ ...small, fontSize: 11.5 }} />}
                    <input value={v.content} placeholder="Replacement content" onChange={(e) => setText(tx.id, { variants: tx.variants.map((x) => (x.id === v.id ? { ...x, content: e.target.value } : x)) })} style={{ ...small, fontSize: 11.5 }} />
                    <Icon name="close" size={15} style={{ cursor: "pointer", color: T.muted }} onClick={() => setText(tx.id, { variants: tx.variants.filter((x) => x.id !== v.id) })} />
                  </div>
                );
              })}
              <Btn variant="outline" style={{ height: 26, fontSize: 12 }} onClick={() => setText(tx.id, { variants: [...tx.variants, textVariant({ id: uid("v"), when: { attr: "visitor.loyalty_tier", op: "eq", value: "Gold" } })] })}><Icon name="add" size={14} />Add variant</Btn>
              <Note>Working grammar for <code>text[].variants</code> (open question 2, blocking for tier-3 rendering): an ordered list of <code>{"{ when: {attr, op, value}, content }"}</code>, first match wins at the element's visibility deadline, falling back to the element's own content. A variant on a PH-locked element can only be authored by Personalisation Hub.</Note>
            </SubPanel>
          </div>
        )}
      </div>
    </div>
  );
}
