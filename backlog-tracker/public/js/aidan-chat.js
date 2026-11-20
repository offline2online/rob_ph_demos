// Aidan in the console (yvnAPPAW9ROLrNwJceyn): the chat launcher on every page
// and the conversation panel it opens. The markup is static in index.html
// (#aidan-chat-launcher, #aidan-chat-panel), inside the signed-in app, so it
// is on every route of the console and never before sign-in; app.js creates
// the panel's dictation controller (createDictationController, the same as
// every other mic in the console) and calls initAidanChat once.
//
// Every control is a <button> acting on click (REQUIREMENTS.md → "iPad taps";
// touch-click.js covers them on the iPad). The panel talks only to
// /mcp/aidan/chat (functions/aidan-chat.js) with the member's own ID token:
// Aidan reads the console as that member and changes nothing.
//
// The conversation lives in this module while the page is open, so moving
// between pages keeps it; its id is remembered per member in localStorage, so
// after a reload the panel reopens it from the server. Read aloud (the
// browser's speech synthesis) is off until the member turns it on, and Stop
// silences it.

const STILL_WORKING_MS = 30000;
const SPEAK_KEY = "ph-aidan-read-aloud";
const convoKey = (member) => `ph-aidan-chat:${String(member || "").toLowerCase()}`;

const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

// Published Help Centre pages: the one place outside the console Aidan may
// link (functions/aidan-chat-core.js → HELP_CENTRE_ORIGINS, the same list).
const HELP_CENTRE_ORIGINS = ["https://help.personalisationhub.com/", "https://personalisationhub.com/support-centre/", "https://www.personalisationhub.com/support-centre/"];

// A link Aidan wrote, as the panel follows it: a link into this console
// becomes its in-page route ("#item-…"), so the panel stays open; a published
// Help Centre page opens in a new tab; anything else is not a link at all (the
// server already drops links to records the turn didn't read, this is the
// second lock).
export function consoleHref(url, origin) {
  const u = String(url || "").trim();
  if (/^#[A-Za-z0-9]/.test(u)) return u;
  const o = String(origin || "").replace(/\/+$/, "");
  if (o && u.startsWith(`${o}/#`)) return u.slice(o.length + 1);
  if (HELP_CENTRE_ORIGINS.some((h) => u.startsWith(h)) && !/["'<>\s]/.test(u)) return u;
  return "";
}

// Aidan's light Markdown as safe HTML: paragraphs, "- " lists, **bold** and
// links into the console. Everything else is escaped text.
export function replyHTML(text, origin) {
  const inline = (s) => {
    let out = "";
    let last = 0;
    const re = /\[([^\]\n]{1,300})\]\(([^)\s]{1,600})\)/g;
    for (const m of String(s).matchAll(re)) {
      out += boldOf(esc(s.slice(last, m.index)));
      const href = consoleHref(m[2], origin);
      const away = href && !href.startsWith("#");
      out += href ? `<a href="${esc(href)}" class="aidan-link"${away ? ' target="_blank" rel="noopener noreferrer"' : ""}>${boldOf(esc(m[1]))}</a>` : boldOf(esc(m[1]));
      last = m.index + m[0].length;
    }
    return out + boldOf(esc(s.slice(last)));
  };
  const boldOf = (h) => h.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  const blocks = String(text || "").replace(/\r/g, "").trim().split(/\n{2,}/);
  return blocks.filter((b) => b.trim()).map((b) => {
    const lines = b.split("\n");
    if (lines.every((l) => /^\s*(?:[-*•]|\d+[.)])\s+/.test(l))) {
      return `<ul>${lines.map((l) => `<li>${inline(l.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, ""))}</li>`).join("")}</ul>`;
    }
    return `<p>${lines.map(inline).join("<br>")}</p>`;
  }).join("");
}

// What read-aloud says: the words, without Markdown marks or link targets.
export function speakableText(text) {
  return String(text || "").replace(/\[([^\]\n]+)\]\([^)\s]+\)/g, "$1").replace(/\*\*/g, "").replace(/^\s*[-*•]\s+/gm, "").replace(/\s+/g, " ").trim();
}

// deps: { apiHeaders() → headers (the member's ID token), dictation (createDictationController's
//   { stop, halt, isListening, clearError }), member() → the signed-in email, fetchImpl?, origin? }
export function initAidanChat(deps) {
  const $ = (id) => document.getElementById(id);
  const els = {
    launcher: $("aidan-chat-launcher"), panel: $("aidan-chat-panel"), close: $("aidan-chat-close"),
    history: $("aidan-chat-history-btn"), fresh: $("aidan-chat-new"), speak: $("aidan-chat-speak"),
    list: $("aidan-chat-list"), log: $("aidan-chat-messages"), input: $("aidan-chat-input"),
    send: $("aidan-chat-send"), mic: $("aidan-chat-mic"), stop: $("aidan-chat-stop-speaking"),
    speaking: $("aidan-chat-speaking"), error: $("aidan-chat-error"),
  };
  if (!els.launcher || !els.panel) return null;
  const fetchImpl = deps.fetchImpl || ((...a) => fetch(...a));
  const origin = deps.origin || (typeof location !== "undefined" ? location.origin : "");
  const state = { conversationId: "", messages: [], busy: false, loaded: false, view: "convo" };
  const synth = typeof window !== "undefined" && window.speechSynthesis ? window.speechSynthesis : null;
  let readAloud = false;
  try { readAloud = localStorage.getItem(SPEAK_KEY) === "1"; } catch { /* private mode: off */ }

  const remember = () => { try { const k = convoKey(deps.member && deps.member()); if (state.conversationId) localStorage.setItem(k, state.conversationId); else localStorage.removeItem(k); } catch { /* not kept */ } };
  const remembered = () => { try { return localStorage.getItem(convoKey(deps.member && deps.member())) || ""; } catch { return ""; } };

  function showError(msg) { els.error.textContent = msg || ""; els.error.hidden = !msg; }

  function bubble(m) {
    const div = document.createElement("div");
    div.className = `aidan-msg aidan-msg-${m.role === "member" ? "member" : "aidan"}${m.pending ? " aidan-msg-pending" : ""}${m.readOnly ? " aidan-msg-readonly" : ""}`;
    if (m.pending) div.innerHTML = `<span class="aidan-dots" aria-hidden="true"><i></i><i></i><i></i></span><span class="aidan-pending-text">${esc(m.text)}</span>`;
    else if (m.role === "member") div.textContent = m.text;
    else div.innerHTML = replyHTML(m.text, origin);
    return div;
  }
  function render() {
    els.log.textContent = "";
    if (!state.messages.length) {
      const intro = document.createElement("div");
      intro.className = "aidan-msg aidan-msg-aidan aidan-intro";
      intro.innerHTML = "<p>Hi, I'm Aidan. Ask me anything about the console: a project, a ticket, the pipeline, a concept, a lead. I read it as you, with your access, and I can't change anything.</p>";
      els.log.appendChild(intro);
    }
    for (const m of state.messages) els.log.appendChild(bubble(m));
    els.log.scrollTop = els.log.scrollHeight;
  }
  function setView(view) {
    state.view = view;
    els.list.hidden = view !== "list";
    els.log.hidden = view === "list";
    els.history.setAttribute("aria-pressed", String(view === "list"));
  }
  function setBusy(on) {
    state.busy = on;
    els.send.disabled = on;
    els.history.disabled = on;
    if (els.fresh) els.fresh.disabled = on;
    els.panel.classList.toggle("is-busy", on);
  }
  function syncSpeak() {
    els.speak.setAttribute("aria-pressed", String(readAloud));
    els.speak.title = readAloud ? "Read aloud is on" : "Read answers aloud";
    els.speak.setAttribute("aria-label", els.speak.title);
    els.speak.querySelector(".material-symbols-outlined").textContent = readAloud ? "volume_up" : "volume_off";
    if (!synth) els.speak.hidden = true;
  }
  function stopSpeaking() {
    if (synth) synth.cancel();
    els.speaking.hidden = true;
  }
  function speak(text) {
    if (!synth || !readAloud) return;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(speakableText(text));
    u.lang = "en-GB";
    u.onend = () => { els.speaking.hidden = true; };
    u.onerror = () => { els.speaking.hidden = true; };
    els.speaking.hidden = false;
    synth.speak(u);
  }

  async function api(method, { body, query } = {}) {
    const url = `/mcp/aidan/chat${query ? `?${new URLSearchParams(query)}` : ""}`;
    const resp = await fetchImpl(url, { method, headers: await deps.apiHeaders(), body: body ? JSON.stringify(body) : undefined });
    let data = null;
    try { data = await resp.json(); } catch { data = null; }
    if (!resp.ok) throw Object.assign(new Error((data && data.error) || `Aidan couldn't be reached (${resp.status}).`), { status: resp.status });
    return data || {};
  }

  async function loadConversation(id) {
    const data = await api("GET", { query: { id } });
    const c = data.conversation || {};
    state.conversationId = c.id || "";
    state.messages = (c.messages || []).map((m) => ({ role: m.role, text: m.text, readOnly: m.readOnly === true }));
    remember();
    setView("convo");
    render();
  }

  // The reply to `text`, if the server saved one although the call failed: the
  // conversation it was asked in (or, for a new one, the newest conversation
  // updated since it was sent), when its last two messages are this question
  // and Aidan's answer. Returns { conversationId, text, readOnly } or null.
  async function savedReply(conversationId, text, sentAt) {
    // Allowing for the server's clock being a little behind this browser's.
    const since = sentAt - 30000;
    const fromThisTurn = (c) => {
      const msgs = c.messages || [];
      const last = msgs[msgs.length - 1];
      const asked = msgs[msgs.length - 2];
      if (!last || last.role !== "aidan" || !asked || asked.role !== "member" || String(asked.text || "").trim() !== text) return null;
      if (!(Date.parse(last.at || "") >= since)) return null;   // an older answer to the same words is not this one
      return { conversationId: c.id, text: last.text, readOnly: last.readOnly === true };
    };
    if (conversationId) return fromThisTurn((await api("GET", { query: { id: conversationId } })).conversation || {});
    const rows = ((await api("GET")).conversations || []).filter((r) => r.updatedAt && Date.parse(r.updatedAt) >= since).slice(0, 3);
    for (const r of rows) {
      const hit = fromThisTurn((await api("GET", { query: { id: r.id } })).conversation || {});
      if (hit) return hit;
    }
    return null;
  }

  async function firstOpen() {
    if (state.loaded) return;
    state.loaded = true;
    const id = remembered();
    if (!id) { render(); return; }
    try { await loadConversation(id); } catch { state.conversationId = ""; remember(); render(); }
  }

  async function showHistory() {
    // While Aidan is answering, the conversation stays where it is: the reply
    // belongs to it.
    if (state.busy) return;
    if (state.view === "list") { setView("convo"); return; }
    setView("list");
    els.list.innerHTML = '<p class="aidan-list-empty">Loading…</p>';
    try {
      const data = await api("GET");
      const rows = data.conversations || [];
      els.list.innerHTML = rows.length
        ? rows.map((r) => `<button type="button" class="aidan-list-row" data-aidan-convo="${esc(r.id)}"><span class="aidan-list-title">${esc(r.title || "Conversation")}</span><span class="aidan-list-meta">${esc(r.updatedAt ? new Date(r.updatedAt).toLocaleString() : "")}</span></button>`).join("")
        : '<p class="aidan-list-empty">No conversations yet.</p>';
    } catch (err) { els.list.innerHTML = `<p class="aidan-list-empty">${esc(err.message)}</p>`; }
  }

  function newConversation() {
    if (state.busy) return;
    state.conversationId = "";
    state.messages = [];
    remember();
    setView("convo");
    render();
    els.input.focus();
  }

  async function send(raw, input = "text") {
    const text = String(raw || "").trim();
    if (!text || state.busy) return;
    showError("");
    stopSpeaking();
    if (deps.dictation && deps.dictation.isListening()) deps.dictation.halt();
    setView("convo");
    els.input.value = "";
    autoGrow();
    state.messages.push({ role: "member", text });
    const pending = { role: "aidan", pending: true, text: "Looking that up…" };
    state.messages.push(pending);
    render();
    setBusy(true);
    const slow = setTimeout(() => { pending.text = "Still working on it. I'll answer here as soon as I'm done."; render(); }, STILL_WORKING_MS);
    const askedIn = state.conversationId;
    const sentAt = Date.now();
    const settle = (reply) => {
      // The reply is shown only in the conversation it was asked in.
      const at = state.messages.indexOf(pending);
      if (at === -1) return false;
      if (reply) state.messages.splice(at, 1, reply); else state.messages.splice(at, 1);
      return true;
    };
    try {
      const data = await api("POST", { body: { text, conversationId: askedIn || undefined, input } });
      const m = data.message || {};
      if (settle({ role: "aidan", text: m.text || "", readOnly: m.readOnly === true })) {
        state.conversationId = data.conversationId || state.conversationId;
        remember();
        render();
        speak(m.text || "");
      }
    } catch (err) {
      // The call can fail after the turn was answered and saved (a slow turn,
      // a dropped connection, a gateway timeout): look once before saying it
      // failed. Not for an answer the server gave (busy, rate limit, gone):
      // then nothing new was saved.
      const lost = !err.status || err.status >= 500;
      const saved = lost ? await savedReply(askedIn, text, sentAt).catch(() => null) : null;
      if (saved && settle({ role: "aidan", text: saved.text || "", readOnly: saved.readOnly === true })) {
        state.conversationId = saved.conversationId;
        remember();
        render();
      } else {
        settle(null);
        render();
        showError(err.message);
        if (!els.input.value) { els.input.value = text; autoGrow(); }
      }
    } finally {
      clearTimeout(slow);
      setBusy(false);
    }
  }

  function autoGrow() {
    els.input.style.height = "auto";
    els.input.style.height = `${Math.min(els.input.scrollHeight, 140)}px`;
  }

  function open() {
    els.panel.hidden = false;
    els.panel.classList.add("is-open");
    els.launcher.setAttribute("aria-expanded", "true");
    document.documentElement.classList.add("aidan-chat-open");
    firstOpen();
    if (!window.matchMedia || !window.matchMedia("(pointer: coarse)").matches) els.input.focus();
  }
  function close() {
    if (deps.dictation && deps.dictation.isListening()) deps.dictation.halt();
    stopSpeaking();
    els.panel.hidden = true;
    els.panel.classList.remove("is-open");
    els.launcher.setAttribute("aria-expanded", "false");
    document.documentElement.classList.remove("aidan-chat-open");
  }
  const isOpen = () => !els.panel.hidden;

  els.launcher.addEventListener("click", () => (isOpen() ? close() : open()));
  els.close.addEventListener("click", close);
  els.fresh.addEventListener("click", newConversation);
  els.history.addEventListener("click", showHistory);
  els.speak.addEventListener("click", () => {
    readAloud = !readAloud;
    try { localStorage.setItem(SPEAK_KEY, readAloud ? "1" : "0"); } catch { /* not kept */ }
    if (!readAloud) stopSpeaking();
    syncSpeak();
  });
  els.stop.addEventListener("click", stopSpeaking);
  els.send.addEventListener("click", () => send(els.input.value, "text"));
  els.input.addEventListener("input", autoGrow);
  els.input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(els.input.value, "text"); }
  });
  els.list.addEventListener("click", (e) => {
    const row = e.target.closest && e.target.closest("[data-aidan-convo]");
    if (!row || state.busy) return;
    loadConversation(row.getAttribute("data-aidan-convo")).catch((err) => showError(err.message));
  });
  // A link to a record opens it in the console; on a phone the panel covers
  // the page, so it closes to show it.
  els.log.addEventListener("click", (e) => {
    const a = e.target.closest && e.target.closest("a.aidan-link");
    if (a && window.matchMedia && window.matchMedia("(max-width: 640px)").matches) close();
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && isOpen()) close(); });
  syncSpeak();
  showError("");
  els.launcher.hidden = false;

  return {
    open, close, isOpen, send,
    // The mic: when the member stops dictating, what they said is sent.
    sendFromVoice: (text) => { if (isOpen()) send(text, "voice"); },
    state: () => ({ conversationId: state.conversationId, messages: state.messages.slice() }),
  };
}
