# space-invaders

Personalisation Hub's **Connected Gaming** prototype — a customer plays
Space Invaders on a portrait digital signage display using their own phone
as the controller, connected over WebSocket via a QR code scan.

- `space-invaders-display.html` — the PWA player that runs on the
  in-store portrait signage: shows an idle demo + QR code, then the live
  game once a phone connects.
- `space-invaders-mobile.html` — the mobile controller loaded on the
  customer's phone after scanning the QR code.
- `space-invaders-ended.html` — the redirect target when a game session
  ends.
- `session-server.js` (+ `package.json`) — the Node/WebSocket session
  server (`ph-space-invaders-session-server`) that pairs a display and a
  phone into one session and relays game state/input between them.
- `railway.json` — deploy config for hosting `session-server.js` on
  Railway (the only piece of this project that isn't a static GitHub
  Pages file — it needs a real always-on WebSocket server).

See [`PH-Platform-Setup.md`](./PH-Platform-Setup.md) for the actual
functional spec: the 4 URLs to configure in the PH platform, QR code
parameters, and the full WebSocket session flow.

Not yet tracked as its own project on the Prototype Backlog board
(`backlog-tracker/` — see root `CLAUDE.md` → "Prototype Backlog"); add one
there if/when this project starts taking its own backlog items.
