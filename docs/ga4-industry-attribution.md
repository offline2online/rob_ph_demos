# GA4 industry audiences and attribution (personalisationhub.com)

Set up 9 Nov 2026. GA4 property `properties/473743482` ("personalisationhub.com", account 341859694),
web stream `10164713901`, measurement ID `G-LBEF15GKVQ`. The site has no Google Tag Manager: Site Kit loads
the Google tag `GT-WPDXCSKF`, which routes to `G-LBEF15GKVQ`. Property changes were made with the Admin API
(v1beta for dimensions, key events and the Ads link; v1alpha for audiences) as the service account
`ph-analytics-agent@ph-analytics-514122.iam.gserviceaccount.com`. Its JSON key lives outside git
(gitignored in the main checkout as `ph-analytics-*.json`) and must never be committed: this repo is public.

## How the data flows

| Piece | Where | What it does |
| --- | --- | --- |
| Page tagging and key events | WordPress snippet **PH GA4** (10733), `ph-website/snippets/ph-ga4/` | Sets `industry` and `content_type` on every event (page_view too), sets the `industry_interest` user property on industry pages, and fires the six website key events |
| client_id on every lead | same snippet, server side | The three lead routes read the GA4 client_id and session_id from the `_ga` cookies, store them on the `ph_lead` post and send them to the console's `leadIngest` |
| Lead store | console `functions/lead-ingest.js` | Keeps them on `leads/{id}.gaClientIds` (newest last, 10 max, never for test leads) |
| Offline ACE events | console `functions/ace-ga4.js`, HTTP function `aceToGa4`, called hourly by `.github/workflows/ace-ga4.yml` with the board key (no Cloud Scheduler: the console project has none on purpose) | Matches each lead to its ACE opportunity and sends `ace_opportunity_*` to GA4 by Measurement Protocol, once each, keyed on the newest client_id |

## Custom dimensions

| Parameter | Scope | Source |
| --- | --- | --- |
| `industry` | event | `/industries/<slug>/` slug on every page_view (`none` elsewhere); key events off an industry page carry the last industry viewed |
| `industry_interest` | user | The last industry page viewed |
| `content_type` | event | industry page, blog, product tour, pricing, other |
| `lead_source` | event | `industry-<slug>`, `telco-business-model`, `interactive-product-tour`, `calendly`, `aws-marketplace` |
| `ace_stage` | event | qualified, launched, won (offline only) |
| `company_name` | event | Offline ACE events only. Never sent from the browser |

## Key events

Website: `industry_page_engaged` (30 s visible or 75% scroll, counted once per session), `product_tour_start`
and `product_tour_complete` (both once per session), `demo_request` (a Calendly booking, counted once per event),
`private_offer_request` (once per event), `lead_created` (once per session).
Offline: `ace_opportunity_qualified`, `ace_opportunity_launched`, `ace_opportunity_won` (each once per event).
The property already had `purchase`, which was left as it was.

**Milestone rules:** *qualified* means the ACE stage reached Qualified or any later stage. *launched* means the
ACE stage is Launched. *won* means the console lead is Closed Won, because ACE has no "won" stage of its own.
Matching a lead to an opportunity checks, in order: `leads/{id}.aceOpportunityId`, the AWS account id, the
website domain, then the company name.

## Audiences (90-day membership, ads personalisation on)

For each of the nine industries (banking, convenience, fashion, grocery, hospitality, pharmacy, qsr,
retail-media, telco):

- **"Industry: \<Name\>"**: a `page_view` with `industry` = the slug
- **"\<Name\> tour engaged"**: a `product_tour_start` with `industry` = the slug

That makes 18 audiences, ids `16299555316` to `16300104318` (list them with the Admin API, or in GA4 Admin → Audiences).

## Attribution and Google Ads

- The reporting attribution model was already `PAID_AND_ORGANIC_CHANNELS_DATA_DRIVEN`. Lookback windows are
  30 days for acquisition and 90 days for other events. Nothing was changed.
- Google Ads link `14419676260` (customer 2513533439) had ads personalisation off, which stops audiences reaching
  Ads. It was switched on 9 Nov 2026. Consent Mode still applies: visitors in the EEA, UK and CH who don't grant
  `ad_personalization` are not added.

## Secrets

- The Measurement Protocol API secret is GitHub Actions secret `GA4_MP_API_SECRET`. `deploy-backlog-tracker.yml`
  syncs it into Secret Manager, and only `aceToGa4` reads it. It never goes to WordPress or a browser.

## Known gaps

See the PR description. In short:
- live hits from a real browser weren't captured in this session;
- `aceToGa4` sends only to GA4's validation endpoint until Partner Central's catalogue is switched to "AWS";
- the site has no pricing page and no private-offer CTA yet;
- visitors who decline analytics consent have no client_id, so their opportunities can't be sent;
- event data retention is 2 months.
