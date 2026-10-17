// Keeps the page where the person left it when a click or selection redraws part of the page. Every filter, tab, toggle
// and chart control rebuilds its panel (a skeleton first, then the new content), which briefly makes the page shorter and
// lets the browser clamp the scroll position, so the page jumps up and does not come back. After any interaction this
// pins the page height and restores the scroll position until the redraw settles; a deliberate scroll by the person wins.
(function () {
  'use strict';
  var frame = document.getElementById('frame');
  if (!frame || !window.MutationObserver) return;
  var SETTLE_MS = 500;   // quiet time with nothing loading before the height pin is released
  var MAX_MS = 15000;    // never hold the pin longer than this
  var y = 0, pinned = 0, active = false, settleTimer = null, maxTimer = null, mo = null;

  function loading() { return !!frame.querySelector('[aria-busy="true"], .rd-skel, .av-skel, .sc-skel, .dc-skel, [class*="skel"]'); }
  function restore() {
    if (!active) return;
    var h = frame.offsetHeight;
    if (h > pinned) pinned = h;
    frame.style.minHeight = pinned + 'px';
    if (Math.abs(window.pageYOffset - y) > 1) window.scrollTo(window.pageXOffset, y);
  }
  function release() {
    active = false; pinned = 0;
    clearTimeout(settleTimer); clearTimeout(maxTimer);
    if (mo) mo.disconnect();
    frame.style.minHeight = '';
  }
  function schedule() {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(function () { if (loading()) schedule(); else release(); }, SETTLE_MS);
  }
  function begin() {
    y = window.pageYOffset; pinned = frame.offsetHeight;
    if (!active) {
      active = true;
      mo = new MutationObserver(function () { restore(); schedule(); });
      mo.observe(frame, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'aria-busy', 'class'] });
    }
    clearTimeout(maxTimer); maxTimer = setTimeout(release, MAX_MS);
    schedule();
  }
  ['click', 'change', 'input', 'keydown'].forEach(function (t) { document.addEventListener(t, begin, true); });
  // The person scrolling on purpose takes over.
  ['wheel', 'touchmove'].forEach(function (t) { window.addEventListener(t, function () { if (active) release(); }, { passive: true }); });
  document.addEventListener('keydown', function (e) {
    if (active && /^(PageUp|PageDown|Home|End| |ArrowUp|ArrowDown)$/.test(e.key) && !/^(INPUT|SELECT|TEXTAREA)$/.test((e.target || {}).tagName || '')) release();
  });
})();
