'use strict';
const calc = require('../calc');
const { LOCALISATION_VARIABLES } = require('../constants');
const { ownAdvertiser } = require('../advertiser-view');

// Advertiser "Your targeting & scheduling": own level, Variables you use, Scheduling, and the Shared Targeting
// Variables shared with the advertiser's DSP that its campaigns do not use. Nothing about other advertisers.
// Sharing defaults (DSP Integration): Localisation is shared with every connected DSP, Personalisation with none
// until the retailer shares it; `catalog.sharedVariables[dsp]` overrides that.
module.exports = {
  path: '/my-targeting',
  advertiserAccess: true,
  handler({ store, filters }) {
    const me = ownAdvertiser(filters);
    const campaigns = [];
    store.scanCampaigns(filters, (c) => campaigns.push(c));
    const used = new Map();
    for (const c of campaigns) for (const v of c.variables) used.set(v.label, v);
    const order = (x, y) => x.label.localeCompare(y.label);
    const tag = (v) => ({ label: v.label, kind: v.kind, ...(v.personalisationType ? { personalisationType: v.personalisationType } : {}) });
    const variablesUsed = [...used.values()].sort(order).map(tag);

    const dsp = (store.advertisers[me] || {}).dsp;
    const configured = (store.catalog.sharedVariables || {})[dsp];
    const shared = calc.sharedVariables(configured || LOCALISATION_VARIABLES);
    const available = shared.filter((v) => !used.has(v.label)).sort(order).map(tag);
    const scheduled = campaigns.filter((c) => c.scheduled);

    const out = {
      variablesUsed,
      scheduling: { uses: scheduled.length > 0, scheduledCampaigns: scheduled.length, campaigns: campaigns.length, schedules: scheduled.reduce((s, c) => s + c.schedules, 0) },
      otherVariablesAvailable: {
        Localised: available.filter((v) => v.kind === 'Localised'),
        Personalised: available.filter((v) => v.kind === 'Personalised'),
      },
      usesEverySharedVariable: shared.length > 0 && available.length === 0,
    };
    const level = calc.maturityLevel(campaigns.map((c) => c.level));
    if (level) out.level = level; // no campaign in range: no level, omitted rather than "not set"
    return out;
  },
};
