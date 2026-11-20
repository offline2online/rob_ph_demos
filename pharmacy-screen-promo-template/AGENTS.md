# Agent instructions — Pharmacy Screen

For coding and deployment agents (Claude Code, Codex, Copilot agents, …) working in this folder. Read
[START-HERE.md](START-HERE.md) first; it is one page. `CLAUDE.md` points here.

## Rules (non-negotiable)

1. **Never log, print, commit or echo the PH API token**, and never ask a person to paste it into a chat, a
   ticket, a file, an environment variable or a command line. It is entered by an admin in Admin → Settings,
   stored envelope-encrypted, and decrypted only inside the proxy. If you need a working token for a test, use
   the local dev server (any token works against its mock Location API).
2. **No secrets in the front end.** `pharmacy-screen/` (screen and `admin/`) is published as public static
   files. `admin/config.js` holds only public, non-secret settings. The screen never receives the token: the
   proxy adds `x-api-key` itself.
3. **No secrets in the repo.** `.env.example` and `.env.<project>` files hold placeholders and non-secret
   settings only. Never add a real key, password, certificate or personal email address to any tracked file.
4. **Logs stay clean.** Server code logs device IDs, server URLs and status codes only, through
   `ph-proxy/src/safe-log.js`. Never log a request's `authorization` or `x-api-key` header, or a settings body.
5. **Keep docs in step with code.** A new or removed environment variable or query parameter must be added to or
   removed from [docs/CONFIGURATION.md](docs/CONFIGURATION.md) in the same change, or
   `pharmacy-screen/test/handover-docs.test.mjs` fails. Update the folder READMEs, the other `docs/` files and
   [CHANGELOG.md](CHANGELOG.md) when behaviour changes.
6. **Don't change the security model** (write-only token, KMS envelope, admin role on every write, public reads
   only of published screen configs and media) without saying so explicitly to a person.
7. **UI**: the admin editor follows the Personalisation Hub design system (Roboto, Material Symbols Outlined,
   content frame only, nothing `position: fixed`; it is iframed into HQ Admin).

## Repository layout

| Path | What |
|---|---|
| `pharmacy-screen/pharmacy-screen.html`, `js/`, `css/`, `sw.js` | The screen page (static ES modules, no build step) |
| `pharmacy-screen/admin/` | The admin editor (static, signs in with Firebase Auth or OIDC) |
| `pharmacy-screen/config-api/` | Config API: pharmacies, promotions, templates, services, published screen configs |
| `pharmacy-screen/ph-proxy/` | PH API settings (encrypted token) and the Location API proxy |
| `pharmacy-screen/seed/` | Launch data and the seed script |
| `pharmacy-screen/fixtures/` | Mock Location API data and mock config (`mockapi=1`, dev server, tests) |
| `aws/` | AWS adapters, Lambda entries, CDK stack, `deploy:aws` / `destroy:aws` / `seed:aws` |
| `scripts/deploy.mjs`, `firebase.json`, `.firebaserc` | Firebase deploy for our test environment |
| `docs/` | Handover docs: deployment, configuration, data contract, test checklist, user guide |
| `test/` | Deploy config checks and the deployed admin gate test |

Each folder has its own README with the detail.

## Run locally with mock data

No cloud, no PH, no install for the first two:

```bash
cd pharmacy-screen-promo-template/pharmacy-screen
npm run serve        # http://localhost:8080/pharmacy-screen.html?mockapi=1&device=TEST&promo=morning&orientation=portrait
node admin/tools/dev-server.mjs   # everything on one origin, in memory, seeded:
                                  # http://localhost:8790/admin/  (access token dev-admin; dev-viewer = non-admin)
```

With the dev server, save any token in Settings and open
`http://localhost:8790/pharmacy-screen.html?device=DEVICE-VIC-MP-001&promo=morning`: the real proxy and config API
answer from `fixtures/campaign-data.json`. Mock devices: `TEST`, `DEVICE-VIC-MP-001` … `005`,
`TEST-NO-SUBURB`, `TEST-LATE-NIGHT`. Add `&debug=1` for the debug panel and a test clock.

## Test

```bash
cd pharmacy-screen-promo-template
npm run check:all     # offline: deploy config, screen, config API, proxy, seed, handover docs (~1 min, no install)
npm run check:docs    # just the handover docs check
npm run check:aws     # AWS target (npm ci in aws/, then offline suites and the OIDC sign-in browser test)
cd pharmacy-screen && npm run test:ci   # units, copy-fit audit, end to end in Chromium (Playwright)
```

Browser tests need Playwright with Chromium (`npm install --no-save playwright@1.56.1 && npx playwright install
chromium` in `pharmacy-screen/`, or set `CHROMIUM_PATH`). The scripts are named `check*`, not `test`, at this
level on purpose (README → Tests).

## Deploy

- **AWS (the retailer's environment)**: `npm run deploy:aws -- --region <region> [options]`; plan first with
  `npm run plan:aws -- --region <region>`. Remove with `npm run destroy:aws`. See
  [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).
- **Firebase (our test environment)**: `npm run deploy` (`deploy:plan` to preview). Cloud Functions are only
  ever deployed by this command or CI.

Deploying needs cloud credentials a person gives you; never ask for or handle the PH API token to do it.

## Definition of done for a change

- Tests above pass, including the handover docs check.
- READMEs, `docs/` and `CHANGELOG.md` say what the code now does.
- No token, key or personal address in any file, log line or test output.
