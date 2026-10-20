// Rich-text editor for ticket descriptions and comments.
//
// The same Quill 1.3.7 setup as the console's FAQ article editor
// (backlog-tracker/public/js/app.js: faQuill, registerFaqEditorFormats,
// openFaqTableDialog, faqHtmlForQuill): headings H1-H4, bold / italic /
// underline / strike, alignment, lists, blockquote, inline code and code
// blocks, Note / Important / Warning callouts, link, image (with alt text),
// video, tables with their own row/column toolbar, and clear formatting.
//
// Added for tickets: @mentions of staff, screenshots (upload, paste or drop,
// downscaled so they fit in the browser's storage), screen recordings
// (getDisplayMedia + MediaRecorder) and URLs turned into links as you type.
// Front-end only: a recording plays for this browser session; the real
// console would upload it to Storage as ticket attachments already are.
window.KBEditor = (function () {
  "use strict";

  const CALLOUT_LEVELS = ["note", "important", "warning"];
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // ── Tables (as the FAQ editor) ──────────────────────────────────────────
  function rowsToHtml(rows) {
    const [head, ...body] = rows.length ? rows : [[""]];
    return "<table><thead><tr>" + head.map((c) => "<th>" + c + "</th>").join("") + "</tr></thead>"
      + (body.length ? "<tbody>" + body.map((r) => "<tr>" + r.map((c) => "<td>" + c + "</td>").join("") + "</tr>").join("") + "</tbody>" : "") + "</table>";
  }
  const rowsFromNode = (node) => [...node.querySelectorAll("tr")].map((tr) => [...tr.children].map((cell) => cell.innerHTML.trim()));
  const rowsFromText = (text) => String(text || "").split(/\r?\n/).map((l) => l.trim())
    .filter((l) => l && !/^\|?\s*:?-{2,}/.test(l.replace(/\|/g, "")))
    .map((l) => l.replace(/^\||\|$/g, "").split("|").map((c) => esc(c.trim())));
  function tableToolbarHtml() {
    return '<div class="faq-table-toolbar" contenteditable="false">'
      + '<button type="button" class="faq-table-btn" data-action="add-row">+ Row</button>'
      + '<button type="button" class="faq-table-btn" data-action="remove-row">&minus; Row</button>'
      + '<button type="button" class="faq-table-btn" data-action="add-col">+ Column</button>'
      + '<button type="button" class="faq-table-btn" data-action="remove-col">&minus; Column</button>'
      + '<button type="button" class="faq-table-btn faq-table-btn-danger" data-action="delete-table">Delete table</button></div>';
  }
  function upgradeTables(root) {
    root.querySelectorAll(".faq-table").forEach((wrap) => {
      wrap.setAttribute("contenteditable", "false");
      if (!wrap.querySelector(":scope > .faq-table-toolbar")) wrap.insertAdjacentHTML("afterbegin", tableToolbarHtml());
      wrap.querySelectorAll("th, td").forEach((cell) => cell.setAttribute("contenteditable", "true"));
    });
  }

  // ── Formats (registered once) ───────────────────────────────────────────
  let registered = false;
  function register() {
    if (registered) return;
    registered = true;
    const Block = Quill.import("blots/block");
    const BlockEmbed = Quill.import("blots/block/embed");
    const Embed = Quill.import("blots/embed");

    class CalloutBlot extends Block {
      static create(value) {
        const node = super.create();
        node.setAttribute("class", "callout callout-" + (CALLOUT_LEVELS.includes(value) ? value : "note"));
        return node;
      }
      static formats(node) {
        const m = /callout-(note|important|warning)/.exec(node.getAttribute("class") || "");
        return m ? m[1] : "note";
      }
    }
    CalloutBlot.blotName = "callout"; CalloutBlot.tagName = "DIV"; CalloutBlot.className = "callout";

    class TableBlot extends BlockEmbed {
      static create(value) {
        const node = super.create();
        node.setAttribute("class", "faq-table");
        node.setAttribute("contenteditable", "false");
        node.innerHTML = tableToolbarHtml() + rowsToHtml(Array.isArray(value) ? value : rowsFromText(value));
        node.querySelectorAll("th, td").forEach((c) => c.setAttribute("contenteditable", "true"));
        return node;
      }
      static value(node) { return rowsFromNode(node); }
    }
    TableBlot.blotName = "faqtable"; TableBlot.tagName = "DIV"; TableBlot.className = "faq-table";

    // @mention: an inline chip that keeps who was mentioned.
    class MentionBlot extends Embed {
      static create(value) {
        const node = super.create();
        node.setAttribute("data-user", value.id);
        node.setAttribute("data-name", value.name);
        node.textContent = "@" + value.name;
        return node;
      }
      static value(node) { return { id: node.getAttribute("data-user"), name: node.getAttribute("data-name") }; }
    }
    MentionBlot.blotName = "mention"; MentionBlot.tagName = "SPAN"; MentionBlot.className = "kb-mention";

    // Screen recording: a playable <video> block.
    class RecordingBlot extends BlockEmbed {
      static create(src) {
        const node = super.create();
        node.setAttribute("src", src);
        node.setAttribute("controls", "");
        node.setAttribute("playsinline", "");
        node.setAttribute("preload", "metadata");
        return node;
      }
      static value(node) { return node.getAttribute("src"); }
    }
    RecordingBlot.blotName = "screenrec"; RecordingBlot.tagName = "VIDEO"; RecordingBlot.className = "kb-recording";

    Quill.register(CalloutBlot, true);
    Quill.register(TableBlot, true);
    Quill.register(MentionBlot, true);
    Quill.register(RecordingBlot, true);

    const icons = Quill.import("ui/icons");
    icons.faqtable = '<svg viewBox="0 0 18 18"><rect class="ql-stroke" height="12" width="14" x="2" y="3"></rect><line class="ql-stroke" x1="2" x2="16" y1="7" y2="7"></line><line class="ql-stroke" x1="7" x2="7" y1="7" y2="15"></line></svg>';
    icons.mention = '<svg viewBox="0 0 18 18"><circle class="ql-stroke" cx="9" cy="9" r="2.6"></circle><path class="ql-stroke" d="M11.6 9v1.1a1.9 1.9 0 0 0 3.8 0V9a6.4 6.4 0 1 0-2.6 5.2"></path></svg>';
    icons.screenrec = '<svg viewBox="0 0 18 18"><rect class="ql-stroke" x="1.5" y="3" width="15" height="10" rx="1.5"></rect><line class="ql-stroke" x1="6" x2="12" y1="15.5" y2="15.5"></line><circle class="ql-fill kb-rec-dot" cx="9" cy="8" r="2.4"></circle></svg>';
  }

  const TOOLBAR_FULL = [
    [{ header: [1, 2, 3, 4, false] }],
    ["bold", "italic", "underline", "strike"],
    [{ align: [] }],
    [{ list: "ordered" }, { list: "bullet" }],
    ["blockquote", "code", "code-block"],
    [{ callout: [false, ...CALLOUT_LEVELS] }],
    ["link", "image", "video", "faqtable"],
    ["mention", "screenrec"],
    ["clean"],
  ];
  const TOOLBAR_COMPACT = [
    ["bold", "italic", "strike"],
    [{ list: "ordered" }, { list: "bullet" }],
    ["link", "image", "mention", "screenrec"],
    ["clean"],
  ];
  const TITLES = {
    bold: "Bold", italic: "Italic", underline: "Underline", strike: "Strikethrough", blockquote: "Quote", code: "Inline code",
    "code-block": "Code block", link: "Link", image: "Screenshot or image", video: "Embed video (URL)", faqtable: "Table",
    mention: "Mention someone (@)", screenrec: "Record your screen", clean: "Clear formatting", list: "List",
  };

  // Screenshots are stored inline, so shrink them first (longest side 1400px).
  function imageFileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = reject;
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => resolve(reader.result);
        img.onload = () => {
          const k = Math.min(1, 1400 / Math.max(img.width, img.height));
          if (k === 1 && file.size < 250000) { resolve(reader.result); return; }
          const c = document.createElement("canvas");
          c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
          c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
          resolve(c.toDataURL("image/jpeg", 0.8));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  // ── Create ──────────────────────────────────────────────────────────────
  // opts: { compact, placeholder, users: [{id, first}], onMention(user), onNotice(text) }
  function create(el, opts = {}) {
    register();
    const notice = opts.onNotice || (() => {});
    const q = new Quill(el, {
      theme: "snow",
      placeholder: opts.placeholder || "",
      modules: {
        toolbar: {
          container: opts.compact ? TOOLBAR_COMPACT : TOOLBAR_FULL,
          handlers: {
            faqtable() { tableDialog(q); },
            image() { imageDialog(q); },
            mention() {
              const r = q.getSelection(true);
              q.insertText(r.index, "@", "user");
              q.setSelection(r.index + 1, 0, "user");
            },
            screenrec() { toggleRecording(q, notice); },
          },
        },
      },
    });
    // As in the FAQ editor: drop Quill 1.3.7's spacing heuristic that adds blank lines on load.
    q.clipboard.matchers = q.clipboard.matchers.filter(([, fn]) => !/offsetTop/.test(String(fn)));
    const toolbar = q.getModule("toolbar").container;
    toolbar.querySelectorAll("button, .ql-picker").forEach((b) => {
      const key = [...b.classList].map((c) => c.replace(/^ql-/, "")).find((c) => TITLES[c]);
      if (key) b.setAttribute("title", TITLES[key]);
    });

    // Table row/column buttons
    q.root.addEventListener("click", (e) => {
      const btn = e.target.closest(".faq-table-btn");
      if (!btn) return;
      e.preventDefault();
      const wrap = btn.closest(".faq-table");
      const action = btn.dataset.action;
      if (action === "delete-table") { const blot = Quill.find(wrap); if (blot) q.deleteText(q.getIndex(blot), 1, "user"); return; }
      const table = wrap.querySelector("table");
      if (!table) return;
      if (action === "add-row") {
        const cols = table.rows[0] ? table.rows[0].cells.length : 1;
        let tbody = table.tBodies[0]; if (!tbody) { tbody = document.createElement("tbody"); table.appendChild(tbody); }
        const tr = document.createElement("tr");
        for (let i = 0; i < cols; i++) { const td = document.createElement("td"); td.setAttribute("contenteditable", "true"); tr.appendChild(td); }
        tbody.appendChild(tr);
      } else if (action === "remove-row") { const tb = table.tBodies[0]; if (tb && tb.rows.length) tb.deleteRow(tb.rows.length - 1); }
      else if (action === "add-col") { [...table.rows].forEach((row) => { const c = document.createElement(row.parentNode.tagName === "THEAD" ? "th" : "td"); c.setAttribute("contenteditable", "true"); row.appendChild(c); }); }
      else if (action === "remove-col") { if ((table.rows[0] ? table.rows[0].cells.length : 0) > 1) [...table.rows].forEach((row) => row.deleteCell(row.cells.length - 1)); }
    });

    // Screenshots: paste or drop an image straight into the text.
    const addImages = async (files, index) => {
      for (const f of files) {
        if (!/^image\//.test(f.type)) continue;
        const url = await imageFileToDataUrl(f);
        q.insertEmbed(index, "image", url, "user");
        index += 1;
      }
      q.setSelection(index, 0, "user");
    };
    q.root.addEventListener("paste", (e) => {
      const files = [...((e.clipboardData && e.clipboardData.files) || [])].filter((f) => /^image\//.test(f.type));
      if (!files.length) return;
      e.preventDefault(); e.stopPropagation();
      addImages(files, (q.getSelection(true) || { index: q.getLength() }).index);
    }, true);
    q.root.addEventListener("drop", (e) => {
      const files = [...((e.dataTransfer && e.dataTransfer.files) || [])].filter((f) => /^image\//.test(f.type));
      if (!files.length) return;
      e.preventDefault(); e.stopPropagation();
      addImages(files, (q.getSelection(true) || { index: q.getLength() }).index);
    }, true);

    // URLs become links as you type (after a space or Enter) and when pasted.
    q.on("text-change", (delta, old, source) => {
      if (source !== "user") return;
      const ops = delta.ops || [];
      const last = ops[ops.length - 1];
      if (!last || typeof last.insert !== "string" || !/^[\s]$/.test(last.insert)) return;
      const sel = q.getSelection();
      if (!sel) return;
      const before = q.getText(Math.max(0, sel.index - 300), Math.min(300, sel.index));
      const m = /(?:^|\s)((?:https?:\/\/|www\.)[^\s]+)\s$/.exec(before);
      if (!m) return;
      const url = m[1].replace(/[.,;:!?)]+$/, "");
      const start = sel.index - 1 - (m[1].length);
      if (q.getFormat(start, url.length).link) return;
      q.formatText(start, url.length, "link", /^www\./.test(url) ? "https://" + url : url, "api");
    });
    q.clipboard.addMatcher(Node.TEXT_NODE, (node, delta) => {
      if (typeof node.data !== "string" || !/(https?:\/\/|www\.)/.test(node.data)) return delta;
      const Delta = Quill.import("delta");
      const out = new Delta();
      node.data.split(/((?:https?:\/\/|www\.)[^\s]+)/).forEach((part, i) => {
        if (!part) return;
        if (i % 2) out.insert(part, { link: /^www\./.test(part) ? "https://" + part : part }); else out.insert(part);
      });
      return out;
    });

    if (opts.users) bindMentions(q, opts.users, opts.onMention || (() => {}));
    return q;
  }

  // ── @mention picker ─────────────────────────────────────────────────────
  function bindMentions(q, users, onMention) {
    const box = document.createElement("div");
    box.className = "kb-mention-menu";
    box.hidden = true;
    q.container.appendChild(box);
    let state = null; // { start, query, items, active }
    const close = () => { box.hidden = true; state = null; };
    const pick = (u) => {
      if (!state) return;
      const { start, query } = state;
      q.deleteText(start, query.length + 1, "user");
      q.insertEmbed(start, "mention", { id: u.id, name: u.first }, "user");
      q.insertText(start + 1, " ", "user");
      q.setSelection(start + 2, 0, "user");
      close();
      onMention(u);
    };
    const fold = (x) => String(x).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toLowerCase();
    const draw = () => {
      box.innerHTML = state.items.map((u, i) => `<button type="button" class="kb-mention-item${i === state.active ? " on" : ""}" data-i="${i}"><span class="kb-avatar" style="background:${u.color}">${esc(u.first.charAt(0))}</span>${esc(u.first)}<span class="kb-mention-full">${esc(u.full || "")}</span></button>`).join("") || '<div class="kb-mention-empty">No one matches</div>';
    };
    q.on("editor-change", () => {
      const sel = q.getSelection();
      if (!sel || sel.length) { close(); return; }
      const before = q.getText(Math.max(0, sel.index - 30), Math.min(30, sel.index));
      const m = /(?:^|\s)@([^\s@]*)$/.exec(before);
      if (!m) { close(); return; }
      const query = m[1];
      const items = users.filter((u) => fold(u.first).startsWith(fold(query)) || fold(u.full || "").includes(fold(query)));
      state = { start: sel.index - query.length - 1, query, items, active: 0 };
      draw();
      const b = q.getBounds(sel.index);
      box.style.left = Math.min(b.left, q.container.clientWidth - 220) + "px";
      box.style.top = b.bottom + 6 + "px";
      box.hidden = false;
    });
    box.addEventListener("mousedown", (e) => {
      const it = e.target.closest("[data-i]");
      if (!it) return;
      e.preventDefault();
      pick(state.items[+it.dataset.i]);
    });
    q.root.parentNode.addEventListener("keydown", (e) => {
      if (!state || box.hidden) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault(); e.stopPropagation();
        state.active = (state.active + (e.key === "ArrowDown" ? 1 : -1) + state.items.length) % Math.max(1, state.items.length);
        draw();
      } else if ((e.key === "Enter" || e.key === "Tab") && state.items.length) {
        e.preventDefault(); e.stopPropagation(); pick(state.items[state.active]);
      } else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
    }, true);
  }

  // ── Dialogs (inside the editor, so they sit in the modal) ───────────────
  function panel(q, html, onOk) {
    q.container.querySelectorAll(".kb-ed-panel").forEach((p) => p.remove());
    const p = document.createElement("div");
    p.className = "kb-ed-panel";
    p.innerHTML = html + '<div class="kb-ed-panel-actions"><button type="button" class="btn-ghost" data-x="cancel">Cancel</button><button type="button" class="btn-primary" data-x="ok">Insert</button></div>';
    q.container.appendChild(p);
    const range = q.getSelection(true) || { index: q.getLength() };
    p.addEventListener("click", async (e) => {
      const x = e.target.closest("[data-x]");
      if (!x) return;
      if (x.dataset.x === "cancel") { p.remove(); return; }
      if (await onOk(p, range) !== false) p.remove();
    });
    const first = p.querySelector("input, textarea");
    if (first) setTimeout(() => first.focus(), 20);
    return p;
  }
  function imageDialog(q) {
    panel(q, `<div class="kb-ed-panel-title">Add a screenshot or image</div>
      <label class="btn-attach kb-ed-upload"><span class="material-symbols-outlined" aria-hidden="true">add_photo_alternate</span>Upload screenshot<input type="file" accept="image/*" multiple hidden></label>
      <span class="kb-ed-or">or paste one straight into the text, or use a link</span>
      <label class="field-label">Image URL</label><input type="url" class="kb-input" data-f="url" placeholder="https://">
      <label class="field-label">Alt text</label><input type="text" class="kb-input" data-f="alt" placeholder="What the image shows (leave blank only if decorative)">`,
    (p, range) => {
      const url = p.querySelector('[data-f="url"]').value.trim();
      if (!url) return false;
      q.insertEmbed(range.index, "image", url, "user");
      q.formatText(range.index, 1, "alt", p.querySelector('[data-f="alt"]').value.trim(), "user");
      q.setSelection(range.index + 1, 0, "user");
    });
    const p = q.container.querySelector(".kb-ed-panel");
    const file = p.querySelector('input[type="file"]');
    file.addEventListener("change", async () => {
      const range = q.getSelection(true) || { index: q.getLength() };
      let i = range.index;
      for (const f of file.files) { q.insertEmbed(i, "image", await imageFileToDataUrl(f), "user"); i++; }
      q.setSelection(i, 0, "user");
      p.remove();
    });
  }
  function tableDialog(q) {
    panel(q, `<div class="kb-ed-panel-title">Insert table</div>
      <label class="field-label">Rows: one per line, cells separated by "|". The first line is the header.</label>
      <textarea class="kb-input" rows="5" data-f="rows">Step | Expected | Actual
1 | Offer shows | Offer missing</textarea>`,
    (p, range) => {
      const rows = rowsFromText(p.querySelector('[data-f="rows"]').value);
      if (!rows.length) return false;
      q.insertEmbed(range.index, "faqtable", rows, "user");
      q.setSelection(range.index + 1, 0, "user");
    });
  }

  // ── Screen recording ────────────────────────────────────────────────────
  let rec = null;
  async function toggleRecording(q, notice) {
    const btn = q.getModule("toolbar").container.querySelector(".ql-screenrec");
    if (rec) { rec.recorder.stop(); return; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia || !window.MediaRecorder) {
      notice("Screen recording isn't supported in this browser. Try Chrome, Edge or Firefox on a computer.");
      return;
    }
    let stream;
    try { stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false }); }
    catch (e) { notice(e && e.name === "NotAllowedError" ? "Screen recording was cancelled." : "Screen recording couldn't start."); return; }
    const chunks = [];
    const recorder = new MediaRecorder(stream);
    const range = q.getSelection(true) || { index: q.getLength() };
    rec = { recorder, stream };
    btn.classList.add("kb-recording-on");
    btn.setAttribute("title", "Stop recording");
    notice("Recording your screen. Click the record button again, or stop sharing, to finish.");
    recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      btn.classList.remove("kb-recording-on");
      btn.setAttribute("title", TITLES.screenrec);
      rec = null;
      if (!chunks.length) return;
      const url = URL.createObjectURL(new Blob(chunks, { type: recorder.mimeType || "video/webm" }));
      q.insertEmbed(range.index, "screenrec", url, "user");
      q.setSelection(range.index + 1, 0, "user");
      notice("Screen recording added.");
    };
    stream.getVideoTracks()[0].addEventListener("ended", () => { if (rec && rec.recorder === recorder && recorder.state !== "inactive") recorder.stop(); });
    recorder.start();
  }

  // ── Read / write ────────────────────────────────────────────────────────
  const looksLikeHtml = (s) => /<\/?(p|div|h[1-6]|ul|ol|li|br|strong|em|a|img|video|blockquote|pre|span|table)\b/i.test(s || "");
  function plainToHtml(text) {
    return String(text || "").split(/\n{2,}/).map((para) => "<p>" + esc(para).replace(/\n/g, "<br>") + "</p>").join("");
  }
  function setHtml(q, value) {
    const html = looksLikeHtml(value) ? value : plainToHtml(value);
    q.setContents(q.clipboard.convert(html), "silent");
    upgradeTables(q.root);
  }
  function getHtml(q) {
    const clone = q.root.cloneNode(true);
    clone.querySelectorAll(".faq-table-toolbar").forEach((el) => el.remove());
    clone.querySelectorAll("[contenteditable]").forEach((el) => el.removeAttribute("contenteditable"));
    const empty = !q.getText().trim() && !clone.querySelector("img, video, iframe, .kb-mention, table");
    return empty ? "" : clone.innerHTML;
  }
  const getText = (q) => q.getText().replace(/\n+$/, "");
  const mentionsIn = (html) => {
    const t = document.createElement("template"); t.innerHTML = html || "";
    return [...new Set([...t.content.querySelectorAll(".kb-mention[data-user]")].map((m) => m.getAttribute("data-user")))];
  };
  // Plain text of stored HTML (search, the agent, card hints).
  function toText(value) {
    if (!looksLikeHtml(value)) return String(value || "");
    const t = document.createElement("template"); t.innerHTML = value;
    t.content.querySelectorAll("p, div, li, h1, h2, h3, h4, br").forEach((n) => n.append("\n"));
    return (t.content.textContent || "").replace(/\n{3,}/g, "\n\n").trim();
  }
  // Rendering stored HTML outside the editor (comments): sanitised.
  function sanitize(html) {
    return window.DOMPurify ? DOMPurify.sanitize(html, { ADD_TAGS: ["video", "iframe"], ADD_ATTR: ["controls", "playsinline", "data-user", "data-name", "allowfullscreen", "frameborder", "target"] }) : esc(html);
  }

  return { create, setHtml, getHtml, getText, toText, sanitize, mentionsIn, looksLikeHtml };
})();
