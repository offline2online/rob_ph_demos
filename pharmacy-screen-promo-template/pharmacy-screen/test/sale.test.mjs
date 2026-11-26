// Sales Promos (promo=sale, js/render.js "sales promos"): the copy with its defaults, the end date's wording (the
// weekday worked out from the date), the sale's two scenes and their seconds, the published config reaching the
// screen, and the screen playing Morning (before 12:00) or Afternoon instead once the end date is over.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { saleCopy, defaultSale, saleDateText, ordinal, saleEnded, saleFooter, saleOffer, saleFinishes, saleSeconds, saleValue, cleanYmd, saleFallbackOrder, storeModel, resolvePromotion, sequence, sceneName, BUILTIN_TEMPLATES } from '../js/render.js';
import { fromPublishedConfig } from '../js/live-data.js';
import * as M from '../admin/js/model.js';

const require = createRequire(import.meta.url);
const { buildScreenConfig } = require('../config-api/src/publish.js');
const { BUILTIN_BY_ID } = require('../config-api/src/builtins.js');

const day = (s) => { const [y, m, d] = s.split('-').map(Number); return { y, m, d }; };

test('the end date is worded from the date itself: weekday, ordinal day, month', () => {
  // The reference video's first draft said "Tuesday 2nd December": 2 Dec 2026 is a Wednesday.
  assert.equal(saleDateText('2026-12-02'), 'Wednesday 2nd December');
  assert.equal(saleDateText('2026-12-01'), 'Tuesday 1st December');
  assert.equal(saleDateText('2027-01-03'), 'Sunday 3rd January');
  assert.equal(saleDateText('2026-11-11'), 'Wednesday 11th November');
  assert.equal(saleDateText('2026-11-12'), 'Thursday 12th November');
  assert.equal(saleDateText('2026-11-13'), 'Friday 13th November');
  assert.equal(saleDateText('2026-12-21'), 'Monday 21st December');
  assert.equal(saleDateText('2026-12-22'), 'Tuesday 22nd December');
  assert.equal(saleDateText('2026-12-23'), 'Wednesday 23rd December');
  assert.equal(saleDateText('2028-02-29'), 'Tuesday 29th February');
  for (const bad of ['2026-02-30', '2027-02-29', '2 Dec', '', null, '2026-13-01']) assert.equal(saleDateText(bad), '', String(bad));
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 24, 30, 31].map(ordinal), ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '24th', '30th', '31st']);
  assert.equal(cleanYmd('2026-12-02'), '2026-12-02');
  assert.equal(cleanYmd('2026-02-31'), '');
});

test('the copy: the Big Brand Sale defaults, and whatever is missing or bad filled from them', () => {
  assert.deepEqual(saleCopy(undefined), defaultSale());
  assert.deepEqual(defaultSale(), { headline1: 'BIG BRAND', headline2: 'SALE', brands: ['TOSHI', 'CETAPHIL', 'NATIO', 'BLACKMORES'], lead: 'UP TO', value: 30, suffix: 'OFF', caption: 'Four big brands. One big sale.', endDate: '2026-12-02', panelLabel: 'SALE FINISHES', s1: 3.5, s2: 5.85 });
  const c = saleCopy({ value: 25, brands: ['A', 'B', 'C', 'D', 'E', 'F', 'G'], endDate: '2026-02-30', s1: 0, caption: '', footer: { custom: false, line1: 'x' } });
  assert.equal(c.value, 25);
  assert.equal(c.brands.length, 6, 'at most six brands');
  assert.equal(c.endDate, '2026-12-02', 'a date that does not exist falls back to the default');
  assert.equal(c.s1, 3.5);
  assert.equal(c.caption, '', 'an emptied caption stays empty');
  assert.equal(c.footer, undefined, 'the footer override is kept only while it is on');
  assert.deepEqual(saleCopy({ brands: [] }).brands, defaultSale().brands, 'never no brands');
  assert.equal(saleCopy({ value: 100 }).value, 30);
  assert.deepEqual([saleValue('25'), saleValue(0), saleValue(99), saleValue(12.5), saleValue('x')], [25, undefined, 99, undefined, undefined]);
});

test('derived lines: the offer, caption line 2 and the footer band follow the copy; the footer can be written by hand', () => {
  const c = saleCopy({});
  assert.equal(saleOffer(c), 'UP TO 30% OFF');
  assert.equal(saleFinishes(c), 'Finishes Wednesday 2nd December');
  assert.deepEqual(saleFooter(c), { line1: 'BIG BRAND SALE · UP TO 30% OFF', line2: 'Finishes Wednesday 2nd December' });
  const d = saleCopy({ value: 25, endDate: '2026-12-09' });
  assert.deepEqual(saleFooter(d), { line1: 'BIG BRAND SALE · UP TO 25% OFF', line2: 'Finishes Wednesday 9th December' });
  assert.deepEqual(saleFooter(saleCopy({ footer: { custom: true, line1: 'Mine', line2: 'Too' } })), { line1: 'Mine', line2: 'Too' });
});

test('two scenes: the brands (3.5 s) and the offer (0.65 s transition + 5.85 s): a 10 s loop that follows the seconds set', () => {
  const store = storeModel(campaign('VIC-MP-001'), config());
  const play = resolvePromotion(config(), store, 'sale');
  assert.equal(play.base, 'sale');
  assert.deepEqual(sequence(play), [{ k: 'brands', t: 3.5 }, { k: 'offer', t: 6.5 }]);
  assert.deepEqual([sceneName(play, 0), sceneName(play, 1)], ['The brands', 'The offer']);
  assert.equal(saleSeconds(play.content.sale), 10);
  const ownCfg = config({ s1: 4, s2: 7 }), own = resolvePromotion(ownCfg, storeModel(campaign('VIC-MP-001'), ownCfg), 'sale');
  assert.deepEqual(sequence(own).map((s) => s.t), [4, 7.65]);
  assert.equal(M.loopSeconds({ sale: { s1: 4, s2: 7 } }, 'sale'), 11.65);
  assert.equal(M.playbackSeconds(M.loopSeconds({ sale: {} }, 'sale')), 11);
  assert.ok(BUILTIN_TEMPLATES.some((t) => t.id === 't_sale' && t.base === 'sale'));
});

test('after the end date (the store\'s date) the screen plays Morning before 12:00 and Afternoon from 12:00', () => {
  const cfg = config({ endDate: '2026-12-02' }), store = storeModel(campaign('VIC-MP-001'), cfg);
  const at = (d, min) => resolvePromotion(cfg, store, 'sale', { today: day(d), now: { day: 'thu', min } });
  // Up to and including the end date: the sale.
  assert.equal(at('2026-12-02', 23 * 60 + 59).base, 'sale');
  assert.equal(at('2026-11-30', 600).promoId, 'sale');
  // From the next day: Morning, then Afternoon at noon.
  const morning = at('2026-12-03', 11 * 60 + 59);
  assert.deepEqual([morning.promoId, morning.base, morning.endedSale], ['morning', 'scenes', 'sale']);
  assert.equal(at('2026-12-03', 12 * 60).promoId, 'afternoon');
  assert.deepEqual(saleFallbackOrder({ min: 0 }), ['morning', 'afternoon']);
  // No date known (the editor's preview): the sale plays.
  assert.equal(resolvePromotion(cfg, store, 'sale').base, 'sale');
  // A pharmacy with no Afternoon promotion falls back to Morning all day.
  const noAft = { ...cfg, promotions: cfg.promotions.filter((p) => p.id !== 'afternoon') };
  assert.equal(resolvePromotion(noAft, storeModel(campaign('VIC-MP-001'), noAft), 'sale', { today: day('2026-12-05'), now: { day: 'sat', min: 900 } }).promoId, 'morning');
  // With neither, the sale keeps playing rather than nothing.
  const none = { ...cfg, promotions: cfg.promotions.filter((p) => p.id === 'sale') };
  assert.equal(resolvePromotion(none, storeModel(campaign('VIC-MP-001'), none), 'sale', { today: day('2026-12-05') }).base, 'sale');
  assert.equal(saleEnded({ endDate: '2026-12-02' }, day('2026-12-03')), true);
  assert.equal(saleEnded({ endDate: '2026-12-02' }, day('2026-12-02')), false);
  assert.equal(M.saleHasEnded({ sale: { endDate: '2026-12-02' } }, day('2027-01-01')), true);
});

test('published config: the sale template reaches the screen as t_sale with the pharmacy\'s copy, else the master\'s', () => {
  assert.equal(BUILTIN_BY_ID.get('builtin-sale').kind, 'sale');
  const promotions = [{ id: 'p-sale', promoId: 'sale', name: 'Sales Promos', templateId: 'builtin-sale', master: { sale: { value: 30 } } }, { id: 'p-m', promoId: 'morning', name: 'Morning', templateId: 'builtin-promotion-scenes' }];
  const ph = (content) => ({ storeCode: 'VIC-MP-004', name: 'Vermont South', colours: { primary: '#123456', accent: '#abcdef' }, content });
  const pub = buildScreenConfig(ph({}), promotions, [], '2026-11-26T00:00:00Z');
  const cfg = fromPublishedConfig(pub);
  assert.equal(cfg.promotions.find((p) => p.promoId === 'sale').template, 't_sale');
  assert.equal(cfg.pharmacies[0].content.sale.sale.value, 30, 'the master\'s copy');
  const mine = fromPublishedConfig(buildScreenConfig(ph({ 'p-sale': { sale: { value: 25 } } }), promotions, [], '2026-11-26T00:00:00Z'));
  assert.equal(mine.pharmacies[0].content.sale.sale.value, 25, 'its own copy wins');
  const store = storeModel({ data: { store_location: { store_code: 'VIC-MP-004' } } }, mine);
  assert.deepEqual(store.brand, { p: '#123456', a: '#abcdef' }, 'in its own colours');
  assert.equal(resolvePromotion(mine, store, 'sale').content.sale.value, 25);
});

test('editor model: Sales Promos is the first tab; its copy is in no master section; the sale template is its own', () => {
  const ps = M.orderPromotions([{ promoId: 'occasions', name: 'Seasonal' }, { promoId: 'closed', name: 'Closed' }, { promoId: 'afternoon', name: 'Afternoon' }, { promoId: 'morning', name: 'Morning' }, { promoId: 'sale', name: 'Sales Promos' }, { promoId: 'x', name: 'X' }]);
  assert.deepEqual(ps.map((p) => p.name), ['Sales Promos', 'Morning', 'Afternoon', 'Closed', 'Seasonal', 'X']);
  assert.deepEqual(M.sectionsForBase('sale'), []);
  assert.equal(M.baseOfTemplate([], M.BUILTIN_SALE), 'sale');
  assert.equal(M.baseOfKind('sale'), 'sale');
  // A pharmacy's own copy always wins over the master's; one with none plays the master's.
  assert.equal(M.effectiveContent({ sale: { value: 30 } }, { sale: { value: 25 } }, []).sale.value, 25);
  assert.equal(M.effectiveContent({ sale: { value: 30 } }, {}, []).sale.value, 30);
  // A new pharmacy starts from the master's copy, filled out.
  const c = M.newContentFor({ promoId: 'sale', master: { sale: { value: 40 } } }, 'sale');
  assert.equal(c.sale.value, 40);
  assert.equal(c.sale.endDate, '2026-12-02');
  assert.deepEqual(M.newContentFor({ promoId: 'sale' }, 'sale').sale, defaultSale());
  // Tokens used in the sale copy are listed for Settings → Tokens.
  const used = M.usedTokens({ content: { s: { sale: { ...defaultSale(), caption: 'Only at ${Suburb} ${Website}' } } } }, [{ id: 's', promoId: 'sale', name: 'Sales Promos', templateId: M.BUILTIN_SALE }], []);
  assert.deepEqual(used.map((t) => [t.name, t.promotions]), [['Suburb', ['Sales Promos']], ['Website', ['Sales Promos']]]);
  // The render config maps the built-in to the screen's t_sale.
  const rc = M.renderConfig({ pharmacies: [], promotions: [{ id: 's', promoId: 'sale', name: 'Sales Promos', templateId: M.BUILTIN_SALE }], templates: [] });
  assert.equal(rc.promotions[0].template, 't_sale');
});

// ── fixtures ──
function campaign(code) {
  return { data: { store_location: { store_code: code, store_name: 'Beaumaris Pharmacy', store_timezone: 'Australia/Melbourne' }, store_info: { opening_hours: [], address_info: { suburb: 'Beaumaris' } } } };
}
function config(sale = {}) {
  const scenes = { greeting: 'Good morning', introTitle: '', introSub: '', slots: [{ label: 'A', icon: 'pill', title: 'T', sub: '', line1: '', line2: '' }], close: { title: 'C' } };
  return {
    promotions: [{ id: 'sale', name: 'Sales Promos', template: 't_sale' }, { id: 'morning', name: 'Morning', template: 't_scenes' }, { id: 'afternoon', name: 'Afternoon', template: 't_scenes' }],
    templates: [],
    pharmacies: [{ storeCode: 'VIC-MP-001', name: 'Beaumaris Pharmacy', brand: { p: '#0f1050', a: '#5ee6b0' }, content: { sale: { sale: { ...defaultSale(), ...sale } }, morning: scenes, afternoon: { ...scenes, greeting: 'Good afternoon' } } }],
  };
}
