// Selfies are kept on the phone only (IndexedDB) and also offered as a
// download. They are never uploaded or sent to Claude.

const DB = 'robot-selfies';

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('selfies', { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction('selfies', mode);
    const out = fn(t.objectStore('selfies'));
    t.oncomplete = () => resolve(out.result ?? out);
    t.onerror = () => reject(t.error);
  });
}

export async function saveSelfie(blob) {
  const id = `selfie-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  try {
    await tx('readwrite', (s) => s.put({ id, blob, t: Date.now() }));
  } catch {}
  downloadBlob(blob, id + '.jpg');
  return id;
}

export async function listSelfies() {
  try {
    const all = await tx('readonly', (s) => s.getAll());
    return all.sort((a, b) => b.t - a.t);
  } catch {
    return [];
  }
}

export async function deleteSelfie(id) {
  await tx('readwrite', (s) => s.delete(id));
}

export function downloadBlob(blob, name) {
  try {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  } catch {}
}
