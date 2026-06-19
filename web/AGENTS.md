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
- Playback exposes a current-page sentence progress slider; the currently spoken sentence is highlighted in the OCR display using whitespace-tolerant text matching.
- Playback progress moves continuously and monotonically within the active sentence using the same frame-based time interpolation across supported browsers; browser-specific speech boundary events must not alter the visible progress.
- On widths below 1000px, voice and rate remain separate, always-visible triggers with their own upward popovers.
- On phone widths, reader actions collapse into a single “…” menu containing “重新识别当前页” and “复制全文”.
- The home header omits the redundant local-only badge and uses a circular storage-percentage control that opens storage details.
- If persistent storage is denied, “申请保护” opens an adaptive install flow: native PWA installation on supporting PC/Android browsers, and Add to Home Screen guidance on iPad/iPhone Safari.
- Mobile text scrolling never changes pages. The fixed bottom transport exposes previous/next page and previous/next sentence controls around play.
- Narrow player controls keep voice and rate separate: voice stays at the left edge, rate stays at the right edge, and play remains centered.
- Manual re-recognition operates on the active PDF page only and replaces only that page’s recognized text.
