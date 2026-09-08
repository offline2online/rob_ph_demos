// One-off (but safe-to-repeat) seed: populates backlog-tracker's Firestore
// with a starting FAQ / Help Center structure — six categories mirroring
// the shape of a typical Personalisation Hub help center, each with a
// couple of placeholder articles — so the new consumer-facing site at
// repo-root `faq/` and the "FAQ Center" admin page in this app aren't
// starting completely empty.
//
// These are explicitly PLACEHOLDER articles (the body text says so), not
// a real replication of https://help.personalisationhub.com/support/home
// — that URL is blocked by this sandbox's network egress policy, so the
// real categories/articles could not be read and copied. Edit or replace
// every one of these from the FAQ Center page once the real content is
// available; nothing here should be treated as final copy.
//
// Same pattern as migrate-artifact-data.js: deterministic doc ids +
// Firestore's create() (insert-only, fails if the doc already exists), so
// this can never clobber a later edit made from the live app (a title
// change, a status flip, a rewritten body) by silently reapplying the
// original seed value on top of it. Safe to delete this script and its
// deploy-workflow step once real content has replaced every placeholder.

const { initializeApp, applicationDefault } = require("firebase-admin/app");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");

initializeApp({ credential: applicationDefault() });
const db = getFirestore();
const now = Timestamp.now();

const categories = [
  { id: "faq-cat-getting-started", name: "Getting Started", icon: "rocket_launch", description: "New to Personalisation Hub? Start here.", order: 0 },
  { id: "faq-cat-account-access", name: "Account & Access", icon: "manage_accounts", description: "Logins, permissions, and user roles.", order: 1 },
  { id: "faq-cat-hq-admin", name: "HQ Admin", icon: "admin_panel_settings", description: "Managing products, pricing, and campaigns from head office.", order: 2 },
  { id: "faq-cat-retail-admin", name: "Retail Admin", icon: "storefront", description: "In-store tools for staff on the shop floor.", order: 3 },
  { id: "faq-cat-menu-boards", name: "Menu Boards & Pricing", icon: "local_offer", description: "Digital menu boards, offers, and pricing sync.", order: 4 },
  { id: "faq-cat-troubleshooting", name: "Troubleshooting", icon: "build", description: "Common issues and how to resolve them.", order: 5 },
];

const PLACEHOLDER_NOTE = "**This is placeholder content.** Replace it with the real article from the Personalisation Hub Help Center using this article's editor in backlog-tracker's FAQ Center.";

const articles = [
  {
    id: "faq-art-what-is-ph", categoryId: "faq-cat-getting-started", order: 0,
    title: "What is Personalisation Hub?", slug: "what-is-personalisation-hub",
    summary: "A quick overview of the platform and what it's used for.",
    keywords: ["overview", "introduction", "platform"],
    bodyMd: `${PLACEHOLDER_NOTE}\n\n## Overview\n\nPersonalisation Hub lets retail teams manage personalised, in-store and online experiences from one place.\n\n- Manage product pricing and offers\n- Target campaigns to specific stores or audiences\n- Control digital menu boards and displays`,
  },
  {
    id: "faq-art-first-login", categoryId: "faq-cat-getting-started", order: 1,
    title: "Signing in for the first time", slug: "signing-in-for-the-first-time",
    summary: "How to activate your account and log in.",
    keywords: ["login", "sign in", "activation"],
    bodyMd: `${PLACEHOLDER_NOTE}\n\n## Steps\n\n- Open the invite email and click the activation link\n- Set a password\n- Sign in at the platform URL your admin gave you`,
  },
  {
    id: "faq-art-user-roles", categoryId: "faq-cat-account-access", order: 0,
    title: "Understanding user roles and permissions", slug: "user-roles-and-permissions",
    summary: "What HQ Admin, Retail Admin, and other roles can each access.",
    keywords: ["roles", "permissions", "access"],
    bodyMd: `${PLACEHOLDER_NOTE}\n\n## Roles\n\n- **HQ Admin** — manages products, pricing, and campaigns across all stores\n- **Retail Admin** — store-level staff managing local displays and queues\n- Additional roles can be assigned by your account owner`,
  },
  {
    id: "faq-art-reset-password", categoryId: "faq-cat-account-access", order: 1,
    title: "Resetting your password", slug: "resetting-your-password",
    summary: "How to reset a forgotten password.",
    keywords: ["password", "reset", "forgot"],
    bodyMd: `${PLACEHOLDER_NOTE}\n\n## Steps\n\n- Click "Forgot password" on the sign-in page\n- Check your email for a reset link\n- Choose a new password`,
  },
  {
    id: "faq-art-manage-pricing", categoryId: "faq-cat-hq-admin", order: 0,
    title: "Managing product pricing", slug: "managing-product-pricing",
    summary: "How RRP, local offers, and targeted pricing work together.",
    keywords: ["pricing", "rrp", "offers"],
    bodyMd: `${PLACEHOLDER_NOTE}\n\n## Pricing types\n\n- **RRP** — the default price shown everywhere\n- **Local offer** — a store-specific override\n- **Targeted** — shown only to a specific audience or segment`,
  },
  {
    id: "faq-art-create-campaign", categoryId: "faq-cat-hq-admin", order: 1,
    title: "Creating a campaign", slug: "creating-a-campaign",
    summary: "The basic steps to launch a new campaign.",
    keywords: ["campaign", "targeting", "launch"],
    bodyMd: `${PLACEHOLDER_NOTE}\n\n## Steps\n\n- Go to Campaigns and click "Launch a new campaign"\n- Set targeting, storyboard, and creative\n- Review and publish`,
  },
  {
    id: "faq-art-retail-queueing", categoryId: "faq-cat-retail-admin", order: 0,
    title: "Using virtual queueing in-store", slug: "using-virtual-queueing-in-store",
    summary: "How staff manage the queue and appointments from Retail Admin.",
    keywords: ["queue", "appointments", "in-store"],
    bodyMd: `${PLACEHOLDER_NOTE}\n\n## Overview\n\n- Open Queueing & Appointments from the Retail Admin sidebar\n- Call the next customer or check them in manually\n- Appointments booked online appear automatically`,
  },
  {
    id: "faq-art-store-hours", categoryId: "faq-cat-retail-admin", order: 1,
    title: "Updating your store's hours", slug: "updating-your-stores-hours",
    summary: "How to change opening hours shown to customers.",
    keywords: ["store hours", "opening times"],
    bodyMd: `${PLACEHOLDER_NOTE}\n\n## Steps\n\n- Go to Store Profile > Store Hours\n- Edit the hours for each day\n- Save — changes reflect on customer-facing pages shortly after`,
  },
  {
    id: "faq-art-menu-board-setup", categoryId: "faq-cat-menu-boards", order: 0,
    title: "Setting up a digital menu board", slug: "setting-up-a-digital-menu-board",
    summary: "Linking a display to your product and pricing data.",
    keywords: ["menu board", "display", "setup"],
    bodyMd: `${PLACEHOLDER_NOTE}\n\n## Steps\n\n- Register the display under Displays & Devices\n- Assign it to a store and a menu board layout\n- Pricing updates made in HQ Admin sync automatically`,
  },
  {
    id: "faq-art-offer-expiry", categoryId: "faq-cat-menu-boards", order: 1,
    title: "How offer expiry works", slug: "how-offer-expiry-works",
    summary: "What happens when a time-limited offer ends.",
    keywords: ["offer", "expiry", "pricing"],
    bodyMd: `${PLACEHOLDER_NOTE}\n\n## Overview\n\n- Offers with an end date are swept automatically when they expire\n- The menu board reverts to RRP once an offer ends\n- Expired offers can be found in the offer history, not deleted`,
  },
  {
    id: "faq-art-display-offline", categoryId: "faq-cat-troubleshooting", order: 0,
    title: "A display is showing as offline", slug: "a-display-is-showing-as-offline",
    summary: "Steps to try before contacting support.",
    keywords: ["offline", "display", "troubleshooting"],
    bodyMd: `${PLACEHOLDER_NOTE}\n\n## Try this first\n\n- Check the display's network connection\n- Restart the display device\n- Wait a few minutes — status can lag behind reality briefly`,
  },
  {
    id: "faq-art-price-not-updating", categoryId: "faq-cat-troubleshooting", order: 1,
    title: "A price change isn't showing on the menu board", slug: "price-change-not-showing",
    summary: "Common causes of a pricing sync delay.",
    keywords: ["pricing", "sync", "troubleshooting"],
    bodyMd: `${PLACEHOLDER_NOTE}\n\n## Common causes\n\n- Sync can take a few minutes after a change is saved\n- Check whether a local offer is overriding the price you expected\n- Confirm the change was saved, not left as a draft`,
  },
];

async function createIfMissing(ref, data) {
  try {
    await ref.create(data);
    return "created";
  } catch (err) {
    if (err.code === 6 /* ALREADY_EXISTS */) return "skipped";
    throw err;
  }
}

async function main() {
  const catCounts = { created: 0, skipped: 0 };
  for (const c of categories) {
    const { id, ...rest } = c;
    const result = await createIfMissing(db.collection("faqCategories").doc(id), {
      ...rest, createdAt: now, updatedAt: now,
    });
    catCounts[result]++;
  }
  console.log(`FAQ categories: ${catCounts.created} created, ${catCounts.skipped} already present (skipped)`);

  const artCounts = { created: 0, skipped: 0 };
  for (const a of articles) {
    const { id, ...rest } = a;
    const result = await createIfMissing(db.collection("faqArticles").doc(id), {
      ...rest, projectId: null, status: "published", needsReview: false,
      createdAt: now, updatedAt: now, publishedAt: now,
    });
    artCounts[result]++;
  }
  console.log(`FAQ articles: ${artCounts.created} created, ${artCounts.skipped} already present (skipped)`);
}

main().catch((err) => {
  console.error("FAQ seed failed:", err);
  process.exit(1);
});
