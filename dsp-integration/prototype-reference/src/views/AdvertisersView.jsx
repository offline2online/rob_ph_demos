import React, { useMemo, useState, useEffect } from "react";
import { T, Icon, Pill, Note, Table, TRow, TCell, Toggle, Empty, small, ADVERTISER_COLOUR, SaveBar, InfoTip } from "../ui.jsx";
import { advertiserSetting } from "../model/sellside.js";

/* Admin only. Per-advertiser settings: whether campaigns need retailer
   approval, and the floor multiplier used in pricing. Campaigns themselves
   are approved in the platform's existing Campaigns section, not here. */
const H = (label, tip) => <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>{label}<InfoTip size={14} text={tip} /></span>;

export default function AdvertisersView({ partners, lists: savedLists, setLists: saveLists, onDirtyChange }) {
  const [lists, setLists] = useState(savedLists);
  const dirty = JSON.stringify(lists) !== JSON.stringify(savedLists);
  useEffect(() => { if (onDirtyChange) onDirtyChange(dirty); }, [dirty]);
  const setAdv = (name, patch) => {
    const k = name.toLowerCase();
    setLists({ ...lists, advertiserSettings: { ...(lists.advertiserSettings || {}), [k]: { ...advertiserSetting(lists, name), ...patch } } });
  };
  const advertisers = useMemo(() => {
    const m = new Map();
    partners.forEach((x) => (x.seats || []).forEach((s) => {
      const k = s.name.toLowerCase();
      if (!m.has(k)) m.set(k, { name: s.name, partners: [] });
      m.get(k).partners.push(x);
    }));
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [partners]);
  const floor = lists.floorCpm;
  const cols = "1.4fr 1.4fr 170px 140px 120px";

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 220, fontSize: 12.5, color: T.muted }}>Every advertiser using the platform, across all DSPs.</div>
        <Pill color={T.muted} bg="#fff" border={T.border}><Icon name="admin_panel_settings" size={13} />Admin only</Pill>
      </div>
      {advertisers.length === 0 ? <Empty icon="sell">No advertisers yet. They appear here once a DSP is connected.</Empty> : (
        <Table cols={cols} header={["Advertiser", H("Via", "The DSP(s) this advertiser's campaigns come through."), H("Campaign approval", "Required: the advertiser's campaigns wait for approval in the Campaigns section. Not required: they publish after automated checks."), H("Floor multiplier", "Scales this advertiser's floor. Default 1.0, e.g. 0.8 for a preferred supplier or 1.2 for a new one."), H("Effective floor", `Floor CPM (${lists.currency || "AUD"} ${floor ?? "—"}, set in DSP Integration → Advertiser settings) × this advertiser's floor multiplier.`)]}>
          {advertisers.map((a, i) => {
            const st = advertiserSetting(lists, a.name);
            return (
              <TRow key={a.name} cols={cols} last={i === advertisers.length - 1}>
                <TCell><span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Icon name="sell" size={14} style={{ color: ADVERTISER_COLOUR }} />{a.name}</span></TCell>
                <TCell muted>{a.partners.map((x) => x.name).join(", ")}</TCell>
                <TCell><div style={{ display: "flex", alignItems: "center", gap: 8 }}><Toggle on={!!st.approvalRequired} onChange={(v) => setAdv(a.name, { approvalRequired: v })} /><span style={{ fontSize: 11.5, color: T.muted }}>{st.approvalRequired ? "Required" : "Not required"}</span></div></TCell>
                <TCell><input type="number" step="0.05" min="0" value={st.floorMultiplier} onChange={(e) => setAdv(a.name, { floorMultiplier: e.target.value === "" ? 1 : Number(e.target.value) })} style={{ ...small, width: 90 }} /></TCell>
                <TCell>{floor == null ? "—" : `${lists.currency || "AUD"} ${(floor * (st.floorMultiplier || 0)).toFixed(2)} CPM`}</TCell>
              </TRow>
            );
          })}
        </Table>
      )}
    </>
  );
}
