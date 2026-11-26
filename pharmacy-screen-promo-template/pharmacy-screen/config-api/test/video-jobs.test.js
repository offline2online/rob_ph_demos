"use strict";

// Download MP4's job service (src/video/jobs.js) and format rules (src/video/format.js), with no browser: the
// renders themselves are in ../test/e2e/video.test.mjs (real Chromium and ffmpeg, checked with ffprobe).

const test = require("node:test");
const assert = require("node:assert/strict");
const { createConfigApi } = require("../src/api");
const { createMemoryStore } = require("../src/adapters/memory-store");
const { createMemoryBlobs } = require("../src/adapters/blobs");
const { createStaticAuth } = require("../src/adapters/auth");
const { runVideoJob, LEASE_MS } = require("../src/video/jobs");
const { VideoError } = require("../src/video/render");
const { videoFileName, ffmpegArgs, frameCount, MAX_SECONDS } = require("../src/video/format");

const USERS = { a: { uid: "a", email: "admin@example.com", admin: true }, v: { uid: "v", email: "viewer@example.com", admin: false } };

async function setup({ video } = {}) {
  const store = createMemoryStore();
  let t = Date.parse("2026-11-26T00:00:00Z");
  const clock = { now: () => t, add: (ms) => { t += ms; } };
  const dispatched = [];
  const api = createConfigApi({
    store, blobs: createMemoryBlobs({ baseUrl: "/media/" }), auth: createStaticAuth(USERS),
    video: video === null ? {} : { screenPageUrl: "https://screens.example.com/pharmacy-screen.html", dispatch: async (id) => { dispatched.push(id); }, now: clock.now, ...(video || {}) },
  });
  const call = async (method, path, body, token = "a") => {
    const out = await api.handle({ method, path, headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? Buffer.from(JSON.stringify(body)) : undefined });
    return { status: out.status, body: out.body };
  };
  const promo = (await call("POST", "/api/admin/promotions", { name: "Sales Promos copy", promoId: "summer", templateId: "builtin-promotion-scenes" })).body;
  const ph = (await call("POST", "/api/admin/pharmacies", { storeCode: "VIC-MP-009", name: "Brighton Pharmacy", device: " DEVICE-9 ", colours: { primary: "#000000", accent: "#ffffff" } })).body;
  return { store, clock, dispatched, call, promo, ph };
}

test("a pharmacy's screen device ID: optional, trimmed, checked, cleared with ''", async () => {
  const { call, ph } = await setup();
  assert.equal(ph.device, "DEVICE-9");
  for (const bad of ["${UniqueDeviceID}", "has space", "x".repeat(129), 12]) {
    const r = await call("PATCH", `/api/admin/pharmacies/${ph.id}`, { device: bad });
    assert.equal(r.status, 400, String(bad));
  }
  const cleared = await call("PATCH", `/api/admin/pharmacies/${ph.id}`, { device: "" });
  assert.equal(cleared.status, 200);
  assert.ok(!("device" in cleared.body));
  // Never published to the screens: the published config is built by allow-list.
  const pub = await call("GET", "/api/screens/VIC-MP-009", undefined, null);
  assert.ok(!JSON.stringify(pub.body).includes("DEVICE-9"));
});

test("start: the job names the real screen page with the pharmacy's device, and dispatches once", async () => {
  const { call, ph, promo, dispatched, store } = await setup();
  const r = await call("POST", "/api/admin/videos", { pharmacyId: ph.id, promotionId: promo.id, orientation: "portrait" });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.deepEqual(Object.keys(r.body).sort(), ["error", "fileName", "id", "orientation", "progress", "seconds", "status", "url"]);
  assert.equal(r.body.status, "queued");
  assert.deepEqual(dispatched, [r.body.id]);
  const job = await store.get("videoJobs", r.body.id);
  assert.equal(job.pageUrl, "https://screens.example.com/pharmacy-screen.html?device=DEVICE-9&promo=summer&orientation=portrait&capture=1");
  assert.equal(job.createdBy, "admin@example.com");
  // What the editor reads back never shows who asked or the page it loads.
  const got = await call("GET", `/api/admin/videos/${r.body.id}`);
  assert.ok(!JSON.stringify(got.body).includes("DEVICE-9") && !JSON.stringify(got.body).includes("admin@example.com"));
});

test("one at a time: a second start is 429 until the first ends, or its lease runs out", async () => {
  const { call, ph, promo, clock, store } = await setup();
  const body = { pharmacyId: ph.id, promotionId: promo.id, orientation: "landscape" };
  const first = await call("POST", "/api/admin/videos", body);
  assert.equal((await call("POST", "/api/admin/videos", body)).status, 429);
  // A worker that died: past the lease the job reads as failed and a new render may start.
  clock.add(LEASE_MS + 1000);
  const stale = await call("GET", `/api/admin/videos/${first.body.id}`);
  assert.equal(stale.body.status, "failed");
  assert.match(stale.body.error, /took too long/);
  const second = await call("POST", "/api/admin/videos", body);
  assert.equal(second.status, 201);
  // The worker finishing releases it at once.
  await runVideoJob(second.body.id, { store, now: clock.now, render: async () => ({ file: "/tmp/x.mp4", seconds: 10 }), upload: async () => ({ url: "https://files.example/x.mp4" }) });
  const done = (await call("GET", `/api/admin/videos/${second.body.id}`)).body;
  assert.equal(done.status, "done");
  assert.equal(done.fileName, "brighton-pharmacy-sales-promos-copy-landscape-10s_android.mp4");
  assert.equal(done.url, "https://files.example/x.mp4");
  assert.equal((await call("POST", "/api/admin/videos", body)).status, 201);
});

test("failures: a plain message from the renderer is shown as it is; anything else is generic; the lease is released", async () => {
  const { call, ph, promo, store, clock } = await setup();
  const body = { pharmacyId: ph.id, promotionId: promo.id, orientation: "portrait" };
  const a = (await call("POST", "/api/admin/videos", body)).body;
  await runVideoJob(a.id, { store, now: clock.now, render: async () => { throw new VideoError("too-long", `This promotion runs 200 seconds; a video can be at most ${MAX_SECONDS} seconds.`); }, upload: async () => ({}) });
  assert.match((await call("GET", `/api/admin/videos/${a.id}`)).body.error, /runs 200 seconds/);
  const b = (await call("POST", "/api/admin/videos", body)).body;
  await runVideoJob(b.id, { store, now: clock.now, render: async () => { throw new Error("spawn /tmp/chromium ENOENT"); }, upload: async () => ({}) });
  const failed = (await call("GET", `/api/admin/videos/${b.id}`)).body;
  assert.equal(failed.status, "failed");
  assert.equal(failed.error, "The video could not be made. Try again.");
  // A job is run once: a second delivery of the same task does nothing.
  assert.deepEqual(await runVideoJob(b.id, { store, render: async () => assert.fail("rendered twice"), upload: async () => ({}) }), { skipped: true });
});

test("refused: no device, bad input, non-admin, not set up, dispatch failing", async () => {
  const { call, ph, promo } = await setup();
  await call("PATCH", `/api/admin/pharmacies/${ph.id}`, { device: "" });
  const none = await call("POST", "/api/admin/videos", { pharmacyId: ph.id, promotionId: promo.id, orientation: "portrait" });
  assert.equal(none.status, 409);
  assert.match(none.body.error.message, /screen device ID in Settings/);
  await call("PATCH", `/api/admin/pharmacies/${ph.id}`, { device: "DEVICE-9" });
  assert.equal((await call("POST", "/api/admin/videos", { pharmacyId: ph.id, promotionId: promo.id, orientation: "square" })).status, 400);
  assert.equal((await call("POST", "/api/admin/videos", { pharmacyId: ph.id, promotionId: promo.id, orientation: "portrait", occasion: "halloween" })).status, 400);
  assert.equal((await call("POST", "/api/admin/videos", { pharmacyId: "nope", promotionId: promo.id, orientation: "portrait" })).status, 404);
  assert.equal((await call("POST", "/api/admin/videos", { pharmacyId: ph.id, promotionId: promo.id, orientation: "portrait" }, "v")).status, 403);
  assert.equal((await call("GET", "/api/admin/videos/abc", undefined, "v")).status, 403);
  assert.equal((await call("GET", "/api/admin/videos/does-not-exist")).status, 404);
  const off = await setup({ video: null });
  const r = await off.call("POST", "/api/admin/videos", { pharmacyId: off.ph.id, promotionId: off.promo.id, orientation: "portrait" });
  assert.equal(r.status, 503);
  const broken = await setup({ video: { dispatch: async () => { throw new Error("queue down"); } } });
  const b = await broken.call("POST", "/api/admin/videos", { pharmacyId: broken.ph.id, promotionId: broken.promo.id, orientation: "portrait" });
  assert.equal(b.status, 503);
  // The failed start released the lease.
  const again = await broken.call("POST", "/api/admin/videos", { pharmacyId: broken.ph.id, promotionId: broken.promo.id, orientation: "portrait" });
  assert.equal(again.status, 503);
});

test("file name: <pharmacy>-<promotion>-<orientation>-<seconds>s_android.mp4, lower case and hyphenated", () => {
  assert.equal(videoFileName({ pharmacy: "Beaumaris Pharmacy", promotion: "Sales Promos", orientation: "portrait", seconds: 10 }), "beaumaris-pharmacy-sales-promos-portrait-10s_android.mp4");
  assert.equal(videoFileName({ pharmacy: "St. Kilda's  Chemist & Co", promotion: "Seasonal Valentine's Day", orientation: "landscape", seconds: 7.4 }), "st-kilda-s-chemist-and-co-seasonal-valentine-s-day-landscape-7s_android.mp4");
  assert.equal(videoFileName({ pharmacy: "Pharmacie Café", promotion: "Morning", orientation: "portrait", seconds: 11 }), "pharmacie-cafe-morning-portrait-11s_android.mp4");
});

test("format: the encoder arguments are the Android 12 signage format, and a loop is whole frames at 25 fps", () => {
  const a = ffmpegArgs("landscape", "/tmp/o.mp4").join(" ");
  for (const want of ["-an", "scale=1920:1080:out_color_matrix=bt709:out_range=tv,fps=25,format=yuv420p,setsar=1", "-c:v libx264", "-profile:v main", "-level:v 4.0", "-crf 18", "-maxrate 6M", "-bufsize 12M", "-g 50", "-keyint_min 50", "-sc_threshold 0", "-bf 3", "-colorspace bt709", "-color_range tv", "-bsf:v filter_units=remove_types=6", "-fps_mode cfr", "-video_track_timescale 12800", "-map_metadata -1", "-movflags +faststart", "-brand mp42"]) {
    assert.ok(a.includes(want), want);
  }
  assert.match(ffmpegArgs("portrait", "/tmp/o.mp4").join(" "), /scale=1080:1920:/);
  assert.equal(frameCount(10), 250);
  assert.equal(frameCount(10.65), 266);
  assert.equal(frameCount(11), 275);
});

test("a cloud worker whose Chromium or ffmpeg cannot load writes the failure on the job, not a job stuck queued", async () => {
  const { cloudRender } = require("../src/video/worker");
  // Making the renderer loads nothing: @sparticuz/chromium and ffmpeg-static are not installed here, and this must
  // not throw before runVideoJob() can catch it.
  const render = cloudRender();
  assert.equal(typeof render, "function");
  const { call, ph, promo, store, clock } = await setup();
  const job = (await call("POST", "/api/admin/videos", { pharmacyId: ph.id, promotionId: promo.id, orientation: "portrait" })).body;
  assert.deepEqual(await runVideoJob(job.id, { store, now: clock.now, render, upload: async () => assert.fail("nothing to upload") }), { ok: false });
  const failed = (await call("GET", `/api/admin/videos/${job.id}`)).body;
  assert.equal(failed.status, "failed");
  assert.equal(failed.error, "The video could not be made. Try again.");
  // ...and the lease is released, so the next one can start.
  assert.equal((await call("POST", "/api/admin/videos", { pharmacyId: ph.id, promotionId: promo.id, orientation: "portrait" })).status, 201);
});

test("ffmpeg that cannot start fails the job within seconds with that reason, frees the slot, and never launches a browser", async () => {
  const { cloudRender } = require("../src/video/worker");
  const logs = [];
  let launched = false;
  const render = cloudRender({ launch: async () => { launched = true; throw new Error("no browser in this test"); }, ffmpegPath: "/nonexistent/ffmpeg-missing" });
  const { call, ph, promo, store, clock } = await setup();
  const job = (await call("POST", "/api/admin/videos", { pharmacyId: ph.id, promotionId: promo.id, orientation: "portrait" })).body;
  const t0 = Date.now();
  const out = await runVideoJob(job.id, { store, now: clock.now, render, upload: async () => assert.fail("nothing to upload"), log: (level, msg) => logs.push(`${level} ${msg}`) });
  assert.deepEqual(out, { ok: false });
  assert.ok(Date.now() - t0 < 5000, `failed in ${Date.now() - t0} ms`);
  assert.equal(launched, false, "no browser is started when ffmpeg cannot start");
  const failed = (await call("GET", `/api/admin/videos/${job.id}`)).body;
  assert.equal(failed.status, "failed");
  assert.match(failed.error, /video encoder could not start/);
  assert.ok(!/ffmpeg/i.test(failed.error), "no internal names in the editor's copy (ph-designer)");
  assert.ok(!/ENOENT|nonexistent/.test(failed.error), "the editor's message holds no internals");
  assert.match((await store.get("videoJobs", job.id)).errorDetail, /^ffmpeg could not start: .*ENOENT/);
  assert.ok(logs.some((l) => /ffmpeg could not start: .*ENOENT/.test(l)), logs.join("\n"));
  assert.equal((await call("POST", "/api/admin/videos", { pharmacyId: ph.id, promotionId: promo.id, orientation: "portrait" })).status, 201, "the slot is free again");
});

test("ffmpeg that starts and then exits: a pending frame write rejects at once instead of waiting for ever", async () => {
  const { startFfmpeg } = require("../src/video/render");
  // `node -e "process.exit(3)"` stands in for an ffmpeg that dies straight away (a bad argument, a broken build).
  const ff = await startFfmpeg(process.execPath, ["-e", "setTimeout(() => process.exit(3), 50)"]);
  const big = Buffer.alloc(4 * 1024 * 1024, 0xff); // larger than any pipe buffer, like a 1080x1920 JPEG
  const t0 = Date.now();
  await assert.rejects(Promise.race([ff.write(big).then(() => ff.write(big)), new Promise((_, r) => setTimeout(() => r(new Error("write still pending after 5 s")), 5000))]), /ffmpeg exited with 3/);
  assert.ok(Date.now() - t0 < 5000);
  await assert.rejects(ff.done, /ffmpeg exited with 3/);
  await assert.rejects(ff.write(big), /ffmpeg exited with 3/, "later writes fail straight away too");
});

test("a Chromium that cannot start fails the job with a plain message and stops ffmpeg", async () => {
  const { cloudRender } = require("../src/video/worker");
  const render = cloudRender({ launch: async () => { throw new Error("Executable doesn't exist at /x/chrome"); }, ffmpegPath: process.execPath });
  const { call, ph, promo, store, clock } = await setup();
  const job = (await call("POST", "/api/admin/videos", { pharmacyId: ph.id, promotionId: promo.id, orientation: "portrait" })).body;
  assert.deepEqual(await runVideoJob(job.id, { store, now: clock.now, render, upload: async () => assert.fail("nothing to upload") }), { ok: false });
  const failed = (await call("GET", `/api/admin/videos/${job.id}`)).body;
  assert.match(failed.error, /headless browser could not start/);
  assert.match((await store.get("videoJobs", job.id)).errorDetail, /^Chromium could not start: Executable doesn't exist/);
});
