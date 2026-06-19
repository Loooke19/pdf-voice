import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowClockwise,
  BookOpenText,
  CaretLeft,
  CaretRight,
  Check,
  Copy,
  FilePdf,
  FolderOpen,
  Gauge,
  Headphones,
  LockKey,
  Minus,
  DotsThree,
  Pause,
  Play,
  Plus,
  SkipBack,
  SkipForward,
  SpeakerHigh,
  StopCircle,
  Trash,
  UploadSimple,
  X,
} from "@phosphor-icons/react";
import {
  deleteDocument,
  getDocument,
  getStorageStatus,
  listDocuments,
  requestPersistentStorage,
  saveDocument,
  updateDocumentMetadata,
} from "./lib/db";
import { makeDocumentPreview, makeSegments, makeSentences } from "./lib/segments";
import { normalizeRecognizedText } from "./lib/textQuality";
import { useSpeechPlayer } from "./lib/useSpeechPlayer";
import { StorageDialog } from "./components/StorageDialog";
import { PwaStatus } from "./components/PwaStatus";

const MAX_BYTES = 500 * 1024 * 1024;
const ILLUSTRATION_NOTICE = "【此处为配图，请查看原始版面】";
const formatBytes = (bytes = 0) =>
  bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

const formatDate = (stamp) =>
  new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(stamp));

function replacePageText(documentText, pageNumber, pageText, hasIllustration) {
  const pages = documentText
    .replace(/\r/g, "")
    .split(/(?=^第 \d+ 页\s*$)/gm)
    .map((part) => part.trim())
    .filter(Boolean);
  const replacement = [
    `第 ${pageNumber} 页`,
    pageText.trim(),
    hasIllustration ? ILLUSTRATION_NOTICE : "",
  ].filter(Boolean).join("\n\n");
  const index = pages.findIndex((page) => page.startsWith(`第 ${pageNumber} 页`));

  if (index >= 0) pages[index] = replacement;
  else pages.splice(Math.max(0, pageNumber - 1), 0, replacement);
  return pages.join("\n\n");
}

function Brand() {
  return (
    <div className="brand" aria-label="阅声首页">
      <span className="brand-mark"><BookOpenText weight="duotone" /></span>
      <span>阅声</span>
    </div>
  );
}

function Home({
  documents,
  onImport,
  onOpen,
  onDelete,
  onOpenStorage,
  storageStatus,
  activeDocument,
  player,
}) {
  const storagePercent = storageStatus?.quota > 0
    ? Math.min(100, Math.max(storageStatus.usage > 0 ? 1 : 0, Math.round(
      (storageStatus.usage / storageStatus.quota) * 100,
    )))
    : 0;

  return (
    <main className="app-shell">
      <header className="topbar">
        <Brand />
        <div className="topbar-actions">
          <button
            className="storage-meter"
            onClick={onOpenStorage}
            aria-label={`存储已使用 ${storagePercent}%，打开存储与备份`}
            title={`存储已使用 ${storagePercent}%`}
            style={{ "--storage-percent": `${storagePercent * 3.6}deg` }}
          >
            <span>{storagePercent}%</span>
          </button>
        </div>
      </header>

      {documents.length === 0 ? (
        <section className="hero">
          <div className="hero-copy">
            <p className="section-label">本地 PDF 阅读与朗读</p>
            <h1>把 PDF 变成<br />可以听的文字</h1>
            <p className="hero-description">
              在浏览器里提取文字、识别扫描页，再用设备自带声音分段朗读。
              文件不会上传到服务器。
            </p>
            <div className="hero-actions">
              <button className="primary-button" onClick={onImport}>
                <Plus weight="bold" />
                导入 PDF
              </button>
              <span>最大 500MB · 页数不限</span>
            </div>
          </div>
          <button className="drop-visual" onClick={onImport}>
            <span className="paper-stack paper-back" />
            <span className="paper-stack paper-mid" />
            <span className="paper-stack paper-front">
              <span className="pdf-stamp">PDF</span>
              <span className="paper-lines" />
              <span className="wave-line">⌁⌁⌁</span>
            </span>
            <span className="drop-caption"><UploadSimple /> 点击选择或拖入文件</span>
          </button>
        </section>
      ) : null}

      <section className={`library-section ${documents.length > 0 ? "is-populated" : ""}`}>
        <div className="section-heading">
          <div>
            <p className="section-label">LIBRARY</p>
            <h2>我的文档</h2>
          </div>
          {documents.length > 0 ? (
            <button className="secondary-button" onClick={onImport}>
              <Plus /> 导入 PDF
            </button>
          ) : null}
        </div>

        {documents.length === 0 ? (
          <button className="empty-library" onClick={onImport}>
            <span className="empty-icon"><FolderOpen weight="duotone" /></span>
            <strong>这里还没有文档</strong>
            <span>导入第一份 PDF，识别后的文字和朗读进度会保存在这里。</span>
          </button>
        ) : (
          <div className="document-list">
            {documents.map((doc, index) => (
              <article className="document-row" key={doc.id}>
                <button className={`cover cover-${index % 4}`} onClick={() => onOpen(doc.id)}>
                  <FilePdf weight="duotone" />
                  <span>{doc.pageCount} 页</span>
                </button>
                <button className="document-main" onClick={() => onOpen(doc.id)}>
                  <span className={`document-status ${doc.partial ? "is-partial" : ""}`}>
                    {doc.partial ? <StopCircle weight="bold" /> : <Check weight="bold" />}
                    {doc.partial ? `部分导入 · ${doc.completedPages} 页` : "已完成"}
                  </span>
                  <h3>{doc.title}</h3>
                  <p>{doc.preview || "已识别文字，等待朗读。"}</p>
                  <span className="document-meta">
                    {formatDate(doc.updatedAt)} · {doc.segmentCount || doc.segments?.length || 0} 段
                  </span>
                </button>
                <div className="row-actions">
                  <button
                    className="round-play"
                    aria-label={`播放 ${doc.title}`}
                    onClick={() => onOpen(doc.id, true)}
                  >
                    <Play weight="fill" />
                  </button>
                  <button className="icon-button subtle" aria-label="删除文档" onClick={() => onDelete(doc)}>
                    <Trash />
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {activeDocument ? (
        <button className="mini-player" onClick={() => onOpen(activeDocument.id)}>
          <span className="mini-cover"><Headphones weight="duotone" /></span>
          <span className="mini-copy">
            <strong>{activeDocument.title}</strong>
            <small>
              第 {player.currentIndex + 1} 段 / 共 {activeDocument.segments?.length || activeDocument.segmentCount || 0} 段
            </small>
          </span>
          <span className="mini-action">
            {player.isPlaying ? <Pause weight="fill" /> : <Play weight="fill" />}
          </span>
        </button>
      ) : null}
    </main>
  );
}

function ImportDialog({
  open,
  minimized,
  onMinimize,
  onRestore,
  onClose,
  onChoose,
  onInterrupt,
  onKeepPartial,
  onDiscardPartial,
  processing,
  interrupted,
  progress,
  error,
}) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);

  if (processing && minimized) {
    return (
      <aside className="import-mini" aria-live="polite">
        <button className="import-mini-main" onClick={onRestore}>
          <span className="mini-processing-icon"><FilePdf weight="duotone" /></span>
          <span>
            <strong>{progress.label}</strong>
            <small>{progress.detail}</small>
          </span>
          <b>{Math.round(progress.value)}%</b>
        </button>
        <div className="mini-progress-track"><span style={{ width: `${progress.value}%` }} /></div>
        <button className="mini-stop-button" onClick={onInterrupt}><StopCircle /> 中断</button>
      </aside>
    );
  }

  if (!open) return null;

  const acceptFiles = (files) => {
    const file = files?.[0];
    if (file) onChoose(file);
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !processing) onClose();
    }}>
      <section className="import-dialog" role="dialog" aria-modal="true" aria-labelledby="import-title">
        <div className="dialog-header">
          <div>
            <p className="section-label">LOCAL IMPORT</p>
            <h2 id="import-title">导入 PDF</h2>
          </div>
          {!processing && !interrupted ? (
            <div className="dialog-header-actions">
              <button className="icon-button" onClick={onClose} aria-label="关闭">
                <X />
              </button>
            </div>
          ) : null}
        </div>

        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          hidden
          onChange={(event) => acceptFiles(event.target.files)}
        />

        {interrupted ? (
          <div className="interrupted-panel" aria-live="polite">
            <span className="interrupted-icon"><StopCircle weight="duotone" /></span>
            <h3>导入已中断</h3>
            <p>
              已完成 {interrupted.completedPages} / {interrupted.pageCount || "?"} 页。
              你可以保留目前识别到的文字，或放弃这次导入。
            </p>
            <div className="partial-preview">
              {interrupted.text
                ? `${interrupted.text.replace(/\s+/g, " ").slice(0, 150)}${interrupted.text.length > 150 ? "…" : ""}`
                : "还没有提取到可保存的文字。"}
            </div>
            <div className="interrupt-actions">
              <button
                className="primary-button"
                onClick={onKeepPartial}
                disabled={!interrupted.text}
              >
                <Check weight="bold" /> 导入当前内容
              </button>
              <button className="secondary-button danger-button" onClick={onDiscardPartial}>
                <X /> 取消导入
              </button>
            </div>
          </div>
        ) : processing ? (
          <div className="processing-panel" aria-live="polite">
            <div className="processing-orbit"><FilePdf weight="duotone" /></div>
            <h3>{progress.label}</h3>
            <p>{progress.detail}</p>
            <div className="progress-track"><span style={{ width: `${progress.value}%` }} /></div>
            <strong>{Math.round(progress.value)}%</strong>
            <div className="processing-actions">
              <button className="secondary-button" onClick={onMinimize}><Minus /> 最小化</button>
              <button className="secondary-button danger-button" onClick={onInterrupt}><StopCircle /> 中断导入</button>
            </div>
            <small>
              可最小化到右下角继续处理。扫描页首次会从当前网址下载本地 OCR 模型；
              iPad 上请保持应用在前台。
            </small>
          </div>
        ) : (
          <>
            <button
              className={`file-drop-zone ${dragging ? "is-dragging" : ""}`}
              onClick={() => inputRef.current?.click()}
              onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                acceptFiles(event.dataTransfer.files);
              }}
            >
              <span className="upload-icon"><UploadSimple weight="bold" /></span>
              <strong>选择本地 PDF</strong>
              <span>或将文件拖放到这里</span>
              <small>最大 500MB · 页数不限</small>
            </button>
            {error ? <p className="error-message">{error}</p> : null}
            <div className="privacy-note">
              <LockKey weight="fill" />
              <div>
                <strong>只在当前设备处理</strong>
                <p>文字提取、扫描页 OCR 和历史保存均在浏览器内完成，不上传源文件。</p>
              </div>
            </div>
            <p className="dialog-footnote">扫描 PDF 会逐页识别，长文档可能需要数分钟。</p>
          </>
        )}
      </section>
    </div>
  );
}

function SourcePanel({ document, activeIndex, onSelect, onOpenSource }) {
  return (
    <aside className="source-panel">
      <div className="source-file">
        <span className="source-file-icon"><FilePdf weight="duotone" /></span>
        <div>
          <strong>{document.title}</strong>
          <span>{document.pageCount} 页 · {formatBytes(document.size)}</span>
        </div>
      </div>
      <button className="source-open-button" onClick={onOpenSource}>
        <FolderOpen /> 打开源文件
      </button>
      <div className="segment-list-heading">
        <span>朗读片段</span>
        <small>{document.segments.length} 段</small>
      </div>
      <div className="segment-list">
        {document.segments.map((segment, index) => (
          <button
            className={index === activeIndex ? "is-active" : ""}
            key={`${document.id}-${index}`}
            onClick={() => onSelect(index)}
          >
            <span>{String(index + 1).padStart(2, "0")}</span>
            <div>
              <strong>{segment.title}</strong>
              <small>{segment.text.slice(0, 34)}{segment.text.length > 34 ? "…" : ""}</small>
            </div>
          </button>
        ))}
      </div>
    </aside>
  );
}

function compactWithMap(text) {
  let compact = "";
  const map = [];
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (/\s/.test(character) || character === "·") continue;
    compact += character;
    map.push(index);
  }
  return { compact, map };
}

function HighlightedText({ displayText, speechText, sentenceIndex, active }) {
  if (!active) return <>{displayText}</>;
  const sentence = makeSentences(speechText || "")[sentenceIndex] || "";
  if (!sentence) return <>{displayText}</>;

  const source = compactWithMap(displayText);
  const needle = compactWithMap(sentence).compact
    .replace(/\.{3,}/g, "")
    .slice(0, 40);
  let matchIndex = source.compact.indexOf(needle);
  let matchLength = needle.length;

  if (matchIndex < 0) {
    const fallback = needle.slice(0, Math.min(14, needle.length));
    matchIndex = fallback.length >= 5 ? source.compact.indexOf(fallback) : -1;
    matchLength = fallback.length;
  }
  if (matchIndex < 0 || !source.map.length) return <>{displayText}</>;

  const start = source.map[matchIndex];
  const endMapIndex = Math.min(source.map.length - 1, matchIndex + Math.max(1, matchLength) - 1);
  let end = source.map[endMapIndex] + 1;
  const sentenceEnd = displayText.slice(end).search(/[。！？.!?；;\n]/);
  if (sentenceEnd >= 0 && sentenceEnd < 180) end += sentenceEnd + 1;

  return (
    <>
      {displayText.slice(0, start)}
      <mark className="spoken-highlight">{displayText.slice(start, end)}</mark>
      {displayText.slice(end)}
    </>
  );
}

function ScrollingTitle({ children }) {
  const viewportRef = useRef(null);
  const textRef = useRef(null);
  const [motion, setMotion] = useState(null);

  useEffect(() => {
    const viewport = viewportRef.current;
    const text = textRef.current;
    if (!viewport || !text) return undefined;

    const measure = () => {
      const overflow = text.scrollWidth > viewport.clientWidth + 1;
      setMotion(overflow ? {
        distance: text.scrollWidth + 48,
        duration: Math.max(10, (text.scrollWidth + 48) / 42),
      } : null);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    observer.observe(text);
    return () => observer.disconnect();
  }, [children]);

  return (
    <div
      className={`scrolling-title ${motion ? "is-scrolling" : ""}`}
      ref={viewportRef}
      aria-label={children}
      style={motion ? {
        "--title-distance": `${motion.distance}px`,
        "--title-duration": `${motion.duration}s`,
      } : undefined}
    >
      <span className="scrolling-title-track">
        <span ref={textRef}>{children}</span>
        {motion ? <span aria-hidden="true">{children}</span> : null}
      </span>
    </div>
  );
}

function PdfPagePreview({ file, pageNumber, stageRef }) {
  const internalContainerRef = useRef(null);
  const canvasRef = useRef(null);
  const [availableWidth, setAvailableWidth] = useState(0);
  const [status, setStatus] = useState("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const container = internalContainerRef.current;
    if (!container) return undefined;
    const updateWidth = () => setAvailableWidth(Math.max(240, container.clientWidth - 48));
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!file || !availableWidth || !canvasRef.current) return undefined;
    let cancelled = false;
    setStatus("loading");
    setMessage("");

    import("./lib/pdfPreview")
      .then(({ renderPdfPage }) => renderPdfPage(
        file,
        pageNumber,
        availableWidth,
      ))
      .then((rendered) => {
        if (cancelled || !canvasRef.current) return;
        const canvas = canvasRef.current;
        const context = canvas.getContext("2d", { alpha: false });
        canvas.width = rendered.canvas.width;
        canvas.height = rendered.canvas.height;
        canvas.style.width = `${rendered.cssWidth}px`;
        canvas.style.height = `${rendered.cssHeight}px`;
        context.drawImage(rendered.canvas, 0, 0);
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) {
          setStatus("error");
          setMessage("无法显示这一页，请尝试在新窗口打开源文件。");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [availableWidth, file, pageNumber]);

  return (
    <div
      className="pdf-page-stage"
      ref={(node) => {
        internalContainerRef.current = node;
        if (stageRef) stageRef.current = node;
      }}
      aria-busy={status === "loading"}
    >
      {status === "loading" ? <div className="pdf-page-status">正在载入第 {pageNumber} 页…</div> : null}
      {status === "error" ? <div className="pdf-page-status is-error">{message}</div> : null}
      <canvas
        ref={canvasRef}
        className={status === "ready" ? "is-ready" : ""}
        aria-label={`原始 PDF 第 ${pageNumber} 页`}
      />
    </div>
  );
}

function Reader({ document, onBack, onReprocessPage, player, onSelectSegment }) {
  const [tab, setTab] = useState("text");
  const [copied, setCopied] = useState(false);
  const [currentHasIllustration, setCurrentHasIllustration] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const actionsRef = useRef(null);
  const readingPaneRef = useRef(null);
  const sourceStageRef = useRef(null);
  const current = document.segments[player.currentIndex] || document.segments[0];
  const displayText = current?.displayText || current?.text || "";
  const hasStoredIllustrationNotice = displayText.includes(ILLUSTRATION_NOTICE);

  useEffect(() => {
    if (hasStoredIllustrationNotice || !document.file) {
      setCurrentHasIllustration(hasStoredIllustrationNotice);
      return undefined;
    }
    let cancelled = false;
    import("./lib/pdfPreview")
      .then(({ detectPdfPageIllustration }) => detectPdfPageIllustration(
        document.file,
        player.currentIndex + 1,
        current?.text || "",
      ))
      .then((result) => {
        if (!cancelled) setCurrentHasIllustration(result);
      })
      .catch(() => {
        if (!cancelled) setCurrentHasIllustration(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    current?.text,
    document.file,
    hasStoredIllustrationNotice,
    player.currentIndex,
  ]);

  const openSource = () => {
    const url = URL.createObjectURL(document.file);
    window.open(url, "_blank", "noopener,noreferrer");
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  const copyText = async () => {
    await navigator.clipboard.writeText(document.text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  useEffect(() => {
    if (!actionsOpen) return undefined;
    const close = (event) => {
      if (!actionsRef.current?.contains(event.target)) setActionsOpen(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [actionsOpen]);

  return (
    <main className="reader-shell">
      <header className="reader-topbar">
        <button className="back-button" onClick={onBack}><ArrowLeft /> 返回文档库</button>
        <Brand />
      </header>
      <div className="reader-workspace">
        <SourcePanel
          document={document}
          activeIndex={player.currentIndex}
          onSelect={onSelectSegment}
          onOpenSource={openSource}
        />
        <section
          className="reading-pane"
          ref={readingPaneRef}
        >
          <div className="reading-header">
            <div>
              <p className="section-label">正在阅读</p>
              <h1><ScrollingTitle>{document.title}</ScrollingTitle></h1>
              <p>
                {document.partial
                  ? `已导入 ${document.completedPages} / ${document.pageCount} 页`
                  : `${document.pageCount} 页`}
                {" · "}{document.ocrPages || 0} 页使用本地 OCR · 自动保存在此设备
              </p>
            </div>
            <div className="reading-actions">
              <div className="mobile-reading-actions" ref={actionsRef}>
                <button
                  className="secondary-button"
                  onClick={() => setActionsOpen((value) => !value)}
                  aria-label="更多阅读操作"
                  aria-expanded={actionsOpen}
                >
                  <DotsThree weight="bold" />
                </button>
                {actionsOpen ? (
                  <div className="reading-actions-popover">
                    <button onClick={() => { setActionsOpen(false); onReprocessPage(); }}>
                      <ArrowClockwise /> 重新识别当前页
                    </button>
                    <button onClick={() => { setActionsOpen(false); copyText(); }}>
                      {copied ? <Check /> : <Copy />} {copied ? "已复制" : "复制全文"}
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
          <div className="reader-tabs" role="tablist">
            <button className={tab === "text" ? "is-active" : ""} onClick={() => setTab("text")}>识别文字</button>
            <button className={tab === "source" ? "is-active" : ""} onClick={() => setTab("source")}>原始版面</button>
          </div>
          {tab === "text" ? (
            <article className="text-content">
              <h2>{current?.title}</h2>
              <pre className="recognized-layout">
                <HighlightedText
                  displayText={displayText}
                  speechText={current?.text || ""}
                  sentenceIndex={player.sentenceIndex}
                  active={player.isPlaying || player.sentenceIndex > 0}
                />
              </pre>
              {currentHasIllustration && !hasStoredIllustrationNotice ? (
                <p className="illustration-notice">{ILLUSTRATION_NOTICE}</p>
              ) : null}
            </article>
          ) : (
            <div className="source-preview">
              <div className="source-preview-toolbar">
                <div>
                  <strong>原始 PDF 版面</strong>
                  <span>第 {player.currentIndex + 1} 页 · 与当前朗读段落同步</span>
                </div>
                <button className="secondary-button" onClick={openSource}><FolderOpen /> 新窗口打开</button>
              </div>
              <PdfPagePreview
                file={document.file}
                pageNumber={player.currentIndex + 1}
                stageRef={sourceStageRef}
              />
            </div>
          )}
        </section>
      </div>
      <PlayerBar document={document} player={player} />
    </main>
  );
}

function PlayerBar({ document, player }) {
  const current = document.segments[player.currentIndex] || document.segments[0];
  const voiceOptions = player.voices.filter((voice) => /^(zh|en)/i.test(voice.lang)).slice(0, 24);
  const [sentenceProgress, setSentenceProgress] = useState(0);

  useEffect(
    () => player.subscribeSentenceProgress(setSentenceProgress),
    [player.subscribeSentenceProgress],
  );

  const pageProgress = player.sentenceCount > 0
    ? (player.sentenceIndex + sentenceProgress) / player.sentenceCount
    : 0;

  const rateField = (
    <label>
      <Gauge />
      <span>速率</span>
      <select value={player.rate} onChange={(event) => player.setRate(Number(event.target.value))}>
        <option value="0.75">0.75×</option>
        <option value="1">1.0×</option>
        <option value="1.25">1.25×</option>
        <option value="1.5">1.5×</option>
        <option value="2">2.0×</option>
      </select>
    </label>
  );
  const voiceField = (
    <label className="voice-select">
      <SpeakerHigh />
      <span>声音</span>
      <select value={player.voiceURI} onChange={(event) => player.setVoiceURI(event.target.value)}>
        <option value="">系统默认语音</option>
        {voiceOptions.map((voice) => (
          <option key={voice.voiceURI} value={voice.voiceURI}>{voice.name} · {voice.lang}</option>
        ))}
      </select>
    </label>
  );

  return (
    <footer className="player-bar">
      <div className="playback-progress">
        <input
          aria-label="当前页朗读进度"
          type="range"
          min="0"
          max={Math.max(1, player.sentenceCount)}
          step="0.01"
          value={Math.min(
            player.sentenceIndex + sentenceProgress,
            Math.max(1, player.sentenceCount),
          )}
          onChange={(event) => player.seekSentence(Math.floor(Number(event.target.value)))}
          style={{
            "--progress": `${pageProgress * 100}%`,
          }}
        />
        <span>
          本页 {Math.min(player.sentenceIndex + 1, player.sentenceCount)} / {player.sentenceCount} 句
        </span>
      </div>
      {player.speechError ? (
        <div className="speech-error" role="alert">{player.speechError}</div>
      ) : null}
      <div className="track-info">
        <span className="track-icon"><Headphones weight="duotone" /></span>
        <div>
          <strong>{current?.title}</strong>
          <span>第 {player.currentIndex + 1} 段 / 共 {document.segments.length} 段</span>
        </div>
      </div>
      <div className="transport">
        <button onClick={player.previous} aria-label="上一页" title="上一页"><CaretLeft weight="bold" /></button>
        <button onClick={() => player.skip(-1)} aria-label="上一句" title="上一句"><SkipBack /></button>
        <button
          className="main-play"
          onClick={player.toggle}
          aria-label={player.isPlaying ? "暂停" : "播放"}
        >
          {player.isPlaying ? <Pause weight="fill" /> : <Play weight="fill" />}
        </button>
        <button onClick={() => player.skip(1)} aria-label="下一句" title="下一句"><SkipForward /></button>
        <button onClick={player.next} aria-label="下一页" title="下一页"><CaretRight weight="bold" /></button>
      </div>
      <div className="player-settings">
        {rateField}
        {voiceField}
      </div>
      <div className="compact-settings">
        <label className="compact-settings-trigger voice-trigger">
          <SpeakerHigh />
          <span>声音</span>
          <select
            aria-label="声音设置"
            value={player.voiceURI}
            onChange={(event) => player.setVoiceURI(event.target.value)}
          >
            <option value="">系统默认语音</option>
            {voiceOptions.map((voice) => (
              <option key={voice.voiceURI} value={voice.voiceURI}>{voice.name} · {voice.lang}</option>
            ))}
          </select>
        </label>
        <label className="compact-settings-trigger rate-trigger">
          <Gauge />
          <span>{player.rate}×</span>
          <select
            aria-label="速率设置"
            value={player.rate}
            onChange={(event) => player.setRate(Number(event.target.value))}
          >
            <option value="0.75">0.75×</option>
            <option value="1">1.0×</option>
            <option value="1.25">1.25×</option>
            <option value="1.5">1.5×</option>
            <option value="2">2.0×</option>
          </select>
        </label>
      </div>
    </footer>
  );
}

export function App() {
  const [documents, setDocuments] = useState([]);
  const [storageStatus, setStorageStatus] = useState(null);
  const [screen, setScreen] = useState("home");
  const [selected, setSelected] = useState(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importMinimized, setImportMinimized] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [storageOpen, setStorageOpen] = useState(false);
  const [interrupted, setInterrupted] = useState(null);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState({ value: 0, label: "正在读取文件", detail: "" });
  const importControllerRef = useRef(null);

  const refreshDocuments = useCallback(async () => {
    const items = await listDocuments();
    setDocuments(items);
    return items;
  }, []);

  const refreshStorageStatus = useCallback(async () => {
    const status = await getStorageStatus();
    setStorageStatus(status);
    return status;
  }, []);

  const player = useSpeechPlayer(selected?.segments || [], async (index) => {
    if (!selected) return;
    const next = { ...selected, lastSegment: index, updatedAt: Date.now() };
    setSelected(next);
    await updateDocumentMetadata(next.id, {
      lastSegment: index,
      updatedAt: next.updatedAt,
    });
    setDocuments((items) => items.map((item) => (
      item.id === next.id
        ? { ...item, lastSegment: index, updatedAt: next.updatedAt }
        : item
    )));
  });

  useEffect(() => {
    refreshStorageStatus().catch(() => setStorageStatus(null));
    refreshDocuments().then(async (items) => {
      if (import.meta.env.DEV && new URLSearchParams(window.location.search).has("demo") && items.length === 0) {
        const demoText = `第一章 在风起之前

傍晚的光落在窗边，书页像一片缓慢移动的海。她把桌上的文件翻到下一页，决定暂时不追赶时间，只听一听文字原本的声音。

这是一段用于检查阅读器排版与分段播放的示例文字。真实使用时，阅声会从你选择的 PDF 中提取文字；如果遇到扫描页，则会在当前设备运行 OCR。

第二章 一封很长的信

有些内容适合快速浏览，有些内容则更适合闭上眼睛慢慢听。设备自带的声音并不产生额外费用，所有阅读进度也只保存在这个浏览器里。`;
        const demo = {
          id: "local-demo-document",
          title: "在风起之前 · 阅读示例",
          fileName: "阅读示例.pdf",
          file: new Blob(["阅声本地阅读示例"], { type: "application/pdf" }),
          size: 2840000,
          pageCount: 18,
          ocrPages: 3,
          text: demoText,
          preview: "傍晚的光落在窗边，书页像一片缓慢移动的海。她决定暂时不追赶时间，只听一听文字原本的声音。",
          segments: makeSegments(demoText),
          lastSegment: 0,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        await saveDocument(demo);
        await refreshDocuments();
      }
    }).catch(() => setError("无法读取本地文档库。"));
  }, [refreshDocuments, refreshStorageStatus]);

  const activeDocument = useMemo(
    () => selected || documents.find((item) => item.lastSegment > 0),
    [selected, documents],
  );

  const storedBytes = useMemo(
    () => documents.reduce((total, item) => total + (item.storageBytes || item.size || 0), 0),
    [documents],
  );

  useEffect(() => {
    refreshStorageStatus().catch(() => {});
  }, [refreshStorageStatus, storedBytes]);

  const openDocument = async (id, autoplay = false) => {
    let document = await getDocument(id);
    if (!document) return;
    const normalizedText = normalizeRecognizedText(document.text || "");
    const normalizedSegments = makeSegments(normalizedText);
    const lastSegment = Math.max(
      0,
      Math.min(
        Number.isInteger(document.lastSegment) ? document.lastSegment : 0,
        Math.max(0, normalizedSegments.length - 1),
      ),
    );
    const segmentsChanged = JSON.stringify(normalizedSegments) !== JSON.stringify(document.segments);
    if (normalizedText !== document.text || segmentsChanged || lastSegment !== document.lastSegment) {
      document = {
        ...document,
        text: normalizedText,
        segments: normalizedSegments,
        preview: makeDocumentPreview(normalizedSegments),
        lastSegment,
      };
      await saveDocument(document);
      await refreshDocuments();
    } else {
      document = {
        ...document,
        text: normalizedText,
        segments: normalizedSegments,
        preview: document.preview || makeDocumentPreview(normalizedSegments),
        lastSegment,
      };
    }
    setSelected(document);
    player.load(lastSegment, autoplay);
    setScreen("reader");
  };

  const commitDocument = async (file, result, options = {}) => {
    const { partial = false, replaceDocument = null } = options;
    const segments = makeSegments(result.text);
    const document = {
      id: replaceDocument?.id || crypto.randomUUID(),
      title: file.name.replace(/\.pdf$/i, ""),
      fileName: file.name,
      file,
      size: file.size,
      pageCount: result.pageCount,
      completedPages: result.completedPages || result.pageCount,
      partial,
      ocrPages: result.ocrPages,
      illustrationPages: result.illustrationPages || [],
      text: result.text,
      preview: makeDocumentPreview(segments),
      segments,
      lastSegment: 0,
      createdAt: replaceDocument?.createdAt || Date.now(),
      updatedAt: Date.now(),
    };
    await saveDocument(document);
    await requestPersistentStorage().catch(() => false);
    await refreshDocuments();
    setSelected(document);
    player.load(0, false);
    setInterrupted(null);
    setImportOpen(false);
    setImportMinimized(false);
    setScreen("reader");
  };

  const handleFile = async (file, options = {}) => {
    setError("");
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      setError("请选择 PDF 文件。");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("文件超过 500MB，请选择更小的 PDF。");
      return;
    }

    const controller = new AbortController();
    importControllerRef.current = controller;
    setInterrupted(null);
    setImportMinimized(false);
    setImportOpen(true);
    setProgress({ value: 0, label: "正在读取文件", detail: file.name });
    setProcessing(true);
    try {
      const { processPdf } = await import("./lib/pdf");
      const result = await processPdf(file, {
        signal: controller.signal,
        forceOcr: Boolean(options.forceOcr),
        onProgress: (next) => setProgress((current) => ({
          ...next,
          value: Math.max(current.value, next.value),
        })),
      });
      if (result.interrupted) {
        setInterrupted({ ...result, file, options });
        setImportOpen(true);
        setImportMinimized(false);
        return;
      }
      await commitDocument(file, result, options);
    } catch (reason) {
      if (!controller.signal.aborted) {
        setError(reason instanceof Error ? reason.message : "处理 PDF 时发生错误。");
      }
    } finally {
      if (importControllerRef.current === controller) importControllerRef.current = null;
      setProcessing(false);
    }
  };

  const reprocessCurrentPage = async () => {
    if (!selected?.file) return;
    const pageNumber = player.currentIndex + 1;
    const controller = new AbortController();
    importControllerRef.current = controller;
    setError("");
    setInterrupted(null);
    setImportMinimized(false);
    setImportOpen(true);
    setProgress({
      value: 0,
      label: "正在准备当前页",
      detail: `仅重新识别第 ${pageNumber} 页`,
    });
    setProcessing(true);

    try {
      const { recognizePdfPage } = await import("./lib/pdf");
      const result = await recognizePdfPage(selected.file, pageNumber, {
        signal: controller.signal,
        onProgress: (next) => setProgress(next),
      });
      if (result.interrupted) {
        setImportOpen(false);
        return;
      }

      const text = replacePageText(
        selected.text,
        pageNumber,
        result.pageText,
        result.hasIllustration,
      );
      const segments = makeSegments(text);
      const next = {
        ...selected,
        text,
        segments,
        preview: makeDocumentPreview(segments),
        illustrationPages: result.hasIllustration
          ? [...new Set([...(selected.illustrationPages || []), pageNumber])]
          : (selected.illustrationPages || []).filter((page) => page !== pageNumber),
        updatedAt: Date.now(),
      };
      await saveDocument(next);
      setSelected(next);
      await refreshDocuments();
      player.load(Math.min(pageNumber - 1, segments.length - 1), false);
      setImportOpen(false);
    } catch (reason) {
      if (!controller.signal.aborted) {
        setError(reason instanceof Error ? reason.message : "重新识别当前页时发生错误。");
      }
    } finally {
      if (importControllerRef.current === controller) importControllerRef.current = null;
      setProcessing(false);
    }
  };

  const openImport = () => {
    setError("");
    if (processing) {
      setImportMinimized(false);
      setImportOpen(true);
      return;
    }
    setImportOpen(true);
  };

  const discardInterrupted = () => {
    setInterrupted(null);
    setError("");
    setImportOpen(false);
    setImportMinimized(false);
  };

  const removeDocument = async (document) => {
    if (!window.confirm(`确定删除“${document.title}”吗？源 PDF 和识别文字都会从当前设备移除。`)) return;
    await deleteDocument(document.id);
    await refreshDocuments();
    if (selected?.id === document.id) {
      player.stop();
      setSelected(null);
    }
  };

  return (
    <>
      {screen === "home" ? (
        <Home
          documents={documents}
          onImport={openImport}
          onOpen={openDocument}
          onDelete={removeDocument}
          onOpenStorage={() => {
            refreshStorageStatus().catch(() => {});
            setStorageOpen(true);
          }}
          storageStatus={storageStatus}
          activeDocument={activeDocument}
          player={player}
        />
      ) : selected ? (
        <Reader
          document={selected}
          onBack={() => setScreen("home")}
          onReprocessPage={reprocessCurrentPage}
          player={player}
          onSelectSegment={(index) => player.select(index, player.isPlaying)}
        />
      ) : null}
      <ImportDialog
        open={importOpen}
        minimized={importMinimized}
        onMinimize={() => { setImportMinimized(true); setImportOpen(false); }}
        onRestore={() => { setImportMinimized(false); setImportOpen(true); }}
        onClose={() => !processing && !interrupted && setImportOpen(false)}
        onChoose={handleFile}
        onInterrupt={() => importControllerRef.current?.abort()}
        onKeepPartial={() => interrupted && commitDocument(interrupted.file, interrupted, {
          ...interrupted.options,
          partial: true,
        })}
        onDiscardPartial={discardInterrupted}
        processing={processing}
        interrupted={interrupted}
        progress={progress}
        error={error}
      />
      <StorageDialog
        open={storageOpen}
        onClose={() => {
          setStorageOpen(false);
          refreshStorageStatus().catch(() => {});
        }}
        documents={documents}
        onChanged={async () => {
          await Promise.all([refreshDocuments(), refreshStorageStatus()]);
        }}
      />
      <PwaStatus />
    </>
  );
}
