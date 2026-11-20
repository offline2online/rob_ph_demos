import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clean, rich, fill, timeTokens, fillTemplate, esc } from '../js/tokens.js';

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
