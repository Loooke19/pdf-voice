# Design QA

- Source visual truth: `/Users/luke/Downloads/用所选项目新建的文件夹/1.PNG`, `/Users/luke/Downloads/用所选项目新建的文件夹/2.PNG`, `/Users/luke/Downloads/用所选项目新建的文件夹/3.PNG`, `/Users/luke/Downloads/用所选项目新建的文件夹/4.PNG`; these are functional references only. The approved visual direction is the modern-reader brief confirmed in the thread.
- Implementation screenshots: `qa/home-desktop.png`, `qa/import-desktop.png`, `qa/home-ipad.png`, `qa/reader-ipad.png`.
- Comparison boards: `qa/compare-home.png`, `qa/compare-reader.png`.
- Viewports: 1440×1024 PC and 1180×820 iPad landscape.
- States: populated home library, import dialog, extracted-text reader, source-file tab, persistent segmented player.

**Full-view comparison evidence**

- The implementation preserves the reference workflow: prominent PDF conversion entry, local file picker, completed-content library, source-file access, extracted text, and persistent playback.
- The visual treatment intentionally differs from the supplied screenshots, as requested: it uses a restrained editorial reader system rather than the reference app’s colorful mobile dashboard.
- Both tested viewports have no horizontal overflow. At iPad width the reader retains its source rail, reading pane, and bottom transport without clipping.

**Focused region comparison evidence**

- Home: the conversion action is the dominant first task, while the document history remains visible below it with play and delete actions.
- Import: the modal includes file type intent, the 500MB size constraint, unlimited page-count messaging, local-only processing disclosure, scanning/OCR expectation, close behavior, and drag/drop target.
- Reader: source PDF metadata and open action remain distinct from extracted text; segmented navigation and player controls stay persistent.
- Player: previous/next segment, sentence skip, play/pause, rate, device voice, and segment position are represented with consistent controls.
- Import task: active processing can collapse into a persistent compact panel; interruption leads to an explicit keep-partial or discard decision instead of silently losing work.

**Required fidelity surfaces**

- Fonts and typography: Noto Serif SC is used for reading and display hierarchy; Noto Sans SC is used for controls and metadata. Long-form text stays at 19px/2.05 line-height on larger screens.
- Spacing and layout rhythm: the PC home uses a 1180px content frame; reader rails and fixed player align without overlap at both target viewports.
- Colors and tokens: warm paper, ink, muted gray, green privacy state, and violet accent are consistently tokenized.
- Image and icon quality: product imagery is deliberately abstract and code-native because it represents a document surface; all functional icons use the consistent Phosphor icon family.
- Copy and content: privacy, limits, OCR behavior, device storage, and segmented playback accurately reflect the implemented MVP.

**Findings**

- No actionable P0, P1, or P2 visual or interaction issues remain.

**Patches made**

- Deferred PDF.js into a conversion-only chunk so the library screen loads without the PDF engine.
- Corrected chapter/page heading segmentation so recognized headings start new playback segments.
- Rebuilt progress reporting as monotonic phases and added cancellable, minimizable background import behavior.
- Added broken-font text-layer detection, page-render OCR fallback, Chinese OCR whitespace normalization, and a safe full-document re-recognition path that cannot be overwritten by stale playback progress.
- Split page-faithful display text from speech-cleaned text, preserved OCR line breaks/indentation, and added an embedded “原始版面” mode synchronized to the active PDF page for exact layout fidelity.
- Added a document-wide draggable sentence progress bar and verified live, whitespace-tolerant highlighting of the currently spoken OCR sentence.
- Verified modal sizing, desktop frame width, reader/player geometry, and horizontal overflow at both target viewports.

**Follow-up polish**

- P3: a future release can add an embedded PDF page canvas beside the text; v1 opens the locally stored source PDF in the browser.

final result: passed
