'use strict';
// MCP tools for agents (REQUIREMENTS section 2 and 7 step 4): Streamable HTTP, JSON-RPC 2.0, POST /mcp.
// Read-only. A tool is one API endpoint (or one dataset) and a tool call is a runRoute call under the
// caller's own principal, so an agent gets exactly what the tab gets: the same filters, the same rounding,
// advertisers pinned to themselves server-side, retailer-only endpoints refused. tools/list shows an
// advertiser only the tools it may call.

const { FilterError, ForbiddenError } = require('./filters');
const { runRoute } = require('./query');
const { availableDatasets, buildDataset, DATASETS } = require('./datasets');

const PROTOCOL_VERSION = '2025-03-26';
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024; // the serialised response to one HTTP request, text plus structuredContent
const MAX_ID_LENGTH = 200;
const str = (description) => ({ type: 'string', description });
const strs = (description) => ({ type: 'array', items: { type: 'string' }, description });
const PAGE_FILTERS = {
  dateFrom: str('First day, YYYY-MM-DD. Defaults to 30 days ending dateTo.'),
  dateTo: str('Last day, YYYY-MM-DD. Defaults to today. The range is at most 366 days.'),
  storeIds: strs('Limit to these stores.'),
  displayTypeIds: strs('Limit to these display types.'),
  advertiserIds: strs('Limit to these advertisers. Advertiser logins are always pinned to their own id.'),
};
const GRANULARITY = str('day, week or month.');
const CHART = { dsps: strs('Limit the money figures to these DSPs.'), dealTypes: strs('Limit the money figures to these deal types.') };

// route -> [tool name, description, extra arguments]
const TOOLS = {
  summary: ['retail_media_summary', 'Earned revenue, estimated revenue and Inventory sold for the filters.', CHART],
  revenue: ['retail_media_revenue', 'Revenue per period x DSP x deal type, earned and estimated.', { granularity: GRANULARITY, ...CHART }],
  yield: ['retail_media_yield', 'Effective CPM, earned revenue and assumed views (VAC-d) per DSP.', { dealType: str('One deal type.') }],
  'display-types': ['retail_media_display_types', 'Display types with their facts and VAC-d averages.', {}],
  'slot-value': ['retail_media_slot_value', 'Floor and effective CPM and value per slot per day, by display type.', {}],
  'slot-allocation': ['retail_media_slot_allocation', 'Advertiser and own-content slots per loop, by display type.', {}],
  'missed-revenue': ['retail_media_missed_revenue', 'Fill, unsold value at floor and downtime lost revenue, by display type.', {}],
  deals: ['retail_media_deals', 'Named deals with fill, pacing (Programmatic guaranteed), revenue, CPM and advertisers.', { dealType: str('One deal type.') }],
  advertisers: ['retail_media_advertisers', 'Advertisers by revenue, share, deals and effective CPM.', {}],
  maturity: ['retail_media_maturity', 'Targeting and scheduling maturity: ladder, scheduling, variables in use and the advertiser table.',
    { granularity: GRANULARITY, level: str('Table filter: a maturity level.'), scheduling: str('Table filter.'), kind: str('Variables filter: Localised or Personalised.'), variable: str('Table filter: a variable label.') }],
  delivery: ['retail_media_delivery', "An advertiser's plays won and spend per day, per-deal blocks and Programmatic guaranteed pacing. A retailer must pass exactly one advertiserIds.", { dealId: str('A deal id or open-auction.') }],
  'deals-by-display-type': ['retail_media_deals_by_display_type', "An advertiser's deals grouped by display type. A retailer must pass exactly one advertiserIds.", {}],
  audience: ['retail_media_audience', "An advertiser's assumed views (VAC-d) delivered, with a daily trend. A retailer must pass exactly one advertiserIds.", {}],
  'my-targeting': ['retail_media_my_targeting', "An advertiser's targeting level, variables used and scheduling. A retailer must pass exactly one advertiserIds.", {}],
};

const schema = (props) => ({ type: 'object', properties: props, additionalProperties: false });

function toolList(principal, routes) {
  const advertiser = principal.principalType === 'advertiser';
  const tools = [];
  for (const [path, [name, description, extra]] of Object.entries(TOOLS)) {
    const route = routes.get(`/${path}`);
    if (!route || (advertiser && !route.advertiserAccess)) continue;
    tools.push({ name, description, inputSchema: schema({ ...PAGE_FILTERS, ...extra }) });
  }
  tools.push({
    name: 'retail_media_dataset',
    description: 'A flat table of the same figures, as the QuickSight dataset of that name. Omit name to list the datasets you may read.',
    inputSchema: schema({ name: str('Dataset name.'), ...PAGE_FILTERS, granularity: GRANULARITY, dealType: str('One deal type.'), dealId: str('A deal id or open-auction.') }),
  });
  return tools;
}

function toParams(args) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(args || {})) {
    if (v === null || v === undefined) continue;
    if (Array.isArray(v)) for (const x of v) { if (x !== null && typeof x === 'object') throw new FilterError(`${k} must be a list of strings`); p.append(k, String(x)); }
    else if (typeof v === 'object') throw new FilterError(`${k} must be a string or a list of strings`);
    else p.set(k, String(v));
  }
  return p;
}

// Arguments are checked with Object.hasOwn: `k in obj` also follows the prototype chain ("constructor", "__proto__").
const has = (obj, k) => Object.hasOwn(obj, k);

function callTool(name, args, { store, routes, principal, today }) {
  if (args !== undefined && args !== null && (typeof args !== 'object' || Array.isArray(args))) throw new FilterError('arguments must be an object');
  const params = toParams(args);
  if (name === 'retail_media_dataset') {
    const ds = params.get('name') && DATASETS.find((d) => d.name === params.get('name'));
    // A dataset takes the page filters plus the extra arguments of the route it is built from, nothing else.
    const extra = ds ? (TOOLS[ds.route] || [, , {}])[2] : {};
    for (const k of params.keys()) if (k !== 'name' && !(ds && (has(PAGE_FILTERS, k) || has(extra, k)))) throw new FilterError(`unknown argument ${k}`);
    if (!params.get('name')) return { datasets: availableDatasets(principal, routes).map((d) => ({ name: d.name, description: d.description, grain: d.grain })) };
    return buildDataset(params.get('name'), { routes, store, principal, params, today });
  }
  const entry = Object.entries(TOOLS).find(([, t]) => t[0] === name);
  if (!entry) throw new FilterError(`unknown tool ${name}`);
  const extra = entry[1][2];
  for (const k of params.keys()) if (!has(PAGE_FILTERS, k) && !has(extra, k)) throw new FilterError(`unknown argument ${k}`);
  return runRoute(routes.get(`/${entry[0]}`), { store, principal, params, today });
}

const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

// A JSON-RPC id is a string (at most 200 characters), a finite number or null; anything else (an object or a deeply
// nested array, which would also blow the stack in JSON.stringify) is an invalid request answered with id null.
const validId = (id) => id === null || (typeof id === 'string' && id.length <= MAX_ID_LENGTH) || (typeof id === 'number' && Number.isFinite(id));

/**
 * Handle one parsed JSON-RPC message. Returns the response object, or null for a notification.
 * `ctx.budget.left` (bytes) is shared by every message of one HTTP request, so a batch cannot exceed the response cap.
 */
function handleMessage(msg, ctx) {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg) || (msg.id !== undefined && !validId(msg.id))) return rpcError(null, -32600, 'invalid request');
  if (msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return rpcError(msg.id, -32600, 'invalid request');
  const isNotification = msg.id === undefined;
  if (isNotification) return null;
  switch (msg.method) {
    case 'initialize':
      return { jsonrpc: '2.0', id: msg.id, result: { protocolVersion: PROTOCOL_VERSION, capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'retail-media-insights', version: '0.1.0' },
        instructions: 'Read-only Retail Media Insights. Figures are USD; CPM is per thousand assumed views (VAC-d). Results are scoped to your login.' } };
    case 'ping':
      return { jsonrpc: '2.0', id: msg.id, result: {} };
    case 'tools/list':
      return { jsonrpc: '2.0', id: msg.id, result: { tools: toolList(ctx.principal, ctx.routes) } };
    case 'tools/call': {
      const { name, arguments: args } = msg.params || {};
      if (typeof name !== 'string') return rpcError(msg.id, -32602, 'name is required');
      try {
        const data = callTool(name, args, ctx);
        const text = JSON.stringify(data);
        const size = Buffer.byteLength(text) * 2; // sent twice: as text and as structuredContent
        const budget = ctx.budget || { left: MAX_RESPONSE_BYTES };
        if (size > budget.left) return { jsonrpc: '2.0', id: msg.id, result: { isError: true, content: [{ type: 'text', text: 'the result is too large: ask for a narrower date range or fewer stores, display types or advertisers' }] } };
        budget.left -= size;
        return { jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text }], structuredContent: data } };
      } catch (e) {
        if (e instanceof FilterError || e instanceof ForbiddenError) return { jsonrpc: '2.0', id: msg.id, result: { isError: true, content: [{ type: 'text', text: e.message }] } };
        return { jsonrpc: '2.0', id: msg.id, result: { isError: true, content: [{ type: 'text', text: 'internal error' }] } };
      }
    }
    default:
      return rpcError(msg.id, -32601, 'method not found');
  }
}

module.exports = { handleMessage, toolList, TOOLS, PROTOCOL_VERSION, MAX_RESPONSE_BYTES };
