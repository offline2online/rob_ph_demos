# Start here — Pharmacy Screen

**What it is.** One templated web page that plays on in-store pharmacy screens as a Personalisation Hub (PH)
campaign URL, an admin editor for pharmacies, promotions and templates, and two small back ends: a config API
and a proxy that holds the PH API token and calls PH's Location API. Each screen finds its own store from its
PH device ID; the URL never carries a store code.

**What you need.** Node 20+, AWS credentials for the target account, about 20 minutes. Optional: a domain with
an ACM certificate in us-east-1, a VPC, your own OIDC identity provider.

## Deploy it (AWS)

From a release package (the Shared Drive's `v<version>` folder), check the download, then unzip it:

```bash
sha256sum -c pharmacy-screen-v<version>.zip.sha256           # macOS: shasum -a 256 -c …
unzip pharmacy-screen-v<version>.zip && cd pharmacy-screen-v<version>
```

From the repository instead: `git clone <this repository> && cd <repository>/pharmacy-screen-promo-template`.
Then, in that folder:

```bash
npm run check:all                                            # offline tests, ~1 minute
npm run deploy:aws -- --region ap-southeast-2 --admin-email <your sign-in address>
```

Then:

1. Open the printed **Admin** URL, sign in (Cognito emails a temporary password).
2. Admin → **Settings**: PH API base URL (default `https://ph.mipharmacy.net`) and the PH API token. The token
   is write-only and stored KMS-encrypted; never put it in a file.
3. `npm run seed:aws -- --region ap-southeast-2` loads the five launch pharmacies, four promotions and the
   service library.
4. In PH, register each screen to its store and set the campaign's Experience URL to the printed **Campaign**
   URL (`…/pharmacy-screen.html?device=${UniqueDeviceID}&promo=morning&orientation=portrait`), with the playback
   duration the editor shows.
5. Work through [docs/TEST-CHECKLIST.md](docs/TEST-CHECKLIST.md).

Try it with no PH at all: the printed **Screen** URL (`…&mockapi=1`) plays from mock data.
Remove it: `npm run destroy:aws -- --region ap-southeast-2`.

## Read next

| If you are… | Read |
|---|---|
| Deploying, upgrading, rolling back or removing it | [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) |
| Looking up a setting, env var or URL parameter | [docs/CONFIGURATION.md](docs/CONFIGURATION.md), [.env.example](.env.example) |
| Integrating with PH, or debugging a screen | [docs/DATA-CONTRACT.md](docs/DATA-CONTRACT.md) |
| Signing it off | [docs/TEST-CHECKLIST.md](docs/TEST-CHECKLIST.md) |
| Setting up pharmacies and content | [docs/USER-GUIDE.md](docs/USER-GUIDE.md) |
| An AI agent working on this repo | [AGENTS.md](AGENTS.md) |
| Checking what changed | [CHANGELOG.md](CHANGELOG.md), and in a package `RELEASE-NOTES.md` |
| Packaging a release for the Shared Drive | [docs/RELEASING.md](docs/RELEASING.md) |
| Looking for the full picture | [README.md](README.md) |

**Two rules.** Never log, commit or paste the PH API token. Never put a secret in the front end (the screen and
editor are public static files).
