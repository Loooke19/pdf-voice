import { useEffect, useRef, useState } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";

const currentVersion = `v${__APP_VERSION__}`;

export function PwaStatus() {
  const registrationRef = useRef(null);
  const [updating, setUpdating] = useState(false);
  const [targetVersion, setTargetVersion] = useState("");
  const [remoteUpdateAvailable, setRemoteUpdateAvailable] = useState(false);
  const [updateError, setUpdateError] = useState("");
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker,
  } = useRegisterSW({
    immediate: true,
    onRegisteredSW(_scriptUrl, registration) {
      registrationRef.current = registration;
      registration?.update().catch(() => {});
    },
    onRegisterError(error) {
      console.error("Service Worker registration failed", error);
    },
  });
  const previewUpdate = import.meta.env.DEV
    && new URLSearchParams(window.location.search).has("pwa-update");
  const showRefresh = needRefresh || remoteUpdateAvailable || previewUpdate;

  useEffect(() => {
    const checkForUpdate = async () => {
      if (document.visibilityState !== "visible" || !navigator.onLine) return;
      registrationRef.current?.update().catch(() => {});
      try {
        const response = await fetch(
          `${import.meta.env.BASE_URL}version.json?time=${Date.now()}`,
          { cache: "no-store" },
        );
        const result = await response.json();
        const remoteVersion = result.version ? `v${result.version}` : "";
        setTargetVersion(remoteVersion);
        setRemoteUpdateAvailable(Boolean(remoteVersion && remoteVersion !== currentVersion));
      } catch {
        // A version check is best-effort; the service worker can still announce an update.
      }
    };
    void checkForUpdate();
    const interval = window.setInterval(checkForUpdate, 5 * 60 * 1000);
    document.addEventListener("visibilitychange", checkForUpdate);
    window.addEventListener("online", checkForUpdate);
    window.addEventListener("focus", checkForUpdate);
    window.addEventListener("pageshow", checkForUpdate);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", checkForUpdate);
      window.removeEventListener("online", checkForUpdate);
      window.removeEventListener("focus", checkForUpdate);
      window.removeEventListener("pageshow", checkForUpdate);
    };
  }, []);

  useEffect(() => {
    if (!showRefresh || targetVersion) return;
    fetch(`${import.meta.env.BASE_URL}version.json?time=${Date.now()}`, {
      cache: "no-store",
    })
      .then((response) => response.json())
      .then((result) => setTargetVersion(result.version ? `v${result.version}` : ""))
      .catch(() => setTargetVersion(""));
  }, [showRefresh, targetVersion]);

  if (!showRefresh && !offlineReady && !updating) return null;

  return (
    <aside className={`pwa-toast ${updating ? "is-updating" : ""}`} aria-live="polite">
      {updating ? (
        <>
          <span className="pwa-update-spinner" aria-hidden="true" />
          <div className="pwa-update-copy">
            <strong>正在更新阅声</strong>
            <span>正在安装 {targetVersion || "新版本"}，马上回来…</span>
          </div>
          <small>{currentVersion} → {targetVersion || "最新版"}</small>
        </>
      ) : (
        <>
          <strong>{showRefresh ? "发现新版本" : "已可离线打开"}</strong>
          <span>
            {showRefresh
              ? `当前 ${currentVersion}${targetVersion ? ` · 可更新至 ${targetVersion}` : ""}。更新不会删除本地 PDF 和阅读进度。`
              : `应用外壳已缓存；已保存的文档可在离线时打开。当前 ${currentVersion}。`}
          </span>
          {updateError ? <small className="pwa-update-error">{updateError}</small> : null}
          <div>
            {showRefresh ? (
              <button onClick={async () => {
                setUpdating(true);
                setUpdateError("");
                try {
                  await new Promise((resolve) => window.setTimeout(resolve, 900));
                  if (previewUpdate) {
                    await new Promise((resolve) => window.setTimeout(resolve, 900));
                    setUpdating(false);
                    return;
                  }
                  await registrationRef.current?.update();
                  await updateServiceWorker(true);
                } catch {
                  setUpdating(false);
                  setUpdateError("更新失败，请检查网络后重试。");
                }
              }}>
                立即更新
              </button>
            ) : null}
            <button onClick={() => {
              setNeedRefresh(false);
              setRemoteUpdateAvailable(false);
              setOfflineReady(false);
            }}>
              稍后
            </button>
          </div>
        </>
      )}
    </aside>
  );
}
