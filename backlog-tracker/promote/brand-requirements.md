# Brand Guidelines — Requirements

## 0. Messaging rules
- R0.1 External messaging covers **launched features only** — no concepts or roadmap items.
- R0.2 **AEM is never mentioned** in external comms.
- R0.3 Hardware messaging is **device-agnostic**; Amazon Signage Stick appears only in the AWS partner track.
- R0.4 No internal project names; audiences are **roles**, never "personas".
- R0.5 All external comms are benefits-led, ideally outcomes-led.
- R0.6 All external content uses the **founder tone of voice** (section 7).

## 1. Message library
- R1.1 One structured library, single source of truth for brand-level external messaging.
- R1.2 Message house: umbrella line "Turn every store visit into revenue"; value pillars Reduce cost, Maximise revenue, Own your data; launched features grouped under the feature pillars (Know who's in store; Personalise every moment; Campaigns that run themselves; Prove it) on a foundation of self-hosted in the business's own AWS VPC, device-agnostic, 30-day AWS Marketplace trial.
- R1.3 Every message entry keyed by **feature × audience (role) × front door × funnel stage**.
- R1.4 Audiences covered: champions (marketing directors / senior marketing, retail / store directors, in-store technical ops / retail tech stack owners, digital heads, CX heads); technical (solution architects / IT architecture); gatekeepers (legal / regulatory, procurement, cybersecurity); cloud partner track (AWS SAs, PDMs, account managers, BDMs, and AWS service teams with a launched better-together story).
- R1.5 **Industry content is out of scope for the brand guidelines.** Industry / vertical USPs, revenue outcomes, use cases and focus live on the personalisationhub.com industry pages as the single source of truth; the guidelines reference those pages and never duplicate them.
- R1.6 Stages: awareness, consideration, intent — each with its own headline, supporting points, proof and CTA.
- R1.7 Default intent CTA is the 30-day free trial on AWS Marketplace; book a demo is secondary.
- R1.8 **Front doors:** for each entry-point need (virtual queuing / appointments, digital signage, insights, check-in / click and collect), a path that starts with the buyer's need and leads to the bigger revenue picture; industry outcome pulled from the relevant website industry page.

## 2. Templates ↔ library
- R2.1 Every template tagged with the funnel stage(s) it suits.
- R2.2 Every named template slot maps to a library field, so selecting role + front door + stage fills the template.
- R2.3 Light/dark toggle, export sizes and visual rules as defined in the README remain unchanged.

## 3. Distribution
- R3.1 Downloadable PDFs (brand guidelines, use cases, case studies, partner / better-together sheets) generated from templates + library.
- R3.2 Library and guidelines exposed via MCP so team, partners and agents pull the current message.
- R3.3 Library and rules live in the `ph-brand` skill; corrections write back into it (self-optimising loop).
- R3.4 Brand guidelines live in the **Promote** section of the PH Agent Console (Promote › Brand Guidelines), readable by agents over MCP; a Leads item can sit beneath them.

## 4. Automated LinkedIn publishing (Personalisation Hub company page)
- R4.1 Cadence: one post every one to two days.
- R4.2 Content calendar rotates through pillar × role × front door × stage to keep a balanced mix.
- R4.3 Generation agent writes copy from the message library in the founder tone of voice and renders it in a brand template (e.g. LinkedIn carousel, 1200×1500 PDF).
- R4.4 Approval gate: every draft lands on the agent console as a card for one-click approve / edit / reject. Initially mandatory; designed to switch to fully automatic later.
- R4.5 Publishing to the company page via LinkedIn's API (requires app approval) or an approved scheduling tool.
- R4.6 Engagement data flows back and weights future pillar / message selection (learn loop).
- R4.7 Generated posts must pass the R0 messaging rules before reaching approval.

## 5. Market insight research
- R5.1 Research agent scans sources weekly per value pillar (e.g. retail media spend, analyst reports, privacy / AI regulation, AWS announcements, competitor and retailer moves).
- R5.2 Starts with a broad source set; narrows over time based on what performs.
- R5.3 Output is an insight brief: what happened, why it matters, PH's point of view, linked to a pillar; briefs feed the message library.
- R5.4 Post mix weighted toward value-adding insight over straight promo (starting ratio around 4:1).
- R5.5 Every statistic carries a cited source, checked at approval.
- R5.6 Weekly briefs roll up into a monthly market report PDF (consideration-stage asset).

## 6. Joint promotions with AWS (co-branding)
- R6.1 Every joint PH + AWS promotion always carries the official "Available in AWS Marketplace" logo from the brand assets page: white version on dark surfaces, dark version on light surfaces, transparent, no chip or box behind it.
- R6.2 The AWS / AWS Marketplace logo is never redrawn, recoloured, stretched, retyped or imitated; only the supplied files are used. Text-only "Available in AWS Marketplace" is allowed only where the logo can't be shown legibly.
- R6.3 The AWS Marketplace logo is always smaller and less prominent than the PH logo; PH logo top-left, AWS Marketplace logo in the footer / CTA area; one per piece or slide.
- R6.4 The logo is used only while Personalisation Hub is listed on AWS Marketplace.
- R6.5 Press releases never describe the AWS relationship as "partner", "partnership" or "alliance" (use "agreement", "teamed" or "relationship"); no AWS executive quotes unless agreed; no sales projections.
- R6.6 Non-press announcements (blogs, social) go to the AWS account manager for review before publishing (up to 10 business days); press releases referencing AWS Marketplace require Amazon sign-off.
- R6.7 The AWS co-branding rules and logo files are folded into the `ph-brand` skill and all logos are retrievable via MCP.

## 7. Founder tone of voice
- R7.1 All external content (promotions, PR, LinkedIn, blogs, decks) is written in the founder's (Rob Geerdink's) tone of voice, whether created by staff or agents.
- R7.2 The voice guide is built from Rob's past blog posts on personalisationhub.com and transcripts of his conversations, and is held in the `ph-brand` skill (shared with the weekly Friday industry blog).
- R7.3 Voice: confident, plain, a little visionary; practical and educational, not salesy; short direct sentences; benefits and outcomes first; real-world examples over jargon; no hype words.
- R7.4 Australian / British spelling throughout ("personalisation").
- R7.5 Finalised pieces approved by Rob feed back into the voice guide.
