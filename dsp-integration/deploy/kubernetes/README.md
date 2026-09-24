# Running the exchange in a client's VPC on EKS

How the DSP Integration API runs inside a client's own AWS account, on
their EKS cluster, sized for 15,000 displays and the advertisers bidding
for slots on them (Rob, 24 Sep 2026). The measurements behind every number
here are in
[SCALE-15000-EKS.md](../../docs/dsp-integration/api/SCALE-15000-EKS.md);
where this build stops and the platform starts is in
[PH-CORE-BOUNDARIES.md](../../docs/dsp-integration/api/PH-CORE-BOUNDARIES.md).

**What this deploys is the POC as it is** — the stand-in session, SQLite,
creatives on a volume. It is a working exchange for a client's estate on
their own network; it is not the integration with PH Core, and the parts
that are POC stand-ins are called out below. Nothing in this folder deploys
from this repository: the client's platform team builds the image and
applies the manifests on their cluster.

## What is here

| Path | What it is |
|---|---|
| `Dockerfile` | Two-stage image: install and bundle with the workspace's toolchain, then Node and the bundle only, running as the unprivileged `node` user on a read-only filesystem. |
| `build.mjs` | The bundle: `dist/api.mjs` (the API), `dist/tick.mjs` (one pass of the scheduled work, for a CronJob) and both migration folders. Same bundling as the hosted Cloud Function. |
| `base/` | The deployment as it runs today: one API pod with the database on an EBS volume, a Service, two ingresses (public Partner API, internal Admin API), a network policy, a ConfigMap, an example Secret. `kubectl apply -k deploy/kubernetes/base`. |
| `optional/` | For a shared database (see *Scaling out*): an HPA, a PodDisruptionBudget and the scheduler as a CronJob. |

## Build the image

From the POC root (`dsp-integration/`):

```bash
docker build -f deploy/kubernetes/Dockerfile -t <registry>/dsp-exchange-api:<tag> .
docker push <registry>/dsp-exchange-api:<tag>
```

`deploy/kubernetes/.dockerignore` keeps `node_modules`, `data/` and the
built prototype out of the context. To check the bundle without Docker:

```bash
node deploy/kubernetes/build.mjs
NODE_ENV=production API_HOST=127.0.0.1 API_PORT=4700 PH_SCHEDULER=off DSP_INTEGRATION_ENABLED=true \
  PH_SECRETS_KEY=<base64 32 bytes> PARTNER_TOKENS='{"<token>":"p_google"}' \
  PH_DB_FILE=/tmp/dsp/poc.sqlite PH_ASSETS_DIR=/tmp/dsp/assets \
  PH_MIGRATIONS_DIRS=$PWD/deploy/kubernetes/dist/migrations/api/:$PWD/deploy/kubernetes/dist/migrations/approval/ \
  node deploy/kubernetes/dist/api.mjs
curl 127.0.0.1:4700/readyz
```

That is what was verified on 24 Sep 2026: the bundle starts, `/healthz`
and `/readyz` answer, a token from `PARTNER_TOKENS` is accepted and the
public POC tokens are refused (`NODE_ENV=production`), and SIGTERM closes
the database cleanly (no `-wal` file left). **The image itself was not
built here** — this sandbox has no Docker daemon — and the manifests were
parsed but not applied to a cluster. Build and apply on the client's
tooling before relying on either.

## Configure

Everything the API reads is an environment variable
(`apps/api/src/config.ts`); `base/configmap.yaml` holds the plain ones and
`base/secret.example.yaml` shows the two secrets.

| Variable | Set to |
|---|---|
| `DSP_INTEGRATION_ENABLED` | `true` — the whole build ships behind this flag. |
| `API_HOST` / `API_PORT` | `0.0.0.0` / `4000` (the image's defaults). The POC binds to `127.0.0.1` by default because its Admin API has no authentication of its own; in the cluster the internal ingress is what limits who reaches it. |
| `PH_PUBLIC_URL` | The Partner API's public origin: creative URLs are built on it. |
| `PH_SCHEDULER` | `in-process` while the database is the SQLite volume (one pod, so one scheduler). `off` once several replicas share a database, with `optional/scheduler-cronjob.yaml` running the tick. |
| `PH_DB_FILE`, `PH_ASSETS_DIR` | `/data/poc.sqlite`, `/data/assets` (the image's defaults) on the volume. |
| `PH_MIGRATIONS_DIRS` | Set by the image: the bundle finds its migrations there. |
| `PH_SECRETS_KEY` | Secret. 32 random bytes, base64: AES-256-GCM for DSP credentials at rest. Rotating it means re-entering every DSP's credentials. |
| `PARTNER_TOKENS` | Secret. JSON, token → partner id, one long random token per DSP. With `NODE_ENV=production` the API refuses to start with the public POC tokens. On integration the platform's own token issuance replaces this (PH-CORE-BOUNDARIES.md, *Partner identity*). |
| `PARTNER_RATE_PER_SECOND`, `PARTNER_RATE_BURST` | Per partner token, per pod: 50 and 100 by default. |
| `PH_MAX_UPLOADS_IN_FLIGHT` | Asset uploads held in memory at once across all partners (default 4). Memory sizing below depends on it. |
| `PH_AUCTION_CONCURRENCY` | Positions the auction clears at once (default 16). |
| `PH_RESERVATION_RETENTION_DAYS` | Rejected, lost and never-cleared bids are deleted this long after their window (default 90). Won and reserved windows are kept. |
| `DV360_BIDDER_URL`, `AMAZON_BIDDER_URL`, `TTD_BIDDER_URL`, the DSP API base URLs | The real DSP endpoints. They default to the mock DSP service, which is **not** deployed by these manifests; for a test cluster, deploy `apps/dsp-mocks` as a Service and point these at it. |
| `POC_ROLE` | `hq_admin`. POC stand-in for the HQ Admin session: every Admin API caller is this role until `SessionSource` is the platform's. This is why the Admin API only ever has an internal ingress. |

**Secrets never come from git.** Produce the `dsp-exchange-api` Secret with
External Secrets Operator from AWS Secrets Manager (or sealed secrets);
`secret.example.yaml` is the shape, deliberately left out of the
kustomization.

## Deploy

1. Replace in `base/`: the image (`deployment.yaml`), the certificate and
   WAF ARNs and the hostnames (`ingress.yaml`), the storage class
   (`pvc.yaml`), the VPC CIDR the ALBs sit in (`networkpolicy.yaml`), and
   the DSP endpoints (`configmap.yaml`).
2. Create the Secret (above).
3. `kubectl apply -k deploy/kubernetes/base`.
4. Wait for `/readyz`: the pod runs every migration on start and answers
   503 until it has, so the ALB never routes to it early.
5. Switch DSP integration on at DSP Integration → Exchange settings, set up
   the exchange and connect the DSPs, as on any instance.

A new image is `kubectl set image` (or a commit to the manifests): the
Deployment's `Recreate` strategy stops the old pod, releases the volume and
starts the new one — a few seconds of 503 from the ALB, while the SQLite
volume is the database.

## Sizing

The API is one Node thread; a pod is one CPU, and more CPU buys nothing.
On this sandbox's CPU, 32 concurrent clients, 15,000 displays (the review
of 24 Sep 2026 — three estate shapes, all 15,000 displays):

| Request | 600 types × 25 displays (2,408 positions) | 60 × 250 (248) | 15 × 1,000 (68) |
|---|---|---|---|
| A page of inventory | 582 req/s | 782 | 850 |
| One position | 2,377 | 2,557 | 2,588 |
| Availability, 7 days / a year | 2,240 / 672 | 2,347 / 704 | 2,187 / 704 |
| A forecast over 30 days | 1,323 | 1,355 | 1,387 |
| A bid placed (`POST /v1/reservations`) | 1,035 | 992 | 992 |
| Inventory filtered by status over a year | 96 | 384 | 502 |

So one pod serves roughly 1,000 bids or 600 inventory pages a second on
the largest shape, with the per-partner limiter at 50 requests/s meaning
twenty partners at their ceiling is about a pod's worth. Start with:

- **API pod:** 1 CPU, 1 GiB memory requested, 2 GiB limit. Memory is the
  process (~200 MB on the demo estate) plus uploads: each is held in
  memory up to the asset limit (200 MB) while its checks run, bounded by
  `PH_MAX_UPLOADS_IN_FLIGHT` (4 → up to 800 MB). Lower that, or raise the
  limit, rather than letting the pod be OOM-killed mid-upload.
- **The auction** is bounded by the DSPs' round trip, not the estate: 2,408
  positions with 3 DSPs is 4,807 bid requests, 12.7 s at an 80 ms round
  trip, 45 s at the 300 ms timeout, 16 positions at a time. It runs once
  per play window (once a day by default) inside the API pod
  (`in-process`) or the CronJob. `PH_AUCTION_CONCURRENCY=64` would clear
  the same estate in about 3 s at up to 500 requests/s per DSP.
- **Billing** runs with the auction: a window on 1,000 displays is 1.9
  million plays, counted in the database in 0.65 s (measured). With
  `PH_SCHEDULER=in-process` that half second is on the API's one thread,
  so the CronJob is the better home for it once there is a shared database.
- **Storage:** the database is a few MB per 100,000 bids and grows with the
  windows sold; bids that lost or were rejected are deleted after 90 days.
  Creatives dominate: size the volume for the creatives kept.

## Scaling out

The base runs **one replica**, and that is not a tuning choice: the
database is one SQLite file on a ReadWriteOnce volume. Everything else in
the API is stateless (the in-process caches expire within a second and are
safe across instances; one live winner per window and one auction per
window are enforced in the database — migrations 0021 and 0024), so the
path to N replicas is one change: **the database.**

- **Postgres (RDS)** — the SQL in every migration and repository is plain
  and Postgres-compatible, but the driver is `node:sqlite`, which is
  synchronous; the repositories, the domain code and the routes call it
  without awaiting. A Postgres adapter therefore means making the
  repository layer asynchronous (a contained change: every seam and
  repository is one file, and `apps/api/src/context.ts` is the only wiring
  point), and the unique indexes of 0021 and the `auction_runs` claim of
  0024 carry over unchanged. This is engineering's integration work, not a
  flag.
- **Creatives to S3** — `AssetStore` (`platform/AssetStore.ts`) is the one
  seam; the local folder is its stand-in. Until then the volume holds them.
- Then: `replicas: 2+`, `PH_SCHEDULER=off` on the API pods,
  `kubectl apply -k deploy/kubernetes/optional` for the HPA (CPU at 60%),
  the PodDisruptionBudget and the scheduler CronJob (one tick a minute:
  billing, the auction at its cutoff, retention). Which pod clears a window
  is settled in `auction_runs`, so a CronJob tick overlapping the previous
  one, or an API pod still running its own scheduler, never auctions a
  window twice.

Until then, one pod is also the honest capacity statement: the numbers
above are what a client's estate gets, and they cover a 15,000-display
estate with headroom.

## Security posture on EKS

What the review of 24 Sep 2026 checked, and where each control lives.

| Concern | Control |
|---|---|
| The Admin API has no authentication of its own in the POC (every caller is `hq_admin`). | It is only ever on the **internal** ALB (`ingress.yaml`), reachable from the VPC — where HQ Admin runs — and never from the internet. On integration the platform's session (`SessionSource`) authenticates it as well. |
| The Partner API is internet-facing. | Public ALB with TLS 1.3, a WAFv2 web ACL (managed core rules and a per-IP rate rule), bearer tokens compared as SHA-256 digests in constant time, the API's own per-partner limiter (per pod), writes only from a connected DSP, and every request bounded (1 MB JSON, 200 positions per forecast, 20 targeted versions, …). `/api/admin` has no route on this ALB. |
| An admin-typed DSP endpoint, or a creative URL in a bid, pointing the exchange at the VPC itself (SSRF: the EC2 metadata service at 169.254.169.254, a node, a pod, RDS). | Two locks. The API refuses a bidder endpoint whose host is a private, loopback, link-local, metadata or cluster-local address, or a single-label name (`domain/partnerInput.ts`; in the POC bid requests go to configured endpoints anyway). The network policy allows egress only to DNS and the internet on 443, never to RFC 1918 space, link-local or loopback. A DNS-aware policy (Cilium, Calico) can narrow that to the DSPs' hostnames. |
| Secrets. | The encryption key and partner tokens arrive as a Secret produced from AWS Secrets Manager; nothing is in git or the image. DSP credentials are AES-256-GCM at rest, never returned. The pod's service account mounts no token and has no AWS role. |
| The pod itself. | Restricted Pod Security Standard on the namespace: non-root, no privilege escalation, all capabilities dropped, read-only root filesystem, seccomp `RuntimeDefault`. Only `/data` and `/tmp` are writable. |
| Memory exhaustion by uploads. | Bounded per partner (2) and per process (`PH_MAX_UPLOADS_IN_FLIGHT`, 4); the pod's memory limit is set from it. |
| A pod that is up but not ready. | `/readyz` is 503 until the database answers and every migration is applied; the ALB and the Service only route to ready pods. |
| Two processes auctioning one window (duplicate bid requests to DSPs). | `auction_runs` (migration 0024): one claim per window, taken over only if left unfinished for 15 minutes. |
| Data growth from bids. | Rejected, lost and never-cleared bids deleted after `PH_RESERVATION_RETENTION_DAYS`. |
| Backups. | The database is one file on EBS: snapshot the volume. Restoring it restores the exchange, including bids and bookings. |

## Operations

- **Logs** go to stdout as JSON (Fastify's logger); the authorization
  header and credential fields are redacted.
- **Start-up** runs every pending migration, then seeds an empty database
  with the sample data (a real instance is switched off until an admin
  enables DSP integration).
- **Shutdown** on SIGTERM: stop accepting, finish in-flight requests, stop
  the schedulers, checkpoint and close the database (`index.ts`);
  `terminationGracePeriodSeconds` is 30.
- **Probes:** `/healthz` (liveness) and `/readyz` (readiness and start-up).
- **Scheduled work:** every minute, in-process or as the CronJob — billing
  the windows that have ended, the auction for any window whose cutoff has
  just passed, the bid and rejected-campaign retention sweeps. `npm run
  scheduler:tick` (`node tick.mjs` in the image) is one pass.
