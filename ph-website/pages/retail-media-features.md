# Retail Media features page: "white label retail media platform"

Source of truth for the rework of the features page currently at `/retail-media-platform/` on personalisationhub.com. The page lives in WordPress/Elementor, so the PH Website deploy session applies this through the personalisationhub.com WordPress MCP (`ph-mcp`). Never offline2online.com.

## SEO fields

| Field | Value |
| --- | --- |
| Slug | `/white-label-retail-media-platform/` (old `/retail-media-platform/` gets a 301 to it) |
| SEO title (<= 60 chars) | White Label Retail Media Platform for Retailers \| Personalisation Hub |
| H1 | White label retail media platform, branded as your own |
| Meta description (<= 155 chars) | Launch your own retail media network on a white label retail media platform. Self-hosted in your AWS VPC, closed loop measurement, advertiser self-service. |
| Canonical | the new URL |

Keyword rule: "white label retail media platform" appears in title, H1, slug, meta description and the first paragraph of this page, and **nowhere** in the title, H1, slug or meta description of `/industries/retail-media/` (that page owns retailer outcomes, see its own ticket).

## Copy

Spelling: "personalisation" with an S. No internal project names. No explanatory copy under charts or tables (use info tooltips). Use industry terms: retail media network (RMN), sponsored products, onsite and offsite, closed loop measurement, first-party data, SSP, DSP.

**Opening paragraph.** A white label retail media platform lets a retailer run its own retail media network under its own brand. Personalisation Hub gives you the platform, hosted inside your own AWS VPC, so you can start selling advertising space without building the technology yourself.

**Sections (H2, one short paragraph each)**

1. **White label, branded as yours.** Your name, your logo, your domain. Advertisers and shoppers see your retail media network, not ours.
2. **Up and running fast.** Install from AWS Marketplace and go live in about an hour and a quarter, then add advertisers at your own pace.
3. **Self-hosted in your AWS VPC.** The platform runs in your own AWS account, so shopper and sales data never leave your environment.
4. **Closed loop measurement.** Connect ad exposure to in-store and online sales so advertisers see the sales their campaigns drove.
5. **Advertiser self-service.** Advertisers create their own ads and campaigns; the platform keeps optimising them as results come in.
6. **First-party audience targeting.** Target audiences built from your own customer data, kept secure inside your environment.
7. **Coming soon: built-in SSP features.** Sell your inventory to the major DSPs, with integrations for Google, The Trade Desk and Amazon DSP. Mark with a "Coming soon" badge; no dates.

**Cross-link (in the opening section):** "See how retailers use it in [Retail Media for retailers](/industries/retail-media/)."
**Reverse link (on `/industries/retail-media/`):** "Looking for the platform? See the [white label retail media platform](/white-label-retail-media-platform/)." Link text on the industry page must not be the exact keyword in a heading, title or meta.

## Images

No image tool (Canva, Nano Banana Pro, LTX 2.5) or personalisationhub.com Media Library was reachable in the build session. Use existing Media Library images (`list-assets`) or inline SVG in the site's style. Any screen shown must display content, never a blank or off screen. The tool comparison is done separately.

## Deploy recipe (deploy session, personalisationhub.com WordPress MCP)

1. Find the page: list pages, search "retail media platform" (current slug `/retail-media-platform/`). Note its post id.
2. Read its structure; keep the existing header, footer and CTA blocks.
3. Rebuild the body from the copy above using existing global classes and variables.
4. Update page settings: slug, SEO title, meta description (SEOPress), H1.
5. Add the 301 from the old slug (check for an existing redirect plugin/rule first).
6. Edit `/industries/retail-media/`: add the reverse link; confirm its title, H1, slug and meta do not contain "white label retail media platform".
7. Update internal links to the old slug (menus, llms.txt entries via PH Industry Enhancements if listed).
8. Publish both, purge the edge cache, run `node ph-website/tests/e2e-live.mjs`.

## Test steps

1. Open `/white-label-retail-media-platform/`: tab title, H1, URL and meta description contain "white label retail media platform".
2. Open `/retail-media-platform/`: it redirects to the new URL.
3. Open `/industries/retail-media/`: its title, H1, URL and meta do not contain the phrase; it links to the features page, and the features page links back.
4. All seven capabilities are present; the SSP/DSP item shows "Coming soon".
5. Any image with a screen shows content.
