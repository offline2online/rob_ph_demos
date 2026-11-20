# CLAUDE.md — Pharmacy Screen

Instructions for Claude Code in this folder. **[AGENTS.md](AGENTS.md) is the full version and wins**; this
is the short form. Start with [START-HERE.md](START-HERE.md).

## Rules

- **Never log, print, commit or echo the PH API token**, and never ask anyone to paste it into a chat, file,
  ticket, env var or command. An admin enters it in Admin → Settings; it is stored envelope-encrypted and only
  the proxy decrypts it.
- **No secrets in the front end** (`pharmacy-screen/` and `admin/` are public static files) and **none in the
  repo** (`.env.example` and `.env.<project>` hold placeholders and non-secret settings only; no personal email
  addresses either).
- **Docs move with the code**: an env var or query parameter added or removed must be added to or removed from
  [docs/CONFIGURATION.md](docs/CONFIGURATION.md) in the same change (`npm run check:docs` fails otherwise).
  Update READMEs, `docs/` and [CHANGELOG.md](CHANGELOG.md) for any behaviour change.
- UI changes follow the Personalisation Hub design system (`ph-designer` skill where available): Roboto,
  Material Symbols Outlined, content frame only, nothing `position: fixed`.

## Commands

```bash
cd pharmacy-screen-promo-template
npm run check:all                       # offline tests, no install
cd pharmacy-screen && npm run serve     # screen on mock data: /pharmacy-screen.html?mockapi=1&device=TEST&promo=morning
node pharmacy-screen/admin/tools/dev-server.mjs   # editor + APIs in memory: http://localhost:8790/admin/ (token dev-admin)
npm run deploy:aws -- --region <region> # AWS install (docs/DEPLOYMENT.md); npm run plan:aws to preview
npm run deploy                          # Firebase test environment (our own)
```

Layout, tests and the definition of done: [AGENTS.md](AGENTS.md).
