# PH API settings and Location API proxy (`ph-proxy/`)

Server side of the Pharmacy Screen Promo Template's security model (concept
README → "Security"; requirements 4–8). Screens never hold the Personalisation
Hub API token: an admin saves it once in Settings, it is envelope-encrypted at
rest, and this proxy decrypts it in memory to call the Location API for each
screen.

One Cloud Function (2nd gen), `pharmacyScreenPhApi`, serves:

| Method | Path | Who | What |
|---|---|---|---|
| `GET` | `/api/settings/ph-api` | admin | Base URLs and `token: {set, last4, setAt, setBy}`. The token itself is never returned. |
| `PUT` | `/api/settings/ph-api` | admin | Body `{baseUrls?: string[], token?: string}`. A `token` sets or replaces it; leaving it out keeps the current one. |
| `DELETE` | `/api/settings/ph-api/token` | admin | Removes the token. |
| `GET` | `/api/device/{UniqueDeviceID}/campaign_data` | screens (public) | Calls `{baseUrl}/location-api/device/{udid}/campaign_data` with `x-api-key` and returns only the fields the screen uses. |

"Admin" is the Firebase ID token's custom claim named by `PH_ADMIN_CLAIM`
(default `admin`), sent as `Authorization: Bearer <ID token>`. Every save,
replace and remove is written to the audit log with the actor's uid and the
token's last 4 characters only.

## Files

| File | What it does |
|---|---|
| `index.js` | Cloud Functions entry point: wires Firestore, Firebase Auth and Cloud KMS into the API. |
| `src/create-api.js` | Builds the API from configuration and adapters (used by `index.js` and the tests). |
| `src/http.js` | Routes, admin gate, CORS, error shape. Framework-free: `handle({method, path, headers, body, ip}) → {status, headers, body}`, so an AWS Lambda handler can reuse it. |
| `src/settings-service.js` | Save / replace / remove, validation, audit entries, and the proxy's short cache of decrypted credentials. |
| `src/location-proxy.js` | Device-id check, per-device cache, one upstream call in flight per device, rate limits on cache misses, server failover, response trimming. |
| `src/client-ip.js` | The client address the per-client rate limit uses (trusted end of `X-Forwarded-For`, never `req.ip`). |
| `src/secret-store.js` | Secret-store adapter: AES-256-GCM envelope encryption with the data key wrapped by a KMS provider (`gcp-kms`; `local` for emulators/tests only). |
| `src/stores.js` | Settings-store and audit-log adapters (Firestore; in-memory for tests). |
| `src/auth.js` | Auth adapter (Firebase ID token + admin custom claim). |
| `src/safe-log.js` | Logger that redacts every token it has seen and drops `x-api-key` / `authorization` values. |
| `test/ph-proxy.test.js` | Offline tests (no network, Firebase or KMS). |
| `.env.example` | Every setting, placeholders only. |

## How the token is protected

- **Write-only.** `PUT` accepts it; nothing returns it. `GET` shows `set` and the last 4 characters.
- **Envelope encryption.** A fresh 256-bit data key encrypts the token (AES-256-GCM, authenticated with the context string `pharmacy-screen:ph-api-token:v1`). Cloud KMS wraps that data key; KMS never sees the token. The `local` provider (wrapping key in an environment variable) is for emulators and tests only and is always refused on Cloud Functions/Run, with no override. The settings document holds only `{ciphertext, iv, tag, wrappedKey, keyId, keyVersion}` plus `last4`.
- **Decrypted only in the proxy function**, in memory, and cached there for at most `PH_PROXY_CACHE_SECONDS`.
- **Server-only storage.** `pharmacyScreen/private/**` is never readable or writable by clients; the repo root `firestore.rules` already denies every path it does not list, and the deployment rules must keep it that way.
- **Never logged.** Code here logs device ids, server URLs and status codes only, and every log line passes through `safe-log.js`.
- **Never in the repo, a ticket or the front end.** The admin types it into Settings after deploy.

## Rotation (no redeploy)

Save the new token in Settings (`PUT` with `token`). Every proxy instance picks
it up within `PH_PROXY_CACHE_SECONDS` (default 15 s) because the settings
document's `version` changes; an instance whose cached token is refused by PH
(401/403 on every server) re-reads the settings on its next call. Screens keep
calling the same proxy URL, so nothing on a screen changes. Rotating the Cloud
KMS key itself needs nothing here: KMS decrypts with whichever key version
wrapped the data key.

## Proxy behaviour

- **Device id**: `[A-Za-z0-9._:-]`, 1–128 characters; an unswapped `${UniqueDeviceID}` is rejected. Bad id → `400 INVALID_DEVICE_ID` ("Invalid screen URL"), and PH is not called.
- **Failover**: tries the base URL that last answered first, then the rest in saved order, one request at a time, each with a `PH_PROXY_TIMEOUT_MS` timeout.
- **Cache**: a per-device result (including "not found") is reused for `PH_PROXY_CACHE_SECONDS`; concurrent requests for one device share one upstream call. Cache hits and requests that join an in-flight call are never rate limited, so nobody can lock a screen out by sending requests for its device id.
- **Rate limits** count only cache misses (requests that would call PH), per function instance, per minute: `PH_RATE_LIMIT_PER_IP_PER_MIN` (default 600) per client address, `PH_RATE_LIMIT_PER_DEVICE_PER_MIN` (default 12; a screen polls twice a minute and misses at most every 15 s) and `PH_UPSTREAM_CALLS_PER_MIN` (default 1200) for the whole instance, which bounds calls to PH even if a caller rotates addresses. When a limit trips, the last good answer for that device (up to `PH_PROXY_STALE_SECONDS`, default 600) is returned with `meta.stale: true`; with none, `429 RATE_LIMITED` with `Retry-After`.
- **Client address**: taken from the right-hand end of `X-Forwarded-For`, the entries our own platform appends, never from Express's `req.ip` (the Functions Framework enables "trust proxy", so `req.ip` is the leftmost, caller-written entry). `PH_TRUSTED_PROXY_HOPS` (default 1) is how many entries from the right are ours: 1 uses the address Google's front end saw. After the first deploy behind Firebase Hosting, check one real request's `X-Forwarded-For`; if its rightmost entry is the same proxy address for every caller, set it to 2. Anything to the left of the trusted entries is ignored.
- **Response** `200`:
  ```json
  { "ok": true,
    "data": {
      "store_location": { "store_code": "VIC-MP-001", "store_name": "…", "store_timezone": "Australia/Melbourne" },
      "store_info": {
        "opening_hours": [ { "open_day": "MONDAY", "open_time": "08:30:00", "close_day": "MONDAY", "close_time": "19:00:00", "is_active": true } ],
        "address_info": { "suburb": "…", "address": "…", "postcode": "…", "state": "…", "phone_number": "…" },
        "logo_url": null } },
    "meta": { "server": "https://ph.mipharmacy.net", "fetchedAt": "…", "cached": false } }
  ```
  `logo_url` is filled once the Location API returns a store logo (PH-181): the first https or `data:image/…` value of `store_info.logo_url | logo | store_logo`, `store_location.logo_url | logo | store_logo`, or `data.logo_url | logo`. The screen reads it from `data.store_info.logo_url` (`../js/render.js` `storeModel`) and falls back to the config logo.

### Error codes

All errors are `{ "ok": false, "error": { "code", "message" } }`.

| Status | Code | Meaning |
|---|---|---|
| 400 | `INVALID_DEVICE_ID` | Missing or malformed device id ("Invalid screen URL"). |
| 400 | `INVALID_BASE_URL` / `INVALID_TOKEN` / `INVALID_BODY` | Settings input rejected. Base URLs must be https (http only for localhost), at most 5, no credentials/query. Tokens are 8–4096 characters with no spaces. |
| 401 | `UNAUTHENTICATED` | Settings call without a valid sign-in. |
| 403 | `FORBIDDEN` | Signed in without the admin claim. |
| 404 | `DEVICE_NOT_FOUND` | PH does not map this device to a store ("Screen not set up"). |
| 429 | `RATE_LIMITED` | A cache miss over a rate limit with no recent good answer to fall back on; see `Retry-After`. |
| 502 | `UPSTREAM_AUTH_FAILED` | Every PH server refused the saved token: replace it in Settings. |
| 502 | `UPSTREAM_UNAVAILABLE` | No PH server answered. The screen keeps its last good data. |
| 503 | `NOT_CONFIGURED` | No token saved yet. |
| 503 | `SECRET_STORE_NOT_CONFIGURED` | `PH_SECRET_STORE` / `PH_TOKEN_KMS_KEY` not set; a token cannot be saved. |
| 503 | `TOKEN_UNREADABLE` | The stored token could not be decrypted (wrong key, or the document was altered): save it again. |

## Configuration

See `.env.example` for every setting the code reads (`PH_REGION`, the secret store, base URL, admin claim, CORS, Firestore paths, cache, stale window, rate limits and `PH_TRUSTED_PROXY_HOPS`). Defaults: base URL `https://ph.mipharmacy.net`
until an admin saves a list; Firestore `pharmacyScreen/private/settings/phApi`
and `pharmacyScreen/private/auditLog`.

## Deploying to our test environment (Firebase `rob-ph-demos`)

`npm run deploy` in `pharmacy-screen-promo-template/` does all of it (that
folder's README has the URLs and the first-deploy steps):

1. **KMS key** (once, idempotent): key ring `pharmacy-screen`, key `ph-api-token`
   (`global`, 90-day rotation), and `roles/cloudkms.cryptoKeyEncrypterDecrypter`
   on that key only for the functions' runtime service account (the default
   compute service account).
2. **Functions codebase** `pharmacy-screen-ph-proxy` (this folder), with the
   non-secret settings in `.env.rob-ph-demos`, including
   `PH_TOKEN_KMS_KEY=projects/rob-ph-demos/locations/global/keyRings/pharmacy-screen/cryptoKeys/ph-api-token`
   and `PH_API_DEFAULT_BASE_URL=https://ph.mipharmacy.net`.
3. **Hosting rewrites** on the pharmacy-screen site, with no broader `/api/**` rule:
   `/api/settings/ph-api`, `/api/settings/ph-api/**` and `/api/device/**` to `pharmacyScreenPhApi`.
4. **Admin claim**: `config-api/scripts/set-admin-claim.js` gives an account the `admin` claim.
5. After the first deploy, the account owner enters the token in Admin → Settings.

For miPharmacy's AWS environment, implement a KMS provider over AWS KMS (or
Secrets Manager) with the four members documented at the top of
`src/secret-store.js`, plus a DynamoDB settings store / audit log and an OIDC
auth adapter with the shapes in `src/stores.js` and `src/auth.js`; `src/http.js`
is reused unchanged.

## Tests

```bash
cd pharmacy-screen-promo-template/pharmacy-screen/ph-proxy
npm test        # node:test, offline, no npm install needed
```
