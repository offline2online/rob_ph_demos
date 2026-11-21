"use strict";

// The config service: every read and write the API offers, independent of
// HTTP and of where data is kept (the store, blobs and clock are injected —
// see README.md → "Adapters").
//
// Each write is one store transaction that:
//   1. reads the whole config (pharmacies, promotions, custom templates —
//      small: a few dozen records),
//   2. applies the change and checks it (validation, unique store codes and
//      promo IDs, optimistic version check),
//   3. writes the changed records, rebuilds the published screen config of
//      every pharmacy the change affects, and appends one audit entry.
// So the published config can never disagree with the admin records, and a
// write that fails leaves nothing behind.

const crypto = require("node:crypto");
const {
  ApiError,
  bad,
  normalisePharmacy,
  normalisePromotion,
  normaliseTemplate,
  normaliseService,
  normaliseStoreCode,
  ORIENTATIONS,
} = require("./validate");
const { BUILTIN_TEMPLATES, BUILTIN_BY_ID, OCCASION_KIND, builtInFor, isBuiltInId, builtInView } = require("./builtins");
const { ownSeasonal } = require("./seasonal");
const { buildScreenConfig } = require("./publish");
const { MEDIA_PREFIX } = require("./adapters/blobs");

const notFound = (what, id) => new ApiError(404, "not-found", `${what} ${id} does not exist`);
const conflict = (code, message) => new ApiError(409, code, message);

const IMAGE_TYPES = {
  "image/png": { ext: "png", magic: (b) => b.length > 8 && b.readUInt32BE(0) === 0x89504e47 && b.readUInt32BE(4) === 0x0d0a1a0a },
  "image/webp": { ext: "webp", magic: (b) => b.length > 12 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP" },
  "image/jpeg": { ext: "jpg", magic: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
};
const UPLOADS = {
  logo: { types: ["image/png", "image/webp"], maxBytes: 2 * 1024 * 1024 },
  background: { types: ["image/png", "image/jpeg", "image/webp"], maxBytes: 5 * 1024 * 1024 },
};

function createConfigService({ store, blobs, now = () => new Date().toISOString(), log = () => {} }) {
  // ── helpers ────────────────────────────────────────────────────────────

  const RECORD_META = ["id", "version", "createdAt", "createdBy", "updatedAt", "updatedBy"];

  function stripMeta(rec) {
    const out = { ...rec };
    for (const k of RECORD_META) delete out[k];
    return out;
  }

  function checkVersion(stored, expectedVersion) {
    if (expectedVersion === undefined || expectedVersion === null || expectedVersion === "") return;
    const want = Number(expectedVersion);
    if (!Number.isInteger(want)) throw bad("expectedVersion must be an integer");
    if ((stored.version || 0) !== want) {
      throw conflict("version-conflict", `This record was changed by someone else (now version ${stored.version || 0}, you had ${want}). Reload it and try again.`);
    }
  }

  function stamp(data, actor, at, stored) {
    return {
      ...data,
      version: ((stored && stored.version) || 0) + 1,
      createdAt: (stored && stored.createdAt) || at,
      createdBy: (stored && stored.createdBy) || actor.uid,
      updatedAt: at,
      updatedBy: actor.uid,
    };
  }

  // For the audit log: the record without bulky content (a short hash per
  // promotion's content instead) and without its bookkeeping fields.
  function auditView(rec) {
    if (!rec) return null;
    const out = stripMeta(rec);
    if (out.content && typeof out.content === "object") {
      out.content = Object.fromEntries(
        Object.entries(out.content).map(([k, v]) => [k, "sha256:" + crypto.createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 16)])
      );
    }
    if (out.master && typeof out.master === "object") out.master = "sha256:" + crypto.createHash("sha256").update(JSON.stringify(out.master)).digest("hex").slice(0, 16);
    if (typeof out.html === "string" && out.html.length > 200) out.html = `(${out.html.length} chars) sha256:${crypto.createHash("sha256").update(out.html).digest("hex").slice(0, 16)}`;
    if (typeof out.css === "string" && out.css.length > 200) out.css = `(${out.css.length} chars) sha256:${crypto.createHash("sha256").update(out.css).digest("hex").slice(0, 16)}`;
    return out;
  }

  function changedFields(before, after) {
    const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
    return [...keys].filter((k) => !RECORD_META.includes(k) && JSON.stringify((before || {})[k]) !== JSON.stringify((after || {})[k])).sort();
  }

  function mediaPaths(rec) {
    const out = [];
    if (rec && rec.logo && rec.logo.path) out.push(rec.logo.path);
    if (rec && rec.backgrounds) for (const o of ORIENTATIONS) if (rec.backgrounds[o] && rec.backgrounds[o].path) out.push(rec.backgrounds[o].path);
    return out;
  }

  // One write transaction (see the header). `mutate(cfg)` gets the current
  // config as Maps keyed by id and returns
  //   { set: [[collection, id, record]], del: [[collection, id]],
  //     audit: { action, entity, entityId, before, after, extra },
  //     result, republish: "all" | [pharmacyIds], unpublish: [storeCodes],
  //     dropMedia: [paths that may now be unreferenced] }
  async function write(actor, mutate, { services = false } = {}) {
    const at = now();
    let orphaned = [];
    const result = await store.transaction(async (tx) => {
      const [pharmacies, promotions, templates, serviceRows] = await Promise.all([
        tx.list("pharmacies"),
        tx.list("promotions"),
        tx.list("templates"),
        services ? tx.list("services") : Promise.resolve([]),
      ]);
      const cfg = {
        pharmacies: new Map(pharmacies.map((r) => [r.id, r])),
        promotions: new Map(promotions.map((r) => [r.id, r])),
        templates: new Map(templates.map((r) => [r.id, r])),
        services: new Map(serviceRows.map((r) => [r.id, r])),
        at,
      };
      // Seasonal content is each pharmacy's own (src/seasonal.js): before the
      // write is applied every pharmacy takes what it plays now, so a change to
      // a Seasonal promotion's master or season below reaches no store.
      const seasonal = new Set();
      for (const [id, ph] of cfg.pharmacies) {
        const own = ownSeasonal(ph, promotions);
        if (own) {
          cfg.pharmacies.set(id, own);
          seasonal.add(id);
        }
      }

      const out = mutate(cfg);
      const sets = out.set || [];
      const dels = out.del || [];

      // The config as it will be after this write, to publish from.
      const next = {
        pharmacies: new Map(cfg.pharmacies),
        promotions: new Map(cfg.promotions),
        templates: new Map(cfg.templates),
      };
      for (const [c, id, rec] of sets) if (next[c]) next[c].set(id, { ...rec, id });
      for (const [c, id] of dels) if (next[c]) next[c].delete(id);

      // And after it: a new pharmacy, a new Seasonal promotion, or a pharmacy
      // whose seasonal content was cleared (Restore to default) starts from the
      // master as it is now.
      const started = [];
      for (const [id, ph] of next.pharmacies) {
        const own = ownSeasonal(ph, [...next.promotions.values()]);
        if (own) {
          next.pharmacies.set(id, own);
          seasonal.add(id);
          started.push(id);
        }
      }

      for (const [c, id, rec] of sets) tx.set(c, id, stripId(rec));
      for (const [c, id] of dels) tx.delete(c, id);
      for (const id of seasonal) if (next.pharmacies.has(id)) tx.set("pharmacies", id, stripId(next.pharmacies.get(id)));
      // The caller gets the record as it was stored.
      if (out.result && out.result.id && seasonal.has(out.result.id) && sets.some(([c, id]) => c === "pharmacies" && id === out.result.id)) {
        out.result = { ...next.pharmacies.get(out.result.id) };
      }

      const toPublish = out.republish === "all" ? [...next.pharmacies.keys()] : [...(out.republish || []), ...started];
      const promos = [...next.promotions.values()];
      const customs = [...next.templates.values()];
      for (const pid of new Set(toPublish)) {
        const ph = next.pharmacies.get(pid);
        if (ph) tx.set("screens", ph.storeCode, buildScreenConfig(ph, promos, customs, at));
      }
      for (const code of out.unpublish || []) {
        if (![...next.pharmacies.values()].some((p) => p.storeCode === code)) tx.delete("screens", code);
      }

      const a = out.audit;
      tx.set("audit", `${at.replace(/[^0-9]/g, "")}-${store.newId()}`, {
        at,
        actorUid: actor.uid,
        actorEmail: actor.email || null,
        action: a.action,
        entity: a.entity,
        entityId: a.entityId,
        changedFields: changedFields(a.before, a.after),
        before: auditView(a.before),
        after: auditView(a.after),
        ...(a.extra || {}),
      });

      // Media no record will point at once this commits.
      const stillUsed = new Set([...next.pharmacies.values(), ...next.templates.values()].flatMap(mediaPaths));
      orphaned = (out.dropMedia || []).filter((p) => p && !stillUsed.has(p));
      return out.result;
    });
    for (const p of orphaned) {
      try {
        await blobs.delete(p);
      } catch (err) {
        log("warn", `could not delete unreferenced media ${p}: ${err.message}`);
      }
    }
    return result;
  }

  function stripId(rec) {
    const { id, ...rest } = rec;
    return rest;
  }

  const withId = (id, rec) => ({ id, ...rec });

  function assertStoreCodeFree(cfg, storeCode, exceptId) {
    for (const p of cfg.pharmacies.values()) {
      if (p.storeCode === storeCode && p.id !== exceptId) throw conflict("duplicate-store-code", `Store code ${storeCode} is already used by ${p.name}`);
    }
  }

  function assertPromoIdFree(cfg, promoId, exceptId) {
    for (const p of cfg.promotions.values()) {
      if (p.promoId === promoId && p.id !== exceptId) throw conflict("duplicate-promo-id", `Promo ID ${promoId} is already used by the promotion "${p.name}"`);
    }
  }

  function assertTemplateExists(cfg, templateId) {
    if (!isBuiltInId(templateId) && !cfg.templates.has(templateId)) throw bad(`templateId ${templateId} is not a built-in or custom template`);
  }

  function templateView(t) {
    return t.builtIn ? builtInView(t) : { ...t, builtIn: false };
  }

  // ── pharmacies ─────────────────────────────────────────────────────────

  // ── store users ────────────────────────────────────────────────────────
  // A store user (actor.admin false, actor.stores = their store codes, from a
  // Personalisation Hub Retail Admin session) sees and edits only the
  // pharmacies with one of those codes, and only their overrides: a
  // promotion's content and which sections are detached from the master.
  // No actor (the seed, internal calls) and admins are not narrowed.
  const narrowed = (actor) => !!actor && actor.admin !== true;
  function assertOwnPharmacy(actor, rec) {
    if (!narrowed(actor)) return;
    if (!rec || !(actor.stores || []).includes(rec.storeCode)) throw new ApiError(403, "forbidden", "This pharmacy is not one of yours");
  }
  const STORE_USER_FIELDS = new Set(["detached"]);

  async function listPharmacies(actor) {
    const all = await store.list("pharmacies");
    const rows = narrowed(actor) ? all.filter((r) => (actor.stores || []).includes(r.storeCode)) : all;
    return rows
      .map(({ content, ...rest }) => ({ ...rest, promotionsWithContent: Object.keys(content || {}).sort() }))
      .sort((a, b) => a.storeCode.localeCompare(b.storeCode));
  }

  async function getPharmacy(id, actor) {
    const rec = await store.get("pharmacies", id);
    // A store user gets the same answer for someone else's pharmacy as for
    // one that does not exist, so ids cannot be probed.
    if (narrowed(actor)) assertOwnPharmacy(actor, rec);
    if (!rec) throw notFound("Pharmacy", id);
    return withId(id, rec);
  }

  // `opts.id` lets the seed (../seed/) create records under fixed ids so a
  // re-run finds them again; the HTTP API never passes it.
  function newRecordId(cfg, collection, opts) {
    if (!opts || opts.id === undefined) return store.newId();
    const id = String(opts.id);
    if (cfg[collection].has(id)) throw conflict("duplicate-id", `${collection} ${id} already exists`);
    return id;
  }

  async function createPharmacy(actor, body, opts) {
    return write(actor, (cfg) => {
      const data = normalisePharmacy(body);
      assertStoreCodeFree(cfg, data.storeCode);
      const id = newRecordId(cfg, "pharmacies", opts);
      const rec = stamp(data, actor, cfg.at);
      return {
        set: [["pharmacies", id, rec]],
        republish: [id],
        audit: { action: "create", entity: "pharmacy", entityId: id, before: null, after: rec },
        result: withId(id, rec),
      };
    });
  }

  async function updatePharmacy(actor, id, body, expectedVersion) {
    return write(actor, (cfg) => {
      const stored = cfg.pharmacies.get(id);
      assertOwnPharmacy(actor, stored);
      if (!stored) throw notFound("Pharmacy", id);
      checkVersion(stored, expectedVersion ?? (body && body.expectedVersion));
      const { expectedVersion: _ignored, ...fields } = body || {};
      if (narrowed(actor)) {
        const extra = Object.keys(fields).filter((k) => !STORE_USER_FIELDS.has(k));
        if (extra.length) throw new ApiError(403, "forbidden", "Only an administrator can change a pharmacy's details");
      }
      const data = normalisePharmacy(fields, stripMeta(stored));
      assertStoreCodeFree(cfg, data.storeCode, id);
      const rec = stamp(data, actor, cfg.at, stored);
      return {
        set: [["pharmacies", id, rec]],
        republish: [id],
        unpublish: stored.storeCode !== data.storeCode ? [stored.storeCode] : [],
        audit: { action: "update", entity: "pharmacy", entityId: id, before: stored, after: rec },
        result: withId(id, rec),
      };
    });
  }

  // One promotion's content for one pharmacy, so two admins editing
  // different promotions of the same pharmacy don't overwrite each other.
  async function setPharmacyContent(actor, id, promotionId, body, expectedVersion) {
    return write(actor, (cfg) => {
      const stored = cfg.pharmacies.get(id);
      assertOwnPharmacy(actor, stored);
      if (!stored) throw notFound("Pharmacy", id);
      if (!cfg.promotions.has(promotionId)) throw notFound("Promotion", promotionId);
      checkVersion(stored, expectedVersion);
      const data = normalisePharmacy({ content: { ...(stored.content || {}), [promotionId]: body } }, stripMeta(stored));
      const rec = stamp(data, actor, cfg.at, stored);
      return {
        set: [["pharmacies", id, rec]],
        republish: [id],
        audit: { action: "update", entity: "pharmacy", entityId: id, before: stored, after: rec, extra: { promotionId } },
        result: withId(id, rec),
      };
    });
  }

  async function deletePharmacy(actor, id, expectedVersion) {
    return write(actor, (cfg) => {
      const stored = cfg.pharmacies.get(id);
      if (!stored) throw notFound("Pharmacy", id);
      checkVersion(stored, expectedVersion);
      return {
        del: [["pharmacies", id]],
        unpublish: [stored.storeCode],
        dropMedia: mediaPaths(stored),
        audit: { action: "delete", entity: "pharmacy", entityId: id, before: stored, after: null },
        result: { id, deleted: true },
      };
    });
  }

  // ── promotions ─────────────────────────────────────────────────────────

  async function listPromotions() {
    const rows = await store.list("promotions");
    return rows.sort((a, b) => a.promoId.localeCompare(b.promoId));
  }

  async function getPromotion(id) {
    const rec = await store.get("promotions", id);
    if (!rec) throw notFound("Promotion", id);
    return withId(id, rec);
  }

  async function createPromotion(actor, body, opts) {
    return write(actor, (cfg) => {
      const data = normalisePromotion(body);
      assertPromoIdFree(cfg, data.promoId);
      assertTemplateExists(cfg, data.templateId);
      const id = newRecordId(cfg, "promotions", opts);
      const rec = stamp(data, actor, cfg.at);
      return {
        set: [["promotions", id, rec]],
        republish: "all",
        audit: { action: "create", entity: "promotion", entityId: id, before: null, after: rec },
        result: withId(id, rec),
      };
    });
  }

  async function updatePromotion(actor, id, body, expectedVersion) {
    return write(actor, (cfg) => {
      const stored = cfg.promotions.get(id);
      if (!stored) throw notFound("Promotion", id);
      checkVersion(stored, expectedVersion ?? (body && body.expectedVersion));
      const { expectedVersion: _ignored, ...fields } = body || {};
      const data = normalisePromotion(fields, stripMeta(stored));
      assertPromoIdFree(cfg, data.promoId, id);
      assertTemplateExists(cfg, data.templateId);
      const rec = stamp(data, actor, cfg.at, stored);
      return {
        set: [["promotions", id, rec]],
        republish: "all",
        audit: { action: "update", entity: "promotion", entityId: id, before: stored, after: rec },
        result: withId(id, rec),
      };
    });
  }

  // A pharmacy's content for a deleted promotion is kept (under the
  // promotion's id) but no longer published; it does no harm and keeps the
  // delete reversible from the audit log.
  async function deletePromotion(actor, id, expectedVersion) {
    return write(actor, (cfg) => {
      const stored = cfg.promotions.get(id);
      if (!stored) throw notFound("Promotion", id);
      checkVersion(stored, expectedVersion);
      return {
        del: [["promotions", id]],
        republish: "all",
        audit: { action: "delete", entity: "promotion", entityId: id, before: stored, after: null },
        result: { id, deleted: true },
      };
    });
  }

  // ── templates ──────────────────────────────────────────────────────────

  async function listTemplates() {
    const customs = (await store.list("templates")).map((t) => ({ ...t, builtIn: false })).sort((a, b) => a.name.localeCompare(b.name));
    return [...BUILTIN_TEMPLATES.map(builtInView), ...customs];
  }

  async function getTemplate(id) {
    if (isBuiltInId(id)) return builtInView(BUILTIN_BY_ID.get(id));
    const rec = await store.get("templates", id);
    if (!rec) throw notFound("Template", id);
    return { id, ...rec, builtIn: false };
  }

  const readOnly = (id) => new ApiError(403, "read-only", `${BUILTIN_BY_ID.get(id).name} is a built-in template and cannot be changed. Clone it to make an editable copy.`);

  async function createTemplate(actor, body) {
    return write(actor, (cfg) => {
      const data = normaliseTemplate(body);
      if (data.basedOn) assertTemplateExists(cfg, data.basedOn);
      const id = store.newId();
      const rec = stamp(data, actor, cfg.at);
      return {
        set: [["templates", id, rec]],
        audit: { action: "create", entity: "template", entityId: id, before: null, after: rec },
        result: templateView(withId(id, rec)),
      };
    });
  }

  async function cloneTemplate(actor, sourceId, body) {
    return write(actor, (cfg) => {
      const src = isBuiltInId(sourceId) ? BUILTIN_BY_ID.get(sourceId) : cfg.templates.get(sourceId) && withId(sourceId, cfg.templates.get(sourceId));
      if (!src) throw notFound("Template", sourceId);
      if (src.kind === OCCASION_KIND) throw bad(`${src.name} is a seasonal template: it has no editable HTML to clone. Pick it in the Seasonal promotion's Season drop-down.`);
      const name = body && body.name !== undefined ? body.name : `${src.name} (copy)`;
      // The clone shares the source's background objects until either is
      // replaced; a shared object is only deleted once nothing points at it.
      const data = normaliseTemplate(
        { name, kind: src.kind, basedOn: src.id, html: src.html, css: src.css },
        { backgrounds: src.backgrounds || {} }
      );
      const id = store.newId();
      const rec = stamp(data, actor, cfg.at);
      return {
        set: [["templates", id, rec]],
        audit: { action: "clone", entity: "template", entityId: id, before: null, after: rec, extra: { clonedFrom: src.id } },
        result: templateView(withId(id, rec)),
      };
    });
  }

  async function updateTemplate(actor, id, body, expectedVersion) {
    if (isBuiltInId(id)) throw readOnly(id);
    return write(actor, (cfg) => {
      const stored = cfg.templates.get(id);
      if (!stored) throw notFound("Template", id);
      checkVersion(stored, expectedVersion ?? (body && body.expectedVersion));
      const { expectedVersion: _ignored, ...fields } = body || {};
      // A template's kind is fixed once made: it decides which built-in its
      // promotions fall back to, and which renderer the screen uses.
      if (fields.kind !== undefined && fields.kind !== stored.kind) throw bad("kind cannot be changed; clone the matching built-in instead");
      const data = normaliseTemplate(fields, stripMeta(stored));
      const rec = stamp(data, actor, cfg.at, stored);
      return {
        set: [["templates", id, rec]],
        republish: "all",
        audit: { action: "update", entity: "template", entityId: id, before: stored, after: rec },
        result: templateView(withId(id, rec)),
      };
    });
  }

  // Requirement: deleting a custom template falls every promotion that used
  // it back to the matching built-in (same kind).
  async function deleteTemplate(actor, id, expectedVersion) {
    if (isBuiltInId(id)) throw readOnly(id);
    return write(actor, (cfg) => {
      const stored = cfg.templates.get(id);
      if (!stored) throw notFound("Template", id);
      checkVersion(stored, expectedVersion);
      const fallback = builtInFor(stored.kind);
      const set = [];
      for (const p of cfg.promotions.values()) {
        if (p.templateId === id) set.push(["promotions", p.id, stamp({ ...stripMeta(p), templateId: fallback.id }, actor, cfg.at, p)]);
      }
      return {
        set,
        del: [["templates", id]],
        republish: "all",
        dropMedia: mediaPaths(stored),
        audit: {
          action: "delete",
          entity: "template",
          entityId: id,
          before: stored,
          after: null,
          extra: { fallbackTemplateId: fallback.id, promotionsFellBack: set.map(([, pid]) => pid) },
        },
        result: { id, deleted: true, fallbackTemplateId: fallback.id, promotionsFellBack: set.map(([, pid]) => pid) },
      };
    });
  }

  // ── service library ────────────────────────────────────────────────────

  async function listServices() {
    const rows = await store.list("services");
    return rows.sort((a, b) => (a.category || "").localeCompare(b.category || "") || a.label.localeCompare(b.label));
  }

  async function getService(id) {
    const rec = await store.get("services", id);
    if (!rec) throw notFound("Service", id);
    return withId(id, rec);
  }

  async function createService(actor, body, opts) {
    return write(
      actor,
      (cfg) => {
        const data = normaliseService(body);
        const id = newRecordId(cfg, "services", opts);
        const rec = stamp(data, actor, cfg.at);
        return {
          set: [["services", id, rec]],
          audit: { action: "create", entity: "service", entityId: id, before: null, after: rec },
          result: withId(id, rec),
        };
      },
      { services: true }
    );
  }

  async function updateService(actor, id, body, expectedVersion) {
    return write(
      actor,
      (cfg) => {
        const stored = cfg.services.get(id);
        if (!stored) throw notFound("Service", id);
        checkVersion(stored, expectedVersion ?? (body && body.expectedVersion));
        const { expectedVersion: _ignored, ...fields } = body || {};
        const data = normaliseService(fields, stripMeta(stored));
        const rec = stamp(data, actor, cfg.at, stored);
        return {
          set: [["services", id, rec]],
          audit: { action: "update", entity: "service", entityId: id, before: stored, after: rec },
          result: withId(id, rec),
        };
      },
      { services: true }
    );
  }

  async function deleteService(actor, id, expectedVersion) {
    return write(
      actor,
      (cfg) => {
        const stored = cfg.services.get(id);
        if (!stored) throw notFound("Service", id);
        checkVersion(stored, expectedVersion);
        return {
          del: [["services", id]],
          audit: { action: "delete", entity: "service", entityId: id, before: stored, after: null },
          result: { id, deleted: true },
        };
      },
      { services: true }
    );
  }

  // ── uploads (logo, template backgrounds) ──────────────────────────────

  function checkImage(kind, contentType, buffer) {
    const rule = UPLOADS[kind];
    const type = String(contentType || "").split(";")[0].trim().toLowerCase();
    if (!rule.types.includes(type)) throw new ApiError(415, "unsupported-media-type", `${kind} must be ${rule.types.join(" or ")}`);
    if (!buffer || !buffer.length) throw bad("The upload is empty");
    if (buffer.length > rule.maxBytes) throw new ApiError(413, "too-large", `${kind} must be at most ${rule.maxBytes / 1024 / 1024} MB`);
    if (!IMAGE_TYPES[type].magic(buffer)) throw bad(`The file is not a valid ${type} image`);
    return { type, ext: IMAGE_TYPES[type].ext, hash: crypto.createHash("sha256").update(buffer).digest("hex").slice(0, 20) };
  }

  // Upload first, then point the record at it in a transaction; if the
  // transaction fails the fresh object is removed again.
  async function withUpload(path, buffer, type, run) {
    const media = await blobs.put(path, buffer, type);
    try {
      return await run({ path: media.path, url: media.url, contentType: type });
    } catch (err) {
      await blobs.delete(path).catch(() => {});
      throw err;
    }
  }

  async function setLogo(actor, id, contentType, buffer) {
    const img = checkImage("logo", contentType, buffer);
    await getPharmacy(id);
    const path = `${MEDIA_PREFIX}logos/${id}/${img.hash}.${img.ext}`;
    return withUpload(path, buffer, img.type, (media) =>
      write(actor, (cfg) => {
        const stored = cfg.pharmacies.get(id);
        if (!stored) throw notFound("Pharmacy", id);
        const rec = stamp({ ...stripMeta(stored), logo: media }, actor, cfg.at, stored);
        return {
          set: [["pharmacies", id, rec]],
          republish: [id],
          dropMedia: stored.logo && stored.logo.path !== path ? [stored.logo.path] : [],
          audit: { action: "upload", entity: "pharmacy", entityId: id, before: stored, after: rec, extra: { media: "logo" } },
          result: withId(id, rec),
        };
      })
    );
  }

  async function removeLogo(actor, id) {
    return write(actor, (cfg) => {
      const stored = cfg.pharmacies.get(id);
      if (!stored) throw notFound("Pharmacy", id);
      const rec = stamp({ ...stripMeta(stored), logo: null }, actor, cfg.at, stored);
      return {
        set: [["pharmacies", id, rec]],
        republish: [id],
        dropMedia: stored.logo ? [stored.logo.path] : [],
        audit: { action: "remove-media", entity: "pharmacy", entityId: id, before: stored, after: rec, extra: { media: "logo" } },
        result: withId(id, rec),
      };
    });
  }

  function orientationOf(o) {
    if (!ORIENTATIONS.includes(o)) throw notFound("Background orientation", o);
    return o;
  }

  async function setBackground(actor, id, orientation, contentType, buffer) {
    if (isBuiltInId(id)) throw readOnly(id);
    const o = orientationOf(orientation);
    const img = checkImage("background", contentType, buffer);
    await getTemplate(id);
    const path = `${MEDIA_PREFIX}backgrounds/${id}/${o}-${img.hash}.${img.ext}`;
    return withUpload(path, buffer, img.type, (media) =>
      write(actor, (cfg) => {
        const stored = cfg.templates.get(id);
        if (!stored) throw notFound("Template", id);
        const old = stored.backgrounds && stored.backgrounds[o];
        const rec = stamp({ ...stripMeta(stored), backgrounds: { ...stored.backgrounds, [o]: media } }, actor, cfg.at, stored);
        return {
          set: [["templates", id, rec]],
          republish: "all",
          dropMedia: old && old.path !== path ? [old.path] : [],
          audit: { action: "upload", entity: "template", entityId: id, before: stored, after: rec, extra: { media: `background.${o}` } },
          result: templateView(withId(id, rec)),
        };
      })
    );
  }

  async function removeBackground(actor, id, orientation) {
    if (isBuiltInId(id)) throw readOnly(id);
    const o = orientationOf(orientation);
    return write(actor, (cfg) => {
      const stored = cfg.templates.get(id);
      if (!stored) throw notFound("Template", id);
      const old = stored.backgrounds && stored.backgrounds[o];
      const rec = stamp({ ...stripMeta(stored), backgrounds: { ...stored.backgrounds, [o]: null } }, actor, cfg.at, stored);
      return {
        set: [["templates", id, rec]],
        republish: "all",
        dropMedia: old ? [old.path] : [],
        audit: { action: "remove-media", entity: "template", entityId: id, before: stored, after: rec, extra: { media: `background.${o}` } },
        result: templateView(withId(id, rec)),
      };
    });
  }

  // ── public read and audit ──────────────────────────────────────────────

  async function getScreenConfig(storeCodeRaw, promoId) {
    let storeCode;
    try {
      storeCode = normaliseStoreCode(storeCodeRaw);
    } catch {
      throw notFound("Screen config for store", String(storeCodeRaw).slice(0, 40));
    }
    const doc = await store.get("screens", storeCode);
    if (!doc) throw notFound("Screen config for store", storeCode);
    if (promoId === undefined || promoId === null || promoId === "") return doc;
    const key = String(promoId).toLowerCase();
    const promo = doc.promotions && doc.promotions[key];
    if (!promo) throw new ApiError(404, "unknown-promo", `No promotion with promo ID ${key}`);
    return { ...doc, promotions: { [key]: promo } };
  }

  async function listAudit({ limit = 100, entity, entityId } = {}) {
    const n = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 500);
    const filtered = Boolean(entity || entityId);
    const rows = await store.list("audit", { orderBy: "at", desc: true, limit: filtered ? 500 : n });
    return rows.filter((r) => (!entity || r.entity === entity) && (!entityId || r.entityId === entityId)).slice(0, n);
  }

  return {
    listPharmacies, getPharmacy, createPharmacy, updatePharmacy, setPharmacyContent, deletePharmacy, setLogo, removeLogo,
    listPromotions, getPromotion, createPromotion, updatePromotion, deletePromotion,
    listTemplates, getTemplate, createTemplate, cloneTemplate, updateTemplate, deleteTemplate, setBackground, removeBackground,
    listServices, getService, createService, updateService, deleteService,
    getScreenConfig, listAudit,
  };
}

module.exports = { createConfigService, UPLOADS };
