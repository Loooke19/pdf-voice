import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  RefreshCw as ArrowClockwise,
  ChevronLeft as CaretLeft,
  ChevronRight as CaretRight,
  Check,
  CircleStop as StopCircle,
  Copy,
  Ellipsis as DotsThree,
  FileText as FilePdf,
  FolderOpen,
  Gauge,
  Headphones,
  Menu as List,
  LockKeyhole as LockKey,
  Minus,
  Pause,
  Play,
  Plus,
  SkipBack,
  SkipForward,
  Volume2 as SpeakerHigh,
  Trash2 as Trash,
  Upload as UploadSimple,
  X,
} from "lucide-react";
import {
  deleteDocument,
  getDocument,
  getStorageStatus,
  listDocuments,
  requestPersistentStorage,
  saveDocument,
  updateDocumentMetadata,
} from "./lib/db";
import {
  makeDocumentPreview,
  makeSegments,
  makeSentences,
  PENDING_PAGE_MESSAGE,
} from "./lib/segments";
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
      <img
        className="brand-mark"
        src={`${import.meta.env.BASE_URL}icons/app-icon.svg`}
        alt=""
        aria-hidden="true"
      />
      <span>阅声</span>
    </div>
  );
}

function Home({
  documents,
  onImport,
  onOpen,
  onResume,
  onDelete,
  onOpenStorage,
  storageStatus,
  activeDocument,
  player,
  backgrounded = false,
  processing,
  processingDocumentId,
}) {
  const storagePercent = storageStatus?.quota > 0
    ? Math.min(100, Math.max(storageStatus.usage > 0 ? 1 : 0, Math.round(
      (storageStatus.usage / storageStatus.quota) * 100,
    )))
    : 0;

  return (
    <main
      className="app-shell"
      inert={backgrounded ? true : undefined}
      aria-hidden={backgrounded ? "true" : undefined}
    >
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
                <Plus />
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
            <span className="empty-icon"><FolderOpen /></span>
            <strong>这里还没有文档</strong>
            <span>导入第一份 PDF，识别后的文字和朗读进度会保存在这里。</span>
          </button>
        ) : (
          <div className="document-list">
            {documents.map((doc, index) => (
              <article className="document-row" key={doc.id}>
                <button className={`cover cover-${index % 4}`} onClick={() => onOpen(doc.id)}>
                  <FilePdf />
                  <span>{doc.pageCount} 页</span>
                </button>
                <button className="document-main" onClick={() => onOpen(doc.id)}>
                  <span className={`document-status ${
                    doc.processingState && doc.processingState !== "complete" ? "is-partial" : ""
                  } ${processingDocumentId === doc.id ? "is-processing" : ""}`}>
                    {!doc.processingState || doc.processingState === "complete" ? <Check /> : <ArrowClockwise />}
                    {!doc.processingState || doc.processingState === "complete"
                      ? "已完成"
                      : processingDocumentId === doc.id
                        ? `识别中 · ${doc.completedPages || 0} / ${doc.pageCount || "?"} 页`
                        : `待继续 · ${doc.completedPages || 0} / ${doc.pageCount || "?"} 页`}
                  </span>
                  <h3>{doc.title}</h3>
                  <p>{doc.preview || "已识别文字，等待朗读。"}</p>
                  <span className="document-meta">
                    {formatDate(doc.updatedAt)} · {doc.segmentCount || doc.segments?.length || 0} 段
                  </span>
                </button>
                <div className="row-actions">
                  {!doc.processingState || doc.processingState === "complete" ? (
                    <button
                      className="round-play"
                      aria-label={`播放 ${doc.title}`}
                      onClick={() => onOpen(doc.id, true)}
                    >
                      <Play fill="currentColor" />
                    </button>
                  ) : (
                    <button
                      className="round-play resume-processing"
                      aria-label={`继续识别 ${doc.title}`}
                      disabled={processing || processingDocumentId === doc.id}
                      onClick={() => onResume(doc.id)}
                    >
                      <ArrowClockwise />
                    </button>
                  )}
                  <button className="icon-button subtle" aria-label="删除文档" onClick={() => onDelete(doc)}>
                    <Trash />
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {activeDocument
        && (!activeDocument.processingState || activeDocument.processingState === "complete") ? (
        <button className="mini-player" onClick={() => onOpen(activeDocument.id)}>
          <span className="mini-cover"><Headphones /></span>
          <span className="mini-copy">
            <strong>{activeDocument.title}</strong>
            <small>
              第 {player.currentIndex + 1} 段 / 共 {activeDocument.segments?.length || activeDocument.segmentCount || 0} 段
            </small>
          </span>
          <span className="mini-action">
            {player.isPlaying ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}
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
          <span className="mini-processing-icon"><FilePdf /></span>
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
            <span className="interrupted-icon"><StopCircle /></span>
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
                <Check /> 导入当前内容
              </button>
              <button className="secondary-button danger-button" onClick={onDiscardPartial}>
                <X /> 取消导入
              </button>
            </div>
          </div>
        ) : processing ? (
          <div className="processing-panel" aria-live="polite">
            <div className="processing-orbit"><FilePdf /></div>
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
              <span className="upload-icon"><UploadSimple /></span>
              <strong>选择本地 PDF</strong>
              <span>或将文件拖放到这里</span>
              <small>最大 500MB · 页数不限</small>
            </button>
            {error ? <p className="error-message">{error}</p> : null}
            <div className="privacy-note">
              <LockKey />
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

function SourcePanel({
  document,
  viewedIndex,
  playingIndex,
  open,
  onSelect,
  onOpenSource,
}) {
  return (
    <aside className={`source-panel ${open ? "is-open" : ""}`} aria-hidden={!open}>
      <div className="source-file">
        <span className="source-file-icon"><FilePdf /></span>
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
            className={[
              index === viewedIndex ? "is-viewing" : "",
              index === playingIndex ? "is-playing" : "",
            ].filter(Boolean).join(" ")}
            key={`${document.id}-${index}`}
            onClick={() => onSelect(index)}
            aria-label={`${segment.title}${index === playingIndex ? "，正在播放" : ""}`}
          >
            <span>{String(index + 1).padStart(2, "0")}</span>
            <div>
              <strong>{segment.title}</strong>
              <small>{segment.text.slice(0, 34)}{segment.text.length > 34 ? "…" : ""}</small>
            </div>
            {index === playingIndex ? <em className="playing-badge">播放中</em> : null}
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

function mapDisplaySentences(displayText, speechText) {
  const sentences = makeSentences(speechText || "");
  const source = compactWithMap(displayText);
  const ranges = [];
  let compactCursor = 0;
  let displayCursor = 0;

  sentences.forEach((sentence, sentenceIndex) => {
    const compactSentence = compactWithMap(sentence).compact.replace(/\.{3,}/g, "");
    if (!compactSentence || !source.map.length) return;
    let matchIndex = source.compact.indexOf(compactSentence, compactCursor);
    let matchLength = compactSentence.length;

    if (matchIndex < 0) {
      const fallback = compactSentence.slice(0, Math.min(14, compactSentence.length));
      matchIndex = fallback.length >= 5
        ? source.compact.indexOf(fallback, compactCursor)
        : -1;
      matchLength = fallback.length;
    }
    if (matchIndex < 0) return;

    const start = source.map[matchIndex];
    const endMapIndex = Math.min(
      source.map.length - 1,
      matchIndex + Math.max(1, matchLength) - 1,
    );
    let end = source.map[endMapIndex] + 1;
    const matchedText = displayText.slice(start, end);
    if (!/[。！？.!?；;]\s*$/.test(matchedText)) {
      const sentenceEnd = displayText.slice(end).search(/[。！？.!?；;]/);
      if (sentenceEnd >= 0 && sentenceEnd < 180) end += sentenceEnd + 1;
    }
    if (start > displayCursor) ranges.push({ text: displayText.slice(displayCursor, start) });
    ranges.push({
      text: displayText.slice(start, end),
      sentenceIndex,
    });
    displayCursor = end;
    compactCursor = matchIndex + Math.max(1, matchLength);
  });

  if (displayCursor < displayText.length) {
    ranges.push({ text: displayText.slice(displayCursor) });
  }
  return ranges.length ? ranges : [{ text: displayText }];
}

function InteractiveRecognizedText({
  displayText,
  speechText,
  activeSentenceIndex,
  active,
  onSelectSentence,
}) {
  const ranges = useMemo(
    () => mapDisplaySentences(displayText, speechText),
    [displayText, speechText],
  );

  return (
    <>
      {ranges.map((range, index) => (
        Number.isInteger(range.sentenceIndex) ? (
          <button
            className={`recognized-sentence ${
              active && range.sentenceIndex === activeSentenceIndex ? "is-speaking" : ""
            }`}
            key={`${range.sentenceIndex}-${index}`}
            onClick={() => onSelectSentence(range.sentenceIndex)}
            aria-label={`从第 ${range.sentenceIndex + 1} 句开始播放`}
          >
            {range.text}
          </button>
        ) : (
          <span key={`text-${index}`}>{range.text}</span>
        )
      ))}
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

function Reader({
  document,
  onBack,
  onReprocessPage,
  onResume,
  player,
  onSelectSegment,
  processingDocumentId,
}) {
  const [tab, setTab] = useState("text");
  const [copied, setCopied] = useState(false);
  const [currentHasIllustration, setCurrentHasIllustration] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth > 760);
  const [viewedIndex, setViewedIndex] = useState(player.currentIndex);
  const [isEntering, setIsEntering] = useState(true);
  const [isExiting, setIsExiting] = useState(false);
  const actionsRef = useRef(null);
  const enterFrameRef = useRef(null);
  const enterReadyFrameRef = useRef(null);
  const exitTimerRef = useRef(null);
  const readingPaneRef = useRef(null);
  const sourceStageRef = useRef(null);
  const previousPlayingIndexRef = useRef(player.currentIndex);
  const current = document.segments[viewedIndex] || document.segments[0];
  const displayText = current?.displayText || current?.text || "";
  const hasStoredIllustrationNotice = displayText.includes(ILLUSTRATION_NOTICE);
  const viewingPlaybackPage = viewedIndex === player.currentIndex;

  useEffect(() => {
    const previousPlayingIndex = previousPlayingIndexRef.current;
    setViewedIndex((index) => (
      index === previousPlayingIndex ? player.currentIndex : index
    ));
    previousPlayingIndexRef.current = player.currentIndex;
  }, [player.currentIndex]);

  useEffect(() => {
    if (hasStoredIllustrationNotice || !document.file) {
      setCurrentHasIllustration(hasStoredIllustrationNotice);
      return undefined;
    }
    let cancelled = false;
    import("./lib/pdfPreview")
      .then(({ detectPdfPageIllustration }) => detectPdfPageIllustration(
        document.file,
        viewedIndex + 1,
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
    viewedIndex,
  ]);

  const browseSegment = (index) => {
    setViewedIndex(index);
    if (window.matchMedia("(max-width: 760px)").matches) setSidebarOpen(false);
    window.requestAnimationFrame(() => {
      if (readingPaneRef.current) readingPaneRef.current.scrollTop = 0;
      if (sourceStageRef.current) sourceStageRef.current.scrollTop = 0;
    });
  };

  const playViewedSentence = (sentenceIndex) => {
    player.selectSentence(viewedIndex, sentenceIndex, true);
  };

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

  useEffect(() => {
    enterFrameRef.current = window.requestAnimationFrame(() => {
      enterReadyFrameRef.current = window.requestAnimationFrame(() => setIsEntering(false));
    });
    return () => {
      window.cancelAnimationFrame(enterFrameRef.current);
      window.cancelAnimationFrame(enterReadyFrameRef.current);
      window.clearTimeout(exitTimerRef.current);
    };
  }, []);

  const returnHome = () => {
    if (isEntering || isExiting) return;
    setIsExiting(true);
    exitTimerRef.current = window.setTimeout(onBack, 900);
  };

  return (
    <main
      className={`reader-shell ${isEntering ? "is-entering" : ""} ${isExiting ? "is-exiting" : ""}`}
      onTransitionEnd={(event) => {
        if (isExiting && event.target === event.currentTarget && event.propertyName === "transform") {
          window.clearTimeout(exitTimerRef.current);
          onBack();
        }
      }}
    >
      <header className="reader-topbar">
        <button
          className="sidebar-toggle"
          onClick={() => setSidebarOpen((value) => !value)}
          aria-label={sidebarOpen ? "收起页面目录" : "打开页面目录"}
          aria-expanded={sidebarOpen}
        >
          <List />
        </button>
        <button
          className="reader-home-button"
          onClick={returnHome}
          aria-label="返回首页"
          disabled={isEntering || isExiting}
        >
          <ChevronDown />
        </button>
      </header>
      <div className={`reader-workspace ${sidebarOpen ? "is-sidebar-open" : "is-sidebar-closed"}`}>
        <button
          className="source-panel-backdrop"
          onClick={() => setSidebarOpen(false)}
          aria-label="关闭页面目录"
          tabIndex={sidebarOpen ? 0 : -1}
        />
        <SourcePanel
          document={document}
          viewedIndex={viewedIndex}
          playingIndex={player.currentIndex}
          open={sidebarOpen}
          onSelect={browseSegment}
          onOpenSource={openSource}
        />
        <section
          className={`reading-pane ${tab === "source" ? "is-source-mode" : ""}`}
          ref={readingPaneRef}
        >
          <div className="reading-header">
            <div>
              <p className="section-label">正在阅读</p>
              <h1><ScrollingTitle>{document.title}</ScrollingTitle></h1>
              <p>
                {document.processingState && document.processingState !== "complete"
                  ? `${processingDocumentId === document.id ? "正在识别" : "识别待继续"} · ${document.completedPages || 0} / ${document.pageCount || "?"} 页`
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
                  <DotsThree />
                </button>
                {actionsOpen ? (
                  <div className="reading-actions-popover">
                    {document.processingState && document.processingState !== "complete" ? (
                      <button
                        disabled={processingDocumentId === document.id}
                        onClick={() => {
                          setActionsOpen(false);
                          onResume(document.id);
                        }}
                      >
                        <ArrowClockwise /> {processingDocumentId === document.id ? "正在识别" : "继续识别"}
                      </button>
                    ) : null}
                    <button
                      disabled={Boolean(processingDocumentId)}
                      onClick={() => { setActionsOpen(false); onReprocessPage(viewedIndex); }}
                    >
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
            <article
              className={`text-content ${viewingPlaybackPage ? "" : "is-previewing"}`}
            >
              <h2>{current?.title}</h2>
              <pre className="recognized-layout">
                <InteractiveRecognizedText
                  displayText={displayText}
                  speechText={current?.text || ""}
                  activeSentenceIndex={player.sentenceIndex}
                  active={viewingPlaybackPage && (player.isPlaying || player.sentenceIndex > 0)}
                  onSelectSentence={playViewedSentence}
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
                  <span>
                    第 {viewedIndex + 1} 页
                    {viewingPlaybackPage ? " · 与当前朗读段落同步" : " · 仅预览，未切换朗读"}
                  </span>
                </div>
                <button className="secondary-button" onClick={openSource}><FolderOpen /> 新窗口打开</button>
              </div>
              <PdfPagePreview
                file={document.file}
                pageNumber={viewedIndex + 1}
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
        <span className="track-icon"><Headphones /></span>
        <div>
          <strong>{current?.title}</strong>
          <span>第 {player.currentIndex + 1} 段 / 共 {document.segments.length} 段</span>
        </div>
      </div>
      <div className="transport">
        <button onClick={player.previous} aria-label="上一页" title="上一页"><CaretLeft /></button>
        <button onClick={() => player.skip(-1)} aria-label="上一句" title="上一句"><SkipBack /></button>
        <button
          className="main-play"
          onClick={player.toggle}
          aria-label={player.isPlaying ? "暂停" : "播放"}
        >
          {player.isPlaying ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}
        </button>
        <button onClick={() => player.skip(1)} aria-label="下一句" title="下一句"><SkipForward /></button>
        <button onClick={player.next} aria-label="下一页" title="下一页"><CaretRight /></button>
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
  const [processingDocumentId, setProcessingDocumentId] = useState(null);
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
      processingState: partial ? "paused" : "complete",
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

  const makeProcessingDocument = (file, result, existing, processingState = "processing") => {
    const text = result.text || `第 1 页\n\n${PENDING_PAGE_MESSAGE}`;
    const segments = makeSegments(text);
    return {
      ...existing,
      id: existing?.id || crypto.randomUUID(),
      title: file.name.replace(/\.pdf$/i, ""),
      fileName: file.name,
      file,
      size: file.size,
      pageCount: result.pageCount || existing?.pageCount || 0,
      completedPages: result.completedPages ?? existing?.completedPages ?? 0,
      partial: processingState !== "complete",
      processingState,
      processingError: processingState === "error" ? existing?.processingError : "",
      ocrPages: result.ocrPages ?? existing?.ocrPages ?? 0,
      illustrationPages: result.illustrationPages || existing?.illustrationPages || [],
      text,
      preview: processingState === "complete"
        ? makeDocumentPreview(segments)
        : `正在识别 · 已完成 ${result.completedPages ?? existing?.completedPages ?? 0} 页`,
      segments,
      lastSegment: Math.min(existing?.lastSegment || 0, Math.max(0, segments.length - 1)),
      createdAt: existing?.createdAt || Date.now(),
      updatedAt: Date.now(),
    };
  };

  const updateProcessingDocument = async (document) => {
    await saveDocument(document);
    setDocuments((items) => {
      const summary = {
        ...document,
        file: undefined,
        text: undefined,
        segments: undefined,
        segmentCount: document.segments.length,
      };
      const exists = items.some((item) => item.id === document.id);
      return exists
        ? items.map((item) => (item.id === document.id ? { ...item, ...summary } : item))
        : [summary, ...items];
    });
    setSelected((current) => (current?.id === document.id ? document : current));
  };

  const processStoredDocument = async (document, options = {}) => {
    const controller = new AbortController();
    importControllerRef.current = controller;
    setProcessingDocumentId(document.id);
    setInterrupted(null);
    setImportMinimized(true);
    setImportOpen(false);
    setProgress({ value: 0, label: "正在读取文件", detail: document.fileName });
    setProcessing(true);
    try {
      const { processPdf } = await import("./lib/pdf");
      const result = await processPdf(document.file, {
        signal: controller.signal,
        forceOcr: Boolean(options.forceOcr),
        initialText: options.forceOcr ? "" : document.text,
        initialOcrPages: options.forceOcr ? 0 : document.ocrPages,
        initialIllustrationPages: options.forceOcr ? [] : document.illustrationPages,
        onProgress: (next) => setProgress((current) => ({
          ...next,
          value: Math.max(current.value, next.value),
        })),
        onCheckpoint: async (checkpoint) => {
          const next = makeProcessingDocument(
            document.file,
            checkpoint,
            document,
            checkpoint.interrupted ? "paused" : "processing",
          );
          Object.assign(document, next);
          await updateProcessingDocument(next);
        },
      });
      if (result.interrupted) {
        await updateProcessingDocument(makeProcessingDocument(
          document.file,
          result,
          document,
          "paused",
        ));
        return;
      }
      const completed = makeProcessingDocument(document.file, result, document, "complete");
      await updateProcessingDocument(completed);
      await refreshDocuments();
      await refreshStorageStatus();
    } catch (reason) {
      if (!controller.signal.aborted) {
        const message = reason instanceof Error ? reason.message : "处理 PDF 时发生错误。";
        const failed = {
          ...document,
          partial: true,
          processingState: "error",
          processingError: message,
          preview: `识别暂停 · ${message}`,
          updatedAt: Date.now(),
        };
        await updateProcessingDocument(failed);
        setError(message);
      }
    } finally {
      if (importControllerRef.current === controller) importControllerRef.current = null;
      setProcessing(false);
      setProcessingDocumentId(null);
      setImportMinimized(false);
    }
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
    if (processing) {
      setError("当前已有一份文档正在识别，请稍后再导入。");
      return;
    }

    setProcessing(true);
    setProgress({ value: 1, label: "正在保存源文件", detail: file.name });
    try {
      const draft = makeProcessingDocument(file, {
        text: `第 1 页\n\n${PENDING_PAGE_MESSAGE}`,
        pageCount: 0,
        completedPages: 0,
        ocrPages: 0,
        illustrationPages: [],
      }, null, "processing");
      await updateProcessingDocument(draft);
      await requestPersistentStorage().catch(() => false);
      await refreshDocuments();
      void processStoredDocument(draft, options);
    } catch (reason) {
      setProcessing(false);
      setError(reason instanceof Error ? reason.message : "保存 PDF 时发生错误。");
    }
  };

  const resumeDocument = async (id) => {
    if (processing) return;
    const document = await getDocument(id);
    if (!document?.file || document.processingState === "complete") return;
    void processStoredDocument(document);
  };

  const reprocessCurrentPage = async (pageIndex = player.currentIndex) => {
    if (!selected?.file) return;
    const pageNumber = pageIndex + 1;
    const playbackIndex = player.currentIndex;
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
      player.load(Math.min(playbackIndex, segments.length - 1), false);
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
    if (processingDocumentId === document.id) {
      importControllerRef.current?.abort();
      await new Promise((resolve) => window.setTimeout(resolve, 120));
    }
    await deleteDocument(document.id);
    await refreshDocuments();
    if (selected?.id === document.id) {
      player.stop();
      setSelected(null);
    }
  };

  return (
    <>
      <Home
        documents={documents}
        onImport={openImport}
        onOpen={openDocument}
        onResume={resumeDocument}
        onDelete={removeDocument}
        onOpenStorage={() => {
          refreshStorageStatus().catch(() => {});
          setStorageOpen(true);
        }}
        storageStatus={storageStatus}
        activeDocument={activeDocument}
        player={player}
        backgrounded={screen === "reader"}
        processing={processing}
        processingDocumentId={processingDocumentId}
      />
      {screen === "reader" && selected ? (
        <Reader
          document={selected}
          onBack={() => setScreen("home")}
          onReprocessPage={reprocessCurrentPage}
          onResume={resumeDocument}
          player={player}
          onSelectSegment={(index) => player.select(index, player.isPlaying)}
          processingDocumentId={processingDocumentId}
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
