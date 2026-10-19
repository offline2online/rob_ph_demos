'use strict';
const sr = require('../sales-response');
const { FilterError } = require('../filters');
const { rulesText, PRIVATE_AUDIENCE } = require('../variations');

const intParam = (params, name, { min, max }) => {
  const raw = params.get(name);
  if (raw === null || raw === '') return null;
  if (!/^\d+$/.test(raw) || Number(raw) < min || Number(raw) > max) throw new FilterError(`${name} must be a whole number from ${min} to ${max}`);
  return Number(raw);
};

const EMPTY_TEXT = {
  'no-pos': 'Requires a POS integration into the Personalisation Hub Transaction API.',
  'no-personalised-plays': 'No personalised plays for this campaign in the selected period.',
  'no-campaigns': 'No campaigns with personalised variants in the selected period.',
};
const NO_CONTROL = 'Control stores — none set for this campaign.';
const TOO_FEW = 'Too few plays to show a rate';

// Sales response after personalised plays (Targeting & scheduling maturity; the advertiser's Your targeting & scheduling).
// The page filters scope it (store, display type, date range, advertiser); an advertiser login is pinned to its own campaigns
// by the filters themselves, so another advertiser's campaign id is simply not in the list and is refused as unknown.
module.exports = {
  path: '/sales-response',
  advertiserAccess: true,
  handler({ store, filters, params, principal }) {
    const own = principal && principal.principalType === 'advertiser';
    const window = intParam(params, 'window', { min: 1, max: sr.MAX_WINDOW }) || sr.DEFAULT_WINDOW;
    const step = intParam(params, 'step', { min: 1, max: sr.MAX_WINDOW }) || 1;
    if (!sr.STEPS.includes(step)) throw new FilterError(`step must be one of ${sr.STEPS.join(', ')}`);
    if (step > window) throw new FilterError('step must not be larger than the window');
    const view = params.get('view') || 'step';
    if (!sr.VIEWS.includes(view)) throw new FilterError(`view must be one of ${sr.VIEWS.join(', ')}`);
    const hourFrom = intParam(params, 'hourFrom', { min: 0, max: 23 });
    const hourTo = intParam(params, 'hourTo', { min: 0, max: 23 });
    if ((hourFrom === null) !== (hourTo === null)) throw new FilterError('hourFrom and hourTo go together');
    if (hourFrom !== null && hourFrom > hourTo) throw new FilterError('hourFrom must not be after hourTo');

    const list = sr.personalisedCampaigns(store, filters);
    const campaigns = list.map((c) => {
      const a = store.advertisers[c.advertiserId] || {};
      const base = { id: c.id, name: c.name || c.id, product: c.product || null, start: c.start, end: c.end };
      return own ? base : { ...base, advertiserId: c.advertiserId, advertiserName: a.name || c.advertiserId, dsp: a.dsp || null };
    });
    const explicit = Boolean(params.get('campaignId'));
    const out = { variationsShown: false, window, step, view, hourBand: hourFrom === null ? null : { from: hourFrom, to: hourTo }, campaigns, campaignId: null, hours: [], emptyReason: null, emptyText: null, lines: [], coverage: null };
    const empty = (reason) => { out.emptyReason = reason; out.emptyText = EMPTY_TEXT[reason]; return out; };

    const wanted = params.get('campaignId');
    if (wanted && !list.some((c) => c.id === wanted)) throw new FilterError('campaignId is not one of the campaigns listed');
    const campaign = list.find((c) => c.id === wanted) || list[0];
    if (!campaign) return empty('no-campaigns');
    out.campaignId = campaign.id;
    out.matchedOnProductName = !(campaign.product && campaign.product.sku);
    if (!store.catalog.transactionApi) return empty('no-pos');

    const r = sr.salesResponse(store, campaign, filters, { window, step, view, hourFrom, hourTo, hoursError: (m) => new FilterError(m) });
    out.hours = r.hours;
    const personalised = r.lines.personalised;
    const control = r.lines.control;
    const stores = r.scope.treated.map((s) => store.catalog.stores[s].name || s).sort();
    out.coverage = { stores: stores.length, storeNames: stores, controlStores: r.scope.control.length, dateFrom: r.dates[0] || null, dateTo: r.dates[r.dates.length - 1] || null };
    if (!personalised.plays) return empty('no-personalised-plays');

    const variations = sr.variationsFor(store, campaign);
    const spec = [
      ['personalised', 'After a personalised play', r.lines.personalised],
      ['localised', 'After a localised play', r.lines.localised],
      ['control', 'Control stores, same clock time', control],
    ];
    const pointsOf = (line) => {
      let running = 0; const windowTransactions = line.transactions.reduce((a, b) => a + b, 0); // running view: the whole window's transactions, so the total builds up
      return line.sales.map((sales, i) => {
        const from = i * step; const to = Math.min((i + 1) * step, window);
        running += sales;
        const transactions = view === 'running' ? windowTransactions : line.transactions[i];
        return {
          from, to, label: sr.labelOf(from, to, step),
          value: sr.rate(view === 'running' ? running : sales, transactions),
          sales: view === 'running' ? running : sales, plays: line.plays, transactions,
        };
      });
    };
    out.lines = spec.flatMap(([key, label, line]) => {
      if (key === 'control' && !r.scope.control.length) return [{ key, label, available: false, note: NO_CONTROL, points: [] }];
      // With a campaign chosen, the personalised line splits into one line per personalised variation.
      if (key === 'personalised' && explicit) {
        out.variationsShown = true;
        return variations.filter((v) => v.tier === 'personalised').map((v) => {
          const vl = r.byVersion[v.id];
          const storeNames = [...vl.stores].map((s) => store.catalog.stores[s].name || s).sort();
          const detail = {
            variationId: v.id, tier: v.tier, rules: rulesText(v.rules), plays: vl.plays, stores: { count: storeNames.length, names: storeNames },
            ...(v.private ? { audienceNote: PRIVATE_AUDIENCE } : {}),
          };
          const k = `personalised:${v.id}`;
          if (vl.plays < sr.MIN_PLAYS) return { key: k, label: v.name, ...detail, available: false, note: TOO_FEW, points: [] };
          return { key: k, label: v.name, ...detail, available: true, points: pointsOf(vl) };
        });
      }
      return [{ key, label, available: true, plays: line.plays, points: pointsOf(line) }];
    });
    return out;
  },
};
