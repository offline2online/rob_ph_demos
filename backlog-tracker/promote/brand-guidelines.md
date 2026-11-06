# Brand Guidelines

## What this is

A permanent place to develop and continually refine Personalisation Hub's **external / customer-facing brand** — both **how we look** (visual identity, templates) and **how we sound** (founder tone of voice, core messaging). Its purpose is to keep every promotion, PR piece and piece of external content consistent: the website, concept-incubator landing pages, decks, LinkedIn promos, PDFs, use cases and case studies.

It pairs with the shared **`ph-brand`** skill in the skills library (slug `ph-brand`), which holds the machine-readable tokens, rules and message library. This concept is where we discuss, decide and evolve the brand; the skill is where the agreed result is written down so every agent — and every team member via MCP — builds on-brand and on-message.

> **Not** `ph-designer`. That skill governs the HQ Admin / Retail Admin **platform UI** (Ant Design). This is the marketing brand — a different palette, voice and purpose, kept deliberately separate.

<!-- agent-only:start -->
> **Where this lives:** the **Promote** section of the PH Agent Console (Promote › Brand Guidelines). This is the brand kit for every promotion and PR piece, and agents read it over MCP (`get_project_document` on the Backlog Tracker & FAQs project).
<!-- agent-only:end -->

## Industry content lives on the website (single source of truth)

Industry and vertical detail — key USPs, revenue outcomes, use cases, focus and messaging per industry — is **no longer held in the brand guidelines**. It lives on the industry pages of [personalisationhub.com](https://personalisationhub.com), which are the single source of truth (start at [personalisationhub.com/industries](https://personalisationhub.com/industries/)). Anyone creating a promotion for a specific industry references the relevant industry page for the industry story and uses these guidelines for look, voice and rules.

## North star

**Apple.** Restraint, whitespace, confident typography, one idea per view. When in doubt, remove something.

## The two-surface system

One brand, two surfaces — picked by **channel**, not by mood:

- **Light** (default) — websites, concept pages, decks, docs. Airy, premium.
- **Dark** — LinkedIn promos, hero moments, title slides. Stands out in a feed; a deliberate "moment".

Same palette, type, spacing and accent logic across both — only the surface flips. Every template supports both, with a toggle.

## Logo usage

The logo mark is a square frame of four bars. Use the right file for the surface it sits on, and keep clear space around it.

- **Full colour** on light surfaces (the default).
- **White** on dark surfaces, with no white chip or box behind it.
- **Mono** for print, co-branding and watermarks.
- **Icon** for favicons and avatars only.
- Never recolour, stretch, redraw or add effects to the logo. The four bar colours appear together only as the logo mark, a thin accent bar or the infinity loop.
- The logo's home is top-left of a page, slide or sheet.

## Colour

The logo mark is a square frame of four bars (teal left, pink top, orange right, green bottom). Those colours are an **accent system used one at a time** — never all four at once. The four together appear only *as the logo mark, a thin accent bar, or the infinity loop*.

Real brand palette: teal `#169BC2`, pink `#EF60A7`, green `#60D838`, orange `#FE9226`; wordmark grey `#7B7B7B`. On light surfaces, accent-coloured text uses a deeper shade for contrast (teal `#0F7A9A`, pink `#C43D82`, green `#3B8F1C`, orange `#B85F08`).

## The infinity loop

Any loop (the closed loop, the self-optimising loop) is always shown as an **infinity loop** in the four brand colours, in mark order, with small gaps that echo the four bars of the logo. It flows gently on screen and is static in exports.

## Typography

Marketing web font: **Kantumruy Pro**. (Product UI uses Roboto — that's `ph-designer`, not here.) Big, confident headlines; one family does the whole job.

## Imagery and icons

- Screens shown in images (signage, devices) must always show content — never a blank or switched-off screen.
- Icons: Google Material Symbols, one locked style, tinted to the accent colour, from the curated feature-icon map in Brand assets; used alongside bullet points where it makes sense.

## Founder tone of voice

All external content — promotions, PR, LinkedIn, blogs, decks — is written in **Rob Geerdink's (founder and CEO) tone of voice**, so anything staff or agents create sounds like it came from the founder.

- **Source of truth:** Rob's past blog posts on personalisationhub.com and transcripts of his conversations, distilled into a voice guide in the `ph-brand` skill (the same voice guide used for the weekly Friday industry blog).
- **Character:** confident, plain and a little visionary; practical and educational rather than salesy; speaks as an experienced operator who has built digital products for 25+ years.
- **How it reads:** short, direct sentences; benefits and outcomes first; real-world retail examples over jargon; no hype words or empty superlatives.
- **Spelling:** Australian / British English ("personalisation", "optimise").
- **Tagline in play:** "Powered by agents. Agnostic by design."
- Every finalised piece that Rob approves feeds back into the voice guide, so the voice sharpens over time.

## Message house (launched features only)

**Umbrella line:** "Make every store visit worth more".

**Value pillars:** Reduce cost · Maximise revenue · Own your data.

**Roof:** Real-time, personalised experiences in every store — owned and run by the business, in its own cloud. *Powered by agents. Agnostic by design.*

**Pillar 1 — Know who's in store, and why**
- Check-in: the client's existing check-in mechanisms (their own app, proximity and arrival detection), plus Bluetooth beacons (Mist / HPE), virtual queue, click-and-collect check-in, dynamic QR code on in-store signage.
- Appointment booking.
- Computer vision audience insights (passer-by counts, demographics) — PH's own CV on capable hardware, or third-party CV or any third-party system via the Visitor API, GDPR-aware.

**Pillar 2 — Personalise every moment in store**
- In-store personalisation driven by who's there and why.
- AI-native digital signage, on any device.
- QR Control — customers interact with screens from their phone.

**Pillar 3 — Campaigns that run themselves**
- Automatic campaign creation and optimisation by AI agents.
- Closed loop: every result feeds the next campaign, so it improves over time.

**Pillar 4 — Prove it**
- Closed-loop attribution from screen to sale.
- Insights dashboards: campaign performance, visitor insights, store insights (queue / wait times, reason for visit, staff performance), upcoming appointments.
- Amazon Quick integration (AWS track lead; mention elsewhere as BI integration).
- Remote device management and monitoring across the estate.

**Foundation:** Self-hosted in the business's own AWS VPC — their data stays theirs. Works with any signage device and existing systems. Start with a 30-day free trial on AWS Marketplace. *(This foundation is also the core gatekeeper message for legal, procurement and cybersecurity.)*

<!-- agent-only:start -->

## Messaging rules (non-negotiable)

- **Launched features only.** No concepts, roadmap items or incubator work in external messaging until they ship.
- **Never mention AEM** in any external comms.
- **Device-agnostic.** PH works with any signage device. Amazon Signage Stick is mentioned **only** in the AWS partner track, never as the general hardware message.
- **No internal project names** — refer to the platform capability.
- Audiences are **roles**, never "personas".
- **Benefits-led, ideally outcomes-led** — focused on the audience's core needs, not features.
- **Founder tone of voice** on everything (see below).

## The model: content and container

- **Containers** = the reusable templates (below), one per touchpoint. They define *how* something looks, with named text slots.
- **Content** = the message library (below), keyed by **feature × audience (role) × front door × stage**. Industry-specific content is pulled from the relevant industry page on the website.
- Pick a template, pick an audience, front door and stage → the slots fill from the library. Same message everywhere, any format.

## Messaging architecture (four layers)

1. **Brand foundation** — positioning, founder tone of voice, visual identity, core proof points. Constant for every audience.
2. **Message house** — launched features grouped under value pillars (see below).
3. **Audience** — roles, with a front door per need. Industry detail comes from the website industry pages.
4. **Funnel stage** — every message has a version per stage (awareness → consideration → intent).

## Front doors

Buyers often arrive looking for one thing. Their **need** decides the front door; the message then walks them to the bigger picture that drives more revenue (the industry outcome comes from the relevant website industry page).

- **Virtual queuing / appointments** (typically store ops, CX heads) → check-in reveals who's in store and why → the wait becomes personalised, not dead time → conversion → wait-time and staff insights.
- **Digital signage** (typically marketing, in-store tech ops) → signage becomes personalised and self-optimising → measured from screen to sale.
- **Insights / measurement** (typically retail directors, digital heads) → visibility into visitors and stores → acting on it automatically with campaigns.
- **Check-in / click and collect** (typically digital and CX heads) → online and in-store joined up → personalised pickup moment.

## Audiences (roles)

- **Champions** (want the value): marketing directors and senior marketing leaders; retail / store directors; in-store technical ops and owners of the retail tech stack; digital / online heads; customer experience heads.
- **Technical:** solution architects and IT architecture teams — often our way in, working with AWS SAs on recommendations.
- **Gatekeepers** (approve or block): legal / regulatory, procurement, cybersecurity.
- **Cloud partner track (AWS first):** AWS solution architects, partner development managers, account managers, business development managers, and AWS service teams with a launched better-together story (e.g. Amazon Signage, Amazon Quick).

## Funnel stages

- **Awareness** — the problem and the big idea. Thought leadership, short video, LinkedIn carousels.
- **Consideration** — proof. Use cases, case studies, reference architectures, better-together sheets.
- **Intent** — the action. Primary CTA: 30-day free trial on AWS Marketplace; secondary: book a demo. One-pagers, decks, landing pages.

## Distribution

- **Downloadable PDFs** — brand guidelines, use cases, case studies, partner sheets — generated from the templates + library, never hand-edited copies.
- **MCP** — the library and guidelines are exposed via MCP so anyone (team, partners, agents) pulls the current, consistent message.

## End goal: automated LinkedIn publishing

The Personalisation Hub company page posts every one to two days, as a closed loop:

1. **Research** — a market-insight agent scans sources weekly per value pillar (retail media spend, analyst reports, privacy / AI regulation, AWS announcements, competitor and retailer moves). Starts broad; narrows to what performs. Output: insight briefs — what happened, why it matters, PH's point of view — feeding the message library.
2. **Plan** — a content calendar rotates through pillar × role × front door × stage. Mix leans to value-adding insight over straight promo (start ~4:1).
3. **Generate** — an agent writes the post from the library in the founder tone of voice and renders it in a brand template (e.g. LinkedIn carousel).
4. **Approve** — each draft lands on the agent console as a one-click approve / edit / reject card, with cited sources for every stat. Mandatory at first; switches to fully automatic once trusted.
5. **Publish** — to the company page via LinkedIn's API (needs app approval) or an approved scheduling tool.
6. **Learn** — engagement flows back and weights which pillars and messages get used next.

Weekly briefs also roll up into a monthly market report PDF.

## Build method

Hand-coded HTML/CSS over Canva for brand-exact artifacts. Canva stays useful for a human to nudge a diagram, but the reusable on-brand layer lives as code referencing the tokens.

## Reusable templates

All live on one page: [Brand templates](https://claude.ai/artifact/2A6tRmPMvenky5dvxsoyWo), each with a dark/light toggle. Each template is tagged with the funnel stage(s) it suits.

1. Concept landing page (hero carousel + sections) — consideration.
2. Deck (title + content slides) — consideration / intent.
3. **LinkedIn carousel** — three product slides + CTA at 4:5, exports a **1200×1500** PDF — awareness.
4. Diagram / architecture sheet (PDF, logo footer) — consideration (technical, AWS track).
5. **Hero slide templates** — the slides inside concept-page hero carousels, replacing the Canva-generated ones.
   - Five types: **Title / overview**, **Step / loop** (with the infinity loop), **Cards**, **Diagram / architecture**, **Hub and spoke**.
   - Each in **16:9 (1920×1080)** and **9:16 (1080×1920)**.
   - One accent per slide, content anchored to a fixed top, URL footer on every slide.
   - Every text slot is a named field (`eyebrow`, `headline`, `lede`, `item1_title`, `item1_text` …, `hub_title`, `hub_text`, `spoke1_title`, `spoke1_text` …), so content can be swapped in directly, mapped to Canva autofill, or filled from the message library.
   - **Hub and spoke** takes 3 to 8 spokes; adding or removing a spoke re-lays out the ring automatically.
   - One-click PNG export per slide at full resolution, in the selected theme.

## Brand assets

Official logo files and asset sheet: [brand assets](https://claude.ai/artifact/5K3jjJfjyn7Dhzun3p5F8o).

| File | Use | Asset ID |
|---|---|---|
| PH full colour SVG | Light surfaces (default) | `9fc093677d4c581658daa4f02bb7eb4b` |
| PH white SVG | Dark surfaces (no white chip behind it) | `ca08b28f375e1f9690139a24e813e36a` |
| PH mono SVG | Print, co-branding, watermarks | `ba67bf7c47140b20559be3b24dd1ab82` |
| PH icon PNG | Favicons, avatars | `ee4db0322cc0f1ce65f1338a6b47b464` |
| "Available in AWS Marketplace" logo, white PNG | Joint AWS promotions on **dark** surfaces | `4d9c26cb5013b179f6da5d832c16d1ae` |
| "Available in AWS Marketplace" logo, dark PNG | Joint AWS promotions on **light** surfaces | `19e70d44e5f78972d97803e4c09ec4f6` |

## Joint promotions with AWS (co-branding)

Applies to **every** joint PH + AWS promotion: AWS-track one-pagers, better-together sheets, decks, LinkedIn posts, landing pages and anything co-marketed with AWS.

**Always use the official AWS Marketplace logo.**
- Use the "Available in AWS Marketplace" logo files above. White on dark surfaces, dark on light surfaces, transparent background, no box or chip behind it.
- Never redraw, recolour, stretch, retype or imitate the AWS or AWS Marketplace logo. Use the supplied files only.
- AWS's kit also allows the plain "AWS Marketplace" logo and a text-only treatment ("Available in AWS Marketplace", on one or two lines). Use text-only only where the logo can't be shown at a legible size.

**Placement and prominence**
- The AWS Marketplace logo is always **smaller and less prominent than the PH logo** (AWS requirement).
- PH logo stays top-left. The AWS Marketplace logo sits in the footer / CTA area, next to the call to action and personalisationhub.com.
- One AWS Marketplace logo per piece or slide; never a second PH logo next to it.

**When it may be used**
- Only while Personalisation Hub is listed on AWS Marketplace. AWS prohibits the logo otherwise.
- The CTA it supports is the 30-day free trial on AWS Marketplace.

**Wording**
- "Better together with AWS" and "Available in AWS Marketplace" are fine.
- In press releases, never call the relationship a "partnership", "partner" or "alliance"; use "agreement", "teamed" or "relationship". No AWS executive quotes unless agreed with AWS, and no sales projections.

**Approvals**
- Blogs, social posts and other non-press announcements go to our AWS account manager for review before publishing (allow up to 10 business days).
- Press releases that reference AWS Marketplace need Amazon sign-off before publication.

**Source:** AWS Partner Central › [Available in AWS Marketplace branding treatment](https://partnercentral.awspartner.com/partnercentral2/s/article?category=AWS_Marketplace_Market&article=Available-in-AWS-Marketplace-Branding-Treatment-v2024) and [AWS trademark guidelines](https://aws.amazon.com/trademark-guidelines/).

## The self-optimising loop

This is meant to **compound**. Every correction — a box moved, copy tightened, a message that lands or doesn't — gets written back into the `ph-brand` skill as a rule or example, so the next generation already reflects it. A one-off fix becomes permanent, inherited taste.

## Work in progress / to refine

- Build the founder tone-of-voice guide from Rob's past blog posts and conversation transcripts; fold it into the `ph-brand` skill.
- Write the message library: each pillar and front door, per role and stage; fold into the `ph-brand` skill.
- Tag every template with its funnel stage(s) and map its named slots to library fields.
- Set up the LinkedIn pipeline: research agent, content calendar, console approval card, publishing route, engagement feedback.
- Fold the hero slide templates, field contract, light/dark toggle, infinity-loop rule and 1200×1500 LinkedIn size into the `ph-brand` skill.
- Fold the AWS co-branding rules and AWS Marketplace logo files into the `ph-brand` skill and expose all logos via MCP.
- Match the infinity loop to the one on personalisationhub.com.
- Rebuild the Experience Templates and Customer Support hero carousels from the new templates.
- Decide the light-surface marketing-accent set (the website-facing tints).

<!-- agent-only:end -->
