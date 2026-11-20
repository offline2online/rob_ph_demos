# Releasing

How a version of the Pharmacy Screen is packaged and handed to miPharmacy through the Google Shared Drive. If you
received a package, you only need [../START-HERE.md](../START-HERE.md) and, to check the download, "Check a
package" below.

## What a release is

One command, `npm run release`, run in a clean checkout of the commit to ship, makes:

| File (in `release/v<version>/`) | What |
|---|---|
| `pharmacy-screen-v<version>.zip` | The package: one folder, `pharmacy-screen-v<version>/`, holding everything below |
| `pharmacy-screen-v<version>.zip.sha256` | Its SHA-256, in `sha256sum` format |
| `START-HERE.md` | The one-page quick start, also inside the zip |
| `RELEASE-NOTES.md` | This version's notes, also inside the zip |

and an annotated git tag `pharmacy-screen-v<version>` on the commit (local; push it yourself).

Inside the zip:

| Path | What |
|---|---|
| `START-HERE.md`, `README.md`, `RELEASE-NOTES.md`, `CHANGELOG.md` | Quick start, overview, this version's notes, every version's changes |
| `docs/` | The whole folder: deployment, configuration, data contract, test checklist, user guide, this file |
| `AGENTS.md`, `CLAUDE.md`, `.env.example` | Agent instructions; every setting with placeholders only |
| `pharmacy-screen/` | Screen and admin editor (source), config API and PH API proxy (back end), `seed/` (the five launch pharmacies, promotions, service library) and `fixtures/` (mock Location API data) |
| `aws/` | The AWS target: CDK stack, Lambda entries, adapters, deploy, destroy and seed scripts, lockfile |
| `dist/web/` | The built screen and admin front ends: exactly the files a deploy publishes, `sw.js` stamped with this build. `npm run deploy:aws` builds them again from source, so this copy is for review or another static host |
| `scripts/`, `firebase.json`, `.firebaserc`, `firestore.indexes.json`, `ci/` | Our Firebase test environment's deploy, for reference (the AWS deploy reuses `scripts/deploy.mjs`) |
| `test/` and each folder's `test/` | The offline checks; `npm run check:all` passes inside the unzipped package |

What is never in it, and is checked on every build:

- Files that are not committed. The package is read from the commit with git, so a local `.env`, a key, an
  untracked file, `node_modules` or a staged deploy cannot reach it. Uncommitted changes are reported and left out.
- `.env` files of any kind except `.env.example`. Our test environment's `.env.rob-ph-demos` files (non-secret
  settings for our Firebase project) are left out, and the checks that read them are skipped in a package.
- Tokens, keys and credentials: private keys, AWS, Google, GitHub, Slack and Stripe key shapes, JSON web tokens,
  an `x-api-key` with a value, key and certificate files, credentials files. The PH API token never exists in a
  file at all: an admin enters it in Admin → Settings after installing.
- Personal email addresses (only reserved example and fixture domains pass).
- Customer data beyond the five launch pharmacies (VIC-MP-001 to VIC-MP-005): the seed may hold only those.

If the scan finds anything, nothing is written and nothing is tagged; the script lists each file and line (never
the value) and exits 1.

The zip is reproducible: every entry carries the commit's time, so building the same commit again gives the same
bytes and the same checksum.

## Cut a release

Needs Node 20+ and git. No install, no network.

1. In [../CHANGELOG.md](../CHANGELOG.md), turn `## [Unreleased]` into `## [<version>] — <date>` (keep an empty
   `## [Unreleased]` above it), and set `"version"` in [../package.json](../package.json) to the same number.
   Versions follow semantic versioning: a patch for fixes, a minor version for new behaviour, a major version when
   an upgrade needs miPharmacy to do more than run `deploy:aws` again.
2. Merge that to `main` (through the train like any other change), then on a clean checkout of `main`:

   ```bash
   cd pharmacy-screen-promo-template
   npm run check:all
   npm run release -- --dry-run      # builds and scans in a temporary folder; writes nothing
   npm run release                   # writes release/v<version>/ and tags the commit
   git push origin pharmacy-screen-v<version>
   ```

   `--version x.y.z` overrides `package.json`; `--out <dir>` writes somewhere other than `release/` (which git
   ignores); `--no-tag` skips the tag. A tag that already exists on another commit stops the release: bump the
   version instead of moving a tag miPharmacy may already have.
3. Check what you are about to share, exactly as miPharmacy will:

   ```bash
   npm run release:verify -- release/v<version>/pharmacy-screen-v<version>.zip
   ```

   then unzip it into an empty folder, `npm run check:all` there, and follow its `START-HERE.md` into a test AWS
   account if the release changed the install.

## Share it

The Shared Drive folder for miPharmacy holds one subfolder per version, named `v<version>` (for example `v0.1.0`).
Each holds the four files from `release/v<version>/`: the zip, its `.sha256`, `START-HERE.md` and
`RELEASE-NOTES.md`. Never replace the files of a version that has been shared; release a new version instead.

Upload them with the Google Drive connector from a Claude session, or by hand in Drive:

1. In the shared folder, create the subfolder `v<version>` (stop if it exists already).
2. Upload the four files into it, keeping their names.
3. Check the uploaded zip's size matches `release/v<version>/`, and tell miPharmacy the version is there, quoting
   the release notes' "What changed".

## Check a package

In the folder holding the zip and its `.sha256`:

```bash
sha256sum -c pharmacy-screen-v<version>.zip.sha256      # macOS: shasum -a 256 -c …
```

After unzipping, `npm run release:verify -- <path to the zip>` from inside the package repeats the full check:
the checksum, one top folder, every required handover file present, and the scan above.
