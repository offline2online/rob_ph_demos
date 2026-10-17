'use strict';
// The shared page-filter layer: dateFrom, dateTo, storeIds[], displayTypeIds[], advertiserIds[].

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// Every endpoint scans the range day by day, so an unbounded range would block the single-threaded server.
const MAX_RANGE_DAYS = 366;
const MIN_YEAR = 2000;
const MAX_YEAR = 2100;

class FilterError extends Error {}
class ForbiddenError extends Error {}

function parseDate(name, value) {
  if (!DATE_RE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))
      || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) {
    throw new FilterError(`${name} must be a calendar date (YYYY-MM-DD)`);
  }
  return value;
}

function list(params, key) {
  const raw = [...params.getAll(key), ...params.getAll(`${key}[]`)];
  const out = [];
  for (const r of raw) for (const part of r.split(',')) if (part.trim()) out.push(part.trim());
  return out.length ? [...new Set(out)] : null;
}

/** Parse URLSearchParams into a filter object; `null` for a list means "no restriction". */
function parseFilters(params, { today = new Date().toISOString().slice(0, 10), defaultDays = 30 } = {}) {
  const dateTo = params.get('dateTo') ? parseDate('dateTo', params.get('dateTo')) : today;
  let dateFrom;
  if (params.get('dateFrom')) dateFrom = parseDate('dateFrom', params.get('dateFrom'));
  else dateFrom = new Date(Date.parse(`${dateTo}T00:00:00Z`) - (defaultDays - 1) * 86400000).toISOString().slice(0, 10);
  if (dateFrom > dateTo) throw new FilterError('dateFrom must not be after dateTo');
  for (const [name, v] of [['dateFrom', dateFrom], ['dateTo', dateTo]]) {
    const year = Number(v.slice(0, 4));
    if (year < MIN_YEAR || year > MAX_YEAR) throw new FilterError(`${name} must be in ${MIN_YEAR}-${MAX_YEAR}`);
  }
  const span = Math.round((Date.parse(`${dateTo}T00:00:00Z`) - Date.parse(`${dateFrom}T00:00:00Z`)) / 86400000) + 1;
  if (span > MAX_RANGE_DAYS) throw new FilterError(`date range must not be longer than ${MAX_RANGE_DAYS} days`);
  return {
    dateFrom,
    dateTo,
    storeIds: list(params, 'storeIds'),
    displayTypeIds: list(params, 'displayTypeIds'),
    advertiserIds: list(params, 'advertiserIds'),
  };
}

// Implemented in scope.js (which needs dealing.js, which needs this file), so required lazily.
const scopeFilters = (...args) => require('./scope').scopeFilters(...args);

const days = (f) => Math.round((Date.parse(`${f.dateTo}T00:00:00Z`) - Date.parse(`${f.dateFrom}T00:00:00Z`)) / 86400000) + 1;

module.exports = { parseFilters, scopeFilters, FilterError, ForbiddenError, days };
