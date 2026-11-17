// Reads one LinkedIn profile page: the name, headline, current company and
// profile URL. Injected into the LinkedIn tab by background.js only when the
// toolbar button is clicked (activeTab), one profile per click. It reads what
// is already on the page; it never scrolls, clicks, fetches or follows links.
// Tested in backlog-tracker/test/linkedin-reader.test.mjs against saved markup.
(function (root) {
  const clean = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim();
  function readLinkedInProfile(doc, href) {
    const m = String(href || "").match(/^https?:\/\/(?:[a-z]{2,3}\.|www\.)?linkedin\.com\/in\/([^/?#]+)/i);
    if (!m) return { error: "Open a LinkedIn profile (linkedin.com/in/…) and click again." };
    const url = `https://www.linkedin.com/in/${m[1]}/`;
    const main = doc.querySelector("main") || doc.body || doc;
    const h1 = main.querySelector("h1");
    let name = clean(h1 && h1.textContent);
    if (!name) name = clean(String(doc.title || "").replace(/^\(\d+\)\s*/, "").split("|")[0]);
    // The top card is the section holding the name; the headline is its medium body text.
    const card = h1 ? (h1.closest("section") || h1.parentElement) : null;
    let headline = "";
    if (card) {
      const el = card.querySelector(".text-body-medium, [data-generated-suggestion-target]");
      headline = clean(el && el.textContent);
    }
    if (!headline) {
      const og = doc.querySelector('meta[property="og:description"], meta[name="description"]');
      headline = clean(og && og.getAttribute("content")).slice(0, 200);
    }
    // Current company: the top card's "Current company: X" button, else the first Experience entry, else "… at X".
    let company = "";
    const cur = doc.querySelector('[aria-label^="Current company:"], [aria-label^="Current company"]');
    if (cur) company = clean(cur.getAttribute("aria-label").replace(/^Current company:?\s*/i, "").replace(/\.?\s*Click to skip.*$/i, ""));
    if (!company) {
      const anchor = doc.getElementById("experience");
      const sec = anchor && (anchor.closest("section") || anchor.parentElement);
      const first = sec && sec.querySelector("li");
      if (first) {
        const spans = [...first.querySelectorAll('span[aria-hidden="true"]')].map((s) => clean(s.textContent)).filter(Boolean);
        if (spans.length > 1) company = clean(spans[1].split("·")[0]);
      }
    }
    if (!company && headline) {
      const at = headline.match(/\b(?:at|@)\s+([^|,·]+)/i);
      if (at) company = clean(at[1]);
    }
    return { url, name: name.slice(0, 120), headline: headline.slice(0, 200), company: company.slice(0, 120) };
  }
  root.phReadLinkedInProfile = readLinkedInProfile;
})(typeof globalThis !== "undefined" ? globalThis : this);
