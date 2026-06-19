import { useRegisterSW } from "virtual:pwa-register/react";

export function PwaStatus() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisterError(error) {
      console.error("Service Worker registration failed", error);
    },
  });

  if (!needRefresh && !offlineReady) return null;

  return (
    <aside className="pwa-toast" aria-live="polite">
      <strong>{needRefresh ? "发现新版本" : "已可离线打开"}</strong>
      <span>
        {needRefresh
          ? "更新不会删除保存在当前设备的 PDF 和阅读进度。"
          : "应用外壳已缓存；已保存的文档可在离线时打开。"}
      </span>
      <div>
        {needRefresh ? (
          <button onClick={() => updateServiceWorker(true)}>立即更新</button>
        ) : null}
        <button onClick={() => {
          setNeedRefresh(false);
          setOfflineReady(false);
        }}>
          稍后
        </button>
      </div>
    </aside>
  );
}
