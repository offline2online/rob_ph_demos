// Template HTML is cleaned in the page before it is shown (js/render.js cleanTemplateDom): nothing an administrator
// (or someone with an administrator's session) writes into a template may run on a screen or in the editor preview.
// Real Chromium, because what matters is how a browser parses the markup.

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { startDevServer } from '../../admin/tools/dev-server.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

let dev, browser;
before(async () => { dev = await startDevServer({ quiet: true }); browser = await chromium.launch(); });
after(async () => { if (browser) await browser.close(); if (dev) await dev.close(); });

test('markup that could run is removed; ordinary template markup is kept as written', async () => {
  const page = await browser.newPage();
  const dialogs = [];
  page.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss(); });
  await page.goto(`${dev.base}/pharmacy-screen.html?mockapi=1&device=TEST&promo=morning&nosw=1`);
  const out = await page.evaluate(async () => {
    const { cleanTemplateDom } = await import('./js/render.js');
    window.__ran = 0;
    const clean = (html) => {
      const t = document.createElement('template');
      t.innerHTML = html;
      cleanTemplateDom(t.content);
      const host = document.createElement('div');
      document.body.appendChild(host);
      host.replaceChildren(t.content);
      return host.innerHTML;
    };
    const bad = [
      '<img title=">" src=x onerror="window.__ran++">',
      '<svg><a xlink:href="javascript:window.__ran++"><text>x</text></a><animate onbegin="window.__ran++" attributeName="x"/></svg>',
      '<a href=" javascript:window.__ran++">x</a><iframe srcdoc="<script>parent.__ran++<\\/script>"></iframe>',
      '<div style="width:expression(1)" onclick="window.__ran++">x</div><script>window.__ran++<\\/script><base href="https://evil.example/">',
      '<form action="javascript:window.__ran++"><button formaction="javascript:window.__ran++">go</button></form><object data="javascript:window.__ran++"></object>',
    ].map(clean);
    const good = '<style>#screen .s-top{color:red}</style><div class="s-top" style="clip-path:polygon(0 0,1px 1px)"><img src="https://cdn.example.com/logo.png" alt="Logo"><svg class="s-chev" viewBox="0 0 90 50"><path d="M8 8 L45 42 L82 8"></path></svg><a href="https://example.com/">site</a><span class="ms">pill</span></div>';
    for (const el of document.querySelectorAll('a, button, div[style]')) { try { el.click(); } catch (e) {} }
    await new Promise((r) => setTimeout(r, 300));
    return { bad, kept: clean(good) === good, ran: window.__ran };
  });
  assert.equal(out.ran, 0, 'something ran');
  assert.deepEqual(dialogs, []);
  for (const html of out.bad) assert.doesNotMatch(html, /onerror|onclick|onbegin|javascript:|<script|<iframe|<base|<form|<object|<animate|expression\(/i, html);
  assert.equal(out.kept, true, 'ordinary template markup was changed');
  await page.close();
});
