// Landscape (in-store) wording for the promotion scenes (28 Nov 2026): landscape screens hang inside the pharmacy,
// portrait ones outside it, so Morning and Afternoon carry landscape wording that never asks the viewer to walk in.
// The render engine's overlay (js/render.js landscapeContent), its defaults, the seed data and fixtures, the
// editor's helpers (admin/js/model.js) and the config API's inheritance and service validation. node --test.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import * as R from '../js/render.js';
import * as M from '../admin/js/model.js';

const require = createRequire(import.meta.url);
const inherit = require('../config-api/src/inherit.js');
const { normaliseService } = require('../config-api/src/validate.js');
const { upgradeLandscape } = require('../seed/seed.js');
const json = (p) => JSON.parse(fs.readFileSync(new URL(p, import.meta.url), 'utf8'));
const SEED = json('../seed/fixtures/pharmacies.json').pharmacies;
const FIXTURE = json('../fixtures/config.json').pharmacies;
const SERVICES = json('../seed/fixtures/services.json').services;

// Wording that asks a viewer outside the pharmacy to come in: never in landscape.
const COME_IN = /\b(walk in|pop in|drop in|come in|visit us|on your way|ask in store)\b/i;
const lines = (c) => [c.introTitle, c.introSub, ...c.slots.flatMap((x) => [x.title, x.sub, x.line1, x.line2]), c.close.title, c.close.sub, c.close.line1, c.close.line2];

test('landscapeContent: overrides replace the shared copy; blank or missing ones fall back to it', () => {
  const c = {
    greeting: 'Hi', introTitle: 'Three reasons to walk in', introSub: 'Just ask in store.', landscape: { introTitle: 'Our services', introSub: '  ' },
    slots: [{ label: 'BP', icon: 'x', title: 'BP', sub: 'Free', line1: 'Know', line2: 'Pop in', dur: 3, landscape: { line2: 'Ask us' } }, { label: 'M', title: 'M', line2: 'Same' }],
    close: { title: 'Walk in today', sub: 'Speak', line1: 'See you', line2: 'Since 1952', dur: 2, landscape: { title: 'Speak to your pharmacist', line2: '' } },
  };
  const l = R.landscapeContent(c);
  assert.equal(l.introTitle, 'Our services');
  assert.equal(l.introSub, 'Just ask in store.');
  assert.equal(l.greeting, 'Hi');
  assert.deepEqual([l.slots[0].line2, l.slots[0].line1, l.slots[0].dur, l.slots[0].label], ['Ask us', 'Know', 3, 'BP']);
  assert.equal(l.slots[1].line2, 'Same');
  assert.deepEqual([l.close.title, l.close.sub, l.close.line2, l.close.dur], ['Speak to your pharmacist', 'Speak', 'Since 1952', 2]);
  // the content itself is not changed, and portrait plays it as it is
  assert.equal(c.introTitle, 'Three reasons to walk in');
  assert.equal(R.copyFor(c, 'portrait'), c);
  // the same scenes and timings in both orientations
  const play = { base: 'scenes', content: c };
  assert.deepEqual(R.sequence(play), R.sequence({ base: 'scenes', content: l }));
  // content with no landscape wording plays the same in both
  const plain = { introTitle: 'a', introSub: 'b', slots: [{ title: 't' }], close: { title: 'c' } };
  assert.deepEqual(R.landscapeContent(plain), plain);
});

test('the default copy has the approved landscape wording, and the portrait wording is unchanged', () => {
  const d = R.defaultContent('scenes');
  assert.deepEqual([d.introTitle, d.introSub, d.close.title, d.close.sub, d.close.line1], ['Three reasons to walk in', 'No fuss. Just ask in store.', 'Walk in today', 'Speak directly with a pharmacist', 'We look forward to seeing you']);
  const l = R.landscapeContent(d);
  assert.deepEqual([l.introTitle, l.introSub], ['Our services', 'Speak to your pharmacist']);
  assert.deepEqual([l.close.title, l.close.sub, l.close.line1, l.close.line2], ['Speak to your pharmacist', "We're here to help", 'Ask us about any of these services', d.close.line2]);
  for (const id of ['morning', 'afternoon']) {
    const c = M.newContentFor({ promoId: id }, 'scenes');
    assert.equal(c.introTitle, 'Three reasons to walk in', id);
    assert.equal(c.close.title, 'Walk in today', id);
    for (const t of lines(R.landscapeContent(c))) assert.doesNotMatch(String(t || ''), COME_IN, `${id} landscape: ${t}`);
  }
});

test('seed data and fixtures: Beaumaris plays the approved landscape wording; no landscape line asks anyone to come in', () => {
  for (const [name, list] of [['seed', SEED], ['fixtures', FIXTURE]]) {
    const b = list.find((p) => p.storeCode === 'VIC-MP-001');
    const m = R.landscapeContent(b.content.morning), a = R.landscapeContent(b.content.afternoon);
    for (const c of [m, a]) {
      assert.deepEqual([c.introTitle, c.introSub], ['Our services', 'Speak to your pharmacist'], name);
      assert.deepEqual([c.close.title, c.close.sub, c.close.line1, c.close.line2], ['Speak to your pharmacist', "We're here to help", 'Ask us about any of these services', 'Trusted local care since 1952'], name);
    }
    assert.equal(m.slots[0].line2, 'Ask us this morning', name);
    assert.equal(a.slots[1].line2, 'Talk to us today', name);
    assert.equal(a.slots[2].sub, 'Ask us to book', name);
    // portrait: exactly as before
    assert.equal(b.content.morning.introTitle, 'Three reasons to walk in');
    assert.equal(b.content.morning.slots[0].line2, 'Pop in this morning');
    assert.equal(b.content.afternoon.slots[1].line2, 'Talk to us on your way home');
    assert.equal(b.content.afternoon.close.title, 'Walk in today');
    for (const ph of list) for (const id of ['morning', 'afternoon']) {
      for (const t of lines(R.landscapeContent(ph.content[id]))) assert.doesNotMatch(String(t || ''), COME_IN, `${name} ${ph.storeCode} ${id} landscape: ${t}`);
      // only Morning and Afternoon carry landscape wording
      for (const other of ['closed', 'occasions', 'sale']) assert.equal(JSON.stringify(ph.content[other] || {}).includes('"landscape"'), false, `${ph.storeCode} ${other}`);
    }
  }
  // the screen's fixtures carry the seed's copy
  for (const ph of SEED) {
    const f = FIXTURE.find((x) => x.storeCode === ph.storeCode);
    for (const id of ['morning', 'afternoon']) assert.deepEqual(f.content[id], ph.content[id], `${ph.storeCode} ${id}`);
  }
});

test('service library: come-in lines have landscape wording, kept by the config API and carried into a slot', () => {
  for (const s of SERVICES) {
    const land = { ...s, ...(s.landscape || {}) };
    for (const k of ['headline', 'accent', 'line1', 'line2']) assert.doesNotMatch(String(land[k] || ''), COME_IN, `${s.key}.${k}`);
  }
  const book = SERVICES.find((s) => s.accent === 'Ask in store to book');
  assert.deepEqual(book.landscape, { accent: 'Ask us to book' });
  const clean = normaliseService({ ...book, id: undefined });
  assert.deepEqual(clean.landscape, { accent: 'Ask us to book' });
  assert.equal('landscape' in normaliseService({ label: 'X', landscape: { accent: ' ' } }), false);
  assert.equal('landscape' in normaliseService({ label: 'X' }), false);
  assert.throws(() => normaliseService({ label: 'X', landscape: 'no' }), /landscape must be an object/);
  assert.throws(() => normaliseService({ label: 'X', landscape: { line2: '<script>x</script>' } }));
  const slot = M.serviceToSlot({ id: 's1', ...book });
  assert.equal(slot.sub, 'Ask in store to book');
  assert.deepEqual(slot.landscape, { sub: 'Ask us to book' });
  assert.equal('landscape' in M.serviceToSlot({ id: 's2', label: 'Plain', headline: 'Plain' }), false);
});

test('editor helpers: landscape text is set and cleared beside the shared copy', () => {
  const slot = { title: 'T', line2: 'Pop in' };
  assert.equal(M.landscapeText(slot, 'line2'), '');
  M.setLandscapeText(slot, 'line2', 'Ask us');
  assert.deepEqual(slot, { title: 'T', line2: 'Pop in', landscape: { line2: 'Ask us' } });
  M.setLandscapeText(slot, 'title', '<br>');
  assert.deepEqual(slot.landscape, { line2: 'Ask us' });
  M.setLandscapeText(slot, 'line2', '  ');
  assert.equal('landscape' in slot, false);
  assert.equal(M.plainCopy('Walk in <b>today</b><br>now &amp; then'), 'Walk in today now & then');
});

test('inheritance: landscape wording inherits and detaches with its section, the same in the editor and the API', () => {
  const master = {
    greeting: 'M', introTitle: 'MI', introSub: 'MS', landscape: { introTitle: 'Our services' },
    slots: [{ title: 'Master slot', line2: 'Pop in', landscape: { line2: 'Ask us' } }],
    close: { title: 'Walk in today', landscape: { title: 'Speak to your pharmacist' } },
  };
  const own = { greeting: 'Own', introTitle: 'Own intro', slots: [{ title: 'Own slot', line2: 'Own line' }], close: { title: 'Own close' } };
  for (const eff of [M.effectiveContent, inherit.effectiveContent]) {
    // Nothing detached: the master's wording, landscape too.
    const all = R.landscapeContent(eff(master, own, []));
    assert.deepEqual([all.introTitle, all.slots[0].line2, all.close.title], ['Our services', 'Ask us', 'Speak to your pharmacist']);
    // Slots detached: the pharmacy's own slots, and no master landscape wording laid over them.
    const slots = R.landscapeContent(eff(master, own, ['slots']));
    assert.deepEqual([slots.slots[0].title, slots.slots[0].line2, slots.introTitle], ['Own slot', 'Own line', 'Our services']);
    // Greeting detached: the pharmacy's own intro in both orientations.
    const greet = R.landscapeContent(eff(master, own, ['greeting']));
    assert.equal(greet.introTitle, 'Own intro');
    assert.equal(greet.landscape, undefined);
  }
});

test('seed upgrade: seeded copy gets the landscape wording; edited copy and portrait wording are kept', () => {
  const fresh = SEED.find((p) => p.storeCode === 'VIC-MP-001').content.afternoon;
  const strip = (c) => JSON.parse(JSON.stringify(c, (k, v) => (k === 'landscape' ? undefined : v)));
  const old = strip(fresh);
  const up = upgradeLandscape(old, fresh);
  assert.deepEqual(up, fresh);
  assert.equal(upgradeLandscape(fresh, fresh), null);
  // an edited intro and slot keep their own copy and get no landscape wording; the rest is upgraded
  const edited = strip(fresh);
  edited.introTitle = 'Our own words';
  edited.slots[1].line2 = 'Our own line';
  const up2 = upgradeLandscape(edited, fresh);
  assert.equal(up2.landscape, undefined);
  assert.equal(up2.introTitle, 'Our own words');
  assert.equal(up2.slots[1].landscape, undefined);
  assert.equal(up2.slots[1].line2, 'Our own line');
  assert.deepEqual(up2.slots[2].landscape, { sub: 'Ask us to book' });
  assert.deepEqual(up2.close.landscape, fresh.close.landscape);
  assert.equal(up2.close.title, 'Walk in today');
});
