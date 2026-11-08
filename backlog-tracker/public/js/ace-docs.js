// Documents attached to an ACE opportunity: Firebase Storage ace/{opportunityId}/{timestamp}-{name}.
// The Selling API cannot take files, so these stay in the console. Rules: storage.rules.
import { getStorage, ref, uploadBytes, getDownloadURL, deleteObject, listAll, getMetadata } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-storage.js";
import { checkDocument, docFileName, docDisplayName } from "./ace-core.js";

const folder = (id) => `ace/${String(id).replace(/[^A-Za-z0-9._-]/g, "")}`;

export async function listAceDocs(id) {
  const res = await listAll(ref(getStorage(), folder(id)));
  const docs = await Promise.all(res.items.map(async (it) => {
    const [url, meta] = await Promise.all([getDownloadURL(it), getMetadata(it).catch(() => ({}))]);
    return { path: it.fullPath || it.name, name: docDisplayName(it.name), size: Number(meta.size) || 0, url, at: meta.timeCreated || "" };
  }));
  return docs.sort((a, b) => String(b.at).localeCompare(String(a.at)) || a.name.localeCompare(b.name));
}

export async function uploadAceDoc(id, file) {
  const chk = checkDocument(file);
  if (!chk.ok) throw new Error(chk.error);
  const r = ref(getStorage(), `${folder(id)}/${Date.now()}-${docFileName(file.name)}`);
  try { await uploadBytes(r, file, { contentType: chk.contentType }); }
  catch (err) { throw new Error(err && /unauthori[sz]ed|permission/i.test(String(err.code || err.message)) ? "You don't have permission to attach documents." : `Upload failed: ${(err && err.message) || err}`); }
  return { path: r.fullPath || r.path, url: await getDownloadURL(r) };
}

export async function removeAceDoc(path) { await deleteObject(ref(getStorage(), path)); }
