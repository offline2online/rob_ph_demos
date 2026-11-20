# Changelog

All notable changes to the Pharmacy Screen. Versions follow [Semantic Versioning](https://semver.org/); each
release handed to miPharmacy is tagged and packaged with this file and the `docs/` folder. Newest first.

## [Unreleased]

Nothing yet. Add changes here; at release time this section becomes `## [x.y.z] — <date>`
([docs/RELEASING.md](docs/RELEASING.md)).

## [0.1.0] — first handover candidate

Tested in our environment (Firebase `rob-ph-demos`); not yet shared with miPharmacy.

### Added

- **Release package** (`npm run release`): a versioned zip for the Google Shared Drive
  (`pharmacy-screen-v<version>.zip`, with a `.sha256` checksum, `START-HERE.md` and `RELEASE-NOTES.md` beside it)
  and a git tag `pharmacy-screen-v<version>`. Built from the commit, never the working tree; carries the built
  screen and admin front ends, back end, AWS infrastructure, seed and mock data, `docs/` and the agent files;
  refuses to package a token, key, `.env` file, personal address or any pharmacy beyond the five launch pharmacies.
  `npm run release:verify -- <zip>` checks a downloaded package the same way. See
  [docs/RELEASING.md](docs/RELEASING.md).
- **Handover package**: [START-HERE.md](START-HERE.md), [AGENTS.md](AGENTS.md) and [CLAUDE.md](CLAUDE.md),
  [.env.example](.env.example), and `docs/`: [DEPLOYMENT.md](docs/DEPLOYMENT.md),
  [CONFIGURATION.md](docs/CONFIGURATION.md), [DATA-CONTRACT.md](docs/DATA-CONTRACT.md),
  [TEST-CHECKLIST.md](docs/TEST-CHECKLIST.md), [USER-GUIDE.md](docs/USER-GUIDE.md). A check
  (`npm run check:docs`, also in `check:all` and the train's tests) fails when an environment variable or query
  parameter is in the code but not in CONFIGURATION.md, or the other way round.
- **AWS deployment** for the retailer's own account (`aws/`): CloudFront + S3, API Gateway + two Lambda
  functions (optionally in a VPC), DynamoDB, an S3 media bucket, a KMS key wrapping the PH API token's data key,
  Cognito or your own OIDC provider for admin sign-in. One command each: `npm run deploy:aws`,
  `npm run destroy:aws`, `npm run seed:aws`.
- **Occasions promotion** (`promo=occasions`): Christmas, New Year's, Australia Day, Valentine's Day, Easter and
  Anzac Day, chosen in the editor's Occasion drop-down.
- **Screen kept on the player** (`sw.js`): starts from the device's own copy, also offline, and downloads again
  only when a deploy changed it.
- **Admin editor** on the config API: pharmacies, branding and logo, shared promotions, the 28-service library,
  scenes and timings, the "Open today" bar, templates (clone, HTML with `${…}` tokens, CSS, backgrounds),
  PH API Settings, live preview, Copy experience URL and playback duration; laid out for the PH frame.
- **Live store data** by device through the back-end proxy (Location API), config by store code, 30 s / 60 s
  polling, server failover, last good result kept, on-screen error states.
- **PH API token** set in Settings, write-only (last 4 shown), KMS envelope-encrypted, decrypted only in the
  proxy, audit-logged, rotation without redeploying screens.
- **Config API and store** with unique store codes and promo IDs, optimistic concurrency, audit log, and a
  public published config with no secrets.
- **Seed data**: five launch pharmacies (VIC-MP-001 to 005), the default promotions, built-in templates and the
  service library; mock Location API data for local runs and tests.
- **Tests**: opening hours and time zones, tokens, live data and failover, copy-fit audit across every pharmacy,
  promotion, scene, orientation and bar state, end to end through the real proxy and config API, security, the
  AWS stack.
- **One-command deploy** to our Firebase test environment, with CI.

### Fixed

- **Editor preview on tablets**: the preview column now scrolls up with the page until the Portrait/Landscape
  tabs lock to the very top, and the preview screen is sized to the visible height, so the bottom of the preview
  (scene bar, Play/Pause, Copy experience URL) is no longer cut off on a tablet.

### Notes

- Service library copy needs TGA advertising review before go-live.
- The store logo comes from the Location API once PH returns it (PH-181); until then the editor's upload is used.
