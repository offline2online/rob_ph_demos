// Removes the Firestore SDK's persistent local cache (IndexedDB) so a shared
// machine keeps nothing of the board after sign-out. A database that is still
// open in this page only finishes deleting once the page reloads or closes,
// which is what sign-out does anyway; the request is queued until then.
export async function clearFirestoreLocalCache() {
  try {
    let names = [];
    if (indexedDB.databases) {
      names = (await indexedDB.databases()).map((d) => d.name).filter((n) => n && n.startsWith("firestore/"));
    }
    await Promise.all(names.map((n) => new Promise((resolve) => {
      const req = indexedDB.deleteDatabase(n);
      req.onsuccess = req.onerror = req.onblocked = () => resolve();
    })));
  } catch { /* best effort: the SDK also scopes the cache per project and user */ }
}
