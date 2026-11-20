import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clean, rich, fill, timeTokens, fillTemplate, esc, applyStoreName } from '../js/tokens.js';

test('${Suburb} is replaced with the suburb only', () => {
  assert.equal(rich('Good morning,<br>${Suburb}', 'Beaumaris'), 'Good morning,<br>Beaumaris');
  assert.equal(fill('Serving ${Suburb} today', 'Ocean Grove'), 'Serving Ocean Grove today');
});

test('${Suburb} is blanked with its leading comma or line break when there is no suburb', () => {
  assert.equal(rich('Good morning,<br>${Suburb}', ''), 'Good morning');
  assert.equal(rich('Hello, ${Suburb}', '  '), 'Hello');
  assert.equal(fill('Serving ${Suburb}', ''), 'Serving');
  assert.equal(rich('Serving ${Suburb}<br><span class="reg">since 1952</span>', ''), 'Serving<br><span class="reg">since 1952</span>');
});

test('the suburb is escaped', () => {
  assert.equal(rich('Hi ${Suburb}', '<b>x</b>'), 'Hi &lt;b&gt;x&lt;/b&gt;');
  assert.equal(fill('Hi ${Suburb}', 'A & B'), 'Hi A &amp; B');
});

test('rich-text sanitiser keeps bold, italic, line breaks and the reg/acc spans only', () => {
  assert.equal(clean('<strong>Big</strong> <em>it</em><br/>x'), '<b>Big</b> <i>it</i><br>x');
  assert.equal(clean('<span class="acc">7PM</span> <span style="color:red">plain</span>'), '<span class="acc">7PM</span> plain');
  assert.equal(clean('<img src=x onerror=alert(1)>Hi<script>alert(1)</script>'), 'Hi');
  assert.equal(clean('<a href="javascript:x">link</a>'), 'link');
  assert.equal(clean('<div>one</div><div>two</div>'), 'one<br>two');
  assert.equal(clean('<b>unclosed'), '<b>unclosed</b>');
  assert.equal(clean('a<br><br>'), 'a');
});

test('plain lines are escaped, not interpreted', () => {
  assert.equal(fill('<b>x</b>', 'S'), '&lt;b&gt;x&lt;/b&gt;');
  assert.equal(esc('"&'), '&quot;&amp;');
});

test('${CloseTime} and ${OpenTime}', () => {
  assert.equal(timeTokens('Open today until <span class="acc">${CloseTime}</span>', '7PM', '8.30AM'), 'Open today until <span class="acc">7PM</span>');
  assert.equal(timeTokens('Opens at ${OpenTime}', '', '9AM'), 'Opens at 9AM');
});

test('template slots: known tokens filled, unknown tokens blank', () => {
  assert.equal(fillTemplate('<div>${Headline}</div>${Nope}', { Headline: '<h2>Hi</h2>' }), '<div><h2>Hi</h2></div>');
  assert.equal(fillTemplate('${toString}', {}), '');
});

test('${StoreName} in copy is the escaped store name (Occasions sign-offs)', () => {
  assert.equal(applyStoreName(fill('Merry Christmas from the whole ${StoreName} team.', 'Beaumaris'), "O'Brien's Pharmacy"), "Merry Christmas from the whole O'Brien's Pharmacy team.");
  assert.equal(applyStoreName(rich('Thanks from ${StoreName}', ''), 'A <b>&</b> B'), 'Thanks from A &lt;b&gt;&amp;&lt;/b&gt; B');
});

test('tokens set by hand: settable names, cleaning and applying', async () => {
  const { DATA_TOKENS, LIVE_TOKENS, SLOT_TOKENS, isSettableToken, tokensIn, cleanTokens, applyTokens, TEMPLATE_TOKENS } = await import('../js/tokens.js');
  assert.deepEqual(DATA_TOKENS, ['Suburb', 'StoreName', 'Phone', 'State', 'StoreCode', 'CloseTime', 'OpenTime']);
  // ${StoreName} is the pharmacy name and today's hours change through the day: never set by hand.
  assert.deepEqual(LIVE_TOKENS, ['StoreName', 'CloseTime', 'OpenTime']);
  for (const k of Object.values(TEMPLATE_TOKENS).flat()) assert.equal(isSettableToken(k), DATA_TOKENS.includes(k) && !LIVE_TOKENS.includes(k), k);
  for (const k of LIVE_TOKENS) assert.equal(isSettableToken(k), false, k);
  assert.deepEqual(cleanTokens({ StoreName: 'Set Name', CloseTime: '9PM', OpenTime: '8AM', Suburb: 'Beaumaris' }), { Suburb: 'Beaumaris' }, 'a stored live token is ignored');
  assert.equal(isSettableToken('Website'), true);
  for (const k of ['1st', 'my token', '_x', '__proto__', '']) assert.equal(isSettableToken(k), false, k);
  assert.deepEqual(tokensIn('Hi ${Suburb}, call ${Phone} or ${Suburb}'), ['Suburb', 'Phone']);
  assert.deepEqual(cleanTokens({ Suburb: ' Beaumaris ', Phone: '  ', Headline: 'x', Website: 'a.example', Bad: 5 }), { Suburb: 'Beaumaris', Website: 'a.example' });
  assert.deepEqual(cleanTokens(['Suburb']), {});
  assert.equal(applyTokens('Visit ${Website} · ${Other}', { Website: '<b>a</b>' }), 'Visit &lt;b&gt;a&lt;/b&gt; · ${Other}');
  // The config API refuses the same template slots (config-api/src/validate.js).
  const { createRequire } = await import('node:module');
  const validate = createRequire(import.meta.url)('../config-api/src/validate.js');
  assert.deepEqual([...validate.SLOT_TOKENS].sort(), [...SLOT_TOKENS].sort());
  assert.deepEqual([...validate.LIVE_TOKENS], LIVE_TOKENS);
});

test('tokens set by hand win over the store data on the screen; the pharmacy name and today\'s hours are always live', async () => {
  const { storeModel, footerMessage } = await import('../js/render.js');
  const campaign = { data: { store_location: { store_code: 'VIC-MP-001', store_name: 'PH name' }, store_info: { address_info: { suburb: 'Wrong', phone_number: '03 0000 0000' } } } };
  const cfg = (tokens) => ({ pharmacies: [{ storeCode: 'VIC-MP-001', name: 'Beaumaris Pharmacy', content: {}, tokens }] });
  let s = storeModel(campaign, cfg(undefined));
  assert.deepEqual([s.suburb, s.name, s.phone], ['Wrong', 'Beaumaris Pharmacy', '03 0000 0000']);
  s = storeModel(campaign, cfg({ Suburb: 'Beaumaris', StoreName: 'MiPharmacy Beaumaris', Phone: '03 9589 0000', CloseTime: '9PM', Website: 'x.example' }));
  assert.deepEqual([s.suburb, s.name, s.phone], ['Beaumaris', 'Beaumaris Pharmacy', '03 9589 0000'], 'a stored ${StoreName} is ignored');
  assert.equal(s.tokens.Website, 'x.example');
  assert.equal(s.tokens.CloseTime, undefined);
  const bar = footerMessage(s, {}, { state: 'open', closeTime: '19:00' });
  assert.match(bar, /7PM/, 'today\'s closing time, not a stored ${CloseTime}');
  assert.doesNotMatch(bar, /9PM/);
});

test('"+ Add token" lists the ticketed tokens; ${State} and ${StoreCode} come from the store unless set by hand', async () => {
  const { ADD_TOKENS, isSettableToken, TEMPLATE_TOKENS } = await import('../js/tokens.js');
  assert.deepEqual(ADD_TOKENS.map((t) => t.label), ['Store name', 'Suburb', 'Brand name', 'Store code', 'State', 'Phone number', 'Website', 'Languages spoken by store staff', 'Localised copy']);
  assert.deepEqual(ADD_TOKENS.map((t) => t.name), ['StoreName', 'Suburb', 'BrandName', 'StoreCode', 'State', 'Phone', 'Website', 'LanguagesSpoken', 'LocalisedCopy']);
  // every one but the pharmacy name can be given a value in Settings → Tokens
  for (const t of ADD_TOKENS) assert.equal(isSettableToken(t.name), t.name !== 'StoreName', t.name);
  for (const k of Object.keys(TEMPLATE_TOKENS)) for (const t of ['State', 'StoreCode']) assert.ok(TEMPLATE_TOKENS[k].includes(t), `${k} offers ${t}`);
  const { storeModel } = await import('../js/render.js');
  const campaign = { data: { store_location: { store_code: 'VIC-MP-001' }, store_info: { address_info: { suburb: 'Beaumaris', state: ' Victoria ' } } } };
  const cfg = (tokens) => ({ pharmacies: [{ storeCode: 'VIC-MP-001', name: 'Beaumaris Pharmacy', content: {}, tokens }] });
  let s = storeModel(campaign, cfg(undefined));
  assert.deepEqual([s.state, s.storeCode], ['Victoria', 'VIC-MP-001']);
  s = storeModel(campaign, cfg({ State: 'VIC', StoreCode: 'MP1' }));
  assert.deepEqual([s.state, s.storeCode], ['VIC', 'MP1']);
});
