import React, { useState, useEffect } from "react";

/* ------------------------------------------------------------------
   Shared tokens and primitives.

   Every value here comes from the ph-designer skill (measured from the live
   platform, August 2026). This is a PROTOTYPE iframed into HQ Admin: the
   content frame only — no header, sidebar or breadcrumb, nothing
   `position: fixed`.
------------------------------------------------------------------- */

export const T = {
  primary: "#169bc2", primaryAccent: "#38b0cf", primaryTint: "rgba(22,155,194,0.10)", primarySoft: "#e8fdff",
  aiViolet: "#9747ff", aiGradient: "linear-gradient(135deg, #169bc2, #9747ff)",
  aiGradientSurface: "linear-gradient(135deg, rgba(22,155,194,0.2), rgba(151,71,255,0.2))",
  text: "#333333", muted: "rgba(0,0,0,0.45)", micro: "#9ca3af",
  border: "#d9d9d9", borderSubtle: "#f0f0f0", divider: "rgba(5,5,5,0.06)",
  surfaceAlt: "#fafafa", surfaceMuted: "#f5f5f5",
  success: "#52c41a", warning: "#faad14", error: "#ff4d4f", info: "#1677ff",
  kpi: { violet: "#f3f0ff", emerald: "#ecfdf5", red: "#fef2f2", amber: "#fff8e1" },
};
export const FONT = 'Roboto, "Helvetica Neue", Helvetica, Arial, sans-serif';
export const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";

export const ADVERTISER_COLOUR = "#7c3aed";
export const ZONE_COLOURS = ["#169bc2", "#9747ff", "#52c41a", "#faad14", "#ef60a7", "#0891b2"];

export const Icon = ({ name, size = 20, style, onClick, title }) => (
  <span className="material-symbols-outlined" onClick={onClick} title={title}
    style={{ fontSize: size, verticalAlign: "middle", lineHeight: 1, flexShrink: 0, ...style }}>{name}</span>
);

export const SectionLabel = ({ children, style }) => (
  <div style={{ fontSize: 12, letterSpacing: "0.5px", textTransform: "uppercase", color: T.muted, marginTop: 24, marginBottom: 12, ...style }}>{children}</div>
);

export const Pill = ({ children, color, bg, border, style, title }) => (
  <span title={title} style={{ display: "inline-flex", alignItems: "center", gap: 4, height: 22, padding: "0 8px", borderRadius: 9999, fontSize: 12, lineHeight: "22px", color, background: bg, border: border ? `1px solid ${border}` : "none", whiteSpace: "nowrap", ...style }}>{children}</span>
);

export const Btn = ({ children, onClick, variant = "default", disabled, style, title }) => {
  const v = {
    default: { background: "#fff", border: `1px solid ${T.border}`, color: T.text },
    primary: { background: T.primary, border: `1px solid ${T.primary}`, color: "#fff" },
    outline: { background: "#fff", border: `1px solid ${T.primary}`, color: T.primary },
    text: { background: "transparent", border: "1px solid transparent", color: T.primary },
    danger: { background: "#fff", border: `1px solid ${T.error}`, color: T.error },
    ai: { background: T.aiGradientSurface, border: "1px solid transparent", color: T.primary },
  }[variant];
  return (
    <button title={title} onClick={disabled ? undefined : onClick}
      style={{ height: 32, padding: "0 15px", borderRadius: 6, fontSize: 14, fontFamily: FONT, cursor: disabled ? "not-allowed" : "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, opacity: disabled ? 0.4 : 1, whiteSpace: "nowrap", overflow: "hidden", flexShrink: 0, ...v, ...style }}>
      {variant === "ai" ? <span style={{ backgroundImage: T.aiGradient, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent", display: "inline-flex", alignItems: "center", gap: 6 }}>{children}</span> : children}
    </button>
  );
};

export const CTL_H = 32;
export const inputStyle = { height: CTL_H, padding: "4px 11px", borderRadius: 6, border: `1px solid ${T.border}`, fontSize: 13, fontFamily: FONT, color: T.text, background: "#fff", outline: "none", width: "100%", boxSizing: "border-box" };
export const ctl = inputStyle;
export const small = { ...inputStyle, height: 28, fontSize: 12.5 };
export const swatch = { height: CTL_H, width: "100%", border: `1px solid ${T.border}`, borderRadius: 6, padding: 3, background: "#fff", boxSizing: "border-box", cursor: "pointer" };

export const Label = ({ children, required, info, right }) => (
  <div style={{ fontSize: 14, marginBottom: 6, display: "flex", alignItems: "center", gap: 5 }}>
    {required && <span style={{ color: T.error }}>*</span>}{children}
    {info && <Icon name="info" size={15} style={{ color: T.micro }} title={typeof info === "string" ? info : undefined} />}
    {right && <span style={{ marginLeft: "auto" }}>{right}</span>}
  </div>
);

export const Fld = ({ label, children, hint, required }) => (
  <div style={{ minWidth: 0 }}>
    <div style={{ fontSize: 12, color: T.muted, marginBottom: 5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
      {required && <span style={{ color: T.error }}>* </span>}{label}
    </div>
    {children}
    {hint && <div style={{ fontSize: 11, color: T.micro, marginTop: 4, lineHeight: 1.4 }}>{hint}</div>}
  </div>
);

export const Grid = ({ cols = 3, children, gap = 14, style }) => (
  <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap, marginBottom: 14, ...style }}>{children}</div>
);

export const Row = ({ children, style }) => <div style={{ display: "flex", gap: 14, marginBottom: 14, ...style }}>{children}</div>;
export const Col = ({ children, style }) => <div style={{ flex: 1, minWidth: 0, ...style }}>{children}</div>;

/* Collapsible section — bordered card with a grey header strip (components.md §14). */
export const Panel = ({ title, children, open, onToggle, badge, style }) => (
  <div style={{ border: `1px solid ${T.borderSubtle}`, borderRadius: 8, marginTop: 16, overflow: "hidden", ...style }}>
    <div onClick={onToggle} style={{ padding: "12px 16px", background: T.surfaceAlt, borderBottom: open ? `1px solid ${T.borderSubtle}` : "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 8, fontSize: 12, letterSpacing: "0.5px", textTransform: "uppercase" }}>
      <Icon name={open ? "expand_more" : "chevron_right"} size={18} style={{ color: T.muted }} />
      <span style={{ flex: 1 }}>{title}</span>
      {badge}
    </div>
    {open && <div style={{ padding: 16 }}>{children}</div>}
  </div>
);

export const SubPanel = ({ title, children, defaultOpen = false, right }) => {
  const [o, setO] = useState(defaultOpen);
  return (
    <div style={{ border: `1px solid ${T.borderSubtle}`, borderRadius: 6, marginBottom: 6, background: "#fff", overflow: "hidden" }}>
      <div onClick={() => setO(!o)} style={{ padding: "9px 12px", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, fontSize: 13, background: T.surfaceAlt }}>
        <Icon name={o ? "expand_more" : "chevron_right"} size={16} style={{ color: T.muted }} />
        <span style={{ flex: 1 }}>{title}</span>{right}
      </div>
      {o && <div style={{ padding: 12 }}>{children}</div>}
    </div>
  );
};

/* "Default (X)" select — null means "inherit the platform default". The
   platform renders inherited values exactly this way. */
export const DefaultSelect = ({ value, onChange, options, fallback, style }) => (
  <select value={value === null || value === undefined ? "__d__" : String(value)}
    onChange={(e) => onChange(e.target.value === "__d__" ? null : e.target.value)}
    style={{ ...inputStyle, color: value === null || value === undefined ? T.muted : T.text, ...style }}>
    <option value="__d__">Default ({fallback})</option>
    {options.map((o) => (typeof o === "string" ? <option key={o} value={o}>{o}</option> : <option key={o.value} value={o.value}>{o.label}</option>))}
  </select>
);

export const IconSelect = ({ value, onChange, options }) => {
  const [open, setOpen] = useState(false);
  const cur = options.find((o) => o.name === value) || options[0];
  return (
    <div style={{ position: "relative" }}>
      <div onClick={() => setOpen(!open)} style={{ ...inputStyle, display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
        <Icon name={cur.icon} size={17} style={{ color: T.primary }} />
        <span style={{ flex: 1 }}>{cur.name}</span>
        <Icon name={open ? "expand_less" : "expand_more"} size={17} style={{ color: T.muted }} />
      </div>
      {open && (
        <div style={{ position: "absolute", zIndex: 20, left: 0, right: 0, marginTop: 3, background: "#fff", border: `1px solid ${T.border}`, borderRadius: 6, boxShadow: "0 4px 14px rgba(0,0,0,0.12)", overflow: "hidden" }}>
          {options.map((o) => (
            <div key={o.name} onClick={() => { onChange(o.name); setOpen(false); }}
              style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 11px", cursor: "pointer", fontSize: 13, background: o.name === value ? T.primaryTint : "#fff", color: o.name === value ? T.primary : T.text }}>
              <Icon name={o.icon} size={17} />{o.name}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export const Toggle = ({ on, onChange, disabled }) => (
  <div onClick={disabled ? undefined : () => onChange(!on)}
    style={{ width: 44, height: 22, borderRadius: 9999, background: on ? T.primary : "rgba(0,0,0,0.25)", cursor: disabled ? "not-allowed" : "pointer", position: "relative", flexShrink: 0, opacity: disabled ? 0.45 : 1 }}>
    <div style={{ width: 18, height: 18, borderRadius: 9999, background: "#fff", position: "absolute", top: 2, left: on ? 24 : 2, transition: "left .15s" }} />
  </div>
);

export const ToggleRow = ({ label, hint, on, onChange, disabled, icon }) => (
  <div style={{ padding: "11px 0", borderBottom: `1px solid ${T.borderSubtle}` }}>
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      {icon && <Icon name={icon} size={18} style={{ color: disabled ? T.micro : T.text }} />}
      <span style={{ flex: 1, minWidth: 0, fontSize: 13.5 }}>{label}</span>
      <Toggle on={!!on} disabled={disabled} onChange={onChange} />
    </div>
    {hint && <div style={{ fontSize: 11.5, color: T.muted, marginTop: 5, marginLeft: icon ? 28 : 0, lineHeight: 1.45 }}>{hint}</div>}
  </div>
);

export const SubSettings = ({ children }) => (
  <div style={{ marginLeft: 28, marginTop: 12, padding: 12, background: T.surfaceAlt, border: `1px solid ${T.borderSubtle}`, borderRadius: 6 }}>{children}</div>
);

export const Note = ({ children, style }) => <div style={{ fontSize: 11.5, color: T.muted, marginTop: 8, lineHeight: 1.5, ...style }}>{children}</div>;

export const Callout = ({ tone = "info", icon, children, action, style }) => {
  const c = { info: T.primary, warning: T.warning, error: T.error, success: T.success }[tone];
  const bg = { info: T.primaryTint, warning: "rgba(250,173,20,0.10)", error: "rgba(255,77,79,0.06)", success: "rgba(82,196,26,0.10)" }[tone];
  return (
    <div style={{ padding: "9px 12px", borderRadius: 6, border: `1px solid ${c}`, background: bg, fontSize: 12.5, lineHeight: 1.5, display: "flex", alignItems: "flex-start", gap: 8, ...style }}>
      <Icon name={icon || { info: "info", warning: "warning", error: "error", success: "check_circle" }[tone]} size={16} style={{ color: c, marginTop: 1 }} />
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
      {action}
    </div>
  );
};

export const Empty = ({ children, icon = "inbox" }) => (
  <div style={{ padding: 16, borderRadius: 6, background: T.surfaceAlt, border: `1px solid ${T.borderSubtle}`, fontSize: 12.5, color: T.muted, lineHeight: 1.6, display: "flex", gap: 10, alignItems: "flex-start" }}>
    <Icon name={icon} size={20} style={{ color: T.border }} />
    <div>{children}</div>
  </div>
);

export const StatusDot = ({ tone, size = 8 }) => (
  <span style={{ display: "inline-block", width: size, height: size, borderRadius: 9999, background: { active: T.success, warning: T.warning, offline: T.error, idle: T.border }[tone] || tone, flexShrink: 0 }} />
);

/* Outlined pill — the platform's Playback Strategy pill. */
export const OutlinePill = ({ children, color = T.text, style }) => (
  <span style={{ display: "inline-flex", alignItems: "center", height: 22, padding: "0 10px", borderRadius: 9999, border: `1px solid ${T.border}`, fontSize: 12, color, whiteSpace: "nowrap", ...style }}>{children}</span>
);

/* Segmented control. */
export const Segmented = ({ value, onChange, options, size = "md" }) => (
  <div style={{ display: "inline-flex", border: `1px solid ${T.border}`, borderRadius: 6, overflow: "hidden" }}>
    {options.map((o, i) => {
      const k = typeof o === "string" ? o : o.value;
      const l = typeof o === "string" ? o : o.label;
      const a = value === k;
      return (
        <div key={k} onClick={() => onChange(k)} title={o.title}
          style={{ padding: size === "sm" ? "4px 9px" : "5px 12px", fontSize: size === "sm" ? 11.5 : 12, cursor: "pointer", display: "flex", alignItems: "center", gap: 5,
                   background: a ? T.primary : "#fff", color: a ? "#fff" : T.muted, borderRight: i < options.length - 1 ? `1px solid ${T.border}` : "none" }}>
          {o.icon && <Icon name={o.icon} size={14} />}{l}
        </div>
      );
    })}
  </div>
);

/* Simple bordered table on a CSS grid. */
export const Table = ({ cols, header, children, style }) => (
  <div style={{ border: `1px solid ${T.borderSubtle}`, borderRadius: 6, overflow: "hidden", ...style }}>
    <div style={{ display: "grid", gridTemplateColumns: cols, background: T.surfaceAlt, borderBottom: `1px solid ${T.borderSubtle}`, fontSize: 12, fontWeight: 600, color: T.muted }}>
      {header.map((h, i) => <div key={i} style={{ padding: "7px 10px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{h}</div>)}
    </div>
    {children}
  </div>
);
export const TRow = ({ cols, children, last, onClick, active, style }) => (
  <div onClick={onClick} style={{ display: "grid", gridTemplateColumns: cols, alignItems: "center", fontSize: 12.5, cursor: onClick ? "pointer" : "default",
    background: active ? T.primaryTint : "transparent", borderBottom: last ? "none" : `1px solid ${T.borderSubtle}`, ...style }}>{children}</div>
);
export const TCell = ({ children, style, muted, mono }) => (
  <div style={{ padding: "8px 10px", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: muted ? T.muted : undefined, fontFamily: mono ? MONO : undefined, fontSize: mono ? 12 : undefined, ...style }}>{children}</div>
);

/* KPI card (components.md §7). */
export const Kpi = ({ icon, tint, label, value, sub }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 12, borderRadius: 8, border: "1px solid rgba(0,0,0,0.05)", padding: "12px 16px", minWidth: 0 }}>
    <div style={{ width: 40, height: 40, borderRadius: 8, background: tint, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
      <Icon name={icon} size={22} style={{ color: T.text }} />
    </div>
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 10, fontWeight: 500, letterSpacing: "0.5px", color: T.micro, textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 600, color: T.text }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: T.muted }}>{sub}</div>}
    </div>
  </div>
);

/* Count line beneath a title (components.md §6). */
export const CountLine = ({ parts }) => (
  <div style={{ fontSize: 14, display: "flex", gap: 6, flexWrap: "wrap" }}>
    {parts.map(([n, noun], i) => <span key={i}>{i > 0 && <span style={{ color: T.muted }}>· </span>}<b>{n}</b> {noun}</span>)}
  </div>
);

export const Tabs = ({ value, onChange, items }) => (
  <div style={{ display: "flex", flexWrap: "wrap", borderBottom: `1px solid ${T.borderSubtle}`, marginBottom: 16 }}>
    {items.map((it) => {
      const a = value === it.key;
      return (
        <div key={it.key} onClick={() => onChange(it.key)}
          style={{ padding: "11px 7px", marginRight: 8, fontSize: 13.5, whiteSpace: "nowrap", fontWeight: a ? 500 : 400, color: a ? T.primary : T.text, cursor: "pointer",
                   borderBottom: `2px solid ${a ? T.primary : "transparent"}`, background: a ? T.primaryTint : "transparent", display: "flex", alignItems: "center", gap: 6 }}>
          {it.icon && <Icon name={it.icon} size={16} />}{it.label}
          {it.count !== undefined && <span style={{ fontSize: 11, color: a ? T.primary : T.micro, background: a ? "#fff" : T.surfaceMuted, borderRadius: 9999, padding: "0 6px" }}>{it.count}</span>}
        </div>
      );
    })}
  </div>
);

/* Chip toggle set. */
export const Chips = ({ options, value, onChange, tone = T.primary, disabledSet = [] }) => (
  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
    {options.map((c) => {
      const on = value.includes(c);
      const dis = disabledSet.includes(c);
      return (
        <span key={c} onClick={() => !dis && onChange(on ? value.filter((x) => x !== c) : [...value, c])}
          style={{ cursor: dis ? "not-allowed" : "pointer", opacity: dis ? 0.35 : 1, display: "inline-flex", alignItems: "center", gap: 4, height: 24, padding: "0 10px", borderRadius: 9999,
                   fontSize: 12, border: `1px solid ${on ? tone : T.border}`, background: on ? `${tone}1a` : "#fff", color: on ? tone : T.text }}>
          {on && <Icon name="check" size={13} />}{c}
        </span>
      );
    })}
  </div>
);

/* JSON viewer — how a record looks on the wire. */
export const JsonBlock = ({ value, maxHeight = 360 }) => (
  <pre style={{ margin: 0, padding: 12, background: "#1f2328", color: "#e6edf3", borderRadius: 6, fontSize: 11.5, lineHeight: 1.5, fontFamily: MONO, overflow: "auto", maxHeight }}>
    {JSON.stringify(value, null, 2)}
  </pre>
);

/* Tracks the iframe's own viewport width, so a prototype panel can react to
   how much canvas the parent has actually given it (a CTA Experience frame
   is resized by the parent and the user's own viewport, never a fixed size —
   see the ph-designer skill's prototyping.md §3). `window` inside an iframe
   measures that iframe's own browsing context, not the parent page's. */
export function useViewportWidth() {
  const [w, setW] = useState(typeof window !== "undefined" ? window.innerWidth : 1280);
  useEffect(() => {
    const onResize = () => setW(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return w;
}

export const fmtInt = (n) => (n === null || n === undefined ? "—" : Math.round(n).toLocaleString("en-GB"));
export const fmtMoney = (n, cur = "GBP") => (n === null || n === undefined ? "—" : new Intl.NumberFormat("en-GB", { style: "currency", currency: cur, maximumFractionDigits: 2 }).format(n));
export const uid = (p = "id") => `${p}_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
