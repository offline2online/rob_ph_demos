// One fixed colour palette keyed by industry, shared by every console page that
// colours something by industry (Promote › Leads today; the website later).
// Pure functions, no DOM, so test/leads.test.mjs drives it directly.
//
// Each entry has a light and a dark set: `bar` is the accent bar, `bg`/`fg`
// the chip. fg on bg meets WCAG AA (4.5:1) in both themes; the test checks it.
// The console's dark theme is opt-in via <html data-theme="dark"> (apple.css),
// so styles.css switches on that attribute rather than prefers-color-scheme.
//
// Matching is case-insensitive and by alias at a word start, in list order,
// so "Telco retail" is Telco and "convenience / fuel" is Convenience and fuel.

// Aliases are written as one space-separated string, "_" meaning a space inside one.
const A = (str) => str.split(" ").filter(Boolean).map((x) => x.replace(/_/g, " "));

export const INDUSTRIES = [
  { key: "retail-media", label: "Retail Media", aliases: A("retail_media retail-media rmn"),
    light: { bar: "#5b6bd6", bg: "#e6e9fb", fg: "#3441a8" }, dark: { bar: "#8c98ee", bg: "#222a5c", fg: "#c6cdf8" } },
  { key: "telco", label: "Telco", aliases: A("telco telecom telecoms telecommunication wireless"),
    light: { bar: "#169bc2", bg: "#dff3fa", fg: "#0b5f7a" }, dark: { bar: "#4cc3e6", bg: "#0f3a4a", fg: "#a9e0f2" } },
  { key: "convenience-fuel", label: "Convenience and fuel", aliases: A("convenience fuel forecourt petrol c-store cstore"),
    light: { bar: "#d9730d", bg: "#fdeedc", fg: "#8a4300" }, dark: { bar: "#f0993f", bg: "#4a2a0a", fg: "#ffd2a3" } },
  { key: "pharmacy", label: "Pharmacy", aliases: A("pharmacy pharmacies chemist drugstore health"),
    light: { bar: "#2e9e5b", bg: "#ddf3e5", fg: "#1b6b3a" }, dark: { bar: "#5cc88a", bg: "#123a22", fg: "#b2e8c7" } },
  { key: "supermarket", label: "Grocery", aliases: A("grocery groceries supermarket food_retail"),
    light: { bar: "#7cb518", bg: "#eaf5d3", fg: "#4a6e0a" }, dark: { bar: "#a5d84a", bg: "#2a3a0c", fg: "#d6edA6" } },
  { key: "fashion", label: "Fashion", aliases: A("fashion apparel clothing footwear"),
    light: { bar: "#d6336c", bg: "#fce3ec", fg: "#a01d4c" }, dark: { bar: "#ee6e9a", bg: "#4a1a2c", fg: "#f8bdd2" } },
  { key: "qsr", label: "QSR", aliases: A("qsr quick_service quick-service fast_food fast-food"),
    light: { bar: "#d93a2f", bg: "#fde4e1", fg: "#9c231b", }, dark: { bar: "#f06e64", bg: "#4a1a17", fg: "#fabcb7" } },
  { key: "hospitality", label: "Hospitality", aliases: A("hospitality hotel restaurant leisure"),
    light: { bar: "#8e44ad", bg: "#f3e5f8", fg: "#6a1f86" }, dark: { bar: "#b877d3", bg: "#3d1f4a", fg: "#e6c2f4" } },
  { key: "banking", label: "Banking", aliases: A("bank banking financial finance"),
    light: { bar: "#2f5d9e", bg: "#e0e9f6", fg: "#1f4478" }, dark: { bar: "#6b98d8", bg: "#1a2c4a", fg: "#b6cdf0" } },
];

export const OTHER_INDUSTRY = {
  key: "other", label: "Other / not set", aliases: A(""),
  light: { bar: "#8c9196", bg: "#eceeef", fg: "#4a4f54" }, dark: { bar: "#a3a8ad", bg: "#34373a", fg: "#d0d3d6" },
};

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const MATCHERS = INDUSTRIES.map((e) => ({ e, re: new RegExp(`(^|[^a-z0-9])(${e.aliases.map(escRe).join("|")})`, "i") }));

// A free-text industry -> its palette entry. Unknown or blank -> Other / not set.
export function industryEntry(text) {
  const s = String(text == null ? "" : text).trim();
  if (!s) return OTHER_INDUSTRY;
  const hit = MATCHERS.find((m) => m.re.test(s));
  return hit ? hit.e : OTHER_INDUSTRY;
}

// A lead's colour: the company's own industry, else the website source industry.
export function leadIndustryEntry(lead) {
  const l = lead || {};
  const own = l.company && l.company.industry;
  const e = industryEntry(own);
  return e !== OTHER_INDUSTRY ? e : industryEntry(l.sourceIndustry);
}

// The label to print on a chip: the lead's own words when it has some,
// else the palette name ("Other / not set").
export function industryChipText(lead) {
  const l = lead || {};
  const own = String((l.company && l.company.industry) || "").trim() || String(l.sourceIndustry || "").trim();
  return own || OTHER_INDUSTRY.label;
}

// Inline custom properties for an element: styles.css reads --ind-* in light
// and --ind-*-d under [data-theme="dark"].
export function industryStyle(entry) {
  const e = entry || OTHER_INDUSTRY;
  return `--ind-bar:${e.light.bar};--ind-bg:${e.light.bg};--ind-fg:${e.light.fg};--ind-bar-d:${e.dark.bar};--ind-bg-d:${e.dark.bg};--ind-fg-d:${e.dark.fg}`;
}

// WCAG contrast ratio of two #rrggbb colours (used by the tests).
export function contrastRatio(a, b) {
  const lum = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
