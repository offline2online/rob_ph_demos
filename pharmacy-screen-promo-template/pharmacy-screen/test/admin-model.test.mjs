// Unit tests for the admin editor's data model (admin/js/model.js): config API records -> the render
// engine's config, content shapes, validation and the service library filter. node --test, no install.
import * as R from '../js/render.js';
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

test('occasions: the Occasion drop-down is the promotion template, content keeps every occasion, defaults follow the sign-off rule', () => {
  assert.deepEqual(M.OCCASION_CHOICES.map((o) => o.name), ['Fallback', 'Christmas', "New Year's", 'Australia Day', "Valentine's Day", 'Easter', 'Anzac Day']);
  assert.equal(M.BUILTIN_OCCASION, 'builtin-occasion-christmas');
  assert.equal(M.baseOfTemplate([], 'builtin-occasion-easter'), 'occasion');
  assert.equal(M.occasionOfTemplate('builtin-occasion-anzac-day'), 'anzac-day');
  assert.equal(M.occasionOfTemplate(M.BUILTIN_SCENES), '');
  // Christmas and New Year's sign off with ${StoreName}; the rest use ${Suburb} only.
  assert.deepEqual(M.OCCASION_CHOICES.filter((o) => o.signOff).map((o) => o.id), ['fallback', 'christmas', 'new-year']);
  const c = M.newContentFor({ promoId: 'occasions' }, 'occasion');
  assert.deepEqual(Object.keys(c.occasions), ['fallback', 'christmas', 'new-year', 'australia-day', 'valentines-day', 'easter', 'anzac-day']);
  for (const [id, o] of Object.entries(c.occasions)) {
    assert.equal(o.beats.length, id === 'christmas' ? 2 : 3, id);
    assert.ok(o.beats.some((x) => /\$\{Suburb\}/.test(x.text)), `${id} uses \${Suburb}`);
    assert.equal(/StoreName/.test(JSON.stringify(o)), ['fallback', 'christmas', 'new-year'].includes(id), `${id} store-name rule`);
  }
  // The approved default copy, beat by beat (label line / main line).
  const lines = (id) => c.occasions[id].beats.map((b) => [b.label, b.text].filter((x) => x !== undefined).join(' / '));
  assert.deepEqual(lines('fallback'), ['Thank you, ${Suburb}', 'for supporting your local pharmacy', '${StoreName}']);
  assert.deepEqual(lines('christmas'), ['Merry Christmas, ${Suburb}', 'With warm wishes / from the whole ${StoreName} team']);
  assert.deepEqual(lines('new-year'), ['Happy<br>New Year', 'Thank you for a great year, ${Suburb}', "Here's to a healthy year ahead / from the whole ${StoreName} team"]);
  assert.deepEqual(lines('australia-day'), ['26 January / Happy Australia Day, ${Suburb}', 'Enjoy the sunshine', 'Stay sun safe this summer / Slip, slop, slap']);
  assert.deepEqual(lines('valentines-day'), ["14 February / Happy Valentine's Day, ${Suburb}", 'Look after the ones you love', 'and yourself, too']);
  assert.deepEqual(lines('easter'), ['Happy Easter, ${Suburb}', 'Wishing you a restful long weekend', 'Take time to recharge']);
  assert.deepEqual(lines('anzac-day'), ['25 April / Anzac Day', 'Lest we forget', 'Remembering together, ${Suburb}']);
  // Switching template kind and back keeps the other kind's fields; a broken occasion is refilled.
  const mixed = M.ensureContent({ slots: [], greeting: 'G', occasions: { easter: { beats: [{ text: 'Mine' }, {}] } } }, 'occasion');
  assert.equal(mixed.greeting, 'G');
  assert.equal(mixed.occasions.easter.beats[0].text, 'Mine');
  assert.equal(mixed.occasions.easter.beats[2].text, 'Take time to recharge');
  assert.equal(mixed.occasions.christmas.beats.length, 2);
  assert.equal(M.loopSeconds(mixed.occasions.easter), 12);
  assert.equal(M.playbackSeconds(M.loopSeconds(mixed.occasions.christmas)), 13);
  // Copy saved before the standalone designs: unedited, the new defaults; edited, kept beat by beat.
  const legacy = (id) => ({ scenes: R.LEGACY_OCCASION_COPY[id].map((x) => ({ ...x })) });
  const old = M.ensureContent({ occasions: { christmas: legacy('christmas'), easter: { scenes: [{ title: 'Hoppy Easter', sub: '', line1: '', line2: '' }, ...legacy('easter').scenes.slice(1)] } } }, 'occasion');
  assert.deepEqual(old.occasions.christmas, R.defaultOccasion('christmas'));
  assert.deepEqual(old.occasions.easter.beats.map((b) => b.text), ['Hoppy Easter', 'Here for you<br>over Easter', 'Thank you,<br>${Suburb}']);
  assert.deepEqual(M.orderPromotions([{ promoId: 'occasions', name: 'O' }, { promoId: 'closed', name: 'C' }, { promoId: 'x', name: 'X' }]).map((p) => p.promoId), ['closed', 'occasions', 'x']);
  // The preview's render config maps the occasion template onto the render engine's built-in.
  const cfg = M.renderConfig({ pharmacies: [], promotions: [{ id: 'p-o', promoId: 'occasions', name: 'Occasions', templateId: 'builtin-occasion-valentines-day' }], templates: [] });
  assert.equal(cfg.promotions[0].template, 't_occ_valentines-day');
});

test('master template: the editor and the config API share one section map and resolve content the same way', async () => {
  const { createRequire } = await import('node:module');
  const inherit = createRequire(import.meta.url)('../config-api/src/inherit.js');
  assert.deepEqual(M.MASTER_SECTIONS, inherit.SECTIONS);
  for (const base of ['scenes', 'hours', 'occasion']) for (const sec of M.sectionsForBase(base)) assert.ok(M.SECTION_NAMES[sec] && M.MASTER_SECTIONS[sec], sec);
  const master = M.newContentFor({ promoId: 'morning' }, 'scenes');
  const own = M.clone(master);
  own.introTitle = 'Own'; own.slots = [own.slots[0]]; own.extra = 1;
  for (const det of [[], ['greeting'], ['greeting', 'slots'], ['footer']]) {
    assert.deepEqual(M.effectiveContent(master, own, det), inherit.effectiveContent(master, own, det), det.join(','));
  }
  assert.equal(M.effectiveContent(master, own, []).introTitle, master.introTitle);
  assert.equal(M.effectiveContent(master, own, ['greeting']).introTitle, 'Own');
  assert.equal(M.effectiveContent(master, own, ['greeting']).slots.length, 3);
  assert.equal(M.effectiveContent(master, own, []).extra, 1, 'a field in no section stays the pharmacy\'s');
  assert.deepEqual(M.effectiveContent(null, own, []), own, 'no master: the pharmacy\'s own content');
});

test('master template: detaching, re-inheriting, syncing and a new pharmacy starting from the master', () => {
  const ph = { detached: { a: ['slots'] } };
  assert.deepEqual(M.setDetached(ph, 'a', 'greeting', true), { a: ['greeting', 'slots'] });
  assert.deepEqual(M.setDetached(ph, 'a', 'slots', false), {});
  assert.deepEqual(ph.detached, { a: ['slots'] }, 'returns a new object');
  assert.deepEqual(M.detachedOf(ph, 'a'), ['slots']);
  assert.deepEqual(M.detachedOf({}, 'a'), []);
  const master = { greeting: 'M', introTitle: 'MT', slots: [{ label: 'M' }], footer: { show: false } };
  const c = { greeting: 'O', introTitle: 'OT', slots: [{ label: 'O' }], close: { title: 'O' } };
  const same = M.syncInherited(c, master, ['slots']);
  assert.equal(same, c, 'in place');
  assert.deepEqual([c.greeting, c.introTitle, c.slots[0].label, c.footer.show, c.close], ['M', 'MT', 'O', false, undefined]);
  assert.notEqual(c.footer, master.footer, 'copies, never shares the master');
  const fresh = M.newContentFor({ promoId: 'morning', master: { ...master, close: { title: 'MC' } } }, 'scenes');
  assert.equal(fresh.greeting, 'M');
  assert.equal(fresh.close.title, 'MC');
  assert.equal(M.newPharmacyContent([{ id: 'p', promoId: 'x', templateId: M.BUILTIN_SCENES, master: { greeting: 'G', slots: [], close: { title: 't' } } }], templates).p.greeting, 'G');
});

test('tokens set by hand: every token the pharmacy uses, master template included, and setting one', () => {
  const tpls = [...templates, { id: 'tpl2', name: 'Scenes, custom', kind: 'promotion-scenes', builtIn: false, html: '<div>${Headline}${Website}</div>' }];
  const promos = [
    { id: 'p-m', name: 'Morning', promoId: 'morning', templateId: M.BUILTIN_SCENES, master: { greeting: 'Good morning,<br>${Suburb}', introTitle: 'Call ${Phone}', introSub: '', slots: [], close: { title: 'Bye' }, footer: { show: false } } },
    { id: 'p-o', name: 'Seasonal', promoId: 'occasions', templateId: M.occasionTemplateId('christmas') },
    { id: 'p-x', name: 'Extra', promoId: 'extra', templateId: 'tpl2' },
  ];
  const ph = { id: 'ph1', content: { 'p-x': { greeting: 'Hello', introTitle: '${Unused', introSub: '', slots: [], close: { title: '${Offer}' } } }, tokens: { Suburb: 'Beaumaris', Old: 'left over' } };
  const list = M.usedTokens(ph, promos, tpls);
  // ${StoreName} (the Pharmacy name field) and ${CloseTime} / ${OpenTime} (today's hours) are filled live: not listed.
  assert.deepEqual(list.map((t) => t.name), ['Suburb', 'Phone', 'Offer', 'Old', 'Website']);
  const by = Object.fromEntries(list.map((t) => [t.name, t]));
  assert.deepEqual(by.Suburb, { name: 'Suburb', data: true, value: 'Beaumaris', promotions: ['Morning', 'Seasonal'] });
  assert.deepEqual(by.Phone.promotions, ['Morning'], 'from the master template');
  const stale = M.usedTokens({ ...ph, tokens: { ...ph.tokens, StoreName: 'Set Name', CloseTime: '9PM' } }, promos, tpls);
  assert.deepEqual(stale.map((t) => t.name), list.map((t) => t.name), 'a stored live token is not listed either');
  assert.deepEqual(by.Website.promotions, ['Extra'], 'custom template HTML; its layout slots are not listed');
  assert.deepEqual(by.Old, { name: 'Old', data: false, value: 'left over', promotions: [] });
  // Detaching a section uses the pharmacy's own copy instead of the master's.
  const det = { ...ph, content: { ...ph.content, 'p-m': { introTitle: 'Plain' } }, detached: { 'p-m': ['greeting'] } };
  const detList = M.usedTokens(det, promos, tpls);
  assert.ok(!detList.some((t) => t.name === 'Phone'), 'the master greeting section no longer plays');
  assert.deepEqual(detList.find((t) => t.name === 'Suburb').promotions, ['Seasonal']);
  // setToken: blank removes.
  assert.deepEqual(M.setToken(ph, 'Phone', '03 1234'), { Suburb: 'Beaumaris', Old: 'left over', Phone: '03 1234' });
  assert.deepEqual(M.setToken(ph, 'Old', '  '), { Suburb: 'Beaumaris' });
  // renderConfig passes them to the render engine.
  assert.deepEqual(M.renderConfig({ pharmacies: [{ ...ph, storeCode: 'A1', colours: {} }], promotions: promos, templates: tpls }).pharmacies[0].tokens, { Suburb: 'Beaumaris', Old: 'left over' });
});

test('timings: every scene of every template has its own seconds, the Closed headlines and occasion beats included', () => {
  // Opening hours (Closed): each headline's own seconds, blank ones at the defaults (2.7 + 2.7 + 2.6).
  const hours = { headlines: ['A', 'B', 'C'], showAddress: false };
  assert.deepEqual(M.headlineSeconds(hours), [2.7, 2.7, 2.6]);
  assert.equal(M.loopSeconds(hours, 'hours'), 8);
  hours.headlineDurs = [5, null, 90];
  assert.deepEqual(M.headlineSeconds(hours), [5, 2.7, 60]);
  assert.equal(M.loopSeconds(hours, 'hours'), 67.7);
  assert.deepEqual(R.sequence({ base: 'hours', content: hours }).map((x) => x.t), [5, 2.7, 60]);
  // The headline timings are part of the Headlines master section, in the editor and the config API alike.
  assert.deepEqual(M.MASTER_SECTIONS.headlines, ['headlines', 'headlineDurs']);
  const eff = M.effectiveContent({ headlines: ['M1', 'M2', 'M3'], headlineDurs: [4, 4, 4] }, { headlines: ['P1', 'P2', 'P3'], headlineDurs: [1, 1, 1] }, []);
  assert.deepEqual(eff.headlineDurs, [4, 4, 4]);
  // Occasions: each beat's own seconds (1-60), kept through ensureContent; the loop is their sum.
  const c = M.ensureContent({ occasions: { easter: { beats: [{ text: 'A', dur: 6 }, { text: 'B' }, { text: 'C', dur: 'x' }] } } }, 'occasion');
  assert.deepEqual(c.occasions.easter.beats.map((b) => b.dur), [6, undefined, undefined]);
  assert.equal(M.loopSeconds(c.occasions.easter), 14);
  assert.equal(M.playbackSeconds(M.loopSeconds(c.occasions.easter)), 15);
  assert.deepEqual(R.occasionCopy('christmas', { beats: [{ text: 'X', dur: 0.2 }, { text: 'Y', dur: 99 }] }).beats.map((b) => b.dur), [1, 60]);
  // Left at the defaults the design's own CSS loop plays; otherwise each beat gets its own keyframes over the sum.
  assert.deepEqual(R.occasionTiming([{}, {}, {}]), { custom: false, total: 12 });
  assert.deepEqual(R.occasionTiming([{ dur: 6 }, { dur: 6 }]), { custom: false, total: 12 });
  const t = R.occasionTiming([{ dur: 5 }, {}, { dur: 2.5 }]);
  assert.equal(t.custom, true);
  assert.equal(t.total, 11.5);
  assert.equal(t.style(1), 'animation-name:occT5_4_2p5B2;animation-duration:11.5s');
  assert.match(t.css, /@keyframes occT5_4_2p5B1\{0%\{opacity:0;/);
  assert.match(t.css, /@keyframes occT5_4_2p5B3\{0%,78\.261%\{opacity:0;/);
});

test('pharmacy view: storeFromQuery reads ?store= or ?storeCode=, normalised like a typed store code', () => {
  assert.equal(M.storeFromQuery('?store=vic-mp-002'), 'VIC-MP-002');
  assert.equal(M.storeFromQuery('?storeCode=VIC-MP-003&x=1'), 'VIC-MP-003');
  assert.equal(M.storeFromQuery('?store=VIC-MP-001&storeCode=VIC-MP-009'), 'VIC-MP-001');
  assert.equal(M.storeFromQuery('?store=%20vic-mp-004%20'), 'VIC-MP-004');
  assert.equal(M.storeFromQuery(''), null);
  assert.equal(M.storeFromQuery('?store='), null);
  assert.equal(M.storeFromQuery('?code=abc&state=x'), null);
});

test('seasonal: the old default name Occasions shows as Seasonal; a renamed or custom promotion is left alone', () => {
  const ps = M.orderPromotions([
    { id: 'a', name: 'Occasions', promoId: 'occasions', templateId: M.occasionTemplateId('easter') },
    { id: 'b', name: 'Occasions', promoId: 'other', templateId: M.BUILTIN_SCENES },
    { id: 'c', name: 'Holidays', promoId: 'holidays', templateId: M.occasionTemplateId('christmas') },
  ]);
  assert.deepEqual(Object.fromEntries(ps.map((p) => [p.id, p.name])), { a: 'Seasonal', b: 'Occasions', c: 'Holidays' });
  assert.equal(M.SECTION_NAMES.occasions, 'Seasonal copy and dates');
});

test('seasonal: dates saved on a season survive ensureContent; bad dates are dropped', () => {
  const c = M.ensureContent({ occasions: { christmas: { from: '12-01', to: '12-26', beats: [] }, easter: { from: '13-01', to: '04-01', beats: [] } } }, 'occasion');
  assert.equal(c.occasions.christmas.from, '12-01');
  assert.equal(c.occasions.christmas.to, '12-26');
  assert.ok(!('from' in c.occasions.easter), 'an invalid month is not kept');
  assert.equal(c.occasions['new-year'].beats.length, 3);
});

test('schedule: No schedule by default; Annual keeps a start and an end date', () => {
  assert.deepEqual(M.SCHEDULE_TYPES.map((t) => t.name), ['No schedule', 'Annual']);
  assert.deepEqual(M.scheduleOf({}), { type: 'none' });
  assert.deepEqual(M.scheduleOf({ schedule: { type: 'annual', from: '11-01', to: '01-15' } }), { type: 'annual', from: '11-01', to: '01-15' });
  assert.deepEqual(M.scheduleOf({ schedule: { type: 'annual', from: '13-01', to: '01-15' } }), { type: 'none' }, 'a bad date is no schedule');
  assert.deepEqual(M.defaultAnnual(new Date(2026, 2, 5)), { type: 'annual', from: '03-05', to: '12-31' });
  assert.equal(M.scheduleText({ type: 'none' }), 'No schedule');
  assert.equal(M.scheduleText({ type: 'annual', from: '11-01', to: '01-15' }), 'Every year, 1 Nov to 15 Jan');
});

test('master template preview: ${Suburb}, ${StoreName} and ${Phone} show as written; a pharmacy is unchanged', async () => {
  const { rich, fill, applyStoreName } = await import('../js/tokens.js');
  const master = { id: '', isMaster: true, name: 'Master template', storeCode: '', content: {} };
  const ph = M.previewPharmacy(master);
  assert.equal(ph.name, '${StoreName}');
  assert.deepEqual(ph.tokens, { Suburb: '${Suburb}', Phone: '${Phone}' });
  assert.equal(master.name, 'Master template', 'the master record itself is not changed');
  assert.equal(master.tokens, undefined);
  const cfg = M.renderConfig({ pharmacies: [{ ...ph, storeCode: 'NEW' }], promotions, templates });
  const store = storeModel(M.campaignForPreview(null, 'NEW', ph.name), cfg);
  assert.equal(store.name, '${StoreName}');
  assert.equal(store.suburb, '${Suburb}');
  assert.equal(store.phone, '${Phone}');
  assert.equal(rich('Good morning,<br>${Suburb}', store.suburb), 'Good morning,<br>${Suburb}');
  assert.equal(fill('Serving ${Suburb}', store.suburb), 'Serving ${Suburb}');
  assert.equal(applyStoreName(rich('from the whole ${StoreName} team', store.suburb), store.name), 'from the whole ${StoreName} team');
  // A pharmacy previews with its own data: no suburb in the sample data blanks the token with its comma.
  const own = { id: 'x', name: 'North Ringwood', storeCode: 'VIC-MP-002', tokens: { Custom: 'hi' } };
  assert.equal(M.previewPharmacy(own), own);
  const s2 = storeModel(M.campaignForPreview(null, 'VIC-MP-002', own.name), M.renderConfig({ pharmacies: [own], promotions, templates }));
  assert.equal(rich('Good morning,<br>${Suburb}', s2.suburb), 'Good morning');
  assert.equal(s2.name, 'North Ringwood');
});

test('seasons: each Season drop-down line shows its start and end dates after the name', () => {
  // The defaults (render.js OCCASIONS): a range, a range over New Year, and one-day seasons as a single date.
  assert.equal(M.seasonOptionLabel('christmas', null, 2026), 'Christmas (15 Dec – 27 Dec)');
  assert.equal(M.seasonOptionLabel('new-year', {}, 2026), "New Year's (28 Dec – 5 Jan)");
  assert.equal(M.seasonOptionLabel('australia-day', {}, 2026), 'Australia Day (26 Jan)');
  assert.equal(M.seasonOptionLabel('valentines-day', {}, 2026), "Valentine's Day (14 Feb)");
  assert.equal(M.seasonOptionLabel('anzac-day', {}, 2026), 'Anzac Day (25 Apr)');
  // Easter is worked out for the year: Good Friday to Easter Monday.
  assert.equal(M.seasonOptionLabel('easter', {}, 2026), 'Easter (3 Apr – 6 Apr)');
  assert.equal(M.seasonOptionLabel('easter', {}, 2027), 'Easter (26 Mar – 29 Mar)');
  // Dates saved on the season's copy (its Dates card) win, for Easter too; invalid ones fall back to the defaults.
  const occs = { christmas: { from: '12-01', to: '12-26' }, easter: { from: '04-01', to: '04-10' }, 'anzac-day': { from: '13-40', to: '04-25' } };
  assert.equal(M.seasonOptionLabel('christmas', occs, 2026), 'Christmas (1 Dec – 26 Dec)');
  assert.equal(M.seasonOptionLabel('easter', occs, 2026), 'Easter (1 Apr – 10 Apr)');
  assert.equal(M.seasonOptionLabel('anzac-day', occs, 2026), 'Anzac Day (25 Apr)');
  assert.equal(M.seasonOptionLabel('nope', occs, 2026), '');
  // The Fallback has no dates: it says when it plays.
  assert.equal(M.seasonOptionLabel('fallback', occs, 2026), 'Fallback');
  // Every season's line of the drop-down, in order, ends in its dates in brackets.
  for (const o of M.OCCASION_CHOICES.filter((x) => x.id !== 'fallback')) assert.match(M.seasonOptionLabel(o.id, {}, 2026), /^.+ \(\d{1,2} [A-Z][a-z]{2}( – \d{1,2} [A-Z][a-z]{2})?\)$/, o.id);
});

test('Currently active promotion: what the screens play today (activation, else the season by date, else the Fallback)', () => {
  const day = (y, m, d) => ({ y, m, d });
  assert.equal(M.seasonOf(null, {}, day(2026, 3, 15)), 'fallback');
  assert.equal(M.seasonOf(null, {}, day(2026, 12, 20)), 'christmas');
  // The old Season pick (content.season) no longer counts.
  assert.equal(M.seasonOf(null, { season: 'easter' }, day(2026, 7, 1)), 'fallback');
  // A running activation wins; once its day has passed it is ignored.
  const act = { activation: { occasion: 'christmas', until: '2026-12-27' } };
  assert.equal(M.seasonOf(null, act, day(2026, 11, 23)), 'christmas');
  assert.equal(M.seasonOf(null, act, day(2026, 12, 28)), 'new-year');
  assert.equal(M.seasonOf(null, act, day(2027, 11, 23)), 'fallback');
  // The editor goes by the store's date, as the screens do, not the browser's: 23:30 UTC on 23 Nov is 24 Nov in
  // Melbourne (the default when the store's time zone is not known) and still 23 Nov in Perth.
  const at = new Date('2026-11-23T23:30:00Z');
  assert.deepEqual(M.storeToday(undefined, at), day(2026, 11, 24));
  assert.deepEqual(M.storeToday('Australia/Perth', at), day(2026, 11, 24));
  assert.deepEqual(M.storeToday('Australia/Perth', new Date('2026-11-23T15:30:00Z')), day(2026, 11, 23));
  // The Fallback plays for exactly 7 s whatever is saved on its beats.
  assert.equal(M.loopSeconds({ beats: [{ dur: 9 }, {}, {}] }, undefined, 'fallback'), 7);
  assert.equal(M.loopSeconds({ beats: [{}, {}, {}] }, undefined, 'easter'), 12);
});

// ── Screen device ID: the store details read live from Personalisation Hub (Settings → Pharmacy details) ──

import { readFileSync } from 'node:fs';
const DEVICES = JSON.parse(readFileSync(new URL('../fixtures/campaign-data.json', import.meta.url), 'utf8')).devices;
const BEAUMARIS = DEVICES['DEVICE-VIC-MP-001'];

test('device ID: well-formed as the proxy accepts it; each failed lookup has its own plain message', () => {
  assert.equal(M.deviceIdError(''), '');
  assert.equal(M.deviceIdError('6890ee6121f42e90ded7baa4d80cc63b2a2b4eb4bfad71c88601712b5397aece'), '');
  assert.equal(M.deviceIdError(' DEVICE-VIC-MP-001 '), '');
  for (const bad of ['bad id', 'a/b', '${UniqueDeviceID}', 'x'.repeat(129)]) assert.match(M.deviceIdError(bad), /not a valid screen device ID/, bad);
  const err = (status, code) => M.lookupError({ status, code });
  assert.deepEqual(err(400, 'INVALID_DEVICE_ID').kind, 'invalid');
  assert.match(err(404, 'DEVICE_NOT_FOUND').message, /^Personalisation Hub does not know this device/);
  assert.equal(err(404, 'DEVICE_NOT_FOUND').kind, 'not-found');
  assert.equal(err(503, 'NOT_CONFIGURED').kind, 'not-set-up');
  assert.match(err(503, 'NOT_CONFIGURED').message, /API is not set up/);
  assert.equal(err(502, 'UPSTREAM_AUTH_FAILED').kind, 'not-set-up');
  // A bare 404 (a static host, a missing rewrite) is a server that could not answer, not an unknown device.
  for (const [s, c] of [[502, 'UPSTREAM_UNAVAILABLE'], [0, 'network'], [404, '404'], [429, 'RATE_LIMITED']]) assert.equal(err(s, c).kind, 'down', `${s} ${c}`);
  assert.match(err(0, 'network').message, /could not be reached\. Try again in a minute\.$/);
  const at = new Date(); at.setHours(10, 42, 0, 0);
  assert.match(M.lookupError({ status: 502, code: 'UPSTREAM_UNAVAILABLE' }, { readAt: at.getTime() }).message, /could not be reached\. Showing the details read at 10:42 am\.$/);
});

test('storeSummary: name, code, address without the suburb twice, phone, timezone and today\'s hours in the store\'s time zone', () => {
  // 01:00 UTC on Monday 23 Nov 2026 is 12:00 Monday in Melbourne.
  const s = M.storeSummary(BEAUMARIS, new Date('2026-11-23T01:00:00Z'));
  assert.deepEqual(s, { name: 'Beaumaris Pharmacy', code: 'VIC-MP-001', address: '1A East Concourse, Beaumaris, Victoria', suburb: 'Beaumaris', phone: '03 9589 2676', timezone: 'Australia/Melbourne', today: 'Monday, 8.30am – 7.00pm', hasHours: true, logo: null });
  assert.equal(M.storeSummary(BEAUMARIS, new Date('2026-11-22T01:00:00Z')).today, 'Sunday, closed');
  const withLogo = { data: { ...BEAUMARIS.data, store_info: { ...BEAUMARIS.data.store_info, logo_url: 'https://cdn.example.com/l.png', address_info: { address: '12 Bay St', suburb: 'Brighton', state: 'VIC', postcode: '3186' } } } };
  const w = M.storeSummary(withLogo);
  assert.equal(w.address, '12 Bay St, Brighton, VIC 3186');
  assert.equal(w.logo, 'https://cdn.example.com/l.png');
});

test('fillPlan: fills only what is empty, offers PH\'s value where a person typed another, and refuses another store\'s device', () => {
  const phs = [{ id: 'a', storeCode: 'VIC-MP-001', name: 'Beaumaris Pharmacy' }, { id: 'b', storeCode: 'VIC-MP-004', name: 'Vermont South Pharmacy' }];
  // A new pharmacy from the device alone: name and store code fill in, the suburb follows PH live.
  const draft = { id: null, name: '', storeCode: '' };
  const brighton = { data: { ...BEAUMARIS.data, store_location: { store_code: 'vic-mp-006', store_name: 'Brighton Pharmacy', store_timezone: 'Australia/Melbourne' } } };
  const p0 = M.fillPlan(draft, brighton, phs);
  assert.deepEqual([p0.name, p0.storeCode, p0.suburb, p0.logo, p0.refusal], ['fill', 'fill', 'live', 'none', '']);
  assert.deepEqual(M.applyFill(draft, p0), ['Pharmacy name', 'Store code']);
  assert.deepEqual([draft.name, draft.storeCode], ['Brighton Pharmacy', 'VIC-MP-006']);
  // The right pharmacy: nothing overwritten; a different name and a hand-set suburb are offered, not replaced.
  const own = { id: 'a', name: 'Beaumaris Pharmacy Plus', storeCode: 'VIC-MP-001', tokens: { Suburb: 'Sandringham' } };
  const p1 = M.fillPlan(own, BEAUMARIS, phs);
  assert.deepEqual([p1.name, p1.storeCode, p1.suburb, p1.handSuburb, p1.refusal], ['differs', 'same', 'differs', 'Sandringham', '']);
  assert.deepEqual(M.applyFill(own, p1), []);
  assert.equal(own.name, 'Beaumaris Pharmacy Plus');
  assert.equal(M.fillPlan({ ...own, name: 'Beaumaris Pharmacy', tokens: { Suburb: 'beaumaris' } }, BEAUMARIS, phs).suburb, 'same');
  // Another store's device: refused, in plain words, and nothing filled.
  const vermont = { id: 'b', name: 'Vermont South Pharmacy', storeCode: 'VIC-MP-004' };
  const p2 = M.fillPlan(vermont, BEAUMARIS, phs);
  assert.equal(p2.refusal, 'This device belongs to Beaumaris Pharmacy (VIC-MP-001), not this pharmacy.');
  assert.deepEqual(M.applyFill(vermont, p2), []);
  // A new pharmacy from a device whose store is already set up here: refused, naming that pharmacy.
  assert.match(M.fillPlan({ id: null, name: '', storeCode: '' }, BEAUMARIS, phs).refusal, /already set up here as Beaumaris Pharmacy/);
});

test('the preview pill: live opening hours with when they were read, else sample data and how to get live data', () => {
  const now = new Date(); const at = new Date(now); at.setHours(9, 5, 0, 0);
  const live = M.previewDataLabel({ live: { data: BEAUMARIS.data, readAt: at.getTime() } }, now);
  assert.equal(live.live, true);
  assert.equal(live.label, 'Live opening hours');
  assert.match(live.tip, /^Read from Personalisation Hub for Beaumaris Pharmacy at 9:05 am\./);
  const none = M.previewDataLabel({ hasDevice: false });
  assert.equal(none.label, 'Sample opening hours');
  assert.match(none.tip, /add its Screen device ID in Settings/);
  assert.match(none.tip, /for the day and time the promotion plays\.$/);
  assert.match(M.previewDataLabel({ hasDevice: true }).tip, /could not be read from Personalisation Hub/);
  assert.match(M.previewDataLabel({ master: true }).tip, /master template always previews sample data/);
  assert.match(M.readAtText(new Date('2026-01-02T03:04:00').getTime(), new Date('2026-05-05T10:00:00')), /^2 Jan, 3:04 am$/);
});

test('the preview of a pharmacy with live data uses the store\'s own hours, through the screen\'s store mapping', () => {
  const content = M.newPharmacyContent(promotions, templates);
  const ph = { id: 'ph1', storeCode: 'VIC-MP-001', name: 'Beaumaris Pharmacy', colours: { primary: '#112233', accent: '#ddeeff' }, logo: null, content };
  const cfg = M.renderConfig({ pharmacies: [ph], promotions, templates });
  const live = storeModel(M.campaignForPreview(BEAUMARIS.data, 'VIC-MP-001', ph.name), cfg);
  const sample = storeModel(M.campaignForPreview(null, 'VIC-MP-001', ph.name), cfg);
  assert.equal(live.suburb, 'Beaumaris');
  assert.equal(sample.suburb, '');
  assert.deepEqual(live.sessions.filter((x) => x.day === 'mon').map((x) => [x.open, x.close]), [['08:30', '19:00']]);
  assert.deepEqual(sample.sessions.filter((x) => x.day === 'mon').map((x) => [x.open, x.close]), [['09:00', '17:30']]);
});
