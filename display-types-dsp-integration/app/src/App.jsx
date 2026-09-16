import React, { useState, useEffect } from "react";
import { T, FONT, Icon, CountLine } from "./ui.jsx";
import TypesView from "./views/TypesView.jsx";
import PlaylistsView from "./views/PlaylistsView.jsx";
import PartnersView from "./views/PartnersView.jsx";
import LayoutComposer from "./views/LayoutComposer.jsx";
import { INITIAL_TYPES, INITIAL_PLAYLISTS, SCENES, INITIAL_PARTNERS, INITIAL_COMPANY_LISTS, INITIAL_EXCHANGE, INITIAL_TEMPLATES } from "./model/data.js";
import { COMPANY_LISTS } from "./model/sellside.js";

/* ------------------------------------------------------------------
   Personalisation Hub — Display Types & DSP Integration
   PROTOTYPE (iframed into HQ Admin): content frame only.

   Release scope: Experience Layout — templates, the surface layer — is
   built and working but deliberately OUT of this release. Set the flag to
   true to bring the nav item and route back with no other change.
------------------------------------------------------------------- */
export const SHOW_EXPERIENCE_LAYOUT = false;

const NAV = [
  { key: "types", label: "Display Types / Elements", icon: "dashboard_customize", title: "Display Types Details" },
  { key: "playlists", label: "Playlist Management", icon: "playlist_play", title: "Playlist Management" },
  { key: "layout", label: "Experience Layout", icon: "space_dashboard", title: "Experience Layout", scope: SHOW_EXPERIENCE_LAYOUT },
  { key: "partners", label: "Partners / DSPs", icon: "handshake", title: "Partners / DSPs" },
].filter((n) => n.scope !== false);

export default function App() {
  const [nav, setNav] = useState("types");
  const [types, setTypes] = useState(INITIAL_TYPES);
  const [playlists, setPlaylists] = useState(INITIAL_PLAYLISTS);
  const [scenes, setScenes] = useState(SCENES);
  const [partners, setPartners] = useState(INITIAL_PARTNERS);
  const [companyLists, setCompanyLists] = useState(INITIAL_COMPANY_LISTS);
  const [exchange, setExchange] = useState(INITIAL_EXCHANGE);
  const [templates, setTemplates] = useState(INITIAL_TEMPLATES);
  const [selType, setSelType] = useState("landscape");
  const [selPlaylist, setSelPlaylist] = useState("pl_landscape");
  const [selPartner, setSelPartner] = useState(COMPANY_LISTS);

  useEffect(() => {
    const l = document.createElement("link");
    l.rel = "stylesheet";
    l.href = "https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;600;700&family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap";
    document.head.appendChild(l);
    const s = document.createElement("style");
    s.textContent = `.material-symbols-outlined{font-variation-settings:'FILL' 0,'wght' 400,'GRAD' 0,'opsz' 24;display:inline-block;width:1em;overflow:hidden;white-space:nowrap} input,select,textarea,button{font-family:${FONT}} code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:0.92em;background:rgba(0,0,0,0.04);padding:0 4px;border-radius:3px}`;
    document.head.appendChild(s);
  }, []);

  const goToType = (id) => { setSelType(id); setNav("types"); };
  const goToPlaylist = (id) => { setSelPlaylist(id); setNav("playlists"); };
  const goToPartner = (id) => { setSelPartner(id); setNav("partners"); };
  const cur = NAV.find((n) => n.key === nav) || NAV[0];

  const counts = {
    types: [[types.length, "display types"]],
    playlists: [[playlists.length, "playlists"], [playlists.reduce((s, p) => s + p.items.length, 0), "items"]],
    partners: [[partners.filter((p) => p.status === "connected").length, "connected partners"], [partners.reduce((s, p) => s + p.seats.length, 0), "advertisers"]],
    layout: [[templates.length, "templates"]],
  }[nav];

  return (
    <div style={{ minHeight: "100vh", background: "#fff", padding: 20, fontFamily: FONT, color: T.text, fontSize: 14, boxSizing: "border-box" }}>
      <div style={{ fontSize: 20, fontWeight: 700 }}>{cur.title}</div>
      <div style={{ height: 1, background: T.divider, margin: "16px 0" }} />
      <div style={{ display: "flex", alignItems: "flex-start" }}>
        <div style={{ width: 210, flexShrink: 0, borderRight: `1px solid ${T.borderSubtle}`, alignSelf: "stretch" }}>
          <div style={{ fontSize: 10, letterSpacing: "0.5px", textTransform: "uppercase", color: T.micro, padding: "4px 16px 6px" }}>Displays</div>
          {NAV.slice(0, SHOW_EXPERIENCE_LAYOUT ? 3 : 2).map((n) => <NavItem key={n.key} n={n} active={nav === n.key} onClick={() => setNav(n.key)} />)}
          <div style={{ fontSize: 10, letterSpacing: "0.5px", textTransform: "uppercase", color: T.micro, padding: "14px 16px 6px" }}>Sell side</div>
          {NAV.slice(SHOW_EXPERIENCE_LAYOUT ? 3 : 2).map((n) => <NavItem key={n.key} n={n} active={nav === n.key} onClick={() => setNav(n.key)} />)}
        </div>
        <div style={{ flex: 1, minWidth: 0, paddingLeft: 20 }}>
          {counts && <div style={{ marginBottom: 12 }}><CountLine parts={counts} /></div>}
          {nav === "types" && <TypesView types={types} setTypes={setTypes} playlists={playlists} setPlaylists={setPlaylists} sel={selType} setSel={setSelType} partners={partners} companyLists={companyLists} goToPartners={() => goToPartner(COMPANY_LISTS)} goToPlaylist={goToPlaylist} />}
          {nav === "playlists" && <PlaylistsView playlists={playlists} setPlaylists={setPlaylists} scenes={scenes} setScenes={setScenes} types={types} sel={selPlaylist} setSel={setSelPlaylist} goToType={goToType} />}
          {nav === "layout" && SHOW_EXPERIENCE_LAYOUT && <LayoutComposer types={types} templates={templates} setTemplates={setTemplates} playlists={playlists} />}
          {nav === "partners" && <PartnersView partners={partners} setPartners={setPartners} companyLists={companyLists} setCompanyLists={setCompanyLists} exchange={exchange} setExchange={setExchange} types={types} goToType={goToType} sel={selPartner} setSel={setSelPartner} />}
        </div>
      </div>
    </div>
  );
}

const NavItem = ({ n, active, onClick }) => (
  <div onClick={onClick} style={{ padding: "11px 16px", cursor: "pointer", fontSize: 14, display: "flex", alignItems: "center", gap: 8, color: active ? T.primary : T.text, background: active ? T.primaryTint : "transparent" }}>
    <Icon name={n.icon} size={18} />{n.label}
  </div>
);
