# visitor-profile

Managing personalisation attributes in Personalisation Hub, and the source
systems that populate them — **System One (The Attribute Layer)** from the
*Real-Time Personalised Surface Architecture Specification v1.2*.

Split out as its own independently-managed project, following the same
pattern as `menu-board-demo/`: developed on its own feature branch(es),
merged to `main` on its own schedule, not tied to
`dsp-integration/`'s release cadence. See root `CLAUDE.md` →
"Live Visitor Profile and Display Types & DSP Integration" for the full
split rationale.

See [`REQUIREMENTS.md`](./REQUIREMENTS.md) for the actual functional spec.
The only implementation so far is the clickable concept prototype in
[`prototype/`](./prototype/index.html) (below). See
[`../shared/interface-contract.md`](../shared/interface-contract.md) for the
maintained boundary with `dsp-integration/`.

Tracked on the Prototype Backlog board as **"Live Visitor Profile & Personas"** (see
root `CLAUDE.md` → "Prototype Backlog") — that project's own Docs page
carries a live, board-native copy of `REQUIREMENTS.md`'s content
(`requirementsMd` field) and the interface contract (as an `interfaces`
collection record) — keep the repo files and those live records in sync.

The board's `requirementsMd` for this project is in sync with
`REQUIREMENTS.md` (spot-checked 1 Oct 2026), and the board's interface
record (`EIIhnzWmieAnEyXffudb`) carries contract v3 — see
[`../shared/interface-contract.md`](../shared/interface-contract.md).

## `prototype/` — clickable concept prototype

`prototype/index.html` is one self-contained static page (no build step),
published at <https://offline2online.github.io/rob_ph_demos/visitor-profile/prototype/>.
It is the content frame only, sized to be iframed into HQ Admin, and uses
in-memory sample data — nothing is saved or sent anywhere. It covers:

- **Attributes** — schema browser across the three families (writability,
  volatility, winning source, populated/blank) and, for inbound attributes,
  the per-field precedence editor (reorder, enable, `max_age_s`,
  `min_confidence`, volatility, default). `Age`/`gender` is the confidence
  example and `purchase_intent` the precedence-inversion example. A sample
  visitor toggle (known customer / anonymous prospect) changes which
  sources have data. Includes **Add custom attribute**.
- **Connectors** — built-in and configured lists, an add/edit form, and a
  sample-response → attribute mapping suggester.
- **Resolution timing** — first-paint budget and slot playback duration,
  with a per-slot deadline preview against connector latency.
- **Health & diagnostics** — p50/p95, error rate and last successful call.
