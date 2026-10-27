'use strict';
const { DEAL_TYPES, SOURCES, normaliseDealType } = require('../constants');
const { FilterError } = require('../filters');

// Chart-level filters shared by summary and revenue. Accepts `dsps=a,b`, `dsps=a&dsps=b` and `dsps[]=a`.
function listParam(params, key) {
  const out = [];
  for (const raw of [...params.getAll(key), ...params.getAll(`${key}[]`)]) for (const p of raw.split(',')) if (p.trim()) out.push(p.trim());
  return out.length ? new Set(out) : null;
}

function dspFilter(params) {
  const set = listParam(params, 'dsps');
  return set ? (r) => set.has(r.dsp) : null;
}

function dealTypeSet(params) {
  const raw = listParam(params, 'dealTypes');
  const set = raw && new Set([...raw].map(normaliseDealType));
  if (set) for (const t of set) if (!DEAL_TYPES.includes(t)) throw new FilterError(`dealTypes must be among ${DEAL_TYPES.join(', ')}`);
  return set;
}

/** Row predicate for the optional dsps[] / dealTypes[] chart filters; null when neither is set. */
function chartFilter(params) {
  const dsp = dspFilter(params);
  const types = dealTypeSet(params);
  if (!dsp && !types) return null;
  return (r) => (!dsp || dsp(r)) && (!types || types.has(r.dealType));
}

// Rounded to the cent after settling float noise (1e-6), so the order a sum was added in never decides a half cent.
const cents = (n) => Math.round(Math.round(n * 1e6) / 1e4) / 100;

module.exports = { chartFilter, listParam, cents, DSPS: SOURCES };
