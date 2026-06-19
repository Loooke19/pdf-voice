import JSZip from "jszip";
import {
  getDocument,
  getSetting,
  listDocuments,
  saveDocument,
  setSetting,
} from "./db";
import { makeDocumentPreview, makeSegments } from "./segments";

const BACKUP_SCHEMA = 1;
const DIRECTORY_HANDLE_KEY = "backup-directory-handle";

function safeName(value) {
  return (value || "未命名文档").replace(/[\\/:*?"<>|]/g, "_").slice(0, 120);
}

function backupMetadata(document) {
  const {
    file: _file,
    text: _text,
    segments: _segments,
    storageMode: _storageMode,
    sourcePath: _sourcePath,
    textPath: _textPath,
    textFingerprint: _textFingerprint,
    ...metadata
  } = document;
  return metadata;
}

export async function createBackupBlob(onProgress) {
  const indexes = await listDocuments();
  const zip = new JSZip();
  const manifest = {
    schema: BACKUP_SCHEMA,
    app: "PDF Voice",
    exportedAt: new Date().toISOString(),
    documents: [],
  };

  for (let index = 0; index < indexes.length; index += 1) {
    const document = await getDocument(indexes[index].id);
    if (!document) continue;
    const folder = zip.folder(`documents/${document.id}`);
    folder.file("source.pdf", document.file);
    folder.file("text.txt", document.text || "");
    const metadata = backupMetadata(document);
    folder.file("metadata.json", JSON.stringify(metadata, null, 2));
    manifest.documents.push({ id: document.id, path: `documents/${document.id}` });
    onProgress?.({
      value: ((index + 1) / Math.max(1, indexes.length)) * 75,
      detail: `正在打包 ${index + 1} / ${indexes.length}`,
    });
  }

  zip.file("manifest.json", JSON.stringify(manifest, null, 2));
  return zip.generateAsync(
    { type: "blob", compression: "STORE" },
    ({ percent }) => onProgress?.({
      value: 75 + percent * 0.25,
      detail: "正在生成备份文件",
    }),
  );
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function exportBackup(onProgress) {
  const blob = await createBackupBlob(onProgress);
  const date = new Date().toISOString().slice(0, 10);
  downloadBlob(blob, `阅声完整备份-${date}.pdfvoice.zip`);
}

export async function restoreBackup(file, onProgress) {
  const zip = await JSZip.loadAsync(file);
  const manifestEntry = zip.file("manifest.json");
  if (!manifestEntry) throw new Error("这不是有效的阅声备份文件。");
  const manifest = JSON.parse(await manifestEntry.async("text"));
  if (manifest.schema !== BACKUP_SCHEMA || !Array.isArray(manifest.documents)) {
    throw new Error("备份版本不受支持。");
  }

  const existingIds = new Set((await listDocuments()).map((item) => item.id));
  let restored = 0;
  let copied = 0;
  for (let index = 0; index < manifest.documents.length; index += 1) {
    const item = manifest.documents[index];
    const metadataEntry = zip.file(`${item.path}/metadata.json`);
    const sourceEntry = zip.file(`${item.path}/source.pdf`);
    const textEntry = zip.file(`${item.path}/text.txt`);
    if (!metadataEntry || !sourceEntry || !textEntry) continue;

    const metadata = JSON.parse(await metadataEntry.async("text"));
    const text = await textEntry.async("text");
    const source = await sourceEntry.async("blob");
    const duplicated = existingIds.has(metadata.id);
    const id = duplicated ? crypto.randomUUID() : metadata.id;
    const segments = makeSegments(text);
    await saveDocument({
      ...metadata,
      id,
      title: duplicated ? `${metadata.title}（恢复副本）` : metadata.title,
      file: new File([source], metadata.fileName || "source.pdf", {
        type: "application/pdf",
      }),
      text,
      segments,
      preview: metadata.preview || makeDocumentPreview(segments),
      updatedAt: Date.now(),
    });
    existingIds.add(id);
    restored += 1;
    if (duplicated) copied += 1;
    onProgress?.({
      value: ((index + 1) / Math.max(1, manifest.documents.length)) * 100,
      detail: `正在恢复 ${index + 1} / ${manifest.documents.length}`,
    });
  }
  return { restored, copied };
}

async function verifyDirectoryPermission(handle, readWrite = true) {
  if (!handle) return false;
  const options = readWrite ? { mode: "readwrite" } : {};
  if ((await handle.queryPermission?.(options)) === "granted") return true;
  return (await handle.requestPermission?.(options)) === "granted";
}

async function writeDirectoryFile(directory, name, value) {
  const fileHandle = await directory.getFileHandle(name, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(value);
  await writable.close();
}

export async function syncBackupDirectory(onProgress) {
  if (!window.showDirectoryPicker) {
    throw new Error("当前浏览器不支持直接写入文件夹，请使用完整备份下载。");
  }
  let root = await getSetting(DIRECTORY_HANDLE_KEY);
  if (!(await verifyDirectoryPermission(root))) {
    root = await window.showDirectoryPicker({ mode: "readwrite" });
    await setSetting(DIRECTORY_HANDLE_KEY, root);
  }
  const backupRoot = await root.getDirectoryHandle("PDF Voice", { create: true });
  const indexes = await listDocuments();
  for (let index = 0; index < indexes.length; index += 1) {
    const document = await getDocument(indexes[index].id);
    if (!document) continue;
    const folder = await backupRoot.getDirectoryHandle(
      `${safeName(document.title)}-${document.id.slice(0, 8)}`,
      { create: true },
    );
    await Promise.all([
      writeDirectoryFile(folder, "source.pdf", document.file),
      writeDirectoryFile(folder, "text.txt", document.text || ""),
      writeDirectoryFile(
        folder,
        "metadata.json",
        JSON.stringify(backupMetadata(document), null, 2),
      ),
    ]);
    onProgress?.({
      value: ((index + 1) / Math.max(1, indexes.length)) * 100,
      detail: `正在同步 ${index + 1} / ${indexes.length}`,
    });
  }
  return { synced: indexes.length };
}
