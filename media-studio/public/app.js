/* Media Studio web UI — talks only to this server's /v1 API. */
(() => {
  'use strict';

  // ── API access (optional bearer token, given once as ?token=…) ──────────
  const params = new URLSearchParams(location.search);
  try {
    if (params.get('token')) { sessionStorage.setItem('ms-token', params.get('token')); history.replaceState(null, '', location.pathname); }
  } catch { /* storage blocked: token only lasts for this load */ }
  let token = params.get('token') || '';
  try { token = sessionStorage.getItem('ms-token') || token; } catch { /* ignore */ }

  async function api(path, opts = {}) {
    const headers = { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
    const resp = await fetch(path, { ...opts, headers });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || data.job?.error?.message || `HTTP ${resp.status}`);
    return data;
  }

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const icon = (name) => `<span class="material-symbols-outlined" aria-hidden="true">${name}</span>`;
  const mediaUrl = (p) => `/media/${p.split('/').map(encodeURIComponent).join('/')}`;

  const state = { health: null, presets: null, jobs: new Map(), library: [], libKind: '', refs: [], frames: { image: null, lastFrame: null }, videoProvider: 'veo' };

  const VIDEO_PROVIDERS = {
    veo: { label: 'Veo 3.1', durations: [8, 6, 4], resolutions: ['1080p', '720p', '4k'], hint: 'Best overall quality, with synchronised sound. 4, 6 or 8 seconds.' },
    'veo-fast': { label: 'Veo 3.1 Fast', durations: [8, 6, 4], resolutions: ['1080p', '720p', '4k'], hint: 'Cheaper and quicker Veo — good for drafts.' },
    ltx: { label: 'LTX 2.5 Pro', durations: [6, 8, 10, 'auto'], resolutions: ['1080p'], hint: 'High-fidelity LTX, up to 1080p, with camera-motion control.' },
    'ltx-fast': { label: 'LTX 2.5 Fast', durations: [6, 8, 10, 12, 14, 16, 18, 20, 'auto'], resolutions: ['1080p', '1440p', '4k'], hint: 'Cheapest per second, up to 4K and 20 seconds.' },
  };

  // ── Tabs ────────────────────────────────────────────────────────────────
  function showTab(name) {
    $$('.tab').forEach((t) => { const on = t.dataset.tab === name; t.classList.toggle('active', on); t.setAttribute('aria-selected', String(on)); });
    $$('.panel').forEach((p) => { p.hidden = p.dataset.panel !== name; });
    if (name === 'library') loadLibrary();
  }
  $$('.tab').forEach((t) => t.addEventListener('click', () => showTab(t.dataset.tab)));

  // ── Health, presets, alerts ─────────────────────────────────────────────
  function renderAlerts(error) {
    const box = $('#alerts');
    if (error) { box.innerHTML = `<div class="alert error">${icon('error')}<div>${esc(error)}</div></div>`; return; }
    const h = state.health;
    const missing = [];
    const conf = (id) => h.providers.find((p) => p.id === id)?.configured;
    if (!conf('nano-banana')) missing.push('<code>GEMINI_API_KEY</code> (Nano Banana Pro and Veo)');
    if (!conf('ltx')) missing.push('<code>LTX_API_KEY</code> (LTX 2.5)');
    box.innerHTML = missing.length
      ? `<div class="alert warning">${icon('warning')}<div>Not set up yet: ${missing.join(' and ')}. Add ${missing.length > 1 ? 'them' : 'it'} to <code>media-studio/.env</code> and restart the server.</div></div>`
      : '';
    $$('.wp-only').forEach((el) => { el.hidden = !h.wordpress.configured; });
  }

  function fillSelect(sel, entries, blank) {
    sel.innerHTML = (blank ? `<option value="">${esc(blank)}</option>` : '') + entries.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('');
  }

  function renderPresets() {
    const { formats, styles, cameraMotions } = state.presets;
    fillSelect($('#img-preset'), Object.entries(formats).filter(([, f]) => f.image).map(([k, f]) => [k, f.label]), 'Custom');
    fillSelect($('#vid-preset'), Object.entries(formats).filter(([, f]) => f.video).map(([k, f]) => [k, f.label]), 'Custom');
    $('#img-preset').value = 'blog-hero';
    $('#vid-preset').value = 'blog-hero';
    for (const sel of [$('#img-style'), $('#vid-style')]) fillSelect(sel, Object.entries(styles).map(([k, s]) => [k === 'none' ? '' : k, s.label]));
    fillSelect($('#vid-camera'), cameraMotions.map((m) => [m, m.replace(/_/g, ' ')]), 'Model decides');
  }

  function renderVideoProviders() {
    const seg = $('#video-provider');
    seg.innerHTML = Object.entries(VIDEO_PROVIDERS).map(([id, p]) => {
      const ok = state.health.providers.find((x) => x.id === id)?.configured;
      return `<button type="button" class="seg${id === state.videoProvider ? ' active' : ''}" data-id="${id}" ${ok ? '' : 'disabled title="API key not set"'}>${esc(p.label)}</button>`;
    }).join('');
    $$('.seg', seg).forEach((b) => b.addEventListener('click', () => { state.videoProvider = b.dataset.id; renderVideoProviders(); }));
    const p = VIDEO_PROVIDERS[state.videoProvider];
    $('#provider-hint').textContent = p.hint;
    const res = $('#vid-res'); const prevRes = res.value;
    fillSelect(res, p.resolutions.map((r) => [r, r === '4k' ? '4K' : r]));
    if (p.resolutions.includes(prevRes)) res.value = prevRes;
    const dur = $('#vid-duration'); const prevDur = dur.value;
    fillSelect(dur, p.durations.map((d) => [String(d), d === 'auto' ? 'Auto' : `${d} s`]));
    if (p.durations.map(String).includes(prevDur)) dur.value = prevDur;
    const isLtx = state.videoProvider.startsWith('ltx');
    $$('.veo-only').forEach((el) => { el.hidden = isLtx; });
    $$('.ltx-only').forEach((el) => { el.hidden = !isLtx; });
  }

  // ── Images in: reference list and first/last frame slots ────────────────
  async function fileToDataUrl(file) {
    const raw = await new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(file); });
    if (file.size < 3 * 1024 * 1024) return raw;
    // Large photos are scaled to 2048px JPEG — plenty for a reference, and
    // well inside the providers' inline-image limits.
    const img = await new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = raw; });
    const scale = Math.min(1, 2048 / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.9);
  }

  function renderRefs() {
    $('#img-refs').innerHTML = state.refs.map((r, i) => `<div class="thumb"><img src="${esc(r.preview)}" alt="Reference ${i + 1}" /><button type="button" data-i="${i}" aria-label="Remove reference">${icon('close')}</button></div>`).join('');
    $$('#img-refs button').forEach((b) => b.addEventListener('click', () => { state.refs.splice(Number(b.dataset.i), 1); renderRefs(); }));
  }
  async function addRefFiles(files) {
    for (const f of [...files].filter((x) => x.type.startsWith('image/'))) {
      if (state.refs.length >= 14) break;
      const dataUrl = await fileToDataUrl(f);
      state.refs.push({ preview: dataUrl, value: dataUrl });
    }
    renderRefs();
  }
  $('#img-ref-input').addEventListener('change', (e) => { addRefFiles(e.target.files); e.target.value = ''; });
  wireDrop($('#img-ref-input').closest('.drop'), addRefFiles);

  function wireDrop(el, onFiles) {
    el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('over'); });
    el.addEventListener('dragleave', () => el.classList.remove('over'));
    el.addEventListener('drop', (e) => { e.preventDefault(); el.classList.remove('over'); onFiles(e.dataTransfer.files); });
  }

  function renderFrameSlots() {
    $$('.frame-slot').forEach((slot) => {
      const key = slot.dataset.slot;
      const f = state.frames[key];
      if (f) {
        slot.innerHTML = `<div class="thumb"><img src="${esc(f.preview)}" alt="" /><button type="button" aria-label="Remove frame">${icon('close')}</button></div>`;
        $('button', slot).addEventListener('click', () => { state.frames[key] = null; renderFrameSlots(); });
      } else {
        slot.innerHTML = `<label class="drop">${icon('add_photo_alternate')}<span>Add image</span><input type="file" accept="image/png,image/jpeg,image/webp" hidden /></label>`;
        const set = async (files) => { const file = files[0]; if (!file) return; const d = await fileToDataUrl(file); state.frames[key] = { preview: d, value: d }; renderFrameSlots(); };
        $('input', slot).addEventListener('change', (e) => set(e.target.files));
        wireDrop($('.drop', slot), set);
      }
    });
  }

  // ── Jobs ────────────────────────────────────────────────────────────────
  function mediaTag(file, controls) {
    const u = mediaUrl(file.path);
    return file.mimeType.startsWith('video/')
      ? `<video src="${u}" ${controls ? 'controls' : 'muted'} playsinline preload="metadata"></video>`
      : `<a href="${u}" target="_blank" rel="noopener"><img src="${u}" alt="" loading="lazy" /></a>`;
  }

  function renderJobs() {
    const jobs = [...state.jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 12);
    const html = jobs.length ? jobs.map((j) => {
      const last = j.progress?.[j.progress.length - 1]?.message || 'Queued';
      const prompt = j.prompt || j.result?.prompt || '';
      return `<div class="job">
        <div class="job-head"><span class="dot ${j.status}"></span>${icon(j.kind === 'video' ? 'movie' : 'image')}<span class="job-prompt" title="${esc(prompt)}">${esc(prompt)}</span></div>
        ${j.status === 'running' ? `<div class="job-msg">${esc(last)}</div>` : ''}
        ${j.status === 'failed' ? `<div class="job-error">${esc(j.error?.message)}</div>` : ''}
        ${j.status === 'succeeded' ? `<div class="job-media">${j.result.files.map((f) => mediaTag(f, true)).join('')}</div>` : ''}
      </div>`;
    }).join('') : `<div class="empty">${icon('auto_awesome')}Nothing generated in this session yet.</div>`;
    $$('[data-jobs]').forEach((el) => { el.innerHTML = html; });
  }

  async function pollJob(id) {
    const j = state.jobs.get(id);
    if (!j || j.status !== 'running') return;
    try {
      const { job } = await api(`/v1/jobs/${id}`);
      state.jobs.set(id, { ...job, prompt: j.prompt });
      renderJobs();
      if (job.status === 'running') setTimeout(() => pollJob(id), job.kind === 'video' ? 5000 : 2000);
      else loadLibrary();
    } catch (e) {
      setTimeout(() => pollJob(id), 8000);
    }
  }

  async function submit(kind, body, button) {
    button.disabled = true;
    try {
      const { job } = await api(`/v1/${kind === 'image' ? 'images' : 'videos'}`, { method: 'POST', body: JSON.stringify(body) });
      state.jobs.set(job.id, { ...job, prompt: body.prompt });
      renderJobs();
      pollJob(job.id);
      renderAlerts();
    } catch (e) {
      renderAlerts(e.message);
    } finally {
      button.disabled = false;
    }
  }

  $('#image-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const body = {
      prompt: f.get('prompt'), preset: f.get('preset') || undefined, style: f.get('style') || undefined,
      aspectRatio: f.get('aspectRatio') || undefined, imageSize: f.get('imageSize') || undefined, count: Number(f.get('count')) || 1,
      references: state.refs.map((r) => r.value), groundWithSearch: f.get('groundWithSearch') ? true : undefined,
      publish: f.get('publish') || undefined,
    };
    submit('image', body, $('button[type=submit]', e.target));
  });

  $('#video-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const isLtx = state.videoProvider.startsWith('ltx');
    const dur = f.get('durationSeconds');
    const body = {
      provider: state.videoProvider, prompt: f.get('prompt'), preset: f.get('preset') || undefined, style: f.get('style') || undefined,
      aspectRatio: f.get('aspectRatio') || undefined, resolution: f.get('resolution') || undefined,
      durationSeconds: dur === 'auto' ? 'auto' : Number(dur),
      image: state.frames.image?.value, lastFrame: state.frames.lastFrame?.value,
      negativePrompt: !isLtx ? f.get('negativePrompt') || undefined : undefined,
      cameraMotion: isLtx ? f.get('cameraMotion') || undefined : undefined,
      generateAudio: isLtx ? Boolean(f.get('generateAudio')) : undefined,
      publish: f.get('publish') || undefined,
    };
    submit('video', body, $('button[type=submit]', e.target));
  });

  // ── Library ─────────────────────────────────────────────────────────────
  async function loadLibrary() {
    try {
      const { items } = await api('/v1/library?limit=500');
      state.library = items;
      renderLibrary();
    } catch (e) { renderAlerts(e.message); }
  }

  function renderLibrary() {
    $('#asset-count').textContent = state.library.length;
    const q = $('#lib-search').value.trim().toLowerCase();
    const items = state.library.filter((i) => (!state.libKind || i.kind === state.libKind) && (!q || i.prompt.toLowerCase().includes(q)));
    const wp = state.health?.wordpress.configured;
    $('#library').innerHTML = items.length ? items.map((i) => {
      const file = i.files[0];
      const published = (i.published || [])[0];
      return `<div class="card" data-id="${i.id}">
        <div class="card-media">${mediaTag(file, true)}</div>
        <div class="card-body">
          <div class="card-prompt" title="${esc(i.prompt)}">${esc(i.prompt)}</div>
          <div class="card-meta">${esc(i.provider)} · ${esc(i.model)} · ${esc(new Date(i.createdAt).toLocaleString())}${i.files.length > 1 ? ` · ${i.files.length} files` : ''}</div>
          <div>${i.params?.preset ? `<span class="pill">${esc(state.presets?.formats[i.params.preset]?.label || i.params.preset)}</span>` : ''} ${published ? '<span class="pill">On WordPress</span>' : ''}</div>
        </div>
        <div class="card-actions">
          <a class="btn btn-text btn-sm" href="${mediaUrl(file.path)}" download>${icon('download')}Download</a>
          <button type="button" class="btn btn-text btn-sm" data-act="copy">${icon('link')}Copy link</button>
          ${i.kind === 'image' ? `<button type="button" class="btn btn-text btn-sm" data-act="animate">${icon('animated_images')}Animate</button>
            <button type="button" class="btn btn-text btn-sm" data-act="reference">${icon('add_photo_alternate')}Use as reference</button>
            <button type="button" class="btn btn-text btn-sm" data-act="remix">${icon('edit')}Reuse prompt</button>` : ''}
          ${wp && !published ? `<button type="button" class="btn btn-text btn-sm" data-act="publish">${icon('upload')}Send to WordPress</button>` : ''}
          ${published ? `<a class="btn btn-text btn-sm" href="${esc(published.link || published.url)}" target="_blank" rel="noopener">${icon('open_in_new')}WordPress</a>` : ''}
        </div>
      </div>`;
    }).join('') : `<div class="empty">${icon('photo_library')}${state.library.length ? 'Nothing matches.' : 'Nothing here yet — create an image or a video.'}</div>`;
  }

  $('#library').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const item = state.library.find((i) => i.id === btn.closest('.card').dataset.id);
    const file = item.files[0];
    const act = btn.dataset.act;
    if (act === 'copy') {
      const url = item.published?.[0]?.url || new URL(mediaUrl(file.path), location.href).href;
      try { await navigator.clipboard.writeText(url); btn.lastChild.textContent = 'Copied'; } catch { prompt('Copy this link', url); }
    } else if (act === 'animate') {
      state.frames.image = { preview: mediaUrl(file.path), value: item.id };
      renderFrameSlots();
      $('#vid-prompt').value = '';
      showTab('video');
      $('#vid-prompt').focus();
    } else if (act === 'reference') {
      if (state.refs.length < 14) state.refs.push({ preview: mediaUrl(file.path), value: item.id });
      renderRefs();
      showTab('image');
    } else if (act === 'remix') {
      $('#img-prompt').value = item.prompt;
      if (item.params?.preset) $('#img-preset').value = item.params.preset;
      showTab('image');
      $('#img-prompt').focus();
    } else if (act === 'publish') {
      btn.disabled = true;
      try { await api(`/v1/library/${item.id}/publish`, { method: 'POST', body: '{}' }); await loadLibrary(); } catch (err) { renderAlerts(err.message); btn.disabled = false; }
    }
  });

  $$('#lib-filter .seg').forEach((b) => b.addEventListener('click', () => {
    state.libKind = b.dataset.kind;
    $$('#lib-filter .seg').forEach((x) => x.classList.toggle('active', x === b));
    renderLibrary();
  }));
  $('#lib-search').addEventListener('input', renderLibrary);
  $('#refresh').addEventListener('click', () => { init(); });

  // ── Boot ────────────────────────────────────────────────────────────────
  async function init() {
    try {
      const [health, presets, jobs] = await Promise.all([api('/v1/health'), api('/v1/presets'), api('/v1/jobs')]);
      state.health = health;
      if (!state.presets) { state.presets = presets; renderPresets(); }
      for (const j of jobs.jobs) if (!state.jobs.has(j.id)) { state.jobs.set(j.id, j); if (j.status === 'running') pollJob(j.id); }
      const firstVideo = Object.keys(VIDEO_PROVIDERS).find((id) => health.providers.find((p) => p.id === id)?.configured);
      if (firstVideo && !health.providers.find((p) => p.id === state.videoProvider)?.configured) state.videoProvider = firstVideo;
      renderAlerts();
      renderVideoProviders();
      renderJobs();
      await loadLibrary();
    } catch (e) {
      renderAlerts(e.message === 'Missing or wrong bearer token'
        ? 'This server needs its access token: open the page as …/?token=<MEDIA_STUDIO_TOKEN>.' : `Could not reach the Media Studio API: ${e.message}`);
    }
  }
  renderRefs();
  renderFrameSlots();
  init();
})();
