'use strict';
const calc = require('../calc');
const { displayTypeFacts } = require('../display-types');

// Slot allocation per display type: slots per loop split into advertiser and own content, with durations and sold %.
module.exports = {
  path: '/slot-allocation',
  handler({ store, filters }) {
    const inv = new Map();
    store.scanInventory(filters, (r) => {
      const a = inv.get(r.displayTypeId) || { sold: 0, unsold: 0, offline: 0 };
      a.sold += r.sold; a.unsold += r.unsold; a.offline += r.offline;
      inv.set(r.displayTypeId, a);
    });
    const rows = displayTypeFacts(store, filters).filter((t) => t.loop).map((t) => {
      const a = inv.get(t.id) || { sold: 0, unsold: 0, offline: 0 };
      const { loop } = t;
      return {
        id: t.id, name: t.def.name,
        connectedDisplays: { displays: t.displays.length, stores: t.storeCount },
        slotsPerLoop: loop.slotsPerLoop,
        loopSeconds: loop.loopSeconds,
        averageSlotSeconds: Math.round((loop.loopSeconds / loop.slotsPerLoop) * 10) / 10,
        advertiserSlots: loop.advertiser,
        ownContentSlots: loop.ownContent,
        advertiserSlotsSoldPercent: calc.fillPercent(a.sold, a.unsold, a.offline),
      };
    });
    return { rows };
  },
};
