/* =========================================================
   STUDY BUDDY — DATA LAYER (IndexedDB)
   ---------------------------------------------------------
   This file is the ONLY place that talks to IndexedDB.
   Every other file calls the functions exported on window.DB.
   Swapping this for a real backend later means rewriting the
   inside of these functions only — every caller stays the same.
   ========================================================= */

const DB_NAME = "study-buddy-db";
const DB_VERSION = 1;

const STORES = [
  { name: "tasks", keyPath: "id" },
  { name: "classes", keyPath: "id" },
  { name: "notes", keyPath: "id" },
  { name: "sessions", keyPath: "id" },
  { name: "conversations", keyPath: "id" },
  { name: "messages", keyPath: "id" },
  { name: "extras", keyPath: "id" },
  { name: "achievements", keyPath: "id" },
  { name: "notifications", keyPath: "id" },
  { name: "settings", keyPath: "key" },
];

let _dbPromise = null;

function openDB() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      STORES.forEach((s) => {
        if (!db.objectStoreNames.contains(s.name)) {
          const store = db.createObjectStore(s.name, { keyPath: s.keyPath });
          if (s.name === "tasks") store.createIndex("dueDate", "dueDate");
          if (s.name === "classes") store.createIndex("dayOfWeek", "dayOfWeek");
          if (s.name === "sessions") store.createIndex("date", "date");
          if (s.name === "messages") store.createIndex("conversationId", "conversationId");
        }
      });
    };

    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => {
      console.error("IndexedDB failed to open", e);
      reject(e);
    };
  });
  return _dbPromise;
}

function tx(storeName, mode = "readonly") {
  return openDB().then((db) => db.transaction(storeName, mode).objectStore(storeName));
}

function uid() {
  return (
    Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 9)
  );
}

/* Generic CRUD ------------------------------------------------ */

async function getAll(storeName) {
  const store = await tx(storeName);
  return new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function getOne(storeName, key) {
  const store = await tx(storeName);
  return new Promise((resolve, reject) => {
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function put(storeName, value) {
  const store = await tx(storeName, "readwrite");
  return new Promise((resolve, reject) => {
    const req = store.put(value);
    req.onsuccess = () => resolve(value);
    req.onerror = () => reject(req.error);
  });
}

async function remove(storeName, key) {
  const store = await tx(storeName, "readwrite");
  return new Promise((resolve, reject) => {
    const req = store.delete(key);
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

async function clearStore(storeName) {
  const store = await tx(storeName, "readwrite");
  return new Promise((resolve, reject) => {
    const req = store.clear();
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

/* Settings are key/value, small helper ------------------------ */
async function getSetting(key, fallback = null) {
  const row = await getOne("settings", key);
  return row ? row.value : fallback;
}
async function setSetting(key, value) {
  return put("settings", { key, value });
}

/* Export / Import whole database ------------------------------- */
async function exportAll() {
  const dump = {};
  for (const s of STORES) {
    dump[s.name] = await getAll(s.name);
  }
  dump._meta = { exportedAt: new Date().toISOString(), version: DB_VERSION };
  return dump;
}

async function importAll(dump) {
  for (const s of STORES) {
    if (!Array.isArray(dump[s.name])) continue;
    await clearStore(s.name);
    const store = await tx(s.name, "readwrite");
    for (const row of dump[s.name]) {
      store.put(row);
    }
  }
  return true;
}

async function wipeAll() {
  for (const s of STORES) await clearStore(s.name);
  return true;
}

window.DB = {
  uid,
  getAll,
  getOne,
  put,
  remove,
  clearStore,
  getSetting,
  setSetting,
  exportAll,
  importAll,
  wipeAll,
  STORES,
};
