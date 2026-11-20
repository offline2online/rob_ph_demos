// Unit tests for the admin editor's data model (admin/js/model.js): config API records -> the render
// engine's config, content shapes, validation and the service library filter. node --test, no install.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../admin/js/model.js';
import { storeModel, resolvePromotion, sequence } from '../js/render.js';

const promotions = [
  { id: 'p-m', name: 'Morning', promoId: 'morning', templateId: M.BUILTIN_SCENES },
  { id: 'p-c', name: 'Closed', promoId: 'closed', templateId: M.BUILTIN_HOURS },
  { id: 'p-w', name: 'Weekend', promoId: 'weekend', templateId: 'tpl1' },
];
const templates = [
  { id: M.BUILTIN_SCENES, name: 'Promotion scenes', kind: 'promotion-scenes', builtIn: true, html: '', css: '' },
  { id: M.BUILTIN_HOURS, name: 'Opening hours', kind: 'opening-hours', builtIn: true, html: '', css: '' },
  { id: 'tpl1', name: 'Hours, custom', kind: 'opening-hours', builtIn: false, html: '<div class="s-head">${Headline}</div>', css: '.s-head{color:red}', backgrounds: { portrait: { url: 'https://cdn.example.com/p.webp' }, landscape: null } },
];

test('renderConfig maps admin records to the render engine, keyed by promo ID', () => {
  const content = M.newPharmacyContent(promotions, templates);
  const ph = { id: 'ph1', storeCode: 'VIC-MP-009', name: 'Test Pharmacy', colours: { primary: '#112233', accent: '#ddeeff' }, logo: { url: '/media/l.png' }, content };
  const cfg = M.renderConfig({ pharmacies: [ph], promotions, templates });
  assert.deepEqual(cfg.promotions.map((p) => [p.id, p.template]), [['morning', 't_scenes'], ['closed', 't_hours'], ['weekend', 'tpl1']]);
  assert.deepEqual(cfg.templates.map((t) => [t.id, t.base, t.bgPortrait, t.bgLandscape]), [['tpl1', 'hours', 'https://cdn.example.com/p.webp', null]]);
  assert.deepEqual(cfg.pharmacies[0].brand, { p: '#112233', a: '#ddeeff' });
  assert.equal(cfg.pharmacies[0].logo, '/media/l.png');
  assert.equal(cfg.pharmacies[0].content.morning, content['p-m']);
  // and the shared render engine accepts it
  const store = storeModel(M.campaignForPreview(null, 'VIC-MP-009', 'Test Pharmacy'), cfg);
  assert.equal(store.code, 'VIC-MP-009');
  assert.equal(store.suburb, '');
  const morning = resolvePromotion(cfg, store, 'morning');
  assert.equal(morning.base, 'scenes');
  assert.equal(sequence(morning).length, 5);
  assert.match(morning.content.greeting, /Good morning/);
  const weekend = resolvePromotion(cfg, store, 'weekend');
  assert.equal(weekend.base, 'hours');
  assert.equal(weekend.template.css, '.s-head{color:red}');
});

test('new pharmacy content: prototype copy for the default promo IDs, fitting each template', () => {
  const c = M.newPharmacyContent(promotions, templates);
  assert.equal(c['p-m'].slots.length, 3);
  assert.equal(c['p-c'].headlines.length, 3);
  assert.equal(c['p-w'].headlines.length, 3); // a custom opening-hours template gets hours content
  assert.equal(c['p-m'].close.line2, 'Trusted local care');
});

test('ensureContent keeps both shapes, so switching a promotion\'s template loses nothing', () => {
  const scenes = M.newContentFor({ promoId: 'morning' }, 'scenes');
  scenes.slots[0].title = 'Edited';
  const both = M.ensureContent(scenes, 'hours');
  assert.equal(both.headlines.length, 3);
  assert.equal(both.slots[0].title, 'Edited');
  const back = M.ensureContent(both, 'scenes');
  assert.equal(back.slots[0].title, 'Edited');
  assert.notEqual(back, both, 'returns a copy');
});

test('campaignForPreview re-points a looked-up record at the pharmacy, keeping its store data', () => {
  const rec = { data: { store_location: { store_code: 'OTHER', store_timezone: 'Australia/Perth' }, store_info: { address_info: { suburb: 'Brighton' } } } };
  const c = M.campaignForPreview(rec, 'VIC-MP-001');
  assert.equal(c.data.store_location.store_code, 'VIC-MP-001');
  assert.equal(c.data.store_location.store_timezone, 'Australia/Perth');
  assert.equal(rec.data.store_location.store_code, 'OTHER', 'input untouched');
  const f = M.storeFields(rec);
  assert.deepEqual(f.find((x) => x.label === 'Suburb'), { label: 'Suburb', path: 'store_info.address_info.suburb', value: 'Brighton' });
});

test('validation mirrors the config API: promo IDs and store codes, unique', () => {
  assert.equal(M.slug(' Late Night! Offers '), 'late-night-offers');
  assert.equal(M.promoIdError('', promotions), 'Add a promo ID.');
  assert.match(M.promoIdError('closed', promotions, 'p-m'), /already used/);
  assert.equal(M.promoIdError('closed', promotions, 'p-c'), '');
  const phs = [{ id: 'a', storeCode: 'VIC-MP-001' }];
  assert.equal(M.normStoreCode(' vic mp 2 '), 'VICMP2');
  assert.match(M.storeCodeError('VIC-MP-001', phs, 'b'), /already used/);
  assert.equal(M.storeCodeError('VIC-MP-001', phs, 'a'), '');
  assert.match(M.storeCodeError('', phs), /Add a store code/);
  assert.match(M.storeCodeError('-X', phs), /2-32/);
});

test('service library: filtered to the pharmacy\'s services and by search, grouped by category', () => {
  const services = [
    { id: 's1', label: 'Vaccinations', category: 'Vaccinations', headline: 'Vaccinations', offeredBy: ['VIC-MP-001'] },
    { id: 's2', label: 'First aid', category: 'Shop', headline: 'First aid', offeredBy: ['VIC-MP-004'] },
    { id: 's3', label: 'Gifts', category: 'Shop', headline: 'Gifts and fragrances', offeredBy: ['VIC-MP-001', 'VIC-MP-004'] },
  ];
  assert.deepEqual(M.filterServices(services, { storeCode: 'VIC-MP-004' }).map((g) => [g.category, g.services.map((s) => s.id)]), [['Shop', ['s2', 's3']]]);
  assert.equal(M.filterServices(services, { storeCode: 'VIC-MP-004', mine: false }).flatMap((g) => g.services).length, 3);
  assert.deepEqual(M.filterServices(services, { q: 'fragr', mine: false }).flatMap((g) => g.services.map((s) => s.id)), ['s3']);
  const slot = M.serviceToSlot({ id: 's3', label: 'Gifts', icon: 'redeem', headline: 'Gifts and fragrances', accent: 'Something for everyone', line1: 'a', line2: 'b' });
  assert.deepEqual(slot, { label: 'Gifts', icon: 'redeem', title: 'Gifts and fragrances', sub: 'Something for everyone', line1: 'a', line2: 'b', svc: 's3' });
});

test('template URL carries the device token, promo ID and orientation, never a store code', () => {
  assert.equal(M.templateUrl('https://screens.example.com/pharmacy-screen.html', 'morning', 'landscape'), 'https://screens.example.com/pharmacy-screen.html?device=${UniqueDeviceID}&promo=morning&orientation=landscape');
  assert.match(M.templateUrl('x', 'closed', 'other'), /orientation=portrait$/);
});

test('orderPromotions puts the defaults first, then by creation; durations clamp to 1-60s', () => {
  const o = M.orderPromotions([{ promoId: 'zz', name: 'Z', createdAt: '2026-01-02' }, { promoId: 'closed' }, { promoId: 'aa', name: 'A', createdAt: '2026-01-03' }, { promoId: 'morning' }]);
  assert.deepEqual(o.map((p) => p.promoId), ['morning', 'closed', 'zz', 'aa']);
  assert.equal(M.clampDur('0.2'), 1);
  assert.equal(M.clampDur('90'), 60);
  assert.equal(M.clampDur(''), undefined);
  assert.equal(M.loopSeconds({ slots: [{ dur: 4 }, {}], close: {} }), 3 + 4 + 2 + 2);
});

test('playback duration is the promotion length plus one second, rounded up, and the tooltip names it', () => {
  assert.equal(M.playbackSeconds(14), 15);
  assert.equal(M.playbackSeconds(13.5), 15);
  assert.equal(M.playbackSeconds(12.1), 14);
  assert.equal(M.playbackSeconds(0.1 + 0.2 + 2.7), 4);
  assert.equal(M.playbackSeconds(0), 1);
  assert.match(M.playbackHelp(15), /^To run this promotion, open the campaign's Creative tab, turn on Experience URL and paste this URL in\. Set the playback duration to 15 seconds, which is one second longer than the promotion so the last scene finishes\. Then save and activate the campaign to put it live\.$/);
});

test('editsSince finds the edits made while a new pharmacy was being created', () => {
  const draft = { name: 'New', storeCode: 'NEW-1', colours: { primary: '#000000', accent: '#ffffff' }, content: M.newPharmacyContent(promotions, templates) };
  const sent = M.clone(draft);
  assert.deepEqual(M.editsSince(sent, draft), { details: false, content: [] });
  draft.name = 'Renamed';
  draft.content['p-m'].introTitle = 'Changed line 1';
  assert.deepEqual(M.editsSince(sent, draft), { details: true, content: ['p-m'] });
  // the posted copy is independent of the draft
  assert.equal(sent.content['p-m'].introTitle === 'Changed line 1', false);
  // content added for a promotion after the create was posted counts too
  draft.content['p-new'] = { greeting: 'Hi', slots: [], close: {} };
  assert.deepEqual(M.editsSince(sent, draft).content, ['p-m', 'p-new']);
});
