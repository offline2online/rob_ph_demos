// Mock data for the Kanban — Staff Task Board prototype. Front-end only:
// nothing here is read from or written to Firestore. "Today" is fixed to
// 20 Oct 2026 so due dates and days-to-release read the same for everyone.
window.KB_SEED = (function () {
  const TODAY = "2026-10-20";

  // Platform users, as listed under Settings → Team & agent access. The board
  // shows each by first name only.
  const users = [
    { id: "rob", first: "Rob", full: "Rob", email: "rob@offline2online.com", location: "London", color: "#169bc2" },
    { id: "minh", first: "Minh", full: "Nguyễn Văn Minh", email: "minh.nguyen@personalisationhub.com", location: "Hà Nội", color: "#9747ff" },
    { id: "linh", first: "Linh", full: "Trần Thị Linh", email: "linh.tran@personalisationhub.com", location: "Hà Nội", color: "#d4433f" },
    { id: "huy", first: "Huy", full: "Lê Quang Huy", email: "huy.le@personalisationhub.com", location: "Hồ Chí Minh City", color: "#2f8f4e" },
    { id: "thao", first: "Thảo", full: "Phạm Thu Thảo", email: "thao.pham@personalisationhub.com", location: "Đà Nẵng", color: "#c98a0a" },
    { id: "duc", first: "Đức", full: "Đỗ Minh Đức", email: "duc.do@personalisationhub.com", location: "Hồ Chí Minh City", color: "#5b6b7a" },
  ];

  const releases = [
    { id: "4.11", name: "PH 4.11", date: "2026-10-09", released: true },
    { id: "4.12", name: "PH 4.12", date: "2026-10-28", released: false },
    { id: "4.13", name: "PH 4.13", date: "2026-12-04", released: false },
  ];

  const sprints = [
    { id: "s40", name: "Sprint 40", range: "30 Sep – 13 Oct" },
    { id: "s41", name: "Sprint 41", range: "14 Oct – 27 Oct" },
    { id: "s42", name: "Sprint 42", range: "28 Oct – 10 Nov" },
  ];


  const labels = ["menu-boards", "dsp", "help-centre", "retail-admin", "hq-admin", "visitor-profile", "performance", "accessibility", "api", "security"];

  // t(key, type, title, status, assignee, reporter, release, estimateH, loggedH, priority, sprint, due, labels, epic, extra)
  let rank = 0;
  function t(key, type, title, status, assignee, reporter, release, estimate, logged, priority, sprint, due, lbls, epic, extra) {
    rank += 10;
    return Object.assign({
      key, type, title, status, assignee, reporter, release, estimate, logged, priority, sprint,
      due: due || "", labels: lbls || [], epic: epic || "", rank,
      description: "", comments: [], attachments: [], links: [], previousAssignee: "",
      created: "2026-10-01T09:00:00Z",
    }, extra || {});
  }

  const tasks = [
    // ── Epics: tickets of type "epic"; any task or bug can name one as its parent
    t("KAN-12", "epic", "Menu Boards — scheduled local offers", "in-progress", "huy", "rob", "4.12", "", 0, "high", "", "", ["menu-boards"], "", {
      description: "Let HQ and stores schedule local offers on menu boards: start and end times, store groups, and correct pricing in previews and on screen.",
    }),
    t("KAN-15", "epic", "Display Types & DSP exchange go-live", "in-progress", "duc", "rob", "4.12", "", 0, "highest", "", "2026-10-28", ["dsp"], ""),
    t("KAN-18", "epic", "Help Centre migration off Freshdesk", "in-progress", "thao", "rob", "4.12", "", 0, "medium", "", "", ["help-centre"], ""),
    t("KAN-21", "epic", "Live Visitor Profile — personalisation attributes", "ready-for-dev", "minh", "rob", "4.13", "", 0, "high", "", "", ["visitor-profile"], ""),
    t("KAN-24", "epic", "Retail Admin queueing & appointments refresh", "backlog", "linh", "rob", "4.13", "", 0, "medium", "", "", ["retail-admin"], ""),

    // ── Backlog
    t("KAN-131", "task", "Bulk-schedule local offers across a store group", "backlog", "", "rob", "4.13", 24, 0, "medium", "", "", ["menu-boards", "hq-admin"], "KAN-12", {
      description: "As an HQ marketer I want to schedule one local offer for every store in a group (e.g. all London high-street stores) so I don't have to repeat it per store.\n\nAcceptance:\n- Choose a store group or tag\n- Preview the stores affected before saving\n- Respects each store's own price override",
    }),
    t("KAN-132", "bug", "Offer expiry sweep ignores the store's time zone", "backlog", "huy", "linh", "4.12", 12, 0, "high", "s42", "2026-10-30", ["menu-boards"], "KAN-12", {
      flagged: true,
      description: "Offers in stores outside Europe/London expire an hour early or late around DST. The sweep compares against UTC midnight instead of the store's local midnight.",
      links: [{ type: "relates to", key: "KAN-118" }],
    }),
    t("KAN-133", "task", "Add personalisation attribute audit log export (CSV)", "backlog", "", "minh", "4.13", 10, 0, "low", "", "", ["visitor-profile"], "KAN-21"),
    t("KAN-134", "task", "Partner API: webhook for sold-slot confirmation", "backlog", "duc", "rob", "4.13", 16, 0, "medium", "", "", ["dsp", "api"], "KAN-15"),
    t("KAN-135", "bug", "Help Centre search returns archived articles", "backlog", "", "thao", "4.12", 3, 0, "medium", "", "", ["help-centre"], "KAN-18"),
    t("KAN-136", "task", "Accessibility pass on Retail Admin queue screen (WCAG 2.2 AA)", "backlog", "thao", "rob", "4.13", 12, 0, "medium", "", "", ["retail-admin", "accessibility"], "KAN-24"),

    // ── Ready for Dev
    t("KAN-121", "task", "Appointment reminders by SMS 2 hours before slot", "ready-for-dev", "linh", "rob", "4.12", 24, 0, "high", "s41", "2026-10-31", ["retail-admin"], "KAN-24", {
      description: "Send an SMS reminder 2 hours before a booked appointment. Customer can reply C to cancel, which frees the slot in the queue.",
    }),
    t("KAN-122", "task", "Rate-limit headers on the Partner API (X-RateLimit-*)", "ready-for-dev", "duc", "minh", "4.12", 5, 0, "medium", "s41", "", ["dsp", "api", "security"], "KAN-15"),
    t("KAN-123", "bug", "Product Assets: PNG upload over 8 MB fails silently", "ready-for-dev", "huy", "thao", "4.12", 8, 0, "high", "s41", "2026-10-24", ["hq-admin"], "", {
      description: "Uploading a PNG larger than 8 MB on Product Assets shows the spinner then nothing. Should show the size limit and reject the file up front.",
      attachments: [{ name: "upload-fails.mov", size: "4.2 MB" }],
    }),
    t("KAN-124", "task", "Visitor attribute envelope v1.3 — add consent scope", "ready-for-dev", "minh", "rob", "4.12", 12, 0, "highest", "s41", "2026-10-28", ["visitor-profile", "api"], "KAN-21", {
      links: [{ type: "blocks", key: "KAN-127" }],
    }),

    // ── In Progress
    t("KAN-111", "task", "Display Types: drag to reorder playlist elements", "in-progress", "duc", "rob", "4.12", 16, 9, "high", "s41", "2026-10-27", ["dsp", "hq-admin"], "KAN-15", {
      description: "Elements in a playlist can be reordered by drag and drop; order is saved immediately and reflected in the next play window.",
      comments: [{ author: "duc", at: "2026-10-17T08:40:00Z", text: "Reorder works, persisting order next. Using the same rank approach as the exchange's slot list." }],
    }),
    t("KAN-112", "bug", "Menu board preview shows RRP instead of local offer price", "in-progress", "huy", "rob", "4.12", 6, 4.5, "highest", "s41", "2026-10-21", ["menu-boards"], "KAN-12", {
      flagged: true,
      description: "On the Menu Board preview, products with an active local offer still show HQ RRP. The live board is correct; only the preview is wrong.",
      comments: [
        { author: "rob", at: "2026-10-16T10:12:00Z", text: "Seen on Covent Garden store — screenshot attached." },
        { author: "huy", at: "2026-10-18T03:05:00Z", text: "Preview reads the cached price map. Fix in review." },
      ],
      attachments: [{ name: "covent-garden-preview.png", size: "612 KB" }],
    }),
    t("KAN-113", "task", "Migrate 140 FAQ articles' images to Firebase Storage", "in-progress", "thao", "rob", "4.12", 10, 6, "medium", "s41", "2026-10-29", ["help-centre"], "KAN-18"),
    t("KAN-114", "task", "Queue: staff can transfer a customer to another desk", "in-progress", "linh", "rob", "4.12", 20, 3, "medium", "s41", "", ["retail-admin"], "KAN-24"),
    t("KAN-115", "task", "Personalisation attribute cache — 15-minute TTL", "in-progress", "minh", "minh", "4.12", 8, 7.5, "high", "s41", "2026-10-20", ["visitor-profile", "performance"], "KAN-21"),
    t("KAN-116", "bug", "Exchange: two winners recorded for the same play window", "in-progress", "duc", "minh", "4.12", 8, 10, "highest", "s41", "2026-10-19", ["dsp"], "KAN-15", {
      flagged: true,
      description: "Under concurrent bids two winners can be written for one window. Migration 0021's unique index should prevent this; the SQLite path bypasses it.",
      links: [{ type: "is blocked by", key: "KAN-122" }],
    }),

    // ── Ready for Testing (reassigned to Rob)
    t("KAN-101", "task", "Stockists tab: filter by region", "ready-for-testing", "rob", "rob", "4.12", 6, 6.5, "medium", "s41", "", ["hq-admin"], "", { previousAssignee: "huy" }),
    t("KAN-102", "bug", "Retail Admin: store hours save loses the Sunday row", "ready-for-testing", "rob", "linh", "4.12", 3, 2, "high", "s41", "2026-10-22", ["retail-admin"], "KAN-24", { previousAssignee: "linh" }),
    t("KAN-103", "task", "Help Centre: redirect old Freshdesk article URLs", "ready-for-testing", "rob", "rob", "4.12", 5, 4, "medium", "s41", "", ["help-centre"], "KAN-18", { previousAssignee: "thao" }),
    t("KAN-104", "task", "Advertisers list: sort by spend this month", "ready-for-testing", "rob", "duc", "4.12", 4, 5, "low", "s41", "", ["dsp", "hq-admin"], "KAN-15", { previousAssignee: "duc" }),

    // ── Approved / Ready for Deployment
    t("KAN-095", "task", "Local offer pill links to the per-product pricing page", "approved", "huy", "rob", "4.12", 4, 3.5, "medium", "s40", "", ["menu-boards", "hq-admin"], "KAN-12"),
    t("KAN-096", "task", "Upgrade Partner API to Fastify 5", "approved", "duc", "duc", "4.12", 6, 6, "low", "s40", "", ["dsp", "api"], "KAN-15"),
    t("KAN-097", "bug", "Visitor profile drawer clips long attribute names", "approved", "minh", "thao", "4.12", 2, 1.5, "low", "s41", "", ["visitor-profile", "accessibility"], "KAN-21"),

    // ── Done
    t("KAN-081", "task", "Menu board: show offer end date on hover", "done", "huy", "rob", "4.11", 5, 5, "medium", "s40", "", ["menu-boards"], "KAN-12"),
    t("KAN-082", "task", "Seed 12 FAQ categories from the September audit", "done", "thao", "rob", "4.11", 8, 9, "medium", "s40", "", ["help-centre"], "KAN-18"),
    t("KAN-083", "bug", "Queue display flickers when two customers are called", "done", "linh", "linh", "4.11", 4, 3, "high", "s40", "", ["retail-admin"], "KAN-24"),
    t("KAN-084", "task", "Exchange load test at 15,000 displays", "done", "duc", "minh", "4.12", 12, 14, "high", "s40", "", ["dsp", "performance"], "KAN-15"),
    t("KAN-085", "task", "Attribute envelope v1.2 published to the interface contract", "done", "minh", "rob", "4.12", 6, 5, "medium", "s40", "", ["visitor-profile", "api"], "KAN-21"),
    t("KAN-086", "bug", "HQ Admin grid: price column shows a store's override", "done", "huy", "rob", "4.12", 3, 2.5, "medium", "s41", "", ["hq-admin", "menu-boards"], "KAN-12"),
  ];
  tasks.push(
    t("KAN-127", "task", "Consent scope: enforce in DSP targeting filters", "backlog", "duc", "minh", "4.12", 8, 0, "high", "s42", "2026-11-03", ["dsp", "visitor-profile", "security"], "KAN-21", {
      links: [{ type: "is blocked by", key: "KAN-124" }],
    }),
    t("KAN-119", "task", "Welsh-language menu boards: bilingual price labels", "ready-for-dev", "huy", "rob", "4.12", 8, 0, "medium", "s41", "2026-10-27", ["menu-boards"], "KAN-12"),
    t("KAN-118", "task", "Store time zone on the stores table", "ready-for-dev", "huy", "rob", "4.12", 3, 0, "medium", "s42", "", ["menu-boards", "api"], "KAN-12")
  );

  return { TODAY, users, releases, sprints, labels, tasks, currentRelease: "4.12", nextKey: 137 };
})();
