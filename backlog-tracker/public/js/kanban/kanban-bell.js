// The notification bell in the console topbar, on every page (KB-NAV-2).
//
// Notifications are written by the Kanban fan-out trigger
// (functions/kanban-notify.js); this only reads, marks read and opens.
// Cost per member stays flat however many notifications they have: one
// limit(30) listener ordered by `at` (newest first), plus a count() for the
// unread badge, re-run whenever that listener's result changes.
import {
  collection, doc, getDocs, getCountFromServer, onSnapshot, query, where, orderBy, limit, writeBatch,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { avatarHTML, memberLabel, normEmail } from "../avatar.js";

export const BELL_LIMIT = 30;
// Read notifications older than this go when their owner marks all read (no scheduled job).
export const PRUNE_AFTER_DAYS = 30;
export const PRUNE_BATCH = 200;
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const isoOf = (v) => (v && v.toDate ? v.toDate().toISOString() : v instanceof Date ? v.toISOString() : typeof v === "string" ? v : "");

// What happened, in words: "Rob assigned PH-7 to you".
export function describe(n, firstOf = (e) => String(memberLabel(e) || "").split(/[\s@]/)[0] || "Someone") {
  const who = `<b>${esc(firstOf(n.from))}</b>`;
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
  const mine = normEmail(me);
  const state = { list: [], unread: 0, open: false, firstNames: {} };
  // The first names the Kanban settings give people ("Huy"), else the first word of their name.
  const firstOf = (e) => state.firstNames[normEmail(e)] || String(memberLabel(e) || "").split(/[\s@]/)[0] || "Someone";
  host.classList.add("kb-bell-wrap");
  host.innerHTML = `<button type="button" class="icon-btn kb-bell" id="kb-bell" aria-haspopup="true" aria-expanded="false" aria-label="Notifications"></button><div class="kb-bell-panel" id="kb-bell-panel" hidden></div>`;
  const btn = host.querySelector("#kb-bell"), panel = host.querySelector("#kb-bell-panel");

  function draw() {
    const unread = state.unread;
    btn.innerHTML = `<span class="material-symbols-outlined" aria-hidden="true">notifications</span>${unread ? `<span class="kb-bell-count">${unread > 999 ? "999+" : unread}</span>` : ""}`;
    btn.setAttribute("aria-label", unread ? `Notifications, ${unread} unread` : "Notifications");
    btn.setAttribute("aria-expanded", state.open ? "true" : "false");
    panel.hidden = !state.open;
    if (!state.open) return;
    const groups = groupByTicket(state.list);
    panel.innerHTML = `<div class="kb-bell-head"><b>Notifications</b>${unread ? '<button type="button" class="link-btn" id="kb-bell-read">Mark all read</button>' : ""}</div>`
      + (groups.map((g) => `<div class="kb-bell-group"><div class="kb-bell-ticket"><b>${esc(g.key)}</b> ${esc(g.title)}</div>${g.items.map((n) => `<button type="button" class="kb-bell-item${n.read ? "" : " unread"}" data-note="${esc(n.id)}" data-key="${esc(n.taskKey)}">${avatarHTML(n.from, 24)}<span>${describe(n, firstOf)}<span class="kb-none">${esc(when(n.at))}</span></span></button>`).join("")}</div>`).join("")
        || '<p class="kb-none kb-bell-empty">Nothing yet</p>');
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

  const unsub = onSnapshot(query(collection(db, "kanbanNotifications"), where("to", "==", mine), orderBy("at", "desc"), limit(BELL_LIMIT)), (snap) => {
    state.list = snap.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) })).map((n) => ({ ...n, at: isoOf(n.at) }));
    draw();
    recount();
  }, onError);

  const unsubNames = onSnapshot(doc(db, "kanbanSettings", "main"), (s) => { state.firstNames = (s.exists() && s.data().firstNames) || {}; draw(); }, onError);

  async function markRead(ids) {
    const b = writeBatch(db);
    for (const id of ids) b.update(doc(db, "kanbanNotifications", id), { read: true });
    await b.commit();
  }
  async function markAllRead() {
    // Every unread one, not only the 30 shown (500 to a batch).
    const snap = await getDocs(query(collection(db, "kanbanNotifications"), where("to", "==", mine), where("read", "==", false)));
    for (let i = 0; i < snap.docs.length; i += 450) {
      const b = writeBatch(db);
      snap.docs.slice(i, i + 450).forEach((d) => b.update(d.ref, { read: true }));
      await b.commit();
    }
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
    if (e.target.closest("#kb-bell-read")) { markAllRead().catch(onError); return; }
    if (state.open && !e.target.closest("#kb-bell-panel")) { state.open = false; draw(); }
  };
  document.addEventListener("click", onClick);
  draw();
  return { destroy() { unsub(); unsubNames(); document.removeEventListener("click", onClick); host.innerHTML = ""; }, state };
}
