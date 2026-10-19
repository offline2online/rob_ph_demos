'use strict';
// Campaign variations (the targeted versions of a campaign) for the outcome charts: the name as authored, the tier it plays in,
// its targeting rules in plain language, and the audience label for an advertiser-private audience.
//
// Inputs, as production will hold them: the targeted versions and their rules from the stored campaign (GET /v1/campaigns/{id})
// and the version id recorded on each play in campaign playback analytics. The test retailer has neither as rows, so they are
// derived deterministically from the campaign here; the charts read only {id, name, tier, rules, private} and a play's version id.

const PRIVATE_AUDIENCE = 'Audience shared only with this advertiser';
// Advertisers with an advertiser-private audience in the test retailer (DSP Integration: "Advertiser audiences").
const PRIVATE_AUDIENCE_ADVERTISERS = new Set(['adv-blackmores', 'adv-haleon']);
const PERSONALISED_VERSIONS = [
  { name: 'New to brand', segment: 'new to brand', weight: 3 },
  { name: 'Existing buyer', segment: 'existing buyer', weight: 2 },
  { name: 'Lapsed buyer', segment: 'lapsed buyer', weight: 1 },
];
const LOCALISED_RULES = {
  'Store Open / Closed': { operator: 'is', values: ['Open'] },
  'Fixed Store Segments': { operator: 'includes', values: ['Metro'] },
  'Variable Store Segments': { operator: 'includes', values: ['Busy'] },
  'Display Tag(s)': { operator: 'includes', values: ['Window'] },
};
const TIERS = ['default', 'localised', 'personalised'];

const sentence = (text) => text.charAt(0).toUpperCase() + text.slice(1).toLowerCase().replace(/\bcomputer vision\b/, 'Computer Vision');

/** One campaign's variations, default first: [{id, name, tier, rules: [{variable, operator, values}], private, weight}]. */
function variationsOf(campaign, store) {
  const brand = ((store.advertisers || {})[campaign.advertiserId] || {}).name || campaign.advertiserId;
  const out = [{ id: `${campaign.id}-default`, name: 'Default', tier: 'default', rules: [], private: false, weight: 1 }];
  if (campaign.level === 'Default only') return out;
  const localVariable = (campaign.variables || []).find((v) => LOCALISED_RULES[v]) || 'Fixed Store Segments';
  out.push({ id: `${campaign.id}-localised`, name: 'Local stores', tier: 'localised', rules: [{ variable: localVariable, ...LOCALISED_RULES[localVariable] }], private: false, weight: 1 });
  if (campaign.level !== 'Personalised') return out;
  const n = Math.min(campaign.targetedVersions || 2, PERSONALISED_VERSIONS.length);
  PERSONALISED_VERSIONS.slice(0, n).forEach((v, i) => out.push({
    id: `${campaign.id}-p${i + 1}`, name: v.name, tier: 'personalised',
    rules: [{ variable: 'Visitor Segments', operator: 'is one of', values: [`${brand} · ${v.segment}`] }],
    private: i === 0 && PRIVATE_AUDIENCE_ADVERTISERS.has(campaign.advertiserId), weight: v.weight,
  }));
  return out;
}

/** Targeting rules in plain language, one line per variable and operator: "Visitor segments is one of: Blackmores · new to brand". */
function rulesText(rules) {
  const merged = new Map();
  for (const r of rules) {
    const key = `${r.variable}|${r.operator}`;
    if (!merged.has(key)) merged.set(key, { ...r, values: [] });
    for (const v of r.values) if (!merged.get(key).values.includes(v)) merged.get(key).values.push(v);
  }
  return [...merged.values()].map((r) => `${sentence(r.variable)} ${r.operator}: ${r.values.join(' · ')}`);
}

/** Split a whole-number total across weights so the parts add up to it (largest remainder). */
function splitTotal(total, weights) {
  const sum = weights.reduce((a, b) => a + b, 0);
  const raw = weights.map((w) => (total * w) / sum);
  const parts = raw.map(Math.floor);
  let left = total - parts.reduce((a, b) => a + b, 0);
  raw.map((x, i) => [x - Math.floor(x), i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]).forEach(([, i]) => { if (left > 0) { parts[i] += 1; left -= 1; } });
  return parts;
}

/** The version a play ran, picked among its tier's variations by `unit` (0 to under 1) in proportion to their weights. */
function pickVersion(variations, tier, unit) {
  const of = variations.filter((v) => v.tier === tier);
  const total = of.reduce((n, v) => n + v.weight, 0);
  let at = unit * total;
  for (const v of of) { at -= v.weight; if (at < 0) return v; }
  return of[of.length - 1];
}

module.exports = { variationsOf, rulesText, splitTotal, pickVersion, PRIVATE_AUDIENCE, TIERS };
