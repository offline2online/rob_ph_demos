'use strict';
const nanoBanana = require('./nano-banana');
const { veo, veoFast } = require('./veo');
const { ltx, ltxFast } = require('./ltx');

const PROVIDERS = { [nanoBanana.id]: nanoBanana, [veo.id]: veo, [veoFast.id]: veoFast, [ltx.id]: ltx, [ltxFast.id]: ltxFast };
const DEFAULTS = { image: 'nano-banana', video: 'veo' };

function getProvider(id, kind) {
  const p = PROVIDERS[id || DEFAULTS[kind]];
  if (!p) {
    const err = new Error(`Unknown provider "${id}". ${kind ? `For ${kind}s use: ${Object.values(PROVIDERS).filter((x) => x.kind === kind).map((x) => x.id).join(', ')}` : ''}`);
    err.status = 400;
    throw err;
  }
  if (kind && p.kind !== kind) {
    const err = new Error(`${p.label} makes ${p.kind}s, not ${kind}s`);
    err.status = 400;
    throw err;
  }
  return p;
}

module.exports = { PROVIDERS, DEFAULTS, getProvider };
