// Stubbed check of the profile-photo rules and helper (no emulator, no
// network — same spirit as test:mcp). The emulator cases that exercise the
// Firestore half live in firestore-rules.test.js; this pins the clauses
// themselves plus the client's file checks, so a loosened rule fails here.
import assert from "node:assert";
import fs from "node:fs";
import { checkAvatarFile, avatarHTML, setAvatarMember, colourFor, initialOf } from "../public/js/avatar.js";

const storage = fs.readFileSync(new URL("../storage.rules", import.meta.url), "utf8");
const fsr = fs.readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
const block = (src, head) => { const i = src.indexOf(head); assert.ok(i >= 0, `${head} missing`); const j = src.indexOf("\n    }", i); return src.slice(i, j > 0 ? j : i + 900); };

const av = block(storage, "match /avatars/{fileName}");
assert.match(av, /allow write: if \(isAvatarOwner\(fileName\) \|\| isAdminClaim\(\)\)/);
assert.match(av, /request\.resource\.size < 2 \* 1024 \* 1024/);
assert.match(av, /request\.resource\.contentType == 'image\/jpeg'/);
assert.match(av, /allow delete: if isAvatarOwner\(fileName\) \|\| isAdminClaim\(\)/);
assert.match(av, /allow read: if isAvatarOwner\(fileName\) \|\|/, "owner must read own avatar for getDownloadURL");
assert.match(storage, /fileName == request\.auth\.token\.email\.lower\(\) \+ "\.jpg"/);
assert.doesNotMatch(av, /allow (write|delete): if isEditor\(\)/, "an ordinary editor must not write other people's avatars");

const self = block(fsr, "A member may also set or clear their OWN profile photo");
assert.match(self, /hasOnly\(\["lastLoginAt", "photoUrl", "photoUpdatedAt"\]\)/);
assert.match(self, /photoUpdatedAt == request\.time/);
assert.match(self, /validPhotoUrl/);
assert.match(fsr, /u\.size\(\) <= 1000/);
assert.match(fsr, /firebasestorage\\\\\.googleapis\\\\\.com\/v0\/b\/backlog-tracker-e4ed2/);

assert.match(checkAvatarFile({ type: "application/pdf", size: 10 }), /isn't an image/);
assert.match(checkAvatarFile({ type: "image/png", size: 15 * 1024 * 1024 }), /10 MB/);
assert.equal(checkAvatarFile({ type: "image/jpeg", size: 5 * 1024 * 1024 }), "");

// Helper: initial + stable colour; photo wins once the member row has one.
assert.equal(initialOf("sam@x.com"), "S");
assert.equal(colourFor("sam@x.com"), colourFor("SAM@x.com"));
assert.match(avatarHTML("sam@x.com", 28), /ph-avatar-initial/);
assert.match(avatarHTML("sam@x.com", 28), /--av:28px/);
setAvatarMember("sam@x.com", { photoUrl: "https://firebasestorage.googleapis.com/v0/b/b/o/avatars%2Fsam.jpg?alt=media", photoUpdatedAt: 1234 });
assert.match(avatarHTML("sam@x.com", 28), /<img[^>]*&amp;v=1234/);
assert.equal(avatarHTML("", 24), "");
console.log("PASS  avatar rules + helper");
