# Run Your Own RMN: Elementor build brief

personalisationhub.com/run-your-own-rmn/ is an **Elementor page**. It is built and edited with "Edit with Elementor", like every page on the site. This brief is what the deploy session builds it from. Snippet 10063 does not render the page and never writes a post. It adds three Shortcode widget blocks and the head tags (see `ph-website/README.md` → "Run Your Own RMN page").

Source of the copy: the page as approved and built on ticket 2TqmoZIiXa1AYq6ieGUV (design: the board document "Run Your Own RMN page design (approved prototype)", artifact `Main.dc.html`, 1440 wide, fluid). Every line in quotes below is the exact copy: paste it, don't retype or reword it. `tests/operator.test.php` checks that this file still carries the lines the markdown twin publishes (H1, sub-line, hero paragraph, the four "why" items, the three steps and the 12 venues).

## Page settings

- **Create**: `elementor-create-page`, title "Run Your Own RMN", slug `run-your-own-rmn`, top level (no parent), template **Elementor Header & Footer** (`elementor_header_footer`: the site header and footer, no title bar). Status: publish. Comments off.
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
| On dark | `#D5D7DB` | venues intro text on the dark band |

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
  - Heading widget, **H1**: "Run your own retail media network" (max width 13ch, margin bottom 12px). This is the page's only H1.
  - Heading widget, `p`, Sub-line font, PH Blue: "Your own RMN on a world-leading white-label platform" (margin bottom 24px).
  - Text Editor, Lead font, Body colour, max width 34em, margin bottom 36px: "AI has changed what one person can achieve. If you’re driven, and you use AI tools every day rather than just talk about them, you no longer need a large team to create real value. One focused operator can now do the work of an entire organisation. Use those skills to resell the world-leading white-label retail media platform, with real-time personalisation in store and in other physical venues, to independent businesses nationwide and beyond."
  - Two Buttons in a row, gap 14px: primary "See how much you can earn" → link `#calculator`; outline "Request further information" → link `#tour`.
- Right column: a card, White background, 1px Rule border, radius 20px, padding 32px (mobile 22px).
  - Heading, `p`, 22px weight 600, margin bottom 24px: "Why it beats anything out there"
  - Four items, gap 20px. Each item is a row: a 10×44px bar (radius 4px) in the colour given, gap 16px, then a title (Body font, weight 600) and its text (Small font, Muted):
    1. PH Blue. "Personalisation in physical venues": "Screens adapt in real time to the person in front of them, in any venue, e.g. stores, clubs, dealerships and forecourts."
    2. PH Pink. "Campaigns can be created automatically": "Brands can bring their own creative, or let AI build, target and launch campaigns for them. Independents can do the same for their own promotions."
    3. PH Orange. "Self-optimising, with proof of results": "Every campaign learns from real in-store sales and improves itself, so advertisers see what they get."
    4. PH Green. "Your brand, your own AWS account": "White-label from end to end, running in your own AWS account. The data and the relationships are yours."

### 2. Your head start: CSS ID `why`

- Background White. Inner container: row, wrap, gap 48px. Left: H2 (flex 1 1 320px). Right: two Lead paragraphs (flex 2 1 520px, max width 38em, 20px between them).
- H2: "Your head start in a changing industry"
- "AI is reshaping agencies, ad tech, design and marketing. Roles are changing fast, and many experienced people are choosing to go out on their own."
- "We want to back them. If you have relationships with brands, retailers or businesses with a physical presence, becoming a Personalisation Hub network operator gives you a head start: your own retail media network, ready to sell from day one."

### 3. Who it is for: CSS ID `who`

- Background Tint.
- H2 (margin bottom 16px): "Built for people who know media"
- Body paragraph, Body colour, max width 40em, margin bottom 40px: "You already have the relationships. Now use them to drive your own advertising revenue, in the real world, where reaching people in person matters more than ever as AI reshapes online media."
- Grid, 3 columns. Each card: no background, a 4px top border in the colour given, padding top 20px; Card title, then Body-colour text:
  1. PH Pink. "Agency media and account leads": "Bring the brands you already buy for into venues no one else is selling."
  2. PH Orange. "Ad-tech sales and partnerships": "Package in-store screens as new inventory for the buyers you know."
  3. PH Green. "Retail media specialists": "You know retail media inside out. Now run your own network, in an industry you know end to end."

### 4. How it works: CSS ID `how`

- Background White.
- H2 (margin bottom 40px): "How it works"
- Grid, 3 columns. Each step card: Tint background, radius 16px, padding 28px. The number (40px, weight 700, Step number colour, margin bottom 12px), Card title, then Body-colour text:
  1. "You sign up venues": "Bring physical venues onto your network, whether they already have screens or you help put them in."
  2. "You partner with brands and advertisers": "Sell advertising and experiences across your network, to the brands your venues stock and to local and national advertisers."
  3. "You run it your own way": "You choose the commercial model, from revenue share to subscriptions. We give you a proven framework; how you build the business is up to you."

### 5. Venues: CSS ID `venues`

- Background Ink, text White, no top rule.
- H2 (margin bottom 16px): "Any business with a physical presence"
- Paragraph, On dark colour, max width 40em, margin bottom 36px: "If it has a physical location, it can be part of your network, with or without screens today."
- 12 pills in a wrapping row, gap 12px. Each pill: 1px Chip border, radius 999px, padding 10px 20px, 17px text: "Car dealerships", "Golf clubs", "Sailing clubs and marinas", "Fuel and convenience", "Trade suppliers", "Rural and farm supplies", "Independent grocery", "Liquor stores", "Hardware", "Utility shopfronts", "Gyms and leisure centres", "Cafés and bakeries".

### 6. Standards: CSS ID `standards`

- Background White. Top: the same H2 + two Lead paragraphs layout as section 2, margin bottom 48px.
- H2: "Built to fix retail media's fragmentation"
- "Buyers say fragmentation is what holds retail media back. Every network measures, reports and sells differently, so results are hard to compare and campaigns are hard to scale."
- "Your network is built on the standards the industry is converging on, giving brands one consistent, measurable way to buy across every venue you sign."
- Grid, columns at least 300px wide (4 on desktop). Each card: White, 1px Rule border with a 4px top border in the colour given, radius 8px, padding 28px; Card title, then Body-colour text:
  1. PH Blue. "Standardised measurement": "Impressions, audiences and outcomes measured in line with the IAB and MRC in-store retail media standards, so results stand up next to every other channel."
  2. PH Pink. "One buy across many venues": "Hundreds of independent venues become one network, with one buy, one set of formats and one report for brands."
  3. PH Orange. "Seamless integrations": "Connects to the programmatic platforms buyers already use, and to venues' existing systems through open APIs."
  4. PH Green. "Consistent formats and definitions": "The same screen formats, slot definitions and audience scoring in every venue, so creative runs anywhere without rework."
  5. PH Blue. "Closed-loop, incremental results": "Campaigns measured from screen to sale, showing what was truly incremental, not just what was seen."
  6. PH Pink. "Secure, with no lock-in": "Runs in your own AWS environment. Shopper data stays private and the network stays yours."
  7. PH Orange. "AI-native, with full MCP support": "Manage your retail media network end to end from the AI tools you already use every day."

### 7. Benefits calculator: Shortcode widget `[ph_operator_calculator]`

- One full-width Container (padding 0, no CSS ID, no background) holding one **Shortcode** widget: `[ph_operator_calculator]`.
- The block carries its own section, anchor `#calculator`, heading "What could it be worth to you?", the "Your network" panel with every tooltip, the dark result panel and its two links. Don't rebuild any of it in Elementor.

### 8. Independents: CSS ID `independents`

- Background Tint. Top: the same H2 + two Lead paragraphs layout as section 2, margin bottom 48px.
- H2: "Give independents a fighting chance"
- "The big chains now run their own retail media networks. Brands pay to be seen in their stores, and that income funds lower prices and protects their margins. Independent businesses miss out, and it's getting harder to compete."
- "Your network levels the field, and you have two jobs. Drive advertising revenue across your venues, and keep optimising conversion in every one of them, so independents earn more and sell more without building or running anything themselves."
- Grid, 4 columns. Each card: White, radius 8px, padding 28px, a 4px top border in the colour given; Card title, then Body-colour text:
  1. PH Blue. "Retail media income": "New income from advertising in their venue, without having to build or run anything themselves."
  2. PH Pink. "Higher conversion on what they stock": "Endemic brands promote the products on their shelves, right where customers decide. More of those products sell."
  3. PH Orange. "Conversion you keep improving": "You continually optimise each venue's own promotions, personalised to the customers in front of them, so more visitors buy."
  4. PH Green. "A way to fight back": "Extra income and extra sales help them hold their own on price and experience against the big chains."

### 9. FAQ: Shortcode widget `[ph_operator_faq]`

- One full-width Container (padding 0) holding one **Shortcode** widget: `[ph_operator_faq]`.
- The block carries anchor `#faq`, the heading "Running your own RMN", the accordion and its FAQPage JSON-LD, generated from the same list. Never add an Elementor Accordion or FAQ widget for these questions: the structured data would then no longer match.
- It sits before the tour band, as approved and built on 2TqmoZIiXa1AYq6ieGUV.

### 10. Product tour: Shortcode widget `[ph_operator_tour]`

- One full-width Container (padding 0) holding one **Shortcode** widget: `[ph_operator_tour]`.
- The block carries anchor `#tour`, the heading "See a retail media network run end to end", the gate "Unlock the product tour" (it posts to `ph-site/v1/operator-lead`) and, once unlocked, the golf club tour framed in place (`/run-your-own-rmn/tour/`). The hero's "Request further information" button and the header's "Arrange A Demo" go here.

## Checks after building

1. "Edit with Elementor" opens the page; `elementor-get-page-structure` returns the 10 sections above in this order, with the three Shortcode widgets.
2. The page has exactly one H1. No section repeats a heading the blocks already carry.
3. Compare with the approved design at 1440, 768 and 390 wide: no horizontal scroll, the hero copy and the "why" card side by side at 1440 and stacked at 390, the card grids at 4/3 → 2 → 1 columns.
4. View source: the title, description, canonical and Open Graph tags once each, one head JSON-LD graph and the FAQPage JSON-LD once, `noindex` while hidden.
5. On `?ph_test=1`: the calculator shows $591K, 90, 270, 2,190,000, 3,942,000 and $59.1M; the tooltips open by hover, focus and tap; the FAQ opens by tap and keyboard; the gate unlocks the tour and it plays. Delete the test lead afterwards.
