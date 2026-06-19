import { openDB } from "idb";

const DB_NAME = "yuesheng-library";
const DB_VERSION = 2;
const ROOT_DIRECTORY = "pdf-voice";
const DOCUMENTS_DIRECTORY = "documents";

const database = openDB(DB_NAME, DB_VERSION, {
  upgrade(db) {
    if (!db.objectStoreNames.contains("documents")) {
      const store = db.createObjectStore("documents", { keyPath: "id" });
      store.createIndex("updatedAt", "updatedAt");
    }
    if (!db.objectStoreNames.contains("settings")) {
      db.createObjectStore("settings");
    }
  },
});

const textEncoder = new TextEncoder();
let migrationPromise;

function textFingerprint(text = "") {
  let hash = 2166136261;
  const sample = text.length > 16_384
    ? `${text.slice(0, 8_192)}${text.slice(-8_192)}${text.length}`
    : text;
  for (let index = 0; index < sample.length; index += 1) {
    hash ^= sample.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${text.length}-${(hash >>> 0).toString(36)}`;
}

function supportsOpfs() {
  return Boolean(navigator.storage?.getDirectory);
}

function normalizeIndexRecord(record) {
  const segmentCount = Math.max(0, record.segmentCount ?? record.segments?.length ?? 0);
  const lastSegment = Math.max(
    0,
    Math.min(Number.isInteger(record.lastSegment) ? record.lastSegment : 0, Math.max(0, segmentCount - 1)),
  );
  if (lastSegment === record.lastSegment && segmentCount === record.segmentCount) return record;
  return { ...record, lastSegment, segmentCount };
}

async function getDocumentsDirectory() {
  const root = await navigator.storage.getDirectory();
  const appDirectory = await root.getDirectoryHandle(ROOT_DIRECTORY, { create: true });
  return appDirectory.getDirectoryHandle(DOCUMENTS_DIRECTORY, { create: true });
}

async function getDocumentDirectory(id, create = true) {
  const documentsDirectory = await getDocumentsDirectory();
  return documentsDirectory.getDirectoryHandle(id, { create });
}

async function writeOpfsFile(directory, name, value) {
  const handle = await directory.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(value);
  await writable.close();
}

async function readOpfsFile(id, name) {
  const directory = await getDocumentDirectory(id, false);
  const handle = await directory.getFileHandle(name);
  return handle.getFile();
}

function toIndexRecord(document, existing = null) {
  const {
    file: _file,
    text: _text,
    segments: _segments,
    ...metadata
  } = document;
  return {
    ...existing,
    ...metadata,
    segmentCount: document.segments?.length ?? document.segmentCount ?? existing?.segmentCount ?? 0,
  };
}

async function saveWithOpfs(document, existing = null) {
  const directory = await getDocumentDirectory(document.id);
  const hasExistingSource = Boolean(existing?.sourcePath);
  const sourceChanged = document.file
    && (!hasExistingSource
      || document.file.size !== existing.sourceSize
      || document.fileName !== existing.fileName);
  const nextTextFingerprint = typeof document.text === "string"
    ? textFingerprint(document.text)
    : existing?.textFingerprint;
  const textChanged = typeof document.text === "string"
    && nextTextFingerprint !== existing?.textFingerprint;

  if (sourceChanged) await writeOpfsFile(directory, "source.pdf", document.file);
  if (textChanged || !existing?.textPath) {
    await writeOpfsFile(directory, "text.txt", document.text || "");
  }

  const indexRecord = {
    ...toIndexRecord(document, existing),
    storageMode: "opfs",
    sourcePath: `${ROOT_DIRECTORY}/${DOCUMENTS_DIRECTORY}/${document.id}/source.pdf`,
    textPath: `${ROOT_DIRECTORY}/${DOCUMENTS_DIRECTORY}/${document.id}/text.txt`,
    sourceSize: document.file?.size ?? existing?.sourceSize ?? document.size ?? 0,
    textBytes: typeof document.text === "string"
      ? textEncoder.encode(document.text).byteLength
      : existing?.textBytes ?? 0,
    textFingerprint: nextTextFingerprint,
  };
  const db = await database;
  await db.put("documents", indexRecord);
  return indexRecord;
}

async function migrateLegacyDocuments() {
  if (migrationPromise) return migrationPromise;
  migrationPromise = (async () => {
    if (!supportsOpfs()) return;
    const db = await database;
    const records = await db.getAll("documents");
    for (const record of records) {
      if (record.storageMode === "opfs" || (!record.file && typeof record.text !== "string")) continue;
      try {
        await saveWithOpfs(record, null);
      } catch {
        // Keep the complete legacy IndexedDB record until OPFS migration succeeds.
      }
    }
  })();
  return migrationPromise;
}

export async function listDocuments() {
  await migrateLegacyDocuments();
  const db = await database;
  const storedItems = await db.getAll("documents");
  const items = storedItems.map(normalizeIndexRecord);
  const correctedItems = items.filter((item, index) => item !== storedItems[index]);
  if (correctedItems.length) {
    const transaction = db.transaction("documents", "readwrite");
    await Promise.all([
      ...correctedItems.map((item) => transaction.store.put(item)),
      transaction.done,
    ]);
  }
  return items
    .map((item) => ({
      ...item,
      storageBytes: (item.sourceSize ?? item.size ?? item.file?.size ?? 0)
        + (item.textBytes ?? textEncoder.encode(item.text || "").byteLength),
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getDocument(id) {
  await migrateLegacyDocuments();
  const db = await database;
  const storedRecord = await db.get("documents", id);
  const record = storedRecord ? normalizeIndexRecord(storedRecord) : null;
  if (record && record !== storedRecord) await db.put("documents", record);
  if (!record || record.storageMode !== "opfs") return record;

  try {
    const [file, textFile] = await Promise.all([
      readOpfsFile(id, "source.pdf"),
      readOpfsFile(id, "text.txt"),
    ]);
    return {
      ...record,
      file,
      text: await textFile.text(),
    };
  } catch {
    return null;
  }
}

export async function saveDocument(document) {
  const db = await database;
  const existing = await db.get("documents", document.id);
  if (supportsOpfs()) {
    try {
      return await saveWithOpfs(document, existing);
    } catch {
      // IndexedDB remains a functional fallback on browsers without usable OPFS.
    }
  }
  const fallback = {
    ...document,
    storageMode: "indexeddb",
    segmentCount: document.segments?.length ?? document.segmentCount ?? 0,
    sourceSize: document.file?.size ?? document.size ?? 0,
    textBytes: textEncoder.encode(document.text || "").byteLength,
  };
  await db.put("documents", fallback);
  return fallback;
}

export async function updateDocumentMetadata(id, changes) {
  const db = await database;
  const record = await db.get("documents", id);
  if (!record) return null;
  const next = { ...record, ...changes };
  await db.put("documents", next);
  return next;
}

export async function deleteDocument(id) {
  const db = await database;
  const record = await db.get("documents", id);
  await db.delete("documents", id);
  if (record?.storageMode === "opfs" && supportsOpfs()) {
    try {
      const documentsDirectory = await getDocumentsDirectory();
      await documentsDirectory.removeEntry(id, { recursive: true });
    } catch {
      // The index deletion already succeeded; orphan cleanup can be retried later.
    }
  }
}

export async function deleteDocuments(ids) {
  await Promise.all(ids.map((id) => deleteDocument(id)));
}

export async function getStorageStatus() {
  const [estimate, persisted] = await Promise.all([
    navigator.storage?.estimate?.() ?? Promise.resolve({ usage: 0, quota: 0 }),
    navigator.storage?.persisted?.() ?? Promise.resolve(false),
  ]);
  return {
    supported: Boolean(navigator.storage),
    opfsSupported: supportsOpfs(),
    persisted,
    usage: estimate.usage || 0,
    quota: estimate.quota || 0,
  };
}

export async function requestPersistentStorage() {
  if (!navigator.storage?.persist) return false;
  if (await navigator.storage.persisted()) return true;
  return navigator.storage.persist();
}

export async function getSetting(key) {
  const db = await database;
  return db.get("settings", key);
}

export async function setSetting(key, value) {
  const db = await database;
  return db.put("settings", value, key);
}
