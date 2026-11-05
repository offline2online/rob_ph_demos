/* PH Consent: banner, Preferences, Consent Mode updates, gating. Defaults are printed in <head> (main.php) before this runs. */
(function () {
  'use strict';
  var W = window, D = document, C = W.phConsentCfg || {}, K = C.ck || 'ph_consent', BOT = /bot|crawl|spider|slurp|headless|lighthouse|gptbot|claude|perplexity|bingpreview|facebookexternalhit/i.test(navigator.userAgent);
  var CATS = { analytics: 'Analytics', marketing: 'Marketing' }, st = { analytics: false, marketing: false }, rec = null, region = 'XX', bar = null, last = null;

  function rnd() { var a = new Uint8Array(12), s = ''; (W.crypto || W.msCrypto).getRandomValues(a); for (var i = 0; i < a.length; i++) s += ('0' + a[i].toString(16)).slice(-2); return s; }
  function read() {
    var m = D.cookie.match(new RegExp('(?:^|; )' + K + '=([^;]*)')); if (!m) return null;
    var p = {}; m[1].split('&').forEach(function (x) { var i = x.split('='); p[i[0]] = i[1]; });
    return p.v === C.v && /^[a-f0-9]{16,32}$/.test(p.id || '') ? { id: p.id, a: p.a === '1', m: p.m === '1', d: p.d === '1' } : null;
  }
  function write(r) {
    var e = new Date(); e.setMonth(e.getMonth() + (C.mo || 12));
    D.cookie = K + '=v=' + C.v + '&id=' + r.id + '&a=' + (r.a ? 1 : 0) + '&m=' + (r.m ? 1 : 0) + '&d=' + (r.d ? 1 : 0) + ';expires=' + e.toUTCString() + ';path=/;SameSite=Lax' + (location.protocol === 'https:' ? ';Secure' : '');
  }
  function isEU(l) { return !l || l === 'XX' || (C.eu || []).indexOf(l) > -1; }
  function geo(cb) {
    var q = location.search.match(/[?&]ph_region=([A-Za-z]{2})/);
    if (q) return cb(q[1].toUpperCase());
    try { var g = JSON.parse(localStorage.getItem('ph_geo')); if (g && /^[A-Z]{2}$/.test(g.l) && Date.now() - g.t < 6048e5) return cb(g.l); } catch (e) {}
    var done = false, fin = function (l) { if (done) return; done = true; if (l !== 'XX') try { localStorage.setItem('ph_geo', JSON.stringify({ l: l, t: Date.now() })); } catch (e) {} cb(l); };
    setTimeout(function () { fin('XX'); }, 2500);
    try { fetch('/cdn-cgi/trace', { cache: 'no-store' }).then(function (r) { return r.text(); }).then(function (t) { var m = t.match(/^loc=([A-Z]{2})$/m); fin(m ? m[1] : 'XX'); }, function () { fin('XX'); }); } catch (e) { fin('XX'); }
  }
  function clearCookies(re) {
    D.cookie.split('; ').forEach(function (c) {
      var n = c.split('=')[0]; if (!re.test(n)) return;
      var h = location.hostname.split('.'), ds = [''];
      for (var i = 0; i < h.length - 1; i++) ds.push(';domain=.' + h.slice(i).join('.'));
      ds.forEach(function (d) { D.cookie = n + '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/' + d; });
    });
  }
  function activate() {
    [].forEach.call(D.querySelectorAll('script[type="text/plain"][data-ph-category]'), function (s) {
      if (!st[s.getAttribute('data-ph-category')] || s.getAttribute('data-ph-done')) return;
      s.setAttribute('data-ph-done', '1');
      var n = D.createElement('script');
      [].forEach.call(s.attributes, function (a) { if (a.name !== 'type' && a.name !== 'data-ph-category' && a.name !== 'data-ph-done') n.setAttribute(a.name, a.value); });
      n.text = s.text; s.parentNode.insertBefore(n, s.nextSibling);
    });
  }
  function apply(a, m) {
    var prev = last; st = { analytics: !!a, marketing: !!m }; last = a + ':' + m;
    if (W.gtag) W.gtag('consent', 'update', { analytics_storage: a ? 'granted' : 'denied', ad_storage: m ? 'granted' : 'denied', ad_user_data: m ? 'granted' : 'denied', ad_personalization: m ? 'granted' : 'denied' });
    if (!a) clearCookies(/^_ga/); if (!m) clearCookies(/^(_gcl|_fb|li_fat_id|bcookie|lidc|UserMatchHistory)/);
    activate();
    if (prev !== last) D.dispatchEvent(new CustomEvent('ph:consent', { detail: { analytics: st.analytics, marketing: st.marketing, region: region } }));
  }
  function log(action) {
    if (!C.rest) return;
    try { fetch(C.rest, { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: rec.id, v: C.v, region: region, a: rec.a, m: rec.m, action: action }) }).catch(function () {}); } catch (e) {}
  }
  function save(a, m, action) {
    rec = { id: rec ? rec.id : rnd(), a: !!a, m: !!m, d: false }; write(rec); apply(a, m); log(action); close();
  }
  function close() { if (bar) { bar.remove(); bar = null; } }
  function el(tag, cls, html) { var e = D.createElement(tag); if (cls) e.className = cls; if (html) e.innerHTML = html; return e; }
  function btn(txt, cls, fn) { var b = el('button', cls, txt); b.type = 'button'; b.addEventListener('click', fn); return b; }

  function show(panel, opener) {
    close();
    var eu = isEU(region), box = el('div', 'ph-cc'), inn = el('div', 'ph-cc-in'), row = el('div', 'ph-cc-r');
    box.setAttribute('role', 'region'); box.setAttribute('aria-label', 'Cookies');
    var p = el('p', '', eu ? 'We use necessary cookies to make this site work. We would also like to set analytics and marketing cookies. <a href="' + C.pol + '">Cookie policy</a>' : 'We use cookies to improve this site and measure our advertising. You can opt out in Preferences. <a href="' + C.pol + '">Cookie policy</a>');
    inn.appendChild(p);
    if (eu) { row.appendChild(btn('Accept all', 'ph-cc-b', function () { save(1, 1, 'accept'); })); row.appendChild(btn('Reject all', 'ph-cc-b', function () { save(0, 0, 'reject'); })); }
    else row.appendChild(btn('OK', 'ph-cc-b', function () { save(1, 1, 'ok'); }));
    var pref = btn('Preferences', 'ph-cc-l', function () { show(true, pref); }); pref.setAttribute('aria-expanded', panel ? 'true' : 'false'); row.appendChild(pref);
    inn.appendChild(row);
    if (panel) {
      var pn = el('div', 'ph-cc-pn'), cur = rec ? { analytics: rec.a, marketing: rec.m } : (eu ? { analytics: false, marketing: false } : st);
      pn.setAttribute('role', 'group'); pn.setAttribute('aria-label', 'Cookie preferences');
      pn.appendChild(el('label', '', '<input type="checkbox" checked disabled><span><strong>Necessary</strong>Remember your choice and make the site work. Always on.</span>'));
      Object.keys(CATS).forEach(function (k) {
        var l = el('label', '', '<input type="checkbox" name="' + k + '"><span><strong>' + CATS[k] + '</strong>' + (k === 'analytics' ? 'Show us how the site is used (Google Analytics).' : 'Measure and personalise our advertising (Google Ads, LinkedIn, Meta).') + '</span>');
        l.querySelector('input').checked = !!cur[k]; pn.appendChild(l);
      });
      var go = btn('Save preferences', 'ph-cc-b', function () { save(pn.querySelector('[name=analytics]').checked, pn.querySelector('[name=marketing]').checked, 'save'); });
      pn.appendChild(go); inn.appendChild(pn);
      box.addEventListener('keydown', function (e) { if (e.key === 'Escape') { if (rec) { close(); if (opener && opener.focus) opener.focus(); } else show(false); } });
    }
    box.appendChild(inn); D.body.appendChild(box); bar = box;
    if (panel) pn.querySelector('[name=analytics]').focus();
  }

  function footerLink() {
    var f = D.querySelector('footer, .elementor-location-footer'); if (!f || f.querySelector('.ph-cc-fl')) return;
    var a = el('a', 'ph-cc-fl', 'Cookie settings'); a.href = '#cookie-settings'; f.appendChild(a);
  }
  D.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href="#cookie-settings"]'); if (!a) return;
    e.preventDefault(); show(true, a);
  });

  W.phConsent = {
    has: function (c) { return c === 'necessary' || !!st[c]; },
    get: function () { return { analytics: st.analytics, marketing: st.marketing, region: region, decided: !!rec && !rec.d }; },
    open: function () { show(true); }
  };

  function init() {
    footerLink(); rec = read();
    geo(function (l) {
      region = l;
      if (rec && rec.d && isEU(l)) rec = null; /* an implied non-EU default never counts in the EU */
      if (rec && !rec.d) return apply(rec.a, rec.m);
      if (isEU(l)) apply(0, 0);
      else { rec = rec || { id: rnd(), a: true, m: true, d: true }; write(rec); apply(1, 1); }
      if (!BOT) show(false);
    });
  }
  if (D.readyState === 'loading') D.addEventListener('DOMContentLoaded', init); else init();
}());
