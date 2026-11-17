// PH Agent Console: add LinkedIn contact. Clicking the toolbar button on a
// LinkedIn profile reads that one page (linkedin-reader.js) and hands what it
// read to the console's Prospects (TAM) › Contacts tab, in a console tab where
// you are already signed in. The console saves it with your own sign-in and
// permissions, matched to a TAM company where it can (otherwise Unmatched);
// the same profile clicked again updates the same contact.
//
// One profile per click, only when you click: nothing runs in the background,
// nothing is scrolled, opened or collected in bulk, and the extension holds no
// credential of its own.
const CONSOLE_ORIGINS = ["https://backlog-tracker-e4ed2.web.app", "https://backlog-tracker-e4ed2.firebaseapp.com"];
const CONTACTS_HASH = "#promote/prospects?tab=contacts";
const PROFILE = /^https:\/\/(?:[a-z]{2,3}\.|www\.)?linkedin\.com\/in\/[^/?#]+/i;
const WAIT_MS = 60000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function badge(tabId, text, colour, title) {
  try {
    await chrome.action.setBadgeText({ tabId, text });
    if (colour) await chrome.action.setBadgeBackgroundColor({ tabId, color: colour });
    if (title) await chrome.action.setTitle({ tabId, title });
  } catch { /* the tab closed */ }
}

// A small note on the LinkedIn page saying what happened.
async function toast(tabId, message, ok) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      args: [message, ok],
      func: (text, good) => {
        const old = document.getElementById("ph-contact-toast");
        if (old) old.remove();
        const el = document.createElement("div");
        el.id = "ph-contact-toast";
        el.setAttribute("role", "status");
        el.textContent = text;
        el.style.cssText = `position:fixed;right:16px;bottom:16px;z-index:2147483647;max-width:360px;padding:12px 16px;border-radius:8px;font:14px/1.4 Roboto,Helvetica,Arial,sans-serif;color:#fff;background:${good ? "#169bc2" : "#c62828"};box-shadow:0 8px 24px rgba(0,0,0,.2)`;
        document.body.appendChild(el);
        setTimeout(() => el.remove(), 6000);
      },
    });
  } catch { /* the page went away */ }
}

async function consoleTab() {
  const tabs = await chrome.tabs.query({ url: CONSOLE_ORIGINS.map((o) => `${o}/*`) });
  const url = `${CONSOLE_ORIGINS[0]}/${CONTACTS_HASH}`;
  if (tabs.length) {
    const t = tabs[0];
    const origin = new URL(t.url).origin;
    await chrome.tabs.update(t.id, { url: `${origin}/${CONTACTS_HASH}` }); // a hash change: the page doesn't reload
    return t;
  }
  return chrome.tabs.create({ url, active: false });
}

// Calls the console page's window.__phAddProspectContact once the Prospects page has mounted it.
async function hand(tabId, profile) {
  const until = Date.now() + WAIT_MS;
  while (Date.now() < until) {
    try {
      const [res] = await chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        args: [profile],
        func: (p) => (typeof window.__phAddProspectContact === "function" ? window.__phAddProspectContact(p) : null),
      });
      if (res && res.result) return res.result;
    } catch { /* the page is still loading */ }
    await sleep(1000);
  }
  return { ok: false, error: "The console didn't answer. Open it, sign in, and click again." };
}

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab || !tab.id) return;
  if (!PROFILE.test(tab.url || "")) {
    await badge(tab.id, "!", "#c62828", "Open a LinkedIn profile (linkedin.com/in/…) and click again.");
    await toast(tab.id, "Open a LinkedIn profile (linkedin.com/in/…) and click again.", false);
    return;
  }
  await badge(tab.id, "…", "#169bc2", "Adding to Prospects (TAM) contacts…");
  let profile;
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["linkedin-reader.js"] });
    const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => globalThis.phReadLinkedInProfile(document, location.href) });
    profile = res && res.result;
  } catch (e) { profile = { error: `Couldn't read the page: ${e && e.message ? e.message : e}` }; }
  if (!profile || profile.error) {
    const msg = (profile && profile.error) || "Couldn't read the profile.";
    await badge(tab.id, "!", "#c62828", msg); await toast(tab.id, msg, false);
    return;
  }
  const ct = await consoleTab();
  const out = await hand(ct.id, profile);
  if (out && out.ok) {
    const msg = `${out.outcome === "updated" ? "Updated" : "Added"} ${out.name} (${out.company}) in Prospects (TAM) contacts.`;
    await badge(tab.id, "✓", "#2e7d32", msg); await toast(tab.id, msg, true);
  } else {
    const msg = (out && out.error) || "Couldn't add the contact.";
    await badge(tab.id, "!", "#c62828", msg); await toast(tab.id, msg, false);
    try { await chrome.tabs.update(ct.id, { active: true }); } catch { /* closed */ }
  }
});
