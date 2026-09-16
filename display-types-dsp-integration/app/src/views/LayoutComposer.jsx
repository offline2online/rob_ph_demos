/* ------------------------------------------------------------------
   Experience Layout — templates, the surface layer (spec §6).

   HELD OUT OF THE FIRST RELEASE. Gated by SHOW_EXPERIENCE_LAYOUT in App.jsx;
   with the flag off this module tree-shakes out of the bundle entirely.
   Kept compiling against the aligned display-type model so flipping the
   flag brings it back with no other change.
------------------------------------------------------------------- */
import React, { useState } from "react";
import { T, MONO, Icon, Pill, Btn, SectionLabel, Note, Grid, Fld, ctl, Toggle, CTL_H } from "../ui.jsx";
import { isWebTP, webEl } from "../model/schema.js";
import { TEMPLATE_KINDS, MOBILE_MODULES, MOBILE_TEMPLATE_DEFS, MOCK, CONNECTION_STATES, SITE_TOKENS, PRECONFIGURED_ITEMS, CTA_ATTRS, MENU_ICONS } from "../model/data.js";
import { CONNECTED_ASSET } from "../assets.js";

const TokenField = ({ label, value, onChange, placeholder, hint }) => (
  <div style={{ minWidth: 0 }}>
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 5, gap: 8 }}>
      <span style={{ fontSize: 12, color: T.muted }}>{label}</span>
      <TokenMenu onPick={(tok) => onChange((value || "") + tok)} />
    </div>
    <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} style={{ ...ctl, fontFamily: MONO, fontSize: 12.5 }} />
    {hint && <div style={{ fontSize: 11, color: T.micro, marginTop: 4, lineHeight: 1.4 }}>{hint}</div>}
  </div>
);
const TokenMenu = ({ onPick }) => {
  const [open, setOpen] = useState(false);
  return (
    <span style={{ position: "relative", display: "inline-block" }}>
      <span onClick={() => setOpen(!open)} style={{ fontSize: 12, color: T.primary, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 3 }}><Icon name="add" size={14} />Add Token</span>
      {open && <span style={{ position: "absolute", right: 0, top: 20, zIndex: 20, background: "#fff", border: `1px solid ${T.border}`, borderRadius: 6, boxShadow: "0 4px 14px rgba(0,0,0,0.12)", padding: 4, minWidth: 150, display: "block" }}>
        {SITE_TOKENS.map((tok) => <span key={tok} onClick={() => { onPick(tok); setOpen(false); }} style={{ display: "block", padding: "6px 9px", fontSize: 11.5, fontFamily: MONO, color: T.text, cursor: "pointer", borderRadius: 4 }}>{tok}</span>)}
      </span>}
    </span>
  );
};

export default function LayoutComposer({ types, templates, setTemplates, playlists }) {
  const [selId, setSel] = useState(templates[0].id);
  const [dragOver, setDragOver] = useState(null);
  const [bp, setBp] = useState("desktop");
  const [paired, setPaired] = useState(false);
  const [modSel, setModSel] = useState(null);     // selected mobile module
  const [ctaEdit, setCtaEdit] = useState(null);   // index | "new"
  const [creating, setCreating] = useState(false);
  const [newT, setNewT] = useState({ name: "", kind: "web_page" });

  const tpl = templates.find((t) => t.id === selId) || templates[0];
  const set = (patch) => setTemplates(templates.map((t) => (t.id === tpl.id ? { ...t, ...patch } : t)));
  const setPair = (patch) => set({ pairing: { ...(tpl.pairing || {}), ...patch } });
  const kind = TEMPLATE_KINDS.find((k) => k.key === tpl.kind) || TEMPLATE_KINDS[0];
  const isMobile = kind.frame === "phone";
  const palette = types.filter((t) => isWebTP(t.touchPoint) && t.element?.type !== "qr_control");
  const qrElements = types.filter((t) => t.element?.type === "qr_control");
  const typeOf = (id) => types.find((t) => t.id === id);

  /* Switching type must seed whatever structure the new type needs, or the
     canvas renders against undefined and throws. */
  const changeKind = (k) => {
    const toMobile = TEMPLATE_KINDS.find((x) => x.key === k).frame === "phone";
    const patch = { kind: k };
    if (toMobile) {
      if (!tpl.modules) patch.modules = [{ mid: `h${Date.now()}`, type: "header" }, { mid: `c${Date.now()}`, type: "carousel" }, { mid: `a${Date.now()}`, type: "ctas" }];
      if (!tpl.items) patch.items = [];
      if (tpl.header === undefined) patch.header = "${BrandName} ${StoreName}";
      if (tpl.qrScanner === undefined) patch.qrScanner = true;
      if (!tpl.carouselPlaylist) patch.carouselPlaylist = playlists[0]?.id;
    } else {
      if (!tpl.rows) patch.rows = [];
      if (tpl.maxWidth === undefined) patch.maxWidth = 1200;
      if (tpl.widthMode === undefined) patch.widthMode = "contained";
      if (!tpl.pairing) patch.pairing = { on: true, elementId: "web_qr", anchor: "Bottom Right", offsetX: 24, offsetY: 24, mobileTemplate: "Mobile App" };
    }
    setModSel(null); setCtaEdit(null);
    set(patch);
  };

  const addTemplate = () => {
    if (!newT.name.trim()) return;
    const id = `tpl_${Date.now()}`;
    const base = { id, name: newT.name.trim(), kind: newT.kind, background: "#ffffff",
      pairing: { on: newT.kind === "web_page", elementId: "web_qr", anchor: "Bottom Right", offsetX: 24, offsetY: 24, mobileTemplate: "Mobile App" } };
    const seeded = newT.kind === "web_page"
      ? { ...base, maxWidth: 1200, widthMode: "contained", rows: [] }
      : { ...base, header: "${BrandName} ${StoreName}", qrScanner: true, carouselPlaylist: playlists[0]?.id,
          modules: [{ mid: `h${Date.now()}`, type: "header" }, { mid: `c${Date.now()}`, type: "carousel" }, { mid: `a${Date.now()}`, type: "ctas" }],
          items: [] };
    setTemplates([...templates, seeded]);
    setSel(id); setCreating(false); setNewT({ name: "", kind: "web_page" });
  };

  /* ---- web drag & drop ---- */
  const dropAt = (i, e) => {
    e.preventDefault(); setDragOver(null);
    const payload = e.dataTransfer.getData("text/plain");
    if (!payload) return;
    if (payload.startsWith("new:")) {
      const rows = [...tpl.rows];
      rows.splice(i, 0, { rid: `r${Date.now()}`, typeId: payload.slice(4) });
      set({ rows });
    } else if (payload.startsWith("move:")) {
      const from = Number(payload.slice(5));
      if (from === i || from + 1 === i) return;
      const rows = [...tpl.rows];
      const [m] = rows.splice(from, 1);
      rows.splice(from < i ? i - 1 : i, 0, m);
      set({ rows });
    }
  };
  const DropZone = ({ i }) => (
    <div onDragOver={(e) => { e.preventDefault(); setDragOver(i); }}
      onDragLeave={() => setDragOver((v) => (v === i ? null : v))}
      onDrop={(e) => dropAt(i, e)}
      style={{ height: dragOver === i ? 30 : 10, borderRadius: 4, transition: "height .12s",
        background: dragOver === i ? T.primaryTint : "transparent",
        border: dragOver === i ? `2px dashed ${T.primary}` : "2px dashed transparent",
        display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: T.primary }}>
      {dragOver === i ? "Drop here" : ""}
    </div>
  );

  /* ---- mobile modules ---- */
  const moveMod = (i, d) => {
    const n = [...tpl.modules]; const j = i + d;
    if (j < 0 || j >= n.length) return;
    [n[i], n[j]] = [n[j], n[i]]; set({ modules: n });
  };
  const addMod = (type) => set({ modules: [...tpl.modules, { mid: `m${Date.now()}`, type }] });

  const moveCta = (i, dnum) => {
    const n = [...(tpl.items || [])]; const j = i + dnum;
    if (j < 0 || j >= n.length) return;
    [n[i], n[j]] = [n[j], n[i]]; set({ items: n });
  };
  const saveCta = (item) => {
    const items = ctaEdit === "new" ? [...tpl.items, item] : tpl.items.map((x, i) => (i === ctaEdit ? item : x));
    set({ items }); setCtaEdit(null);
  };

  return (
    <div style={{ display: "flex", gap: 18, alignItems: "flex-start", flexWrap: "wrap" }}>
      {/* ---------------- templates + palette ---------------- */}
      <div style={{ width: 210, flexShrink: 0 }}>
        <div style={{ fontSize: 12, color: T.micro, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 8 }}>Templates</div>
        {creating ? (
          <div style={{ border: `1px solid ${T.primary}`, borderRadius: 8, padding: 10, marginBottom: 12 }}>
            <Fld label="Template name">
              <input autoFocus value={newT.name} onChange={(e) => setNewT({ ...newT, name: e.target.value })}
                onKeyDown={(e) => { if (e.key === "Enter") addTemplate(); if (e.key === "Escape") setCreating(false); }}
                placeholder="e.g. Store Connect" style={ctl} />
            </Fld>
            <div style={{ height: 10 }} />
            <Fld label="Template type">
              <select value={newT.kind} onChange={(e) => setNewT({ ...newT, kind: e.target.value })} style={ctl}>
                {TEMPLATE_KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
              </select>
            </Fld>
            <div style={{ display: "flex", gap: 6, marginTop: 12 }}>
              <Btn variant="primary" style={{ flex: 1, justifyContent: "center" }} disabled={!newT.name.trim()} onClick={addTemplate}>Create</Btn>
              <Btn onClick={() => setCreating(false)}>Cancel</Btn>
            </div>
          </div>
        ) : (
          <Btn variant="primary" style={{ width: "100%", justifyContent: "center", marginBottom: 10 }} onClick={() => setCreating(true)}>
            <Icon name="add" size={16} />New template
          </Btn>
        )}

        <div style={{ border: `1px solid ${T.borderSubtle}`, borderRadius: 8, overflow: "hidden", marginBottom: 16 }}>
          {templates.map((t) => {
            const a = t.id === tpl.id;
            const k = TEMPLATE_KINDS.find((x) => x.key === t.kind) || TEMPLATE_KINDS[0];
            const n = t.kind === "web_page" ? (t.rows || []).length : (t.modules || []).length;
            return (
              <div key={t.id} onClick={() => { setSel(t.id); setModSel(null); setCtaEdit(null); }}
                style={{ padding: "9px 11px", cursor: "pointer", borderBottom: `1px solid ${T.borderSubtle}`, background: a ? T.primaryTint : "transparent" }}>
                <div style={{ fontSize: 12.5, color: a ? T.primary : T.text, display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                  <Icon name={k.icon} size={14} />
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.name}</span>
                </div>
                <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>
                  {k.label} · {n} module{n === 1 ? "" : "s"}{t.isDefault ? " · default" : ""}
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ fontSize: 12, color: T.micro, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 6 }}>
          {isMobile ? "Modules" : "Display types"}
        </div>
        <div style={{ fontSize: 11.5, color: T.muted, marginBottom: 8 }}>
          {isMobile ? "Click to add to the site." : "Drag onto the page."}
        </div>
        {isMobile
          ? MOBILE_MODULES.map((m) => (
              <div key={m.key} onClick={() => addMod(m.key)}
                style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 10px", marginBottom: 6, borderRadius: 6, border: `1px solid ${T.border}`, background: "#fff", cursor: "pointer", fontSize: 12.5 }}>
                <Icon name="add" size={14} style={{ color: T.micro }} />
                <Icon name={m.icon} size={15} style={{ color: T.primary }} />{m.label}
              </div>
            ))
          : palette.map((t) => (
              <div key={t.id} draggable onDragStart={(e) => e.dataTransfer.setData("text/plain", `new:${t.id}`)}
                style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 10px", marginBottom: 6, borderRadius: 6, border: `1px solid ${T.border}`, background: "#fff", cursor: "grab", fontSize: 12.5 }}>
                <Icon name="drag_indicator" size={15} style={{ color: T.micro }} />
                <Icon name={webEl(t.element?.type).icon} size={15} style={{ color: T.primary }} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.name}</span>
              </div>
            ))}
      </div>

      {/* ---------------- canvas ---------------- */}
      <div style={{ flex: 1, minWidth: 320 }}>
        <Grid cols={2}>
          <Fld label="Template type">
            <select value={tpl.kind} onChange={(e) => changeKind(e.target.value)} style={ctl}>
              {TEMPLATE_KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
            </select>
          </Fld>
          <div />
          <Fld label="Template name">
            <input value={tpl.name} onChange={(e) => set({ name: e.target.value })} style={ctl} />
          </Fld>
          <div />
        </Grid>

        <div style={{ border: `1px solid ${T.border}`, borderRadius: 8, padding: 12, background: T.surfaceAlt, minHeight: 180 }}>
          {isMobile ? (
            (tpl.modules || []).map((m, i) => {
              const def = MOBILE_MODULES.find((x) => x.key === m.type);
              const a = modSel === m.mid;
              return (
                <div key={m.mid} onClick={() => { setModSel(m.mid); setCtaEdit(null); }}
                  style={{ background: "#fff", border: `2px ${a ? "solid" : "dashed"} ${a ? T.primary : T.border}`, borderRadius: 8, padding: "10px 12px", marginBottom: 8, cursor: "pointer", display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ display: "flex", flexDirection: "column" }} onClick={(e) => e.stopPropagation()}>
                    <span onClick={() => moveMod(i, -1)} style={{ cursor: "pointer", opacity: i === 0 ? 0.2 : 1, lineHeight: 0.65 }}><Icon name="expand_less" size={15} style={{ color: T.muted }} /></span>
                    <span onClick={() => moveMod(i, 1)} style={{ cursor: "pointer", opacity: i === tpl.modules.length - 1 ? 0.2 : 1, lineHeight: 0.65 }}><Icon name="expand_more" size={15} style={{ color: T.muted }} /></span>
                  </div>
                  <Icon name={def.icon} size={17} style={{ color: T.primary }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5 }}>{def.label}</div>
                    <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>
                      {m.type === "ctas" ? `${(tpl.items || []).length} CTAs — click to manage`
                        : m.type === "carousel" ? (playlists.find((p) => p.id === tpl.carouselPlaylist)?.name || "No playlist")
                        : m.type === "header" ? tpl.header : def.desc}
                    </div>
                  </div>
                  <Icon name="close" size={16} style={{ color: T.muted, cursor: "pointer" }}
                    onClick={(e) => { e.stopPropagation(); set({ modules: tpl.modules.filter((_, k) => k !== i) }); }} />
                </div>
              );
            })
          ) : (
            <>
              <DropZone i={0} />
              {(tpl.rows || []).map((row, i) => {
                const t = typeOf(row.typeId);
                if (!t) return null;
                const el = webEl(t.element?.type);
                return (
                  <div key={row.rid}>
                    <div draggable onDragStart={(e) => e.dataTransfer.setData("text/plain", `move:${i}`)}
                      style={{ background: "#fff", border: `2px dashed ${T.primary}`, borderRadius: 8, padding: "10px 12px", cursor: "grab", display: "flex", alignItems: "center", gap: 10 }}>
                      <Icon name="drag_indicator" size={16} style={{ color: T.micro }} />
                      <Icon name={el.icon} size={17} style={{ color: T.primary }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13.5 }}>{t.name}</div>
                        <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>
                          {el.plays} · {t.wDesktop || 1200}×{t.hDesktop || 520}px
                        </div>
                      </div>
                      <Icon name="close" size={16} style={{ color: T.muted, cursor: "pointer" }}
                        onClick={() => set({ rows: tpl.rows.filter((_, k) => k !== i) })} />
                    </div>
                    <DropZone i={i + 1} />
                  </div>
                );
              })}
              {(tpl.rows || []).length === 0 && (
                <div style={{ padding: 26, textAlign: "center", color: T.muted, fontSize: 13 }}>Empty template — drag a display type here.</div>
              )}
            </>
          )}
        </div>

        {!isMobile && (
          <>
            <SectionLabel>Template settings</SectionLabel>
            <Grid cols={3}>
              <Fld label="Width"><select value={tpl.widthMode} onChange={(e) => set({ widthMode: e.target.value })} style={ctl}><option value="contained">Contained</option><option value="full">Full bleed</option></select></Fld>
              <Fld label="Max width (px)"><input type="number" value={tpl.maxWidth} onChange={(e) => set({ maxWidth: Number(e.target.value) })} style={ctl} /></Fld>
              <div />
            </Grid>
            <Grid cols={3}>
              <Fld label="Background"><input type="color" value={tpl.background} onChange={(e) => set({ background: e.target.value })} style={swatch} /></Fld>
              <div />
            </Grid>

            <SectionLabel>QR control (pairing overlay)</SectionLabel>
            <div style={{ fontSize: 12, color: T.muted, marginBottom: 12, lineHeight: 1.5 }}>
              Appearance — colours, icons and attribution — is defined on the QR Control element.
              The template decides <b>which element to use and where it sits</b>.
            </div>
            <Grid cols={3}>
              <Fld label="Enable overlay">
                <div style={{ height: CTL_H, display: "flex", alignItems: "center" }}>
                  <Toggle on={tpl.pairing.on} onChange={(v) => setPair({ on: v })} />
                </div>
              </Fld>
              <Fld label="QR Control element">
                <select value={tpl.pairing.elementId || ""} disabled={!tpl.pairing.on}
                  onChange={(e) => setPair({ elementId: e.target.value })} style={{ ...ctl, opacity: tpl.pairing.on ? 1 : 0.45 }}>
                  {qrElements.length === 0 && <option value="">No QR Control element defined</option>}
                  {qrElements.map((q) => <option key={q.id} value={q.id}>{q.name}</option>)}
                </select>
              </Fld>
              <Fld label="Opens">
                <select value={tpl.pairing.mobileTemplate} disabled={!tpl.pairing.on}
                  onChange={(e) => setPair({ mobileTemplate: e.target.value })} style={{ ...ctl, opacity: tpl.pairing.on ? 1 : 0.45 }}>
                  {templates.filter((x) => x.kind !== "web_page").map((x) => <option key={x.id}>{x.name}</option>)}
                </select>
              </Fld>
            </Grid>
            <Grid cols={3}>
              <Fld label="Anchor">
                <select value={tpl.pairing.anchor} disabled={!tpl.pairing.on} onChange={(e) => setPair({ anchor: e.target.value })} style={{ ...ctl, opacity: tpl.pairing.on ? 1 : 0.45 }}>
                  {["Top Left", "Top Right", "Bottom Left", "Bottom Right", "Center"].map((o) => <option key={o}>{o}</option>)}
                </select>
              </Fld>
              <Fld label="Offset X"><input type="number" value={tpl.pairing.offsetX} disabled={!tpl.pairing.on} onChange={(e) => setPair({ offsetX: Number(e.target.value) })} style={{ ...ctl, opacity: tpl.pairing.on ? 1 : 0.45 }} /></Fld>
              <Fld label="Offset Y"><input type="number" value={tpl.pairing.offsetY} disabled={!tpl.pairing.on} onChange={(e) => setPair({ offsetY: Number(e.target.value) })} style={{ ...ctl, opacity: tpl.pairing.on ? 1 : 0.45 }} /></Fld>
            </Grid>
          </>
        )}
      </div>

      {/* ---------------- right panel ---------------- */}
      <div style={{ width: 310, flexShrink: 0 }}>
        {isMobile && modSel ? (
          (() => {
            const mod = (tpl.modules || []).find((m) => m.mid === modSel);
            if (!mod) return <MobilePreview t={tpl} playlists={playlists} />;
            if (mod.type === "header") return (
              <div style={{ border: `1px solid ${T.primary}`, borderRadius: 8, padding: 14 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                  <span style={{ fontSize: 15, fontWeight: 500 }}>Site Header</span>
                  <Icon name="close" size={18} style={{ color: T.muted, cursor: "pointer" }} onClick={() => setModSel(null)} />
                </div>
                <TokenField label="Header text" value={tpl.header} onChange={(v) => set({ header: v })}
                  hint="Substituted at render time from the resolved store and visitor context." />
                <div style={{ height: 14 }} />
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 13 }}>Enable QR Code Scanner</span>
                  <Toggle on={tpl.qrScanner} onChange={(v) => set({ qrScanner: v })} />
                </div>
                <Note>The scanner sits in the header, so it is configured here.</Note>
              </div>
            );
            if (mod.type === "carousel") return (
              <div style={{ border: `1px solid ${T.primary}`, borderRadius: 8, padding: 14 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                  <span style={{ fontSize: 15, fontWeight: 500 }}>Carousel</span>
                  <Icon name="close" size={18} style={{ color: T.muted, cursor: "pointer" }} onClick={() => setModSel(null)} />
                </div>
                <Fld label="Playlist">
                  <select value={tpl.carouselPlaylist} onChange={(e) => set({ carouselPlaylist: e.target.value })} style={ctl}>
                    {playlists.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </Fld>
                <Note>Campaigns in this playlist rotate at the top of the mobile site.</Note>
              </div>
            );
            if (mod.type === "content") return (
              <div style={{ border: `1px solid ${T.primary}`, borderRadius: 8, padding: 14 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                  <span style={{ fontSize: 15, fontWeight: 500 }}>Content</span>
                  <Icon name="close" size={18} style={{ color: T.muted, cursor: "pointer" }} onClick={() => setModSel(null)} />
                </div>
                <TokenField label="Text" value={mod.text || ""} placeholder="Copy shown on the site"
                  onChange={(v) => set({ modules: tpl.modules.map((m) => (m.mid === mod.mid ? { ...m, text: v } : m)) })} />
              </div>
            );
            // ctas
            return ctaEdit !== null ? (
              <MenuItemEditor initial={ctaEdit === "new" ? null : tpl.items[ctaEdit]} onCancel={() => setCtaEdit(null)} onSave={saveCta} />
            ) : (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, gap: 8 }}>
                  <div style={{ fontSize: 15, fontWeight: 500 }}>CTAs</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <Btn variant="outline" style={{ height: 28, fontSize: 12.5 }} onClick={() => setCtaEdit("new")}><Icon name="add" size={15} />Add</Btn>
                    <Icon name="close" size={18} style={{ color: T.muted, cursor: "pointer" }} onClick={() => setModSel(null)} />
                  </div>
                </div>
                <div style={{ border: `1px solid ${T.borderSubtle}`, borderRadius: 8, overflow: "hidden" }}>
                  {(tpl.items || []).map((it, i) => (
                    <div key={i} style={{ padding: "9px 11px", borderBottom: i < tpl.items.length - 1 ? `1px solid ${T.borderSubtle}` : "none", display: "flex", alignItems: "flex-start", gap: 8 }}>
                      <div style={{ display: "flex", flexDirection: "column", paddingTop: 1 }}>
                        <span onClick={() => moveCta(i, -1)} style={{ cursor: "pointer", opacity: i === 0 ? 0.2 : 1, lineHeight: 0.65 }}>
                          <Icon name="expand_less" size={15} style={{ color: T.muted }} /></span>
                        <span onClick={() => moveCta(i, 1)} style={{ cursor: "pointer", opacity: i === tpl.items.length - 1 ? 0.2 : 1, lineHeight: 0.65 }}>
                          <Icon name="expand_more" size={15} style={{ color: T.muted }} /></span>
                      </div>
                      <Icon name={it.icon} size={17} style={{ color: T.text, marginTop: 1 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 500 }}>{it.name}</div>
                        <div style={{ display: "flex", gap: 3, flexWrap: "wrap", marginTop: 4 }}>
                          {it.states.map((st) => {
                            const c = CONNECTION_STATES.find((x) => x.key === st);
                            return <Pill key={st} color={T.primary} bg={T.primaryTint}>{c ? c.label.replace(" State", "") : st}</Pill>;
                          })}
                          <Pill color={T.muted} bg="rgba(0,0,0,0.04)">{it.hours === "24" ? "24h" : "hours"}</Pill>
                          {(it.rules || []).length > 0 && <Pill color={T.aiViolet} bg="rgba(151,71,255,0.10)"><Icon name="filter_alt" size={11} />{it.rules.length}</Pill>}
                        </div>
                      </div>
                      <Icon name="edit" size={15} style={{ color: T.muted, cursor: "pointer" }} onClick={() => setCtaEdit(i)} />
                      <Icon name="delete" size={15} style={{ color: T.error, cursor: "pointer" }} onClick={() => set({ items: tpl.items.filter((_, k) => k !== i) })} />
                    </div>
                  ))}
                  {(tpl.items || []).length === 0 && <div style={{ padding: 20, textAlign: "center", fontSize: 12.5, color: T.muted }}>No CTAs yet.</div>}
                </div>
                <Note>Visibility is set per connection state, so the same site shows different actions in store and away from store.</Note>
              </div>
            );
          })()
        ) : isMobile ? (
          <MobilePreview t={tpl} playlists={playlists} />
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <div style={{ fontSize: 12, color: T.micro, textTransform: "uppercase", letterSpacing: "0.5px" }}>Preview</div>
              <div style={{ display: "inline-flex", border: `1px solid ${T.border}`, borderRadius: 6, overflow: "hidden" }}>
                {[["desktop", "desktop_windows"], ["tablet", "tablet_mac"], ["mobile", "smartphone"]].map(([k, ic], i) => (
                  <div key={k} onClick={() => setBp(k)} style={{ padding: "4px 8px", cursor: "pointer", background: bp === k ? T.primary : "#fff", color: bp === k ? "#fff" : T.muted, borderRight: i < 2 ? `1px solid ${T.border}` : "none" }}>
                    <Icon name={ic} size={14} />
                  </div>
                ))}
              </div>
            </div>
            <TemplatePreview tpl={tpl} types={types} bp={bp} kind={kind} paired={paired} />
            {tpl.pairing.on && (
              <div style={{ marginTop: 10, display: "inline-flex", border: `1px solid ${T.border}`, borderRadius: 6, overflow: "hidden" }}>
                {[["Idle", false], ["Connected", true]].map(([l, v], i) => (
                  <div key={l} onClick={() => setPaired(v)}
                    style={{ padding: "5px 12px", fontSize: 12, cursor: "pointer", background: paired === v ? T.primary : "#fff", color: paired === v ? "#fff" : T.muted, borderRight: i === 0 ? `1px solid ${T.border}` : "none" }}>{l}</div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}


function TemplatePreview({ tpl, types, bp, kind, paired }) {
  const qrEl = types.find((t) => t.id === tpl.pairing?.elementId);
  const idle = { qrColour: qrEl?.qrControl?.qrCode?.colour || "#000000", qrSize: qrEl?.qrControl?.qrCode?.size || 120, showPoweredBy: true, poweredByText: qrEl?.qrControl?.connected?.poweredByText || "Powered by Personalisation Hub" };
  const conn = { icon: qrEl?.qrControl?.connected?.icon || "smartphone", iconColour: qrEl?.qrControl?.connectedIconColour || "#169bc2", showPoweredBy: true };
  const w = kind.frame === "phone" ? 190 : { desktop: 300, tablet: 240, mobile: 175 }[bp];
  const typeOf = (id) => types.find((t) => t.id === id);
  const p = tpl.pairing;
  const anchor = {
    "Top Left": { left: 8, top: 8 }, "Top Right": { right: 8, top: 8 },
    "Bottom Left": { left: 8, bottom: 8 }, "Bottom Right": { right: 8, bottom: 8 },
    "Center": { left: "50%", top: "50%", transform: "translate(-50%,-50%)" },
  }[p.anchor];
  const qrBox = Math.max(26, Math.round(idle.qrSize / 3.2));

  return (
    <div style={{ width: w, border: `1px solid ${T.border}`, borderRadius: kind.frame === "phone" ? 16 : 8, overflow: "hidden", background: "#fff", position: "relative", transition: "width .15s" }}>
      <div style={{ height: 18, background: T.surfaceAlt, borderBottom: `1px solid ${T.borderSubtle}`, display: "flex", alignItems: "center", justifyContent: kind.frame === "phone" ? "center" : "flex-start", gap: 3, padding: "0 7px" }}>
        {kind.frame === "phone"
          ? <div style={{ width: 40, height: 5, borderRadius: 9999, background: "rgba(0,0,0,0.2)" }} />
          : ["#ff5f57", "#febc2e", "#28c840"].map((c) => <span key={c} style={{ width: 6, height: 6, borderRadius: 9999, background: c }} />)}
      </div>

      <div style={{ maxHeight: 380, overflowY: "auto", background: tpl.background, padding: tpl.widthMode === "contained" ? "8px 10px" : "8px 0" }}>
        {tpl.rows.map((row, i) => {
          const t = typeOf(row.typeId);
          if (!t) return null;
          const el = webEl(t.element?.type);
          const mock = MOCK[t.id] || ["Campaign"];
          const cols = el.plays === "simultaneous" ? (t.element?.breakpoints?.[bp]?.columns) || 1 : 1;
          const shown = el.plays === "simultaneous" ? ((t.element?.breakpoints?.[bp]?.items) || mock.length) : 1;
          const locked = el.key === "order";
          return (
            <div key={row.rid}>
              <div style={{ marginBottom: 8 }}>
                {locked ? (
                  <div style={{ border: `1px solid ${T.error}`, background: "rgba(255,77,79,0.06)", borderRadius: 4, padding: 7 }}>
                    <div style={{ fontSize: 8.5, color: T.error, display: "flex", alignItems: "center", gap: 3 }}><Icon name="lock" size={10} />PH-authored</div>
                    <div style={{ height: 7, width: "40%", background: "rgba(0,0,0,0.25)", borderRadius: 2, marginTop: 5 }} />
                    <div style={{ height: 4, width: "72%", background: "rgba(0,0,0,0.12)", borderRadius: 2, marginTop: 4 }} />
                  </div>
                ) : el.plays === "simultaneous" ? (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                    {mock.slice(0, shown).map((m, k) => (
                      <div key={k} style={{ width: `calc(${100 / cols}% - 4px)`, background: T.primaryTint, border: `1px solid ${T.primaryAccent}`, borderRadius: 3, padding: 5, minHeight: 30, display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", fontSize: 8, color: T.primary, lineHeight: 1.2 }}>{m}</div>
                    ))}
                  </div>
                ) : (
                  <div style={{ background: T.primaryTint, border: `1px solid ${T.primaryAccent}`, borderRadius: 3, minHeight: el.key === "hero" ? 54 : 40, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3, fontSize: 9, color: T.primary }}>
                    <Icon name={el.icon} size={14} />{mock[0]}
                    {el.plays === "sequential" && (
                      <div style={{ display: "flex", gap: 3, marginTop: 2 }}>
                        {mock.map((_, k) => <span key={k} style={{ width: 4, height: 4, borderRadius: 9999, background: k === 0 ? T.primary : "transparent", border: `1px solid ${T.primary}` }} />)}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {p.on && qrEl && (
        <div style={{ position: "absolute", ...anchor, width: qrBox, height: qrBox, background: "#fff", borderRadius: 5,
          boxShadow: "0 3px 10px rgba(0,0,0,0.25)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          border: `1px solid ${paired ? p.connectedColour : "rgba(0,0,0,0.08)"}` }}>
          {paired
            ? <img src={CONNECTED_ASSET} alt="Connected" style={{ width: "82%", display: "block" }} />
            : <Icon name="qr_code_2" size={Math.round(qrBox * 0.72)} style={{ color: p.colour }} />}
        </div>
      )}
    </div>
  );
}

/* --------------------------- mobile store sites --------------------------- */

function MenuItemEditor({ initial, onCancel, onSave }) {
  const [it, setIt] = useState(initial || { pre: "custom", icon: "link", name: "", url: "", newTab: false, states: ["connected_store"], hours: "24", rules: [] });
  const set = (p) => setIt({ ...it, ...p });
  const pre = PRECONFIGURED_ITEMS.find((p) => p.key === it.pre);
  const isCustom = it.pre === "custom";
  const valid = it.name.trim() && (!isCustom || it.url.trim());

  const choosePre = (k) => {
    const p = PRECONFIGURED_ITEMS.find((x) => x.key === k);
    set({ pre: k, icon: p.icon, name: it.name || (k === "custom" ? "" : p.label), url: k === "custom" ? it.url : "" });
  };

  return (
    <div style={{ border: `1px solid ${T.primary}`, borderRadius: 8, padding: 14 }}>
      <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 12 }}>Menu Item</div>

      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 12, color: T.muted, marginBottom: 4 }}>Pre-configured menu item</div>
        <select value={it.pre} onChange={(e) => choosePre(e.target.value)} style={{ ...inputStyle, height: 30, fontSize: 12.5 }}>
          {PRECONFIGURED_ITEMS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
        </select>
        {!isCustom && <Note>{pre.label} is handled by the platform — no URL needed.</Note>}
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <div style={{ width: 96 }}>
          <div style={{ fontSize: 12, color: T.muted, marginBottom: 4 }}>Icon</div>
          <select value={it.icon} onChange={(e) => set({ icon: e.target.value })} style={{ ...inputStyle, height: 30, fontSize: 12 }}>
            {MENU_ICONS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, color: T.muted, marginBottom: 4 }}>Menu Name</div>
          <input value={it.name} onChange={(e) => set({ name: e.target.value })} style={{ ...inputStyle, height: 30, fontSize: 12.5 }} />
        </div>
      </div>

      {isCustom && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
            <span style={{ fontSize: 12, color: T.muted }}>URL</span>
          </div>
          <input value={it.url} onChange={(e) => set({ url: e.target.value })} placeholder="{YourDomain}?store={$StoreName}"
            style={{ ...inputStyle, height: 30, fontFamily: MONO, fontSize: 11.5 }} />
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 5 }}>
            {SITE_TOKENS.map((tok) => (
              <span key={tok} onClick={() => set({ url: it.url + tok })}
                style={{ fontSize: 10, fontFamily: MONO, padding: "2px 5px", borderRadius: 4, border: `1px solid ${T.border}`, cursor: "pointer", color: T.primary }}>{tok}</span>
            ))}
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 8, cursor: "pointer", fontSize: 12.5 }}>
            <input type="checkbox" checked={it.newTab} onChange={(e) => set({ newTab: e.target.checked })} style={{ width: 15, height: 15, accentColor: T.primary }} />
            Open in New Tab
          </label>
        </div>
      )}

      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 12, color: T.muted, marginBottom: 6 }}>When Menu Item will be shown</div>
        {CONNECTION_STATES.map((c) => {
          const on = it.states.includes(c.key);
          return (
            <label key={c.key} style={{ display: "flex", alignItems: "flex-start", gap: 7, marginBottom: 6, cursor: "pointer" }}>
              <input type="checkbox" checked={on} style={{ width: 15, height: 15, accentColor: T.primary, marginTop: 1 }}
                onChange={(e) => set({ states: e.target.checked ? [...it.states, c.key] : it.states.filter((x) => x !== c.key) })} />
              <span style={{ minWidth: 0 }}>
                <span style={{ fontSize: 12.5 }}>{c.label}</span>
                <span style={{ fontSize: 11, color: T.muted, display: "block", lineHeight: 1.35 }}>{c.hint}</span>
              </span>
            </label>
          );
        })}
      </div>

      <div style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
          <span style={{ fontSize: 12, color: T.muted }}>Targeting criteria</span>
          <span onClick={() => set({ rules: [...(it.rules || []), { attr: CTA_ATTRS[0], op: "is", value: "" }] })}
            style={{ fontSize: 12, color: T.primary, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 3 }}>
            <Icon name="add" size={14} />Add rule
          </span>
        </div>
        {(it.rules || []).length === 0 && (
          <div style={{ fontSize: 11.5, color: T.micro, lineHeight: 1.45 }}>
            No criteria — shown to everyone in the selected states.
          </div>
        )}
        {(it.rules || []).map((r, i) => (
          <div key={i} style={{ display: "flex", gap: 5, marginBottom: 5, alignItems: "center" }}>
            <select value={r.attr} onChange={(e) => set({ rules: it.rules.map((x, k) => (k === i ? { ...x, attr: e.target.value } : x)) })}
              style={{ ...ctl, height: 28, fontSize: 11.5, flex: 1.2 }}>
              {CTA_ATTRS.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
            <select value={r.op} onChange={(e) => set({ rules: it.rules.map((x, k) => (k === i ? { ...x, op: e.target.value } : x)) })}
              style={{ ...ctl, height: 28, fontSize: 11.5, width: 78 }}>
              {["is", "is not", "contains", "exists"].map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
            {r.op !== "exists" && (
              <input value={r.value} onChange={(e) => set({ rules: it.rules.map((x, k) => (k === i ? { ...x, value: e.target.value } : x)) })}
                placeholder="value" style={{ ...ctl, height: 28, fontSize: 11.5, flex: 1 }} />
            )}
            <Icon name="close" size={15} style={{ color: T.muted, cursor: "pointer" }}
              onClick={() => set({ rules: it.rules.filter((_, k) => k !== i) })} />
          </div>
        ))}
        <Note>All criteria must match. Evaluated on top of the connection states above.</Note>
      </div>

      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 12, color: T.muted, marginBottom: 6 }}>Availability</div>
        {[["24", "Show 24 hours a day"], ["opening", "Show based on Store Opening Hours"]].map(([k, l]) => (
          <label key={k} style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 5, cursor: "pointer", fontSize: 12.5 }}>
            <input type="radio" checked={it.hours === k} onChange={() => set({ hours: k })} style={{ accentColor: T.primary }} />{l}
          </label>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <Btn variant="primary" disabled={!valid} onClick={() => onSave(it)}>Save</Btn>
        <Btn onClick={onCancel}>Cancel</Btn>
      </div>
    </div>
  );
}

function MobilePreview({ t, playlists }) {
  const [state, setState] = useState("connected_display");
  const visible = t.items.filter((i) => i.states.includes(state));
  const header = t.header
    .replace("${BrandName}", "One NZ").replace("${StoreName}", "Newmarket")
    .replace("${StoreCode}", "NM01").replace("${FirstName}", "Eli").replace("${QueuePosition}", "3");

  return (
    <div>
      <div style={{ fontSize: 12, color: T.micro, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 8 }}>Preview</div>
      <div style={{ fontSize: 12, color: T.muted, marginBottom: 6 }}>Connection state</div>
      <select value={state} onChange={(e) => setState(e.target.value)} style={{ ...inputStyle, height: 30, fontSize: 12.5, marginBottom: 12 }}>
        {CONNECTION_STATES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
      </select>

      <div style={{ width: 210, border: `2px solid ${T.border}`, borderRadius: 18, overflow: "hidden", background: "#fff" }}>
        <div style={{ height: 20, background: T.surfaceAlt, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ width: 44, height: 5, borderRadius: 9999, background: "rgba(0,0,0,0.2)" }} />
        </div>
        <div style={{ padding: "12px 12px 8px", borderBottom: `1px solid ${T.borderSubtle}`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 600, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{header}</div>
          {t.qrScanner && <Icon name="qr_code_scanner" size={17} style={{ color: T.primary, flexShrink: 0 }} />}
        </div>
        <div style={{ padding: 10 }}>
          {(t.modules || []).some((m) => m.type === "carousel") && (
            <div style={{ background: T.primaryTint, border: `1px solid ${T.primaryAccent}`, borderRadius: 5, minHeight: 62, marginBottom: 8, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3 }}>
              <Icon name="view_carousel" size={16} style={{ color: T.primary }} />
              <span style={{ fontSize: 9.5, color: T.primary, textAlign: "center", padding: "0 6px" }}>
                {(playlists || []).find((p) => p.id === t.carouselPlaylist)?.name || "Carousel"}
              </span>
              <div style={{ display: "flex", gap: 3 }}>
                {[0,1,2].map((k) => <span key={k} style={{ width: 4, height: 4, borderRadius: 9999, background: k === 0 ? T.primary : "transparent", border: `1px solid ${T.primary}` }} />)}
              </div>
            </div>
          )}
          {visible.map((i, k) => (
            <div key={k} style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 10px", border: `1px solid ${T.borderSubtle}`, borderRadius: 6, marginBottom: 6 }}>
              <Icon name={i.icon} size={16} style={{ color: T.primary }} />
              <span style={{ fontSize: 12, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{i.name}</span>
              <Icon name="chevron_right" size={14} style={{ color: T.micro }} />
            </div>
          ))}
          {visible.length === 0 && <div style={{ padding: 16, textAlign: "center", fontSize: 11.5, color: T.muted }}>No items shown in this state.</div>}
          {(t.modules || []).some((m) => m.type === "footer") && (
            <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${T.borderSubtle}`, textAlign: "center", fontSize: 9, color: T.micro, lineHeight: 1.5 }}>
              Site footer<br />Legal · Contact · Privacy
            </div>
          )}
        </div>
      </div>
      <Note>
        {visible.length} of {t.items.length} items visible in this state. Availability rules would further hide
        items outside store opening hours.
      </Note>
    </div>
  );
}
