# PH Agent Console: add LinkedIn contact (Chrome extension)

A toolbar button for Chrome. On a LinkedIn profile, one click reads the
person's name, headline, current company and profile URL from the page and
adds them to **Promote › Prospects (TAM) › Contacts** in the PH Agent Console,
matched to a TAM company where the company name matches one (otherwise
**Unmatched**). Clicking it again on the same profile updates that contact; it
never makes a second one (the LinkedIn profile URL is the contact's identity).

It is meant for one person's own Chrome (the account owner's), not for the team.

## Install (once)

1. Download this folder (`backlog-tracker/chrome-extension/`) from the
   repository, or use a clone of it.
2. In Chrome, open `chrome://extensions`, switch on **Developer mode** (top
   right) and click **Load unpacked**. Pick this folder.
3. Pin it: the puzzle-piece icon in the toolbar → the pin next to
   "PH Agent Console: add LinkedIn contact".
4. Sign in to the console (https://backlog-tracker-e4ed2.web.app/) in the
   same Chrome profile. A role that can edit Prospects (TAM) is needed.

After a change to these files, click the reload icon on the extension's card
in `chrome://extensions`.

## Use

1. Open someone's LinkedIn profile (`linkedin.com/in/…`) while signed in to
   LinkedIn.
2. Click the toolbar button. The console's Contacts tab is used in the
   background (an open console tab is reused, otherwise one is opened behind
   the current tab).
3. A note at the bottom right of the LinkedIn page, and a ✓ on the button,
   say "Added …" or "Updated …" with the company it was matched to. A red !
   says what went wrong (not a profile page, not signed in to the console,
   a view-only role); the console tab is brought forward when it needs you.

## What it does and doesn't do

- It reads only the page you are on, only when you click: no background
  activity, no scrolling, no opening other profiles, no bulk collection. It
  keeps within LinkedIn's terms by doing only what you could copy by hand.
- Permissions: `activeTab` (the LinkedIn tab you clicked on, for that click),
  `scripting` (to read it and to hand the result to the console) and the
  console's own two addresses. It holds no password, token or key: the
  console saves the contact with your own sign-in, so the console's normal
  permissions apply.
- Files: `manifest.json`; `background.js` (the click, finding or opening the
  console tab, handing over through `window.__phAddProspectContact`, defined
  by `public/js/prospects-page.js`); `linkedin-reader.js` (reads the page;
  tested in `test/linkedin-reader.test.mjs`).
- LinkedIn changes its page markup from time to time. If the name or company
  comes out wrong, the contact can be corrected in the Contacts tab, and the
  reader's selectors are in `linkedin-reader.js`.

See `backlog-tracker/REQUIREMENTS.md` → "Prospects (TAM): Contacts tab and the
LinkedIn extension".
