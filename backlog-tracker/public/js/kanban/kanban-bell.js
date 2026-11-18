// The notification bell in the console topbar, on every page (KB-NAV-2).
//
// Notifications are written by the Kanban fan-out trigger
// (functions/kanban-notify.js); this only reads, marks read and opens.
// Cost per member stays flat however many notifications they have: one
// limit(30) listener ordered by `at` (newest first), plus a count() for the
// unread badge, re-run whenever that listener's result changes.
//
// Resting the pointer on (or keyboard focus on) a "mentioned you in a comment"
// notification shows that one comment beside the panel. A notification holds
// no comment text, so the ticket's comments are read once on the first hover
// (the read that opening the ticket makes) and kept while the page is open.
import {
  collection, doc, getDoc, getDocs, getCountFromServer, onSnapshot, query, where, orderBy, limit, writeBatch,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { avatarHTML, getAvatarMember, memberLabel, normEmail } from "../avatar.js";
import { canonicalEmail, htmlToText, setPersonAliases } from "./kanban-core.js";

export const BELL_LIMIT = 30;
// Read notifications older than this go when their owner marks all read (no scheduled job).
export const PRUNE_AFTER_DAYS = 30;
export const PRUNE_BATCH = 200;
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const isoOf = (v) => (v && v.toDate ? v.toDate().toISOString() : v instanceof Date ? v.toISOString() : typeof v === "string" ? v : "");

// A person's full name: first name + last name as saved in Users, else their
// display name, else the part of their address before the @.
export function fullNameOf(e, row) {
  const m = row || getAvatarMember(e) || {};
  const saved = [m.firstName, m.lastName].map((x) => String(x || "").trim()).filter(Boolean).join(" ");
  if (saved) return saved;
  const label = String((row && row.displayName) || memberLabel(e) || "").trim();
  return (label.includes("@") && !/\s/.test(label) ? label.split("@")[0] : label) || "Someone";
}

// What happened, in words: "Minh Nguyen assigned this to you".
export function describe(n, nameOf = fullNameOf) {
  const who = `<b>${esc(nameOf(n.from))}</b>`;
  switch (n.kind) {
    case "assigned": return `${who} assigned this to you`;
    case "testing": return `${who} handed this to you for testing`;
    case "returned": return `${who} returned this to you from testing`;
    case "commented": return `${who} commented`;
    case "closed": return `${who} closed this`;
    case "mention": return `${who} mentioned you ${n.via === "comment" ? "in a comment" : "in the description"}`;
    case "comment": return `${who} mentioned you in a comment`;
    default: return `${who} mentioned you`;
  }
}

// Only a tag in a comment has a comment to show ("comment" is the older name for it).
export const hasCommentPreview = (n) => !!n && ((n.kind === "mention" && n.via === "comment") || n.kind === "comment");
const samePerson = (a, b) => !!a && canonicalEmail(normEmail(a)) === canonicalEmail(normEmail(b));
// The comment a mention notification is about: the newest comment by its sender
// that tags `me` and is not later than the notification. null when it has gone.
export function taggedComment(comments, n, me) {
  const upTo = Date.parse(n.at);
  let best = null, bestAt = -1;
  for (const c of comments || []) {
    if (n.from && !samePerson(c.author, n.from)) continue;
    if (!(Array.isArray(c.mentions) ? c.mentions : []).some((m) => samePerson(m, me))) continue;
    const at = Date.parse(isoOf(c.at)) || 0;
    if (!Number.isNaN(upTo) && at > upTo) continue;
    if (at >= bestAt) { best = c; bestAt = at; }
  }
  return best;
}
export const commentText = (c) => String((c && (c.text || htmlToText(c.html || ""))) || "").trim();
// How long the pointer rests on a mention before its comment shows.
export const PREVIEW_DELAY_MS = 200;
// The room the card needs beside the panel (its 280px, a gap and a margin); less, and it goes under the notification.
const PREVIEW_ROOM = 304;

// Newest first, grouped by ticket: a ticket sits where its newest note is.
export function groupByTicket(list) {
  const groups = new Map();
  for (const n of list) {
    if (!groups.has(n.taskKey)) groups.set(n.taskKey, { key: n.taskKey, title: n.taskTitle || "", items: [] });
    groups.get(n.taskKey).items.push(n);
  }
  return [...groups.values()];
}

// host: the element to put the bell in. openTicket(key) shows that ticket.
export function mountNotificationBell({ db, me, host, openTicket, onError = () => {} }) {
  // Notifications are addressed to a person's own address, whichever of their addresses they signed in with.
  let mine = canonicalEmail(normEmail(me));
  const state = { list: [], unread: 0, open: false, names: {}, error: "", busy: false, preview: null };
  // Who each notification is from, by full name. The console's own record of a
  // member may not be loaded on this page yet, so each sender's directory row
  // is read once (memberDirectory: name and photo, readable by every member).
  const nameOf = (e) => state.names[normEmail(e)] || fullNameOf(e);
  const asked = new Set();
  function loadNames(list) {
    for (const e of new Set(list.map((n) => normEmail(n.from)).filter(Boolean))) {
      if (asked.has(e)) continue;
      asked.add(e);
      getDoc(doc(db, "memberDirectory", e)).then((s) => {
        if (!s.exists()) return;
        state.names[e] = fullNameOf(e, s.data() || {});
        draw();
      }).catch(onError);
    }
  }
  host.classList.add("kb-bell-wrap");
  host.innerHTML = `<button type="button" class="icon-btn kb-bell" id="kb-bell" aria-haspopup="true" aria-expanded="false" aria-label="Notifications"></button><div class="kb-bell-panel" id="kb-bell-panel" hidden></div>`;
  const btn = host.querySelector("#kb-bell"), panel = host.querySelector("#kb-bell-panel");

  // The comment behind a mention (see the top of this file). One card, moved to whichever notification is hovered.
  const preview = document.createElement("div");
  preview.className = "kb-bell-preview"; preview.id = "kb-bell-preview"; preview.setAttribute("role", "tooltip");
  const commentsOf = new Map(); // ticket key → { at, list: Promise<comment[]> }
  function loadComments(n) {
    const held = commentsOf.get(n.taskKey);
    // A mention newer than the copy held is about a comment that copy can't have.
    if (held && !(Date.parse(n.at) > held.at)) return held.list;
    const entry = { at: Date.now(), list: getDocs(collection(db, "kanbanTasks", n.taskKey, "comments")).then((snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }))) };
    entry.list.catch(() => { if (commentsOf.get(n.taskKey) === entry) commentsOf.delete(n.taskKey); });
    commentsOf.set(n.taskKey, entry);
    return entry.list;
  }
  let previewTimer = 0;
  const itemOf = (id) => [...panel.querySelectorAll(".kb-bell-item")].find((b) => b.dataset.note === id) || null;
  function hidePreview() {
    clearTimeout(previewTimer); previewTimer = 0;
    if (!state.preview) return;
    state.preview = null;
    const was = panel.querySelector('[aria-describedby="kb-bell-preview"]');
    if (was) was.removeAttribute("aria-describedby");
    preview.remove();
  }
  // Beside the panel, level with its notification; under the notification where the window has no room beside.
  function placePreview() {
    const pv = state.preview, item = pv && state.open ? itemOf(pv.id) : null;
    if (!item) { hidePreview(); return; }
    preview.innerHTML = `<b class="kb-bell-preview-who">${esc(nameOf(pv.from))}</b><span class="kb-bell-preview-text${pv.text ? "" : " kb-none"}">${esc(pv.text || pv.status)}</span>`;
    item.setAttribute("aria-describedby", "kb-bell-preview");
    const box = panel.getBoundingClientRect();
    const inline = box.left < PREVIEW_ROOM;
    preview.classList.toggle("inline", inline);
    if (inline) {
      preview.style.top = preview.style.right = "";
      if (item.nextSibling !== preview) item.after(preview);
      return;
    }
    if (preview.parentNode !== host) host.appendChild(preview);
    const hostBox = host.getBoundingClientRect(), row = item.getBoundingClientRect();
    // Level with the row, kept within the panel's own height while the list scrolls.
    let top = Math.min(Math.max(row.top, box.top), Math.max(box.top, box.bottom - 40));
    // …and inside the window when the comment is a long one.
    top = Math.max(8, Math.min(top, window.innerHeight - 8 - preview.offsetHeight));
    preview.style.top = `${Math.round(top - hostBox.top)}px`;
    preview.style.right = `${Math.round(hostBox.right - box.left + 8)}px`;
  }
  function showPreview(id) {
    const n = state.list.find((x) => x.id === id);
    if (!state.open || !hasCommentPreview(n)) { hidePreview(); return; }
    if (state.preview && state.preview.id === id) return;
    hidePreview();
    const pv = state.preview = { id, from: n.from, text: "", status: "Loading the comment…" };
    placePreview();
    loadComments(n).then((list) => {
      if (state.preview !== pv) return;
      const c = taggedComment(list, n, mine);
      pv.text = c ? commentText(c) : "";
      pv.status = c ? "This comment has no text." : "This comment is no longer on the ticket.";
      placePreview();
    }).catch((err) => {
      onError(err);
      if (state.preview !== pv) return;
      pv.status = "Couldn't load the comment.";
      placePreview();
    });
  }
  // A mouse only: a finger has no hover, and its tap opens the ticket as before.
  const onOver = (e) => {
    if (e.pointerType !== "mouse") return;
    const item = e.target.closest && e.target.closest(".kb-bell-item");
    if (!item || !panel.contains(item)) return;
    const id = item.dataset.note;
    if ((state.preview && state.preview.id === id) || !hasCommentPreview(state.list.find((x) => x.id === id))) return;
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => showPreview(id), PREVIEW_DELAY_MS);
  };
  const onOut = (e) => {
    if (e.pointerType !== "mouse") return;
    const item = e.target.closest && e.target.closest(".kb-bell-item");
    if (!item || (e.relatedTarget && item.contains(e.relatedTarget))) return;
    hidePreview();
  };
  // Keyboard focus shows it too; focus from a click or tap does not.
  const onFocusIn = (e) => {
    const item = e.target.closest && e.target.closest(".kb-bell-item");
    let keyboard = false;
    try { keyboard = !!item && item.matches(":focus-visible"); } catch { /* no :focus-visible: hover only */ }
    if (keyboard) showPreview(item.dataset.note);
  };
  const onFocusOut = (e) => { if (e.target.closest && e.target.closest(".kb-bell-item")) hidePreview(); };
  panel.addEventListener("pointerover", onOver);
  panel.addEventListener("pointerout", onOut);
  panel.addEventListener("focusin", onFocusIn);
  panel.addEventListener("focusout", onFocusOut);
  panel.addEventListener("scroll", () => { if (state.preview) placePreview(); }, { passive: true });

  function draw() {
    const unread = state.unread;
    btn.innerHTML = `<span class="material-symbols-outlined" aria-hidden="true">notifications</span>${unread ? `<span class="kb-bell-count">${unread > 999 ? "999+" : unread}</span>` : ""}`;
    btn.setAttribute("aria-label", unread ? `Notifications, ${unread} unread` : "Notifications");
    btn.setAttribute("aria-expanded", state.open ? "true" : "false");
    panel.hidden = !state.open;
    if (!state.open) { hidePreview(); return; }
    const groups = groupByTicket(state.list);
    panel.innerHTML = `<div class="kb-bell-head"><b>Notifications</b>${unread ? `<button type="button" class="link-btn" id="kb-bell-read"${state.busy ? " disabled" : ""}>Mark all as read</button>` : ""}</div>`
      + (state.error ? `<p class="kb-none kb-bell-empty" role="alert" id="kb-bell-error">${esc(state.error)}</p>` : "")
      + (groups.map((g) => `<div class="kb-bell-group"><div class="kb-bell-ticket"><b>${esc(g.key)}</b> ${esc(g.title)}</div>${g.items.map((n) => `<button type="button" class="kb-bell-item${n.read ? "" : " unread"}" data-note="${esc(n.id)}" data-key="${esc(n.taskKey)}">${avatarHTML(n.from, 24)}<span>${describe(n, nameOf)}<span class="kb-none">${esc(when(n.at))}</span></span></button>`).join("")}</div>`).join("")
        || '<p class="kb-none kb-bell-empty">Nothing yet</p>');
    // The list was redrawn: put the comment card back on its notification, or drop it if that has gone.
    if (state.preview) placePreview();
  }
  const when = (iso) => { const d = new Date(iso); return Number.isNaN(+d) ? "" : d.toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); };

  // The badge: a count() of unread, not a count of the 30 held.
  let countSeq = 0;
  async function recount() {
    const seq = ++countSeq;
    try {
      const r = await getCountFromServer(query(collection(db, "kanbanNotifications"), where("to", "==", mine), where("read", "==", false)));
      if (seq === countSeq) { state.unread = r.data().count; draw(); }
    } catch (err) { onError(err); }
  }

  const listen = () => onSnapshot(query(collection(db, "kanbanNotifications"), where("to", "==", mine), orderBy("at", "desc"), limit(BELL_LIMIT)), (snap) => {
    state.list = snap.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) })).map((n) => ({ ...n, at: isoOf(n.at) }));
    draw();
    loadNames(state.list);
    recount();
  }, onError);
  let unsub = listen(), gone = false;
  // Which address is this person's own is configuration (consoleConfig/identity), and the bell is
  // on every page, often before anything else has read it: read here, once. Someone signed in
  // with a second address is then listened for under their own. (It used to depend on the Staff
  // Kanban having loaded the map first, so the bell was empty for them on every other page.)
  getDoc(doc(db, "consoleConfig", "identity")).then((s) => {
    if (gone || !s.exists()) return;
    setPersonAliases((s.data() || {}).personAliases);
    const own = canonicalEmail(normEmail(me));
    if (own === mine) return;
    unsub(); mine = own; unsub = listen();
  }).catch(() => { /* not readable: no aliases */ });

  async function markRead(ids) {
    const b = writeBatch(db);
    for (const id of ids) b.update(doc(db, "kanbanNotifications", id), { read: true });
    await b.commit();
    // The newest-30 listener may not change (the note can be older than that), so re-count.
    recount();
  }
  async function markAllRead() {
    if (state.busy) return;
    state.busy = true; state.error = "";
    // Clear the badge and the list straight away; the server write below makes it stick.
    const before = { list: state.list, unread: state.unread };
    state.list = state.list.map((n) => ({ ...n, read: true })); state.unread = 0; draw();
    try {
      // Every unread one, not only the 30 shown (500 to a batch).
      const snap = await getDocs(query(collection(db, "kanbanNotifications"), where("to", "==", mine), where("read", "==", false)));
      for (let i = 0; i < snap.docs.length; i += 450) {
        const b = writeBatch(db);
        snap.docs.slice(i, i + 450).forEach((d) => b.update(d.ref, { read: true }));
        await b.commit();
      }
    } catch (err) {
      // Put the real state back and say so: a silent failure looked like a button that does nothing.
      state.list = before.list; state.unread = before.unread; state.error = "Couldn't mark them read. Try again.";
      onError(err);
    } finally {
      state.busy = false; draw();
    }
    // The listener only sees the newest 30, so count again whatever it showed.
    recount();
    pruneRead().catch((e) => console.warn("staff kanban: notifications not pruned:", e));
  }
  // The member's own read notifications older than 30 days: one query, 200 at most.
  async function pruneRead() {
    const cutoff = new Date(Date.now() - PRUNE_AFTER_DAYS * 86400000);
    const snap = await getDocs(query(collection(db, "kanbanNotifications"), where("to", "==", mine), where("read", "==", true), where("at", "<", cutoff), limit(PRUNE_BATCH)));
    if (snap.empty) return;
    const b = writeBatch(db);
    snap.docs.forEach((d) => b.delete(d.ref));
    await b.commit();
  }

  const onClick = (e) => {
    if (e.target.closest("#kb-bell")) { state.open = !state.open; draw(); return; }
    const item = e.target.closest(".kb-bell-item");
    if (item && host.contains(item)) {
      state.open = false; draw();
      markRead([item.dataset.note]).catch(onError);
      openTicket(item.dataset.key);
      return;
    }
    if (e.target.closest("#kb-bell-read")) { markAllRead(); return; }
    if (state.open && !e.target.closest("#kb-bell-panel")) { state.open = false; draw(); }
  };
  document.addEventListener("click", onClick);
  draw();
  return { destroy() { gone = true; unsub(); hidePreview(); document.removeEventListener("click", onClick); host.innerHTML = ""; }, state };
}
