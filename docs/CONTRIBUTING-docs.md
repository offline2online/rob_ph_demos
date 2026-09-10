---
title: Documentation Standards — FAQs and User Guides
description: House rules for writing, structuring and formatting FAQs and user guides. Read this file in full before drafting or editing any documentation.
audience: Writers, engineers, and AI agents producing customer-facing documentation
status: Active
last_reviewed: 2026-09-10
---

# Documentation Standards — FAQs and User Guides

This file governs every customer-facing documentation surface in this
repo — today that means the public FAQ / Help Center site (`faq/`) and
its content, authored from backlog-tracker's own **FAQ Center** admin
page (see `backlog-tracker/README.md` → "FAQ / Help Center"). Any future
user-guide surface added to this repo is governed by it too, by default —
reference this file rather than writing a second, competing standard.

## 0. How to use this file

This is a **standards and formatting spec**, not a tutorial. It is written to be dropped into a repository (for example at `docs/CONTRIBUTING-docs.md` or referenced from `CLAUDE.md`) and used as the governing instruction set for anyone — human or agent — producing documentation.

**If you are an AI agent working in this repo:**

1. Read this file completely before writing or editing any documentation.
2. Classify the requested page against §2 before writing a word. If it does not fit one of the four types, the request is wrong, not the framework — say so.
3. Never invent product behaviour, UI labels, field names, error strings, endpoints, or limits. If you cannot verify it from source code, a spec, or a screenshot, insert `<!-- TODO(verify): … -->` and flag it in your summary.
4. Never write a screenshot into a draft. Insert a placeholder with a precise capture instruction (§5.6).
5. When you finish, run the checklist in §9 against your own output and report any items you failed.

---

## 1. First principles

These hold across every document type. When a specific rule below conflicts with a principle here, the principle wins.

1. **Documentation exists to make the reader successful, not to describe the product.** Every page answers a need the reader arrived with. If you cannot name that need in one sentence, do not write the page.
2. **Answer first, explain second.** Put the answer, the outcome, or the key instruction in the first sentence. Readers scan; they do not read. Background, rationale and caveats come after.
3. **One page, one job.** A page that teaches, instructs, describes and explains at the same time does all four badly. Keeping the four modes separate is the single highest-leverage structural decision in documentation.
4. **Write for the scanner.** Descriptive headings, short paragraphs, lists over prose, bold for the thing being acted on. Assume the reader reads roughly the first two words of each line.
5. **Repetition is a defect.** The same fact stated in three places will be wrong in two of them within six months. State it once in its canonical home and link to it.
6. **A frequently asked question is usually a product bug.** Log it, fix the underlying friction, and treat the FAQ entry as a temporary patch — not a permanent feature.
7. **Docs ship with the change.** A behaviour change and its documentation change belong in the same commit or the same release. Undocumented changes are incomplete changes.

---

## 2. Choose the document type before writing

Use the Diátaxis model. Four reader needs, four document types, kept strictly separate.

| Type | Reader's need | Reader's state | Written as |
|---|---|---|---|
| **Tutorial** | "Teach me" | New; no goal of their own yet | A guided lesson with a guaranteed successful outcome |
| **How-to guide** | "Help me do X" | Competent; has a specific goal | A sequence of steps to a real-world result |
| **Reference** | "Tell me the facts about Y" | Working; needs to look something up | A dry, consistent, exhaustive description |
| **Explanation** | "Help me understand why" | Studying; away from the keyboard | Discursive prose about context and trade-offs |

**Decision rule:** ask whether the reader is *acting* or *knowing*, and whether they are *studying* or *working*.

- Acting + studying → tutorial
- Acting + working → how-to guide
- Knowing + working → reference
- Knowing + studying → explanation

**Where "user guide" fits.** "User guide" is not a Diátaxis type; it is a container. A good user guide is an ordered set of how-to guides, fronted by one short tutorial (the quickstart) and backed by reference. Structure it that way rather than as a single long document.

**Where FAQ fits.** An FAQ is a navigation and reassurance layer, not a content type. Each answer should be short and, wherever the topic has real depth, link to the canonical tutorial, how-to or reference page. An FAQ that contains information found nowhere else is a symptom of broken information architecture.

**Common failures this prevents:**

- A tutorial that stops to explain architecture (breaks the learner's momentum).
- Reference material that breaks off to show how to do something.
- A how-to guide that starts by teaching concepts the reader already has.
- An FAQ that has quietly become the real manual.

**In this repo:** every `faqArticles` doc carries a `docType` field
(`faq` | `how-to` | `reference` | `explanation`) precisely so the FAQ
Center doesn't quietly collapse back into "one undifferentiated pile of
articles." Set it honestly per §2's decision rule when writing or editing
an article — see `backlog-tracker/REQUIREMENTS.md` → "FAQ / Help Center"
for the field's exact shape.

---

## 3. Repository conventions

```
docs/
├── index.md                  # Entry point: what this product is, in ≤100 words, plus routes to the four sections
├── quickstart.md             # The single tutorial. First success in under 15 minutes.
├── guides/                   # How-to guides. One task per file.
│   └── configure-sso.md
├── reference/                # Facts. Settings, fields, limits, errors, API.
│   └── settings.md
├── concepts/                 # Explanation. Why it works this way.
│   └── data-model.md
├── faq.md                    # Or faq/ split by audience if >30 entries
└── troubleshooting.md
```

This repo's actual documentation content lives in Firestore
(`faqCategories`/`faqArticles`), rendered by `faq/`, rather than as
files under `docs/` per-article — this layout is the model to hold in
mind for organisation (chunk by topic, keep tutorial/how-to/reference/
explanation separate), not a literal folder structure to replicate here.

**File naming:** kebab-case, verb-led for guides (`configure-sso.md`, `invite-a-user.md`), noun-led for reference and concepts (`rate-limits.md`, `data-model.md`). For this repo's Firestore-backed articles, the equivalent is the `slug` field — same rule applies.

**Front matter:** every page carries the following. Pages without it are incomplete.

```yaml
---
title: Configure SSO
description: One sentence, ≤160 characters, stating what the reader will be able to do.
type: how-to            # tutorial | how-to | reference | explanation | faq
audience: Administrator # Who this is for
applies_to: v2.4+       # Version, plan, or environment scope
last_reviewed: 2026-09-10
owner: platform-team
---
```

For a `faqArticles` doc, `title`/`type` (as `docType`)/`last_reviewed`
(as `updatedAt`) already exist; there is no `docs/`-style file with its
own YAML front matter to add this to.

**One H1 per page**, matching `title`. Headings descend without skipping levels. Never go deeper than H4 — if you need H5, the page should be split.

---

## 4. FAQ standard

### 4.1 When an FAQ is justified

Write an FAQ entry only when **all** of these are true:

- Real people have actually asked it. Source from support tickets, sales calls, onboarding sessions, site search logs, and community threads — never from a brainstorm.
- The answer is short. If it needs more than ~200 words, it is a how-to guide with an FAQ entry pointing at it.
- It does not have an obvious home elsewhere, or it does but readers keep failing to find it.

Do **not** write an FAQ entry for: marketing claims disguised as questions ("Why is your platform the best?"), anything that duplicates the getting-started flow, or anything a reader would only ask if the UI were broken (fix the UI).

### 4.2 Writing the question

- **Use the reader's words, not the company's.** If customers say "login", do not title it "authentication". Match the phrasing people type into search and into AI assistants.
- **First person, question form.** "How do I reset my password?" — not "Password resets" and not "How to reset a password". Be consistent across every entry.
- **One question per entry.** Split anything containing "and" or "or".
- **Front-load the distinguishing word.** "Can I export my data?" scans better than "Is it possible for me to export data?"
- **Keep it under ~10 words** where the topic allows.
- **Generalise the question, not the answer.** Rewrite a specific ticket ("Why did my 3 June import fail?") into the general form ("Why did my import fail?").

### 4.3 Writing the answer

**Structure every answer as: direct answer → qualification → next step.**

```markdown
### Can I export my data?

Yes. Every account can export its full dataset as CSV or JSON at any time,
from **Settings → Data → Export**.

Exports over 1 million rows are queued and emailed to you as a download link
that expires after 24 hours.

For scheduled or automated exports, see [Automating exports](guides/automate-exports.md).
```

Rules:

- **The first sentence must stand alone.** A reader who reads nothing else gets a usable answer. Start yes/no questions with "Yes" or "No".
- **Target 40–60 words for the core answer**, up to ~200 for the whole entry.
- **Never open with throat-clearing.** No "Great question!", no "At [Company], we believe…", no restating the question.
- **Link, don't duplicate.** One canonical destination per topic.
- **State the constraint honestly.** If the answer is "no", say no, then say what the reader can do instead. Evasive FAQ answers generate more support load than they deflect.
- **No promotional language inside answers.** It reads as evasion, and it fails structured-data quality checks.

### 4.4 Organisation and formatting

- **Chunk by topic** once you pass ~10 entries. Use H2 for the category, H3 for each question. Categories should map to the reader's mental model (Billing, Data and privacy, Integrations), not your org chart.
- **Order within a category by frequency**, most-asked first. Not alphabetical, not chronological.
- **Provide in-page navigation**: a list of questions at the top linking to anchors, and a "back to top" affordance for long pages. This also gives you shareable per-question links.
- **Single column.** Multi-column FAQ layouts destroy scannability.
- **If you use accordions**: make the entire row clickable, not just the chevron; include expand-all/collapse-all; keep the question visible when collapsed; ensure collapsed content is still findable by in-page search or link.
- **Visual hierarchy**: questions must be visually distinct from answers by weight, size and spacing — and marked up as real headings, not bolded paragraphs.
- **Prune on a schedule.** Review quarterly. Delete entries nobody opens; add what support is currently drowning in. An FAQ is a living support artefact, not an archive.

`faq/`'s architecture is one article per page (`article.html?id=…`)
rather than many short Q&As stacked on one long page, so the in-page
anchor-list/back-to-top guidance above applies at the *category* level if
a category page ever grows long, not within a single article. There is
no accordion pattern in this codebase today — if one is added later, it
must follow the accordion rules above.

### 4.5 Structured data (current as of September 2026)

`FAQPage` JSON-LD is still a valid Schema.org type and is still parsed by non-Google crawlers and answer engines, but **Google retired FAQ rich results on 7 May 2026**, including the narrow government-and-health eligibility that had survived the August 2023 restriction. Search Console reporting and Rich Results Test support were withdrawn over the following months.

Practical implications:

- Do not add or retain `FAQPage` markup expecting a Google SERP feature. There is none.
- Existing markup is harmless and can stay; unused structured data does not damage Search.
- If you keep it: one `FAQPage` block per URL, every marked-up question and answer must appear visibly on the page, no promotional copy in `acceptedAnswer`, and update the JSON-LD in the same commit as the visible answer. Drift between markup and page content is the most common long-term defect.
- Any dashboards or Search Console API calls that query FAQ appearance data need to be retired.

The durable play is the writing itself: answer-first phrasing, clean question headings, and factual, self-contained answers are what retrieval systems and human readers both reward.

`faq/` carries no `FAQPage` JSON-LD today — that's compliant as-is; don't add it expecting a Google rich-result benefit that no longer exists.

---

## 5. User guide standard

### 5.1 Page anatomy (how-to guide)

Every how-to guide follows this order. Omit a section only if it is genuinely empty.

```markdown
# Configure SSO                          ← imperative verb + object

One or two sentences: what this achieves and who it is for.

**Before you begin**                     ← prerequisites, permissions, prior steps
- Administrator access to your identity provider
- The Owner role in [Product]

**Time required:** about 15 minutes       ← only if non-trivial

## Steps                                  ← numbered procedure

## Verify it worked                       ← how the reader confirms success

## Troubleshooting                         ← symptom → cause → fix (top 3 only)

## Related
- [Managing user roles](manage-roles.md)
```

### 5.2 Titles

- **How-to guides:** imperative, verb-first. "Configure SSO", "Invite a user", "Export a report". Not "SSO configuration", not "How to configure SSO" (redundant in a guides section).
- **Tutorials:** the outcome. "Build your first campaign in 10 minutes".
- **Reference:** noun phrase. "Campaign settings", "Rate limits", "Error codes".
- **Explanation:** noun phrase or a why-question. "How targeting works", "Why we use eventual consistency".
- Sentence case throughout. No trailing punctuation.

### 5.3 Writing steps

This is where most user guides fail. The rules are strict.

1. **One action per step.** If a step contains "and then", split it.
2. **Imperative mood, present tense, second person.** "Select **Save**." Not "You should now save" or "The user saves".
3. **Location before action.** "In the left sidebar, select **Settings**." The reader needs to know where to look before being told what to do.
4. **Condition before instruction.** "If you use SAML, enter your metadata URL." Never "Enter your metadata URL if you use SAML" — by then they have already typed.
5. **State the result when it is not obvious.** "The **Connections** panel opens." Do not narrate obvious results.
6. **Nine steps maximum per procedure.** Beyond that, split into sub-procedures under H3s, or into separate guides.
7. **Do not number non-actions.** Notes, warnings and explanations sit inside the step as an indented paragraph, not as their own numbered step.
8. **Every procedure ends in a verifiable state.** The reader must be able to tell they succeeded.

**Example of correct form:**

```markdown
1. In the left sidebar, select **Settings → Authentication**.
2. Select **Add provider**, then choose **SAML 2.0**.
3. Paste your identity provider's metadata URL into **Metadata URL**.

   If your provider does not expose a metadata URL, select **Enter manually**
   and supply the sign-in URL and certificate instead.

4. Select **Test connection**.

   A new tab opens and returns you to the setup page with a green
   **Connection verified** banner.

5. Select **Enable for all users**.
```

### 5.4 Formatting conventions

| Element | Convention | Example |
|---|---|---|
| UI labels (buttons, fields, menus, tabs) | **Bold** | Select **Save changes** |
| Navigation paths | Bold with `→` | **Settings → Billing → Plans** |
| Literal input the reader types | `Code font` | Enter `admin@example.com` |
| Filenames, paths, commands, values | `Code font` | Open `config.yaml` |
| Placeholders inside code | `ANGLE_BRACKETS` or `<lowercase>` | `api_key=<YOUR_API_KEY>` |
| Emphasis on a concept | *Italic*, sparingly | This is the *canonical* record |
| Keyboard keys | Bold, plus sign | Press **Ctrl** + **S** |

- **Lists:** numbered for sequence, bulleted for unordered sets. Parallel grammatical structure across every item. Sentence case; full stops only if items are full sentences.
- **Tables:** for comparing three or more things across two or more attributes. Never for layout. Header row always. Keep cells to a few words — long prose in a cell means it should be a list.
- **Code blocks:** always language-tagged. Runnable and copy-pasteable as written. Show a realistic example response or output beneath. Use obviously fake but plausible sample data — never real keys, customer names, or internal hostnames.
- **Callouts:** three levels only, used sparingly. `Note` (useful aside), `Important` (will cause rework if ignored), `Warning` (data loss, cost, or irreversibility). More than two callouts on a page means the page is badly structured.
- **Links:** descriptive text naming the destination. "See [Configuring SSO]" — never "click [here]" or "see [this page]". Relative links within the docs tree so they survive moves.

### 5.5 Language rules

- **Second person, active voice, present tense.** "The system will be updated by the scheduler" → "The scheduler updates the system."
- **One idea per sentence.** Average under 20 words; hard ceiling around 30.
- **Consistent terminology.** One term per concept, forever. If it is a "store" in the UI, it is a "store" in the docs — never a "location", "site" or "branch" as a stylistic variation. Maintain a terminology table in `reference/glossary.md`.
- **Expand acronyms on first use per page**, then use the acronym.
- **"Select" over "click"** — it covers mouse, touch and keyboard. Reserve "click" for cases where a mouse is genuinely required, "enter" for typed input, "choose" for picking from a set of options.
- **Numerals for all measurable quantities**, including one to nine. "3 retries", "5 minutes", "1 store".
- **Unambiguous dates.** `10 September 2026` or `2026-09-10`. Never `10/09/26`.
- **Set one locale and hold it.** This project uses Australian English: `-ise` endings (personalise, organise, authorise), `-our` endings (behaviour, colour), and `personalisation` spelt with an S everywhere including URLs.

**Banned words and phrases:**

| Banned | Why | Use instead |
|---|---|---|
| simply, just, easily, obviously, of course | Makes a stuck reader feel stupid | Delete; say nothing |
| please | Not a request; it is an instruction | Delete |
| should be able to | Uncertainty about your own product | State what happens |
| in order to | Padding | to |
| utilise, leverage, facilitate | Jargon | use, use, help |
| we, our team | Reader does not care about you | Name the product, or use passive-free description |
| above / below | Meaningless on reflowed or mobile layouts | "in [section name]", with a link |
| the button on the left / the red icon | Fails for screen readers and colour-blind users | Name the control: "select **Save**" |

### 5.6 Screenshots and images

Screenshots are the most expensive content you can create — every UI change invalidates them silently.

- **Default to no screenshot.** Add one only when the UI is genuinely ambiguous, when the reader must recognise a visual state, or at the single hardest moment of a long flow.
- **Never put information only in an image.** Every fact in a screenshot must also be in the text.
- **Crop tight** to the relevant control plus enough surroundings to orient. Never full-window at desktop resolution.
- **Annotate** with a single accent colour box or arrow. Do not annotate with text baked into the image.
- **Alt text is mandatory** and describes the information, not the picture: `alt="Authentication settings with SAML 2.0 selected"`, not `alt="screenshot"`.
- **Use consistent, sanitised demo data.** One fictional company, one fictional user set, across every screenshot.
- **Placeholder syntax for drafts:**
  `<!-- SCREENSHOT: Settings → Authentication, SAML provider list, one provider connected. Crop to panel. Alt: "SAML provider list showing one verified connection." -->`

The FAQ Center's rich-text editor prompts for alt text whenever an image
is inserted, precisely to enforce the mandatory-alt-text rule above at
the point of authoring rather than relying on a later audit.

### 5.7 Troubleshooting entries

Fixed three-part form, one entry per symptom:

```markdown
### "Connection verified" never appears

**Cause.** Your identity provider is returning the assertion to a callback URL
that does not match the one registered in [Product].

**Fix.** In your provider, set the ACS URL to exactly the value shown in
**Settings → Authentication → Callback URL**, including the trailing slash.
```

Lead with the symptom **as the reader experiences it** — the error string they see, or what visibly failed. Not your internal name for the failure mode.

---

## 6. Accessibility

Non-negotiable, and it overlaps almost entirely with plain good writing.

- Real semantic headings in correct order; no skipped levels; no bold-text-as-heading.
- No meaning conveyed by colour, position, shape or size alone.
- Descriptive link text that makes sense read out of context in a link list.
- Alt text on every informative image; `alt=""` on purely decorative ones.
- Tables with header rows; no merged cells; no layout tables.
- Plain language: aim for roughly a Grade 9 reading level for general-audience docs, and do not exceed Grade 12 even for technical ones.
- Expandable content must be keyboard operable and must not hide content from in-page search.

---

## 7. Maintenance

- **Docs change in the same PR as the behaviour change.** No exceptions for "we'll document it next sprint".
- **`last_reviewed` is updated on every substantive edit.** Pages untouched for 12 months are flagged for review or deletion.
- **Deletion is a feature.** Wrong documentation is worse than missing documentation, because it is trusted.
- **Instrument it.** Track page views, in-page search terms that return nothing, and support tickets that cite a doc page. Failed searches are your content backlog.
- **Version and deprecation notices go at the top of the page**, never buried mid-body. State what changed, when, and what to do instead.
- **Changelog entries are plain language**: what changed, who it affects, what action is required.

---

## 8. Templates

### 8.1 How-to guide

```markdown
---
title: <Imperative verb + object>
description: <One sentence, ≤160 chars>
type: how-to
audience: <Role>
applies_to: <Version/plan>
last_reviewed: <YYYY-MM-DD>
owner: <team>
---

# <Imperative verb + object>

<What this achieves, and when you would want it. 1–2 sentences.>

**Before you begin**
- <Permission or role required>
- <Prior configuration required>

## Steps

1. <Location>, select **<Control>**.
2. <Single action>.
3. <Single action>.

## Verify it worked

<Observable state that confirms success.>

## Troubleshooting

### <Symptom as the reader sees it>
**Cause.** <One sentence.>
**Fix.** <One or two sentences.>

## Related
- [<Link>](<path>)
```

### 8.2 FAQ entry

```markdown
### <Question in the reader's own words, first person, ≤10 words?>

<Direct answer in the first sentence. Yes/No first for yes/no questions.>

<Qualification, limit, or edge case. Optional.>

<Link to the canonical page for anything deeper.>
```

### 8.3 Reference page

```markdown
# <Noun phrase>

<One sentence on what this describes and when to consult it.>

| Setting | Type | Default | Description |
|---|---|---|---|
| `<name>` | `<type>` | `<default>` | <What it does. What happens at the boundaries.> |

## Limits

| Limit | Value | Applies to |
|---|---|---|

## Errors

| Code | Meaning | Resolution |
|---|---|---|
```

Reference pages are dry by design. No advice, no steps, no persuasion — describe the machinery and nothing else.

### 8.4 Tutorial (quickstart)

```markdown
# <Outcome> in <N> minutes

By the end of this tutorial you will have <concrete, demonstrable artefact>.

**You need:** <minimum prerequisites — keep this list brutally short>

## 1. <First milestone>
...
## 2. <Second milestone>
...

## What you built
<Restate the achievement. Show the result.>

## Next steps
- [<How-to guide for the obvious next task>](<path>)
```

Tutorial rules: the reader must succeed, every time, on the happy path. No branching, no options, no "you could also". Minimal explanation inline — link out for the why. Test it end to end on a clean environment before publishing.

---

## 9. Review checklist

Run this against every page before it merges.

**Type and purpose**
- [ ] The page is exactly one Diátaxis type, and does not drift into another.
- [ ] The reader's need is stated or obvious within the first two sentences.

**Structure**
- [ ] One H1, matching the title; no skipped heading levels; nothing deeper than H4.
- [ ] Front matter complete, including `last_reviewed`.
- [ ] Prerequisites appear before steps.
- [ ] The procedure ends in a verifiable state.

**Writing**
- [ ] Answer-first: the first sentence of each section carries the payload.
- [ ] Second person, active voice, present tense, imperative for instructions.
- [ ] One action per numbered step; location before action; condition before instruction.
- [ ] No banned words (§5.5). No "simply", "just", "easily", "please".
- [ ] Terminology matches the glossary and the UI exactly.
- [ ] Sentences average under 20 words.

**Formatting**
- [ ] UI labels bold; literal input in code font; navigation paths use `→`.
- [ ] Code blocks language-tagged, runnable, with realistic sanitised data.
- [ ] Links are descriptive and relative; no "click here".
- [ ] At most two callouts.

**Accuracy**
- [ ] Every claim verified against source, spec or live UI — no invented labels, limits or errors.
- [ ] Any unverifiable claim marked `<!-- TODO(verify): … -->` and reported.
- [ ] No real credentials, customer data, or internal hostnames.

**Accessibility**
- [ ] Alt text on every informative image.
- [ ] No colour-, position- or shape-only references.
- [ ] Tables have header rows and no merged cells.

**Duplication**
- [ ] Nothing here restates content that already has a canonical home elsewhere.

---

## 10. Sources

The rules above synthesise established practice rather than invented preference. Primary sources:

- **Diátaxis** (diataxis.fr, Daniele Procida) — the four-type model in §2. Adopted as the documentation foundation by Canonical/Ubuntu, among others.
- **Nielsen Norman Group** — FAQ research underpinning §4.4: chunk by topic, rewrite questions into general form, support in-page jump links, distinguish questions from answers visually, avoid multi-column layouts, make whole accordion rows clickable.
- **Google developer documentation style guide** and **Microsoft Writing Style Guide** — voice, person, tense, UI element formatting, "select" over "click", numerals, and the banned-words list in §5.5.
- **GOV.UK content design guidance** — plain language, reading level, and the discipline of writing for user need rather than organisational structure.
- **Google Search Central** — FAQ structured data status in §4.5. FAQ rich results ceased appearing 7 May 2026; `FAQPage` remains a valid Schema.org type.
- **Stripe and Twilio documentation** — the pattern in §2 and §5.1: quickstart to first success, task-shaped guides named after real jobs, copy-pasteable examples with realistic responses, and error documentation treated as first-class content rather than an appendix.
