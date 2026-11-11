// Promote › Prospects (TAM) › company detail view (#promote/prospects, a company
// name opens it). Four tabs on one company: Profile, Org chart (reporting tree
// with buying-role badges and the lead overlay), AWS team (with one-click email)
// and Documents (versioned library). The data rules are in prospect-detail-core.js.
// The org chart, AWS team, ACE opportunity and documents belong to the COMPANY:
// they are stored once in prospectCompanies/{companyDocId(name)} and shared by
// every country record of it (ALDI · Australia and ALDI · Netherlands show the
// same chart); the profile's vendors and AWS account ID stay on the country record.
// A write is live for everyone through this view's snapshot of that document.
// Enrich / Refresh info (editors) queues an agent's web research of the company
// at /leadEnrich/v1/enrich (functions/lead-enrich.js); the findings land on the
// record (enrichment: logo, facts, news, financials) and fill the profile's
// blanks, and arrive through the prospects snapshot. A new record is enriched
// by itself when it is created.
//
// Every control is a <button> or link and acts on click (the iPad rule); the
// forms are plain <form>s that submit with a button.
import { doc, getDoc, setDoc, updateDoc, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import {
  BUYING_ROLES, roleLabel, AWS_ROLES, awsRoleLabel, ENGAGEMENTS, engagementLabel, DOC_KINDS, docKindLabel,
  buildTree, countRoles, leadOverlay, leadGaps, awsTeamWithAce, awsEngagement, groupDocuments, nextVersion, sharedWithAws,
  cleanPerson, cleanAwsMember, cleanDocument, cleanProfile, cleanAce, detailForSave, mailto, initials, isEmail, safeHttpUrl,
  companyDocId, COMPANY_COLLECTION, normaliseDetail, normaliseAwsAccountId,
} from "./prospect-detail-core.js";
import { sizeBandLabel, statusLabel } from "./prospects-core.js";
import { enrichmentHTML, enrichmentRunning, enrichButtonLabel, enrichmentStatus } from "./enrichment-view.js";

const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const TABS = [["profile", "Profile"], ["org", "Org chart"], ["aws", "AWS account team"], ["docs", "Documents"]];
const fmtDate = (iso) => { const t = Date.parse(iso); return Number.isNaN(t) ? "" : new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }); };
const icon = (n) => `<span class="material-symbols-outlined" aria-hidden="true">${n}</span>`;
const val = (form, name) => (form.elements[name] ? form.elements[name].value : "");

export function mountProspectDetail({ db, root, canEdit, me, getRow, getCompanyRows, onClose, onAllFields, say, apiHeaders }) {
  let id = "";          // the country record that was opened
  let ckey = "";        // its company's shared-detail document id
  let data = null;      // the company's detail, null until the first snapshot
  let loadError = "";
  let unsub = null;
  let tab = "profile";
  let editing = null; // { kind: "profile" | "person" | "aws" | "doc", id }
  let lead = null;
  let leadFor = "";
  const collapsed = new Set();

  const row = () => getRow(id);
  const detail = () => data;
  const isOpen = () => !!id;

  function avatar(p) {
    return p.photoUrl
      ? `<img class="pd-photo" src="${esc(p.photoUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer" data-initials="${esc(initials(p.name))}">`
      : `<span class="pd-photo pd-photo-fallback" aria-hidden="true">${esc(initials(p.name))}</span>`;
  }
  const roleBadge = (key) => (key ? `<span class="pd-role pd-role-${esc(key)}">${esc(roleLabel(key))}</span>` : "");
  const mailBtn = (address, label, subject) => {
    const href = mailto(address, subject);
    return href ? `<a class="pd-mail" href="${esc(href)}" aria-label="Email ${esc(label)}" title="Email ${esc(label)}">${icon("mail")}</a>` : "";
  };
  const list = (items, empty) => (items.length ? `<div class="pd-chips">${items.map((x) => `<span class="pd-chip">${esc(x)}</span>`).join("")}</div>` : `<span class="pd-none">${esc(empty)}</span>`);
  const editBtn = (kind, eid, label) => (canEdit() ? `<button type="button" class="btn-ghost pd-edit" data-act="edit" data-kind="${kind}"${eid ? ` data-id="${esc(eid)}"` : ""}>${icon("edit")}${esc(label || "Edit")}</button>` : "");

  // The org chart, AWS team and documents are the company's, not this country record's.
  function sharedNote(r) {
    const countries = getCompanyRows(ckey).map((x) => x.country).filter(Boolean);
    return countries.length > 1 ? `<p class="pd-shared-note">${icon("public")}Org chart, AWS team and documents are shared by every ${esc(r.name)} record (${esc(countries.join(", "))}).</p>` : "";
  }

  // ── Profile ────────────────────────────────────────────────────────────────
  function profileHTML(r, d) {
    const p = d.profile;
    const field = (label, html) => `<div class="pd-field"><dt>${esc(label)}</dt><dd>${html}</dd></div>`;
    const txt = (v) => (v ? esc(v) : '<span class="pd-none">Not researched yet</span>');
    return `<div class="pd-card">
      <div class="pd-card-head"><h3>Profile</h3>${editBtn("profile", "", "Edit profile")}</div>
      ${sharedNote(r)}
      <p class="pd-summary">${p.summary ? esc(p.summary) : '<span class="pd-none">No summary yet. An agent can add one over MCP, or use Edit profile.</span>'}</p>
      <dl class="pd-fields">
        ${field("AWS account ID", txt(r.awsAccountId))}
        ${field("Industry", txt([r.industry, r.subIndustry].filter(Boolean).join(" › ")))}
        ${field("Markets", list(r.markets, "No markets recorded"))}
        ${field("Stores", txt(r.storeCount == null ? "" : `${r.storeCount.toLocaleString("en-GB")} (${sizeBandLabel(r.sizeBand)})`))}
        ${field("Tech stack", list(p.techStack, "Not researched yet"))}
        ${field("Existing vendors", list(r.vendors, "None known"))}
        ${field("Primary cloud provider", txt(p.primaryCloud))}
        ${field("Email address format", p.emailFormats.length ? `<div class="pd-chips">${p.emailFormats.map((x) => `<code class="pd-chip">${esc(x)}</code>`).join("")}</div>` : '<span class="pd-none">Not researched yet</span>')}
        ${field("Likely products of interest", list(p.productsOfInterest, "Not researched yet"))}
        ${field("Latest news", txt(p.latestNews))}
        ${field("Staff owner", txt(p.staffOwner))}
        ${field("Last researched", txt(fmtDate(p.lastResearchedAt)))}
        ${field("Status", esc(statusLabel(r.status)))}
      </dl></div>
      <div class="pd-card" id="pd-research"><div class="pd-card-head"><h3>Company research</h3></div>
        ${enrichmentHTML(r.enrichment) || '<p class="pd-none">Not enriched yet. Enrich researches the company on the web.</p>'}
      </div>`;
  }
  function profileForm(r, d) {
    const p = d.profile, ace = d.aceOpportunity || {};
    const inp = (name, label, v, extra = "") => `<label class="pd-label">${esc(label)}<input class="pd-input" name="${name}" value="${esc(v)}" ${extra}></label>`;
    return `<form class="pd-form" data-form="profile" novalidate>
      <h3>Edit profile</h3>
      <label class="pd-label">Summary<textarea class="pd-input" name="summary" rows="4" maxlength="2000">${esc(p.summary)}</textarea></label>
      ${inp("logoUrl", "Logo address (https)", p.logoUrl)}
      ${inp("techStack", "Tech stack (comma separated)", p.techStack.join(", "))}
      ${inp("vendors", "Existing vendors (comma separated)", r.vendors.join(", "))}
      ${inp("awsAccountId", "AWS account ID (12 digits, if known)", r.awsAccountId || "", 'inputmode="numeric" maxlength="14"')}
      ${inp("primaryCloud", "Primary cloud provider", p.primaryCloud)}
      ${inp("emailFormats", "Email address formats (comma separated, e.g. first.last@acme.com)", p.emailFormats.join(", "))}
      ${inp("productsOfInterest", "Likely products of interest (comma separated)", p.productsOfInterest.join(", "))}
      <label class="pd-label">Latest news<textarea class="pd-input" name="latestNews" rows="2" maxlength="1000">${esc(p.latestNews)}</textarea></label>
      ${inp("staffOwner", "Staff owner (email)", p.staffOwner)}
      ${inp("lastResearchedAt", "Last researched", p.lastResearchedAt, 'type="date"')}
      <fieldset class="pd-fieldset"><legend>ACE opportunity seller (fills the AWS account manager)</legend>
        ${inp("aceSellerName", "Seller name", ace.sellerName || "")}
        ${inp("aceSellerEmail", "Seller email", ace.sellerEmail || "")}
      </fieldset>
      ${formButtons()}</form>`;
  }

  // ── Org chart ──────────────────────────────────────────────────────────────
  function nodeHTML(n, overlay) {
    const o = overlay.get(n.id) || { isLead: false, engagement: [] };
    const open = !collapsed.has(n.id);
    const kids = n.children.length;
    return `<li class="pd-node" role="treeitem"${kids ? ` aria-expanded="${open}"` : ""}>
      <div class="pd-person${o.isLead ? " is-lead" : ""}" data-person="${esc(n.id)}">
        ${avatar(n)}
        <div class="pd-person-body">
          <strong class="pd-person-name">${esc(n.name)}</strong>
          <span class="pd-person-title">${esc(n.title || "No title")}</span>
          ${n.awsAccountId ? `<span class="pd-person-title">AWS account ${esc(n.awsAccountId)}</span>` : ""}
          <span class="pd-badges">${roleBadge(n.buyingRole)}${o.isLead ? `<span class="pd-lead-badge">${icon("star")}Lead contact</span>` : ""}${o.engagement.map((e) => `<span class="pd-eng">${esc(engagementLabel(e))}</span>`).join("")}</span>
        </div>
        <div class="pd-person-actions">
          ${mailBtn(n.email, n.name)}
          ${editBtn("person", n.id, "Edit")}
          ${kids ? `<button type="button" class="pd-toggle" data-act="toggle" data-id="${esc(n.id)}" aria-expanded="${open}" aria-label="${open ? "Collapse" : "Expand"} ${esc(n.name)}'s reports (${kids})">${icon(open ? "expand_less" : "expand_more")}<span class="pd-toggle-n">${kids}</span></button>` : ""}
        </div>
      </div>
      ${kids && open ? `<ul class="pd-tree" role="group">${n.children.map((c) => nodeHTML(c, overlay)).join("")}</ul>` : ""}
    </li>`;
  }
  function orgHTML(d) {
    const overlay = leadOverlay(d.people, lead);
    const gaps = leadGaps(d.people, overlay);
    const counts = countRoles(d.people);
    const legend = BUYING_ROLES.map((r) => `<span class="pd-role pd-role-${r.key}">${esc(r.label)}${counts[r.key] ? ` · ${counts[r.key]}` : ""}</span>`).join("");
    return `<div class="pd-card">
      <div class="pd-card-head"><h3>Org chart</h3>${editBtn("person", "", "Add person")}</div>
      <div class="pd-legend" aria-label="Buying roles">${legend}</div>
      ${gaps.length ? `<ul class="pd-gaps" role="status">${gaps.map((g) => `<li>${icon("warning")}${esc(g)}</li>`).join("")}</ul>` : ""}
      ${d.people.length ? `<ul class="pd-tree pd-tree-root" role="tree" aria-label="Reporting tree">${buildTree(d.people).map((n) => nodeHTML(n, overlay)).join("")}</ul>` : '<p class="pd-none">No one in the org chart yet. Add people, or an agent can add them over MCP.</p>'}
    </div>`;
  }
  function personForm(d, pid) {
    const p = pid ? d.people.find((x) => x.id === pid) : null;
    const x = p || { name: "", title: "", photoUrl: "", reportsTo: "", buyingRole: "", email: "", awsAccountId: "", engagement: [] };
    const others = d.people.filter((o) => o.id !== x.id);
    return `<form class="pd-form" data-form="person" data-id="${esc(pid || "")}" novalidate>
      <h3>${p ? "Edit person" : "Add person"}</h3>
      <label class="pd-label">Name<input class="pd-input" name="name" value="${esc(x.name)}" maxlength="120" required></label>
      <label class="pd-label">Job title<input class="pd-input" name="title" value="${esc(x.title)}" maxlength="120"></label>
      <label class="pd-label">Photo address (https)<input class="pd-input" name="photoUrl" value="${esc(x.photoUrl)}"></label>
      <label class="pd-label">Email<input class="pd-input" name="email" value="${esc(x.email)}" maxlength="200"></label>
      <label class="pd-label">AWS account ID (12 digits, if known)<input class="pd-input" name="awsAccountId" value="${esc(x.awsAccountId)}" inputmode="numeric" maxlength="14"></label>
      <label class="pd-label">Reports to<select class="pd-input" name="reportsTo"><option value="">Nobody (top of the chart)</option>${others.map((o) => `<option value="${esc(o.id)}"${o.id === x.reportsTo ? " selected" : ""}>${esc(o.name)}</option>`).join("")}</select></label>
      <label class="pd-label">Buying role<select class="pd-input" name="buyingRole"><option value="">Not set</option>${BUYING_ROLES.map((r) => `<option value="${r.key}"${r.key === x.buyingRole ? " selected" : ""}>${esc(r.label)}</option>`).join("")}</select></label>
      <fieldset class="pd-fieldset"><legend>Engagement</legend>${ENGAGEMENTS.map((e) => `<label class="pd-check"><input type="checkbox" name="eng-${e.key}"${x.engagement.includes(e.key) ? " checked" : ""}>${esc(e.label)}</label>`).join("")}</fieldset>
      ${formButtons(p ? "remove" : "")}</form>`;
  }

  // ── AWS account team ───────────────────────────────────────────────────────
  function awsHTML(d) {
    const team = awsTeamWithAce(d.awsTeam, d.aceOpportunity);
    const eng = awsEngagement(team, d.people);
    return `<div class="pd-card">
      <div class="pd-card-head"><h3>AWS account team</h3>${editBtn("aws", "", "Add AWS contact")}</div>
      ${team.length ? `<ul class="pd-aws">${team.map((m) => `<li class="pd-aws-row" data-aws="${esc(m.id)}">
        <span class="pd-photo pd-photo-fallback pd-photo-aws" aria-hidden="true">${esc(initials(m.name))}</span>
        <div class="pd-person-body">
          <strong class="pd-person-name">${esc(m.name)}</strong>
          <span class="pd-person-title">${esc(awsRoleLabel(m.role))}${m.dealRole ? ` · ${esc(m.dealRole)}` : ""}</span>
          ${m.source === "ace" ? `<span class="pd-badges"><span class="pd-eng">From the ACE opportunity</span></span>` : ""}
          ${eng.get(m.id).length ? `<span class="pd-engages">${icon("handshake")}Engaging ${eng.get(m.id).map((p) => esc(p.name)).join(", ")}</span>` : ""}
        </div>
        <div class="pd-person-actions">${mailBtn(m.email, m.name, `${(row() || {}).name || "Customer"} opportunity`)}${m.source === "ace" ? "" : editBtn("aws", m.id, "Edit")}</div>
      </li>`).join("")}</ul>` : '<p class="pd-none">No AWS contacts yet. The assigned seller appears here once the company is on an ACE opportunity; add the rest with Add AWS contact.</p>'}
    </div>`;
  }
  function awsForm(d, mid) {
    const m = mid ? d.awsTeam.find((x) => x.id === mid) : null;
    const x = m || { name: "", role: "specialist", email: "", dealRole: "", engages: [] };
    return `<form class="pd-form" data-form="aws" data-id="${esc(mid || "")}" novalidate>
      <h3>${m ? "Edit AWS contact" : "Add AWS contact"}</h3>
      <label class="pd-label">Name<input class="pd-input" name="name" value="${esc(x.name)}" maxlength="120" required></label>
      <label class="pd-label">Role<select class="pd-input" name="role">${AWS_ROLES.map((r) => `<option value="${r.key}"${r.key === x.role ? " selected" : ""}>${esc(r.label)}</option>`).join("")}</select></label>
      <label class="pd-label">Email<input class="pd-input" name="email" value="${esc(x.email)}" maxlength="200"></label>
      <label class="pd-label">Role on this deal<input class="pd-input" name="dealRole" value="${esc(x.dealRole)}" maxlength="200"></label>
      <fieldset class="pd-fieldset"><legend>Engaging these customer contacts</legend>${d.people.length ? d.people.map((p) => `<label class="pd-check"><input type="checkbox" name="eng-${esc(p.id)}"${x.engages.includes(p.id) ? " checked" : ""}>${esc(p.name)}</label>`).join("") : '<span class="pd-none">Add people to the org chart first.</span>'}</fieldset>
      ${formButtons(m ? "remove" : "")}</form>`;
  }

  // ── Document library ───────────────────────────────────────────────────────
  function docsHTML(d) {
    const groups = groupDocuments(d.documents);
    const one = (x, latest) => `<li class="pd-doc${latest ? " is-latest" : ""}">
      <div class="pd-doc-main">
        ${x.url ? `<a class="pd-doc-title" href="${esc(x.url)}" target="_blank" rel="noopener noreferrer">${esc(x.title)}</a>` : `<span class="pd-doc-title">${esc(x.title)}</span>`}
        <span class="pd-badges"><span class="pd-eng">${esc(docKindLabel(x.kind))}</span><span class="pd-eng">v${x.version}</span>${x.date ? `<span class="pd-eng">${esc(fmtDate(x.date))}</span>` : ""}${sharedWithAws(x) ? `<span class="pd-lead-badge">${icon("cloud")}Shared with AWS</span>` : ""}${x.tags.map((t) => `<span class="pd-chip">${esc(t)}</span>`).join("")}</span>
        ${x.sharedWith.length ? `<span class="pd-shared">${icon("share")}Shared with ${x.sharedWith.map((s) => esc(`${s.name || s.email}${s.aws ? " (AWS)" : ""}${s.at ? `, ${fmtDate(s.at)}` : ""}`)).join("; ")}</span>` : '<span class="pd-shared pd-none">Not shared yet</span>'}
      </div>
      <div class="pd-person-actions">${editBtn("doc", x.id, "Edit")}${canEdit() && latest ? `<button type="button" class="btn-ghost pd-edit" data-act="newversion" data-id="${esc(x.id)}">${icon("add")}New version</button>` : ""}</div>
    </li>`;
    return `<div class="pd-card">
      <div class="pd-card-head"><h3>Document library</h3>${editBtn("doc", "", "Add document")}</div>
      ${groups.length ? `<ul class="pd-docs">${groups.map((g) => `<li class="pd-doc-group"><ul>${one(g[0], true)}${g.length > 1 ? `<li><details class="pd-older"><summary>${g.length - 1} earlier version${g.length === 2 ? "" : "s"}</summary><ul>${g.slice(1).map((x) => one(x, false)).join("")}</ul></details></li>` : ""}</ul></li>`).join("")}</ul>` : '<p class="pd-none">No documents yet. One-pagers, prospect packs, decks, business cases and funding documents made for this company are listed here.</p>'}
    </div>`;
  }
  function docForm(d, did, base) {
    const m = did ? d.documents.find((x) => x.id === did) : null;
    const x = m || base || { title: "", kind: "prospect-pack", version: 1, date: new Date().toISOString().slice(0, 10), url: "", tags: [], sharedWith: [] };
    const team = awsTeamWithAce(d.awsTeam, d.aceOpportunity);
    const awsShared = x.sharedWith.filter((s) => s.aws);
    const other = x.sharedWith.filter((s) => !s.aws).map((s) => (s.email ? (s.name ? `${s.name} <${s.email}>` : s.email) : s.name)).join(", ");
    return `<form class="pd-form" data-form="doc" data-id="${esc(m ? m.id : "")}" novalidate>
      <h3>${m ? "Edit document" : x.version > 1 ? `New version (v${x.version})` : "Add document"}</h3>
      <label class="pd-label">Title<input class="pd-input" name="title" value="${esc(x.title)}" maxlength="160" required></label>
      <label class="pd-label">Type<select class="pd-input" name="kind">${DOC_KINDS.map((k) => `<option value="${k.key}"${k.key === x.kind ? " selected" : ""}>${esc(k.label)}</option>`).join("")}</select></label>
      <label class="pd-label">Version<input class="pd-input" name="version" type="number" min="1" max="999" value="${x.version}"></label>
      <label class="pd-label">Date<input class="pd-input" name="date" type="date" value="${esc(x.date)}"></label>
      <label class="pd-label">Link to the file (https)<input class="pd-input" name="url" value="${esc(x.url)}"></label>
      <label class="pd-label">Tags (comma separated)<input class="pd-input" name="tags" value="${esc(x.tags.join(", "))}"></label>
      <fieldset class="pd-fieldset"><legend>Shared with AWS</legend>${team.length ? team.map((t) => `<label class="pd-check"><input type="checkbox" name="aws-${esc(t.id)}"${awsShared.some((s) => (t.email && s.email === t.email) || s.name === t.name) ? " checked" : ""}>${esc(t.name)} (${esc(awsRoleLabel(t.role))})</label>`).join("") : '<span class="pd-none">No AWS contacts yet.</span>'}</fieldset>
      <label class="pd-label">Also shared with (comma separated names or emails)<input class="pd-input" name="shared" value="${esc(other)}"></label>
      ${formButtons(m ? "remove" : "")}</form>`;
  }

  function formButtons(extra) {
    return `<p class="pd-form-error" role="alert" hidden></p><div class="pd-form-actions">
      <button type="submit" class="btn-primary">Save</button>
      <button type="button" class="btn-ghost" data-act="cancel">Cancel</button>
      ${extra === "remove" ? `<button type="button" class="btn-ghost pd-danger" data-act="remove">${icon("delete")}Remove</button>` : ""}
    </div>`;
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  function render() {
    if (!id) { root.hidden = true; root.innerHTML = ""; return; }
    const r = row(), d = detail();
    if (r && !d) { root.hidden = false; root.innerHTML = `<button type="button" class="btn-ghost pd-back" data-act="back">${icon("arrow_back")}All prospects</button><h2 class="pd-name" tabindex="-1">${esc(r.name)}</h2><p class="${loadError ? "pd-form-error" : "pd-none"}" role="status">${esc(loadError || "Loading the company…")}</p>`; return; }
    if (!r || !d) { root.hidden = false; root.innerHTML = `<button type="button" class="btn-ghost pd-back" data-act="back">${icon("arrow_back")}All prospects</button><p class="pd-none">This company is no longer in the list.</p>`; return; }
    const p = d.profile;
    const logo = p.logoUrl || safeHttpUrl(r.enrichment && r.enrichment.logoUrl);
    let body;
    if (editing && canEdit()) {
      body = editing.kind === "profile" ? profileForm(r, d) : editing.kind === "person" ? personForm(d, editing.id) : editing.kind === "aws" ? awsForm(d, editing.id) : docForm(d, editing.id, editing.base);
    } else body = tab === "profile" ? profileHTML(r, d) : tab === "org" ? orgHTML(d) : tab === "aws" ? awsHTML(d) : docsHTML(d);
    root.hidden = false;
    root.innerHTML = `<div class="pd-toprow"><button type="button" class="btn-ghost pd-back" data-act="back">${icon("arrow_back")}All prospects</button>${onAllFields ? `<button type="button" class="btn-ghost pd-edit" data-act="allfields">${icon("list_alt")}All fields</button>` : ""}${canEdit() && apiHeaders ? `<button type="button" class="btn-ghost pd-edit" data-act="enrich"${enrichmentRunning(r.enrichment) ? " disabled" : ""}>${icon("auto_awesome")}${esc(enrichButtonLabel(r.enrichment))}</button>` : ""}</div>
      ${enrichNote || enrichmentStatus(r.enrichment) ? `<p class="pd-enrich-status field-hint" role="status">${esc(enrichmentStatus(r.enrichment) || enrichNote)}</p>` : ""}
      <header class="pd-head">
        ${logo ? `<img class="pd-logo" src="${esc(logo)}" alt="${esc(r.name)} logo" referrerpolicy="no-referrer">` : `<span class="pd-logo pd-logo-fallback" aria-hidden="true">${esc(initials(r.name))}</span>`}
        <div><h2 class="pd-name" tabindex="-1">${esc(r.name)}</h2>
        <p class="pd-sub">${esc([r.industry, r.hqCountry].filter(Boolean).join(" · "))}${r.leadId ? ` · <a href="#promote/leads">Lead</a>` : ""}${safeHttpUrl(r.website) ? ` · <a href="${esc(safeHttpUrl(r.website))}" target="_blank" rel="noopener noreferrer">Website</a>` : ""}</p></div>
      </header>
      <div class="pd-tabs" role="tablist" aria-label="Company detail">${TABS.map(([k, l]) => `<button type="button" role="tab" class="pd-tab" id="pd-tab-${k}" aria-selected="${tab === k && !editing}" data-act="tab" data-tab="${k}">${esc(l)}</button>`).join("")}</div>
      <div class="pd-panel" role="tabpanel" aria-labelledby="pd-tab-${tab}">${body}</div>`;
  }

  // ── Saving ─────────────────────────────────────────────────────────────────
  async function save(next, extra, okMsg) {
    const d = detailForSave(next);
    const r = row();
    if (!ckey) { say("This company's name has no letters or digits, so its detail has nowhere to be kept.", true); return; }
    try {
      // The company's shared detail first, then (profile only) the fields that stay on this country record.
      await setDoc(doc(db, COMPANY_COLLECTION, ckey), { name: r ? r.name : "", ...d, updatedAt: serverTimestamp(), updatedByEmail: me() });
      if (extra) await updateDoc(doc(db, "prospects", id), { ...extra, updatedAt: serverTimestamp(), updatedByEmail: me() });
      editing = null; say(okMsg || "Saved.");
    } catch (e) { say(`Couldn't save: ${e && e.message ? e.message : e}`, true); }
    render();
  }
  const showError = (form, msg) => { const p = form.querySelector(".pd-form-error"); p.textContent = msg; p.hidden = false; };
  const uid = (prefix) => `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const urlOk = (form, name, label) => { const v = val(form, name).trim(); if (v && !safeHttpUrl(v)) { showError(form, `${label} isn't a valid web address.`); return false; } return true; };

  function submit(form) {
    const d = detail(), kind = form.dataset.form, fid = form.dataset.id;
    if (kind === "profile") {
      if (!urlOk(form, "logoUrl", "The logo address")) return;
      const sellerEmail = val(form, "aceSellerEmail").trim();
      if (sellerEmail && !isEmail(sellerEmail)) return showError(form, "The seller email isn't a valid address.");
      const profile = cleanProfile({ summary: val(form, "summary"), logoUrl: val(form, "logoUrl"), techStack: val(form, "techStack"), primaryCloud: val(form, "primaryCloud"), emailFormats: val(form, "emailFormats"), productsOfInterest: val(form, "productsOfInterest"), latestNews: val(form, "latestNews"), staffOwner: val(form, "staffOwner"), lastResearchedAt: val(form, "lastResearchedAt") });
      const ace = cleanAce({ id: (d.aceOpportunity || {}).id || "", sellerName: val(form, "aceSellerName"), sellerEmail });
      const vendors = val(form, "vendors").split(/[,;\n]/).map((s) => s.trim().slice(0, 80)).filter(Boolean).slice(0, 60);
      const awsAccountId = normaliseAwsAccountId(val(form, "awsAccountId"));
      if (awsAccountId === null) return showError(form, "AWS account ID must be exactly 12 digits.");
      return save({ ...d, profile, aceOpportunity: ace }, { vendors, awsAccountId }, "Profile saved.");
    }
    if (kind === "person") {
      const name = val(form, "name").trim();
      if (!name) return showError(form, "Name the person first.");
      if (val(form, "email").trim() && !isEmail(val(form, "email"))) return showError(form, "The email isn't a valid address.");
      if (!urlOk(form, "photoUrl", "The photo address")) return;
      if (normaliseAwsAccountId(val(form, "awsAccountId")) === null) return showError(form, "AWS account ID must be exactly 12 digits.");
      const person = cleanPerson({ id: fid || uid("p"), name, awsAccountId: val(form, "awsAccountId"), title: val(form, "title"), photoUrl: val(form, "photoUrl"), email: val(form, "email"), reportsTo: val(form, "reportsTo"), buyingRole: val(form, "buyingRole"), engagement: ENGAGEMENTS.filter((e) => form.elements[`eng-${e.key}`] && form.elements[`eng-${e.key}`].checked).map((e) => e.key) }, 0);
      const people = fid ? d.people.map((p) => (p.id === fid ? person : p)) : [...d.people, person];
      return save({ ...d, people }, null, `${name} saved.`);
    }
    if (kind === "aws") {
      const name = val(form, "name").trim();
      if (!name) return showError(form, "Name the AWS contact first.");
      if (val(form, "email").trim() && !isEmail(val(form, "email"))) return showError(form, "The email isn't a valid address.");
      const m = cleanAwsMember({ id: fid || uid("a"), name, role: val(form, "role"), email: val(form, "email"), dealRole: val(form, "dealRole"), engages: d.people.filter((p) => form.elements[`eng-${p.id}`] && form.elements[`eng-${p.id}`].checked).map((p) => p.id), source: "manual" }, 0);
      const awsTeam = fid ? d.awsTeam.map((x) => (x.id === fid ? m : x)) : [...d.awsTeam, m];
      return save({ ...d, awsTeam }, null, `${name} saved.`);
    }
    if (kind === "doc") {
      const title = val(form, "title").trim();
      if (!title) return showError(form, "Give the document a title.");
      if (!urlOk(form, "url", "The file link")) return;
      const team = awsTeamWithAce(d.awsTeam, d.aceOpportunity);
      const prior = fid ? d.documents.find((x) => x.id === fid) : (editing && editing.base);
      const today = new Date().toISOString().slice(0, 10);
      const shared = [];
      for (const t of team) if (form.elements[`aws-${t.id}`] && form.elements[`aws-${t.id}`].checked) {
        const was = prior && prior.sharedWith.find((s) => (t.email && s.email === t.email) || s.name === t.name);
        shared.push({ name: t.name, email: t.email, aws: true, at: was && was.at ? was.at : today });
      }
      for (const tok of val(form, "shared").split(",").map((s) => s.trim()).filter(Boolean)) {
        const m = tok.match(/^(.*?)<([^>]+)>$/);
        const addr = m ? m[2].trim() : isEmail(tok) ? tok : "";
        const was = prior && prior.sharedWith.find((s) => !s.aws && (addr ? s.email === addr.toLowerCase() : s.name === tok));
        shared.push({ name: m ? m[1].trim() : addr ? "" : tok, email: addr, aws: false, at: was && was.at ? was.at : today });
      }
      const docNext = cleanDocument({ id: fid || uid("d"), title, kind: val(form, "kind"), version: val(form, "version"), date: val(form, "date"), url: val(form, "url"), tags: val(form, "tags"), sharedWith: shared }, 0);
      const documents = fid ? d.documents.map((x) => (x.id === fid ? docNext : x)) : [...d.documents, docNext];
      return save({ ...d, documents }, null, `${title} saved.`);
    }
  }

  function remove(form) {
    const d = detail(), kind = form.dataset.form, fid = form.dataset.id;
    if (!fid) return;
    if (kind === "person") {
      // The people who reported to them move up a level.
      const gone = d.people.find((p) => p.id === fid);
      const people = d.people.filter((p) => p.id !== fid).map((p) => (p.reportsTo === fid ? { ...p, reportsTo: gone ? gone.reportsTo : "" } : p));
      const awsTeam = d.awsTeam.map((m) => ({ ...m, engages: m.engages.filter((x) => x !== fid) }));
      return save({ ...d, people, awsTeam }, null, "Removed.");
    }
    if (kind === "aws") return save({ ...d, awsTeam: d.awsTeam.filter((m) => m.id !== fid) }, null, "Removed.");
    if (kind === "doc") return save({ ...d, documents: d.documents.filter((x) => x.id !== fid) }, null, "Removed.");
  }

  root.addEventListener("submit", (e) => { e.preventDefault(); if (canEdit()) submit(e.target); });
  root.addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]");
    if (!b || !root.contains(b)) return;
    const act = b.dataset.act;
    if (act === "back") { close(); if (onClose) onClose(); return; }
    if (act === "allfields") { if (onAllFields) onAllFields(id); return; }
    if (act === "enrich" && canEdit() && apiHeaders) { enrich(); return; }
    if (act === "tab") { tab = b.dataset.tab; editing = null; render(); return; }
    if (act === "toggle") { if (collapsed.has(b.dataset.id)) collapsed.delete(b.dataset.id); else collapsed.add(b.dataset.id); render(); const t = root.querySelector(`[data-act="toggle"][data-id="${CSS.escape(b.dataset.id)}"]`); if (t) t.focus(); return; }
    if (act === "cancel") { editing = null; render(); return; }
    if (act === "edit" && canEdit()) { editing = { kind: b.dataset.kind, id: b.dataset.id || "" }; render(); const f = root.querySelector("form input, form textarea"); if (f) f.focus(); return; }
    if (act === "newversion" && canEdit()) {
      const d = detail(), x = d.documents.find((o) => o.id === b.dataset.id);
      if (x) { editing = { kind: "doc", id: "", base: { ...x, version: nextVersion(d.documents, x.title, x.kind), date: new Date().toISOString().slice(0, 10), sharedWith: [] } }; render(); }
      return;
    }
    if (act === "remove" && canEdit()) {
      const form = b.closest("form");
      if (!b.dataset.armed) { b.dataset.armed = "1"; b.lastChild.textContent = "Click again to remove"; return; }
      remove(form);
    }
  });
  // A photo that won't load becomes the person's initials.
  root.addEventListener("error", (e) => {
    const im = e.target;
    if (!im || im.tagName !== "IMG") return;
    const s = document.createElement("span");
    s.className = im.classList.contains("pd-logo") ? "pd-logo pd-logo-fallback" : "pd-photo pd-photo-fallback";
    s.setAttribute("aria-hidden", "true");
    s.textContent = im.dataset.initials || initials((row() || {}).name);
    im.replaceWith(s);
  }, true);

  // Queues the agent's research of this record; the findings arrive through the prospects snapshot.
  let enrichNote = "";
  async function enrich() {
    const rid = id;
    enrichNote = "Starting the research…"; render();
    try {
      const resp = await fetch("/leadEnrich/v1/enrich", { method: "POST", headers: await apiHeaders(), body: JSON.stringify({ prospectId: rid }) });
      const body = await resp.json().catch(() => ({}));
      enrichNote = resp.ok ? "" : (body.error || `Enrichment failed (HTTP ${resp.status}).`);
      if (resp.ok) say("Researching the company on the web… the findings appear here when it finishes.");
    } catch (err) { enrichNote = `Enrichment failed: ${err && err.message ? err.message : err}`; }
    if (id === rid && !editing) render();
  }

  // A lead is one document per company, linked from whichever country record was converted.
  const companyLeadId = () => { const r = row(); if (!r) return ""; if (r.leadId) return r.leadId; const sib = getCompanyRows(ckey).find((x) => x.leadId); return sib ? sib.leadId : ""; };
  async function loadLead() {
    const lid = companyLeadId();
    if (!lid || leadFor === lid) return;
    leadFor = lid;
    try { const s = await getDoc(doc(db, "leads", lid)); lead = s.exists() ? s.data() : null; } catch { lead = null; }
    if (id && companyLeadId() === leadFor) render();
  }
  function listen() {
    if (unsub) unsub();
    unsub = null; data = null; loadError = "";
    if (!ckey) { data = normaliseDetail({}); return; }
    unsub = onSnapshot(doc(db, COMPANY_COLLECTION, ckey), (snap) => {
      data = normaliseDetail(snap.exists() ? snap.data() : {});
      loadError = "";
      if (id && !editing) { render(); loadLead(); }
    }, (err) => { loadError = `The company detail could not be loaded: ${err && err.message ? err.message : err}`; if (id) render(); });
  }
  function open(companyId, startTab) {
    id = companyId; tab = startTab || "profile"; editing = null; lead = null; leadFor = ""; enrichNote = "";
    const r = row();
    ckey = r ? companyDocId(r.name) : "";
    listen();
    render(); loadLead();
    const h = root.querySelector(".pd-name"); if (h) h.focus({ preventScroll: true });
  }
  function close() { if (unsub) unsub(); unsub = null; data = null; id = ""; ckey = ""; editing = null; render(); }
  function refresh() {
    if (!id) return;
    const r = row();
    const key = r ? companyDocId(r.name) : "";
    if (key !== ckey) { ckey = key; listen(); } // the company was renamed
    if (!editing) { render(); loadLead(); }
  }
  return { open, close, refresh, isOpen, currentId: () => id };
}
