import { useEffect, useRef, useState } from "react";
import {
  Archive,
  Check,
  Desktop,
  DeviceMobile,
  DownloadSimple,
  FolderOpen,
  HardDrives,
  ShareNetwork,
  ShieldCheck,
  ShieldWarning,
  Trash,
  UploadSimple,
  X,
} from "@phosphor-icons/react";
import {
  deleteDocuments,
  getStorageStatus,
  requestPersistentStorage,
} from "../lib/db";
import {
  exportBackup,
  restoreBackup,
  syncBackupDirectory,
} from "../lib/backup";

const formatBytes = (bytes = 0) => {
  if (!bytes) return "0 MB";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
};

const isInstalledApp = () => (
  window.matchMedia?.("(display-mode: standalone)")?.matches
  || window.navigator.standalone === true
);

const getInstallPlatform = () => {
  const previewPlatform = import.meta.env.DEV
    ? new URLSearchParams(window.location.search).get("install-platform")
    : null;
  if (["ios", "android", "mac", "desktop"].includes(previewPlatform)) return previewPlatform;
  const userAgent = window.navigator.userAgent;
  const appleTouchDevice = /iPad|iPhone|iPod/.test(userAgent)
    || (/Macintosh/.test(userAgent) && window.navigator.maxTouchPoints > 1);
  if (appleTouchDevice) return "ios";
  if (/Android/i.test(userAgent)) return "android";
  if (/Macintosh/i.test(userAgent)) return "mac";
  return "desktop";
};

export function StorageDialog({ open, onClose, documents, onChanged }) {
  const restoreInputRef = useRef(null);
  const [status, setStatus] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const [working, setWorking] = useState("");
  const [progress, setProgress] = useState({ value: 0, detail: "" });
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [installPrompt, setInstallPrompt] = useState(null);
  const [installOpen, setInstallOpen] = useState(false);
  const installPlatform = getInstallPlatform();

  const refreshStatus = async () => {
    setStatus(await getStorageStatus());
  };

  useEffect(() => {
    const captureInstallPrompt = (event) => {
      event.preventDefault();
      setInstallPrompt(event);
    };
    const handleInstalled = async () => {
      setInstallPrompt(null);
      setInstallOpen(false);
      const granted = await requestPersistentStorage().catch(() => false);
      await refreshStatus().catch(() => {});
      setMessage(granted
        ? "应用已安装，本地存储也已获得持久化保护。"
        : "应用已安装。持续使用后可再次申请本地存储保护。");
    };
    window.addEventListener("beforeinstallprompt", captureInstallPrompt);
    window.addEventListener("appinstalled", handleInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", captureInstallPrompt);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    setSelected(new Set());
    setMessage("");
    setError("");
    setInstallOpen(false);
    refreshStatus().catch(() => setError("无法读取当前存储状态。"));
  }, [open]);

  if (!open) return null;

  const run = async (name, task) => {
    setWorking(name);
    setProgress({ value: 0, detail: "" });
    setMessage("");
    setError("");
    try {
      const result = await task((next) => setProgress(next));
      await refreshStatus();
      await onChanged?.();
      return result;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "操作失败，请重试。");
      return null;
    } finally {
      setWorking("");
    }
  };

  const toggleDocument = (id) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allSelected = documents.length > 0 && selected.size === documents.length;
  const busy = Boolean(working);

  return (
    <div className="modal-backdrop storage-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onClose();
    }}>
      <section className="storage-dialog" role="dialog" aria-modal="true" aria-labelledby="storage-title">
        <header className="storage-dialog-header">
          <div>
            <p className="section-label">LOCAL STORAGE</p>
            <h2 id="storage-title">本地存储与备份</h2>
          </div>
          <button className="icon-button" onClick={onClose} disabled={busy} aria-label="关闭存储管理">
            <X />
          </button>
        </header>

        <div className="storage-status-grid">
          <article className={`storage-status-card ${status?.persisted ? "is-safe" : "is-warning"}`}>
            {status?.persisted ? <ShieldCheck weight="duotone" /> : <ShieldWarning weight="duotone" />}
            <div>
              <strong>{status?.persisted ? "本地存储已保护" : "本地存储尚未保护"}</strong>
              <span>
                {status?.persisted
                  ? "系统存储紧张时不会自动清理；主动清除网站数据仍会删除。"
                  : "浏览器可能在空间紧张时回收数据，建议申请保护并定期备份。"}
              </span>
            </div>
            {!status?.persisted ? (
              <button
                className="secondary-button"
                disabled={busy || !status?.supported}
                onClick={async () => {
                  const forceInstallGuide = import.meta.env.DEV
                    && new URLSearchParams(window.location.search).has("install-guide");
                  const granted = forceInstallGuide
                    ? false
                    : await run("persist", () => requestPersistentStorage());
                  if (granted) {
                    setMessage("已获得持久化保护。");
                    return;
                  }
                  if (isInstalledApp()) {
                    setMessage("应用已经安装；请持续使用一段时间后再次申请保护，并定期保留备份。");
                    return;
                  }
                  setInstallOpen(true);
                }}
              >
                申请保护
              </button>
            ) : null}
          </article>

          <article className="storage-status-card">
            <HardDrives weight="duotone" />
            <div>
              <strong>{formatBytes(status?.usage)} 已使用</strong>
              <span>
                可用配额约 {formatBytes(status?.quota)}
                {" · "}{status?.opfsSupported ? "PDF 与文字存于 OPFS" : "使用 IndexedDB 兼容存储"}
              </span>
            </div>
          </article>
        </div>

        <div className="backup-actions">
          <button
            className="primary-button"
            disabled={busy || documents.length === 0}
            onClick={async () => {
              await run("export", exportBackup);
              setMessage("完整备份已下载，包含源 PDF、识别文字和播放位置。");
            }}
          >
            <DownloadSimple /> 导出完整备份
          </button>
          <button
            className="secondary-button"
            disabled={busy}
            onClick={() => restoreInputRef.current?.click()}
          >
            <UploadSimple /> 恢复备份
          </button>
          {window.showDirectoryPicker ? (
            <button
              className="secondary-button"
              disabled={busy || documents.length === 0}
              onClick={async () => {
                const result = await run("directory", syncBackupDirectory);
                if (result) setMessage(`已同步 ${result.synced} 份文档到所选文件夹。`);
              }}
            >
              <FolderOpen /> 同步到文件夹
            </button>
          ) : null}
          <input
            ref={restoreInputRef}
            type="file"
            accept=".zip,.pdfvoice.zip,application/zip"
            hidden
            onChange={async (event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) return;
              const result = await run("restore", (onProgress) => restoreBackup(file, onProgress));
              if (result) {
                setMessage(
                  `已恢复 ${result.restored} 份文档${result.copied ? `，其中 ${result.copied} 份作为副本保留` : ""}。`,
                );
              }
            }}
          />
        </div>

        {working && working !== "persist" ? (
          <div className="storage-operation" aria-live="polite">
            <Archive weight="duotone" />
            <div>
              <strong>{progress.detail || "正在处理本地数据"}</strong>
              <span><i style={{ width: `${progress.value}%` }} /></span>
            </div>
            <b>{Math.round(progress.value)}%</b>
          </div>
        ) : null}
        {message ? <p className="storage-message"><Check /> {message}</p> : null}
        {error ? <p className="storage-error">{error}</p> : null}

        <div className="storage-list-header">
          <div>
            <strong>设备上的文档</strong>
            <span>{documents.length} 份 · 只属于当前网址和浏览器</span>
          </div>
          <label>
            <input
              type="checkbox"
              checked={allSelected}
              onChange={() => setSelected(allSelected
                ? new Set()
                : new Set(documents.map((document) => document.id)))}
            />
            全选
          </label>
        </div>

        <div className="storage-document-list">
          {documents.length ? documents.map((document) => (
            <label key={document.id}>
              <input
                type="checkbox"
                checked={selected.has(document.id)}
                onChange={() => toggleDocument(document.id)}
              />
              <span className="storage-document-icon"><Archive weight="duotone" /></span>
              <span>
                <strong>{document.title}</strong>
                <small>
                  {formatBytes(document.storageBytes || document.size)}
                  {" · "}{document.storageMode === "opfs" ? "OPFS" : "兼容存储"}
                </small>
              </span>
            </label>
          )) : (
            <p className="storage-empty">当前设备还没有保存文档。</p>
          )}
        </div>

        <footer className="storage-dialog-footer">
          <p>更换浏览器、设备或网址不会自动同步数据；重要文档请保留完整备份。</p>
          <button
            className="secondary-button danger-button"
            disabled={busy || selected.size === 0}
            onClick={async () => {
              if (!window.confirm(`确定从当前设备删除选中的 ${selected.size} 份文档吗？`)) return;
              await run("delete", async (onProgress) => {
                const ids = [...selected];
                for (let index = 0; index < ids.length; index += 1) {
                  await deleteDocuments([ids[index]]);
                  onProgress({
                    value: ((index + 1) / ids.length) * 100,
                    detail: `正在删除 ${index + 1} / ${ids.length}`,
                  });
                }
              });
              setSelected(new Set());
              setMessage("所选文档已从当前设备删除。");
            }}
          >
            <Trash /> 删除所选
          </button>
        </footer>
      </section>

      {installOpen ? (
        <div className="install-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setInstallOpen(false);
        }}>
          <section
            className="install-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="install-title"
          >
            <button
              className="icon-button install-close"
              onClick={() => setInstallOpen(false)}
              aria-label="关闭安装提示"
            >
              <X />
            </button>
            <span className="install-app-icon">
              {installPlatform === "ios" || installPlatform === "android"
                ? <DeviceMobile weight="duotone" />
                : <Desktop weight="duotone" />}
            </span>
            <p className="section-label">INSTALL APP</p>
            <h3 id="install-title">安装“阅声”应用？</h3>
            <p className="install-description">
              安装后可从桌面或主屏幕直接打开，离线使用更稳定，也更有利于浏览器批准本地存储保护。
            </p>

            {installPrompt ? (
              <div className="install-actions">
                <button
                  className="primary-button"
                  onClick={async () => {
                    const prompt = installPrompt;
                    setInstallPrompt(null);
                    await prompt.prompt();
                    const choice = await prompt.userChoice;
                    if (choice.outcome === "accepted") {
                      setMessage("正在安装阅声；安装完成后会再次尝试申请存储保护。");
                      setInstallOpen(false);
                    } else {
                      setMessage("已暂缓安装。你仍可继续使用，并建议定期导出完整备份。");
                      setInstallOpen(false);
                    }
                  }}
                >
                  安装阅声
                </button>
                <button className="secondary-button" onClick={() => setInstallOpen(false)}>
                  暂不安装
                </button>
              </div>
            ) : (
              <>
                <div className="install-steps">
                  {installPlatform === "ios" ? (
                    <>
                      <div><b>1</b><span>使用 Safari 打开当前页面</span></div>
                      <div><b>2</b><span>点击浏览器的“分享”按钮 <ShareNetwork /></span></div>
                      <div><b>3</b><span>选择“添加到主屏幕”，开启“作为 Web App 打开”，再点击“添加”</span></div>
                    </>
                  ) : null}
                  {installPlatform === "android" ? (
                    <>
                      <div><b>1</b><span>打开浏览器右上角菜单</span></div>
                      <div><b>2</b><span>选择“安装应用”或“添加到主屏幕”</span></div>
                      <div><b>3</b><span>安装后从主屏幕打开阅声，再次点击“申请保护”</span></div>
                    </>
                  ) : null}
                  {installPlatform === "mac" ? (
                    <>
                      <div><b>1</b><span>Safari：选择菜单“文件”→“添加到程序坞”</span></div>
                      <div><b>2</b><span>Chrome 或 Edge：打开地址栏右侧的安装图标</span></div>
                      <div><b>3</b><span>安装后从应用图标打开阅声，再次点击“申请保护”</span></div>
                    </>
                  ) : null}
                  {installPlatform === "desktop" ? (
                    <>
                      <div><b>1</b><span>打开浏览器地址栏右侧的安装图标或浏览器菜单</span></div>
                      <div><b>2</b><span>选择“安装阅声”或“将此站点安装为应用”</span></div>
                      <div><b>3</b><span>安装后从桌面或开始菜单打开，再次点击“申请保护”</span></div>
                    </>
                  ) : null}
                </div>
                <button className="primary-button install-done" onClick={() => setInstallOpen(false)}>
                  我知道了
                </button>
              </>
            )}
            <small>安装不会上传 PDF，也不会移动或删除当前设备上的文档。</small>
          </section>
        </div>
      ) : null}
    </div>
  );
}
