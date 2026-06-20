# Prototype Instructions

Run the local server yourself and open the preview in the in-app browser. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

## Product decisions

- Visual direction: modern reading tool with warm paper surfaces, editorial Chinese typography, dark ink, and restrained violet-blue accents.
- Target: responsive public web app for PC and iPad.
- Privacy: PDF parsing, OCR, speech, source files, text, and history remain on the current device.
- Limits: PDF only, maximum 500MB; no page-count limit.
- Audio: segmented device speech synthesis; no downloadable MP3/WAV and no paid API dependency.
- Import jobs can be minimized, interrupted after the current page operation, then either saved as partial content or discarded.
- PDF pages with broken font character maps must be detected as suspicious text and rendered to images for OCR; existing documents expose a full “重新识别” action.
- Reader separates OCR text from exact page layout: “识别文字” preserves OCR line breaks for copying/reading, while “原始版面” embeds the current source PDF page and follows the active page segment.
- “原始版面” reserves the reader’s remaining height for its PDF stage; the page canvas scrolls independently in both directions while reader chrome and playback stay fixed.
- Playback exposes a current-page sentence progress slider; the currently spoken sentence is highlighted in the OCR display using whitespace-tolerant text matching.
- Playback progress moves continuously and monotonically within the active sentence using the same frame-based time interpolation across supported browsers; browser-specific speech boundary events must not alter the visible progress.
- On widths below 1000px, voice and rate remain separate, always-visible triggers with their own upward popovers.
- At every width, reader actions live in a single “…” menu containing “重新识别当前页” and “复制全文”.
- Reader document titles are never ellipsized: overflowing titles loop horizontally, while reduced-motion users can scroll them manually. The inline purple segment badge is omitted.
- The page directory is a browse-only surface: selecting an entry previews its text without changing playback. Every recognized sentence is individually clickable and starts playback from that sentence, including when previewing another page. Fine-pointer devices show sentence hover feedback; touch devices do not depend on hover. The directory is collapsible on wide screens and opens as an overlay from a hamburger control on narrow screens.
- The directory marks playback with a compact right-aligned “播放中” badge; it does not use a left-edge playback outline.
- The reader top bar contains only the directory toggle on the left and a downward-arrow home action on the right; it omits both the centered brand and the labeled back button.
- Interface icons use Lucide’s restrained single-line style. The reader home action uses `ChevronDown`, and the home brand reuses the installed PWA app icon instead of a separate book glyph.
- Activating the reader’s downward home action slides the entire reader sheet down to reveal the already-rendered library beneath it, then closes the reader after the transition.
- Opening a document uses the inverse sheet transition: the reader rises from the bottom over the library. Both entry and dismissal use a deliberately unhurried 700ms easing with an even, readable travel pace.
- Production is hosted free on GitHub Pages at `https://read.loooke.net/`; production assets and PWA routes therefore use the domain root rather than the former `/pdf-voice/` project subpath.
- PDF imports are durable jobs: the source file and a library record are saved before parsing begins, incomplete pages display “暂未完成识别”, each completed page is checkpointed locally, and interrupted jobs remain available to resume.
- Background recognition does not use a floating progress panel. Its library row owns the task controls: an active job shows a stop button, and a paused job shows a resume button.
- Interrupting recognition closes the progress dialog immediately while the worker shuts down. Deleting an active job tombstones its ID before aborting, waits for worker cleanup, and prevents late checkpoints from recreating the deleted document.
- In the mobile reader, the app shell, reader header, tabs, and player remain fixed. Only the recognized-text area or original-page stage owns vertical scrolling; opening the reader locks document-level scrolling.
- Global font sizing is available from the “Aa” control on both the library and reader headers. The selected small, standard, large, or extra-large scale persists on the current device.
- OCR reconstruction uses Tesseract line coordinates to detect one-, two-, or three-column page layouts. Multi-column pages are read column-by-column from left to right, with text ordered top-to-bottom inside each column.
- On Chinese-dominant OCR lines, low-confidence short Latin, mixed alphanumeric, symbol, and isolated short-number fragments are removed using word-level confidence data; credible English names, years, and measurements remain.
- PWA update prompts are backed by both service-worker lifecycle events and an uncached `version.json` comparison on startup, focus, foreground return, reconnection, and a five-minute interval.
- The library logo has no visible update affordance. Clicking the unchanged logo opens a small version bubble with the current version and a manual update check; “立即更新” appears only when a newer build is available.
- Locally generated document IDs use the shared `createId()` compatibility helper; direct `crypto.randomUUID()` calls are avoided because iOS Safari omits that API on non-secure origins.
- The home header omits the redundant local-only badge and uses a circular storage-percentage control that opens storage details.
- The large import hero appears only while the library is empty. Once documents exist, importing moves to a compact “导入 PDF” action at the upper-right of “我的文档”.
- If persistent storage is denied, “申请保护” opens an adaptive install flow: native PWA installation on supporting PC/Android browsers, and Add to Home Screen guidance on iPad/iPhone Safari.
- PWA update prompts show the current and target version. Starting an update opens a compact loading toast before the new service worker reloads the app.
- Mobile text scrolling never changes pages. The fixed bottom transport exposes previous/next page and previous/next sentence controls around play.
- Narrow player controls keep voice and rate separate: voice stays at the left edge, rate stays at the right edge, and play remains centered.
- Manual re-recognition operates on the active PDF page only and replaces only that page’s recognized text.
