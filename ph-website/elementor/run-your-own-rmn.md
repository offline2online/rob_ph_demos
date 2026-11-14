# Run Your Own RMN: Elementor build brief

personalisationhub.com/run-your-own-rmn/ is an **Elementor page**. It is built and edited with "Edit with Elementor", like every page on the site. This brief is what the deploy session builds it from. Snippet 10063 does not render the page and never writes a post. It fills three empty mount containers with the calculator, the FAQ and the tour, server-side, and adds the head tags (see `ph-website/README.md` → "Run Your Own RMN page").

Source of the copy: the board document "Run Your Own RMN page copy (14 Nov, updated design)" (the approved design artifact `Main.dc.html`, 1440 wide, fluid, as Rob updated it on 14 Nov 2026). Every line in quotes below is the exact copy: paste it, don't retype or reword it. `tests/operator.test.php` checks that this file still carries every line the markdown twin publishes (H1, sub-line, hero paragraph, the four "why" items, the head-start paragraphs, the three ways, the three steps, the venues intro and the 12 venues, the standards leads and eight cards, the independents leads, dark band and four cards).

## Page settings

- **Create**: `elementor-create-page`, title "Run Your Own RMN", slug `run-your-own-rmn`, top level (no parent), template **Elementor Header & Footer** (`elementor_header_footer`: the site header and footer, no title bar). Status: publish. Comments off.
- **Build**: with `elementor-build-composition` (atomic elements). The Elementor MCP refuses the V3 Shortcode widget, and atomic widgets don't run shortcodes, so the page has **no Shortcode widget**: sections 7, 9 and 10 are empty mount containers that the snippet fills. No manual editor step is needed.
- The page must open with "Edit with Elementor", and `elementor-get-page-structure` must return its tree. The snippet only recognises a published top-level page on this slug whose `_elementor_edit_mode` is `builder`.
- **SEO**: leave SEOPress's title, description and social fields empty. Snippet 10063 prints the title, description, canonical, Open Graph, Twitter card and JSON-LD on this page and switches SEOPress's own copies off. It also sets the noindex while the page is hidden.
- **Header item**: don't add the page to any menu. While hidden, the snippet adds "Run Your Own RMN" to the header on this page only.

## Styling: use the site kit

Use the Elementor kit's **global colours and global fonts** for every widget (Site Settings → Global Colors / Global Fonts). Never type a colour, font or size into a widget's own style fields when a global exists. Where the design needs a colour that is not yet a kit global, add it to the kit once under the name below, then select it. Don't add custom CSS to widgets.

| Global colour (name) | Hex | Used for |
|---|---|---|
| PH Blue | `#179BC2` | sub-line, primary buttons, step accents, first card bar |
| PH Pink | `#EF61A6` | card bars |
| PH Orange | `#FE9226` | card bars |
| PH Green | `#60D838` | card bars |
| Ink | `#181A1F` | headings, the dark venues band background |
| Body | `#3A3D44` | paragraphs |
| Muted | `#555962` | "why" item text |
| Step number | `#0E7FA0` | the step numbers 1–3 |
| Tint | `#F9FAFD` | tinted section and step-card backgrounds |
| White | `#FFFFFF` | white sections and cards |
| Rule | `#E6E7E5` | section top rules, card borders |
| Chip border | `#4A4D55` | venue pills on the dark band |
| On dark | `#D5D7DB` | venues intro text on the dark band, the independents band's text |
| Navy | `#1C2540` | the independents dark band background |

| Global font | Setting |
|---|---|
| Family | **Kantumruy Pro** (fallback Segoe UI, Arial), letter spacing 0.24px |
| H1 | 72px desktop / 56px tablet / 40px mobile, weight 700, line height 1.08, capitalize |
| H2 | 40px / 34px / 28px, weight 600, line height 1.1, capitalize |
| Sub-line | 32px / 28px / 24px, weight 600, line height 1.2 |
| Lead | 20px, weight 400, line height 1.5 |
| Body | 18px, weight 400, line height 1.5 |
| Card title | 22px, weight 600, line height 1.3 |
| Small | 16px, weight 400 (the "why" item text) |

**Layout defaults** (every section is one full-width Container with a boxed inner Container):
- Outer container: content width **Full width**, padding 0, border top 1px Rule (the hero and the dark band have none).
- Inner container: boxed, max width **1280px**, padding **112px 32px** (mobile **72px 16px**).
- Grids of cards: Container with Grid layout, gap 24px; columns 3 or 4 on desktop as given, 2 on tablet, 1 on mobile.
- Buttons: Button widget, radius 4px, padding 16px 28px, 18px weight 500. Primary: PH Blue background, White text, hover `#0E7FA0`. Outline: White background, 1.5px Ink border, Ink text.

## Sections, in order

Each section's **CSS ID** goes on its outer Container (Advanced → CSS ID). `operator.css` keeps those anchors clear of the sticky header.

### 1. Hero: CSS ID `top`

- Outer container background Tint, no top rule. Inner container: padding 88px 32px 96px (mobile 56px 16px 64px), **row** direction, wrap, gap 56px, align centre. Left column flex 1 1 520px; right column flex 1 1 380px.
- Left column:
  - Heading widget, **H1**: "Run your own retail media network" (max width 16ch, margin bottom 12px). This is the page's only H1.
  - Heading widget, `p`, Sub-line font, PH Blue: "Without the upfront cost" (margin bottom 24px).
  - Text Editor, Lead font, Body colour, max width 34em, margin bottom 36px: "AI has changed what one person can achieve (the rise of the solopreneur). If you’re self-driven and you use AI tools every day rather than just talk about them, you no longer need a large team to deliver real value. One focused operator can now do the work of an entire organisation. Use those skills to launch your own retail media network, in an industry that you know and love. Enable independent businesses nationwide to support real-time personalisation in-store and in other physical venues and help them leverage AI to continually optimise their bottom line."
  - Two Buttons in a row, gap 14px: primary "See how much you can earn" → link `#calculator`; outline "Request further information" → link `#tour`.
- Right column: a card, White background, 1px Rule border, radius 20px, padding 32px (mobile 22px).
  - Heading, `p`, 22px weight 600, margin bottom 24px: "Why it beats anything out there"
  - Four items, gap 20px. Each item is a row: a 10×44px bar (radius 4px) in the colour given, gap 16px, then a title (Body font, weight 600) and its text (Small font, Muted):
    1. PH Blue. "Personalisation in physical venues": "Screens adapt in real time to any context, such as location, local venue conditions, time and weather, as well as to the person in front of them, in any venue, e.g. stores, clubs, dealerships and forecourts."
    2. PH Pink. "Campaigns can be created automatically": "Brands can bring their own creative, or let AI build, target and launch campaigns for them. Independents can do the same for their own promotions."
    3. PH Orange. "Self-optimising, with proof of results": "Every campaign learns from real in-store sales and keeps improving in line with retail media best practice, so advertisers see what they get."
    4. PH Green. "Your brand, your own AWS account": "White-label from end to end, running in your own AWS account. The data and the relationships are yours."

### 2. Your head start: CSS ID `why`

- Background White. Inner container: row, wrap, gap 48px. Left: H2 (flex 1 1 320px). Right: two Lead paragraphs (flex 2 1 520px, max width 38em, 20px between them).
- H2: "Your head start in a changing industry"
- "AI is reshaping agencies, ad tech, design and marketing. Roles are changing fast, and many experienced people are choosing to go out on their own."
- "We want to back these people, along with smaller retailers who are being left behind by the big chains. Whether you're going solo, building a team or running your own stores, setting up your own retail media network gives you a head start. It's your network, under your brand, simply powered by Personalisation Hub. You're ready to personalise in-store offers and sell targeted advertising inventory from day one, without the capital outlay of existing solutions."

### 3. Three ways to run your own network: CSS ID `who`

- Background Tint.
- H2 (margin bottom 16px): "Three ways to run your own network"
- Body paragraph, Body colour, max width 40em, margin bottom 40px: "Pick the path that fits you. Each runs the same white-label platform, under your own brand, in your own AWS account."
- Grid, columns at least 260px wide (3 on desktop). Each card: no background, a 4px top border in the colour given, padding top 20px; Card title, then Body-colour text:
  1. PH Pink. "Individual operator": "Build your own income by running a network across many venues of one kind, such as a portfolio of golf clubs. With AI, one driven person can do the work of a whole department."
  2. PH Orange. "Operator team": "Team up a retail media expert, an ad sales expert and a creative agency expert. Between you, you cover venues, advertisers and campaigns, all focused on maximising the advertising revenue your venues earn and the in-store sales they make from the endemic brands they stock."
  3. PH Green. "Small to medium retailer": "Run your own omnichannel retail media network, on your own domain, seamlessly connecting experiences across your website, app and stores. Serve hyper-personalised, targeted offers without the upfront investment, all running securely in your own virtual private cloud."

### 4. How it works: CSS ID `how`

- Background White.
- H2 (margin bottom 40px): "How it works"
- Grid, 3 columns. Each step card: Tint background, radius 16px, padding 28px. The number (40px, weight 700, Step number colour, margin bottom 12px), Card title, then Body-colour text:
  1. "Get set up": "We onboard you onto the white-label platform in your own AWS account, with the playbooks, templates and sales framework you need to launch."
  2. "Roll out with a free runway": "Sign up venues or switch on your stores, and win your first advertisers, with time to get up and running before you pay for the platform."
  3. "Grow on outcomes": "Once you're live, our model is based on outcomes, so we only grow when you do. Operators choose their own commercial model with venues."

### 5. Venues: CSS ID `venues`

- Background Ink, text White, no top rule.
- H2 (margin bottom 16px): "Any business with a physical presence"
- Paragraph, On dark colour, max width 40em, margin bottom 36px: "If it has a physical location, it can be part of your network, with or without screens today."
- 12 pills in a wrapping row, gap 12px. Each pill: 1px Chip border, radius 999px, padding 10px 20px, 17px text: "Car dealerships", "Golf clubs", "Sailing clubs and marinas", "Fuel and convenience", "Trade suppliers", "Rural and farm supplies", "Independent grocery", "Liquor stores", "Hardware", "Utility shopfronts", "Gyms and leisure centres", "Cafés and bakeries".

### 6. Standards: CSS ID `standards`

- Background White. Top: the same H2 + two Lead paragraphs layout as section 2, margin bottom 48px.
- H2: "Built to fix retail media's fragmentation"
- "Buyers say fragmentation is what holds retail media back. Every network measures, reports and sells differently, so results are hard to compare and campaigns are hard to scale."
- "Your network is built on the standards the industry is converging on, giving brands one consistent, measurable way to buy across every venue you own or sign up."
- Eight cards in a grid of columns at least 300px wide (3 per row on desktop). Each card: White, 1px Rule border with a 4px top border in the colour given, radius 8px, padding 28px; Card title, then Body-colour text:
  1. PH Blue. "Standardised measurement": "Impressions, audiences and outcomes measured in line with the IAB and MRC in-store retail media standards, so results stand up next to every other channel."
  2. PH Pink. "One buy across many venues": "Hundreds of independent venues become one network, with one buy, one set of formats and one report for brands."
  3. PH Orange. "Seamless integrations": "Connects to the programmatic platforms buyers already use, and to venues' existing systems through open APIs."
  4. PH Green. "Consistent formats and definitions": "The same screen formats, slot definitions and audience scoring in every venue, so creative runs anywhere without rework."
  5. PH Blue. "Closed-loop, incremental results": "Campaigns measured from screen to sale, showing what was truly incremental, not just what was seen."
  6. PH Pink. "Your brand, your data, your network": "Runs under your brand in your own AWS environment. You use your own shopper and venue data, it stays private, and the network and its relationships are yours."
  7. PH Orange. "AI-native, with full MCP support": "Manage your retail media network end to end from the AI tools you already use every day. Every campaign and transaction builds up historic context that keeps optimising campaign and sales performance, so each venue's network becomes more valuable, and harder to walk away from, the longer it runs."
  8. PH Green. "A dedicated engineering team behind you": "Our engineers work solely on optimising the end-to-end solution, so your network keeps pace as retail media, real-time personalisation and agentic personalisation evolve, including the custom AI models and agents we are refining to add value for retailers."

### 7. Benefits calculator: mount container, CSS ID `ph-rmn-calculator`

- One full-width e-flexbox, padding 0, no background, **empty**, with the CSS ID `ph-rmn-calculator` (`_cssid` in `elementor-build-composition`). Put nothing inside it.
- The snippet puts the calculator block inside this container, server-side. The block carries its own section, anchor `#calculator`, heading "What could it be worth to you?", the "Your network" panel with the "I am" toggle ("Operator or team" / "Retailer") and every tooltip, the dark result panel and its two links. Don't rebuild any of it in Elementor.

### 8. Independents: CSS ID `independents`

- Background Tint. Top: the same H2 + two Lead paragraphs layout as section 2, margin bottom 48px.
- H2: "Give independents a fighting chance"
- "The big chains now run their own retail media networks. Brands pay to be seen in their stores, and that income funds lower prices and protects their margins. Independent businesses and smaller retailers miss out, and existing solutions cost more than most can justify."
- "Running your own retail media network levels the field, and it has two jobs. Drive advertising revenue across every venue or store, and keep optimising conversion in each one, so independents and smaller retailers earn more and sell more without the upfront cost."
- A dark band before the cards: background Navy, White text, radius 12px, padding 36px 40px, margin bottom 32px; a wrapping row with a 32px gap.
  - Left (flex 1 1 280px, 26px, weight 600): "Independents don't have the time to run their screens. You do."
  - Right (flex 2 1 480px, 18px, On dark): "Most independent owners and smaller groups simply don't have the people or the hours to manage what plays on their screens, let alone optimise it. That's the gap you fill. You manage their screens for them, keep optimising in-store conversion, and sell advertising, ideally from the endemic brands they already stock. With someone motivated to grow their sales running it all, installing screens becomes an easy yes."
- Grid, 4 columns. Each card: White, radius 8px, padding 28px, a 4px top border in the colour given; Card title, then Body-colour text:
  1. PH Blue. "Retail media income": "New income from advertising in their venue, without having to build or run anything themselves."
  2. PH Pink. "Higher conversion on what they stock": "Endemic brands promote the products on their shelves, right where customers decide. More of those products sell."
  3. PH Orange. "Conversion you keep improving": "You continually optimise each venue's own promotions, personalised to the customers in front of them, so more visitors buy."
  4. PH Green. "A way to fight back": "Extra income and extra sales help them hold their own on price and experience against the big chains."

### 9. FAQ: mount container, CSS ID `ph-rmn-faq`

- One full-width e-flexbox, padding 0, **empty**, with the CSS ID `ph-rmn-faq` (`_cssid`).
- The snippet puts the FAQ block inside it, server-side, so the questions and their FAQPage JSON-LD are in the first HTML response. The block carries anchor `#faq`, the heading "Running your own RMN", the accordion and its FAQPage JSON-LD, generated from the same list. Never add an Elementor Accordion or FAQ widget for these questions: the structured data would then no longer match.
- It sits before the tour band. It was added for search and is not in the design.

### 10. Product tour: mount container, CSS ID `ph-rmn-tour`

- One full-width e-flexbox, padding 0, **empty**, with the CSS ID `ph-rmn-tour` (`_cssid`).
- The snippet puts the tour block inside it, server-side. The block carries anchor `#tour`, the heading "See a retail media network run end to end", the gate "Unlock the product tour" (its "I am" select and the background list; it posts to `ph-site/v1/operator-lead`) and, once unlocked, the golf club tour framed in place (`/run-your-own-rmn/tour/`). The hero's "Request further information" button and the header's "Arrange A Demo" go here.

**The mount containers, in short**: each is filled once, only on this page, and only when it is there (a missing one is skipped). The anchors `#calculator`, `#faq` and `#tour` are inside the blocks, so never give a container one of those as its CSS ID. The shortcodes `[ph_operator_calculator]`, `[ph_operator_faq]` and `[ph_operator_tour]` still exist; a block that is already on the page through one is not added a second time.

## Checks after building

1. "Edit with Elementor" opens the page; `elementor-get-page-structure` returns the 10 sections above in this order, with the three empty mount containers (`ph-rmn-calculator`, `ph-rmn-faq`, `ph-rmn-tour`).
2. The page has exactly one H1. No section repeats a heading the blocks already carry.
3. Compare with the approved design at 1440, 768 and 390 wide: no horizontal scroll, the hero copy and the "why" card side by side at 1440 and stacked at 390, the card grids at 4/3 → 2 → 1 columns. View source (not the inspector): the calculator, the FAQ and the tour gate are in the HTML the server sent, each once, inside its container.
4. View source: the title, description, canonical and Open Graph tags once each, one head JSON-LD graph and the FAQPage JSON-LD once, `noindex` while hidden.
5. On `?ph_test=1`: the calculator shows $591K, 90, 270, 2,190,000, 3,942,000 and $59.1M, and $60.0M with "Stores in your network" and "Extra sales in your stores a year" once "Retailer" is chosen; the tooltips open by hover, focus and tap; the FAQ opens by tap and keyboard; the gate (with "I am" chosen) unlocks the tour and it plays. Delete the test lead afterwards.
