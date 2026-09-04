# Changelog

All notable changes to the StudyNet project are documented in this file.

## [Unreleased] - 2026-09-04

### 📝 Study Notes & Snips
- **Formula Parser / OCR**: Added a new Gemini-powered Formula OCR tool to the Snip popover. Extracts raw LaTeX from captured PDF snippets with live KaTeX preview, manual editing, and direct insertion into notes.
- **LaTeX Rendering**: Enabled full LaTeX math rendering (`$$ ... $$`) in Study Notes via `remark-math` and `rehype-katex`.
- **Smooth In-Note Image Zooming**: Implemented fluid mouse-wheel zooming for snips directly inside Study Notes with debounced storage saves and dynamic layout reflow.
- **Interactive Fullscreen Lightbox & GPU Pan/Zoom**:
  - Upgraded fullscreen image popout using React Portals (`createPortal`) for absolute layer isolation.
  - Implemented GPU-accelerated infinite zoom (up to 1000%) with active non-passive wheel listeners.
  - Added smooth click-and-drag panning with grab cursors and global window tracking.
  - Added double-click quick toggle (100% / 250%) and header toolbar zoom controls (+, -, reset badge).
  - Fixed accidental popout dismissals during dragging and prevented unmount race conditions during debounced markdown saves.
- **Note State Persistence Fix**: Fixed a critical race condition during component unmounts that caused Study Notes to cross-contaminate between different documents.
- **Auto-Repair Mislinked Notes**: Added a background service (`noteRepairService.ts`) to automatically detect and re-link orphaned or swapped notes to their correct parent documents.

## [0.1.1] - 2026-08-31

### 📌 Dashboard Study Board & Pinnwand
- **Study Board Workspace**: Added an interactive study and scratchpad board to the right column of the dashboard on wide screens (`max-w-[1700px]`), stacking responsively on mobile.
- **Sticky Notes**: Color-coded sticky notes (7 color schemes: Yellow, Blue, Green, Purple, Rose, Orange, Slate) with in-place editing, pinning, and deletion.
- **Paper Reading Order**: Structured reading queue supporting direct document library selection, reading progress badges, direct reader opening (`#doc=...`), reordering (`1.`, `2.`, `3.`), priority tags (*Next*, *High*, *Medium*, *Optional*), and custom notes.
- **Reminders & Deadlines**: Important date tracking with automatic urgency badges (*Due today*, *Tomorrow*, *In X days*, *Overdue*) and completion checkmarks.
- **Checklists & To-Dos**: Interactive task lists with progress bars, keyboard creation (`Enter`), and instant strike-through upon completion.
- **Image & Screenshot Support**: Upload images, drag-and-drop directly onto the board, or paste from clipboard (`Ctrl+V`), with offline IndexedDB storage and full-screen lightbox preview with download.
- **Dexie Schema v10 & Backup**: Persistent local storage in `dashboardCards` Dexie table with full JSON backup export and import integration.

### 🎨 UI Theming & Shape Engine
- **Toggleable UI Themes**: Added real-time design shape styles in the Settings panel:
  - 🟣 **Modern Rounded (Default)**: Bento grid with soft rounded corners (`rounded-xl`).
  - ⬛ **Minimal Sharp**: 90° crisp, angular corners (`border-radius: 0px`) across all cards, buttons, badges, and popups.
  - ⚡ **Tactical Chamfer**: 45° beveled angle cuts using CSS `clip-path: polygon(...)` for a futuristic HUD/Cyber look.
  - 📐 **Technical Blueprint**: CAD/engineering style with blueprint grid background, subtle blue frame accents, and monospace metrics.
- **Persistent Storage**: Selected theme persists across sessions in `localStorage`.

### 📖 Reader & Citation Enhancements
- **Persistent Reader Sidebar State**: Reader sidebar state (`open` / `collapsed`) is persisted across document changes and reloads in `localStorage` without unwanted auto-collapsing.
- **One-Click APA Citation Copy**: Clicking the `DOI: ...` badge in the reader header copies the standardized **APA 7th Edition citation** (Authors, Year, Title, DOI link) to the clipboard with animated visual feedback (`✓ Zitation kopiert!`) and toast notifications. Fallback copy button available for documents without DOI.

### 📄 Docling Fluid Mode & Equation Reconstruction
- **Optimized Docling Pipeline**: Accelerated PDF-to-Markdown conversion on CPU by disabling slow VLM formula enrichments while retaining crystal-clear inline formula image fallbacks.
- **2D Spatial Equation Sorting**: Solved Elsevier/ScienceDirect scrambled PDF text streams by grouping PDF word bounding boxes by Y-coordinate and sorting horizontally by X-coordinate using PyMuPDF (`fitz`), producing clean LaTeX `aligned` blocks for multi-line reactions.
- **Intelligent Paragraph & Caption Stitching**: Enhanced `stitch_paragraphs` to seamlessly connect sentences split across page breaks, headers (`Catalysis Today`), figure captions (`Fig.`, `Table`), and images without dropping sentence continuity.
- **Typographical Ligature Normalization**: Automated backend fixing of split ligatures (`fi`, `fl`, `ffi`, `ff`, `ft`) in scientific texts.
- **Resilient KaTeX Rendering**: Configured `rehype-katex` with `strict: false, trust: true` and sanitized image file naming (`formula-*.png`) to prevent rendering collisions and LaTeX macro exceptions.
- **Fluid Mode Re-Generation & Downloads**: Added backend API endpoints (`/api/pdf/:id/fluid/regenerate`, `/api/pdf/:id/fluid/json`) and frontend OPFS caching to force re-processing and export structured Docling JSON.

### 📊 Excel / Spreadsheet Export
- **Comprehensive Metadata & Q&A Export**: Integrated `xlsx` sheet generation exporting all paper metadata, generated study questions, answers, taxonomy, Bloom's levels, and key quotes into styled multi-sheet workbooks.

---

## [0.1.0] - 2026-08-30

### 🚀 Highlights & Architectural Improvements
- **Native Gemini Structured Output (`responseSchema`)**: Fully migrated AI question generation to Gemini's native JSON Schema mode, eliminating brittle regex/markdown extraction and reducing token overhead.
- **Accurate Token & Cost Calculation**: Integrated full `totalTokenCount` accounting to include cached system prompts and reasoning tokens, deriving input tokens via `Math.max(0, totalTokens - outputTokens)`.
- **Intelligent Fast-Polling & Dynamic Fallbacks**: Replaced slow exponential backoffs with fast-polling (400ms base + 0–600ms jitter) and dynamic fallback model cascading configurable via the UI.
- **Continuous PDF Chunk Highlighting**: Upgraded PDF viewer highlighting from fragmented word matches to contiguous sentence and multi-sentence passage overlays with `mix-blend-mode: multiply` and non-overlapping bounding rects.
- **Scientific Text Normalization**: Fixed broken ligatures (`Æ` -> `Fi`/`fi`), hyphenation (`precursor±support` -> `precursor-support`), and chemical formula spacing (`Al 2 O 3` -> `Al2O3`).

---

### 🔍 Search & Retrieval
- **Multi-Vector Search Worker**: Offloaded heavy cosine similarity calculations to a dedicated Web Worker (`vectorSearch.worker.ts`).
- **Passage-Based Search Highlighting**: Opening search hits in the PDF viewer now passes the complete source chunk (`parentChunkText`) instead of isolated questions.
- **Hybrid Retrieval Enhancements**: Improved combination of dense vector similarity with lexical matching (MiniSearch) and Reciprocal Rank Fusion (RRF).

---

### 🤖 AI Question Generation & LLM Pipeline
- **Schema-Enforced Outputs**: Enforced `responseSchema` on `generateContent` requests for 100% compliant JSON responses.
- **Prompt Sanitization**: Stripped hardcoded schema instructions from the user prompt template to save tokens.
- **Fast Retry Loop with Hard Failure**: Hardened API retry logic with a strict attempt cap and immediate error escalation to prevent runaway request loops.
- **Configurable Fallbacks in Settings**:
  - Added dynamic fallback model selection populated from the user's API key.
  - Added configurable retry attempts per model.
  - Removed all hardcoded model names.

---

### 🎨 UI & Reader Experience
- **Token Tracker UI Cleanup**: Removed emojis and redundant local embedding badges for a clean, professional dashboard metric grid.
- **Precise Input Token Metrics**: Fixed token counters on both the Dashboard live progress bar and Paper cards to reflect actual billed tokens.
- **Configurable Target Chunk Size**: Added a slider (250–2000 tokens) in the settings panel to allow custom chunk sizes and token optimization.
- **Database Backup & Restore**: Added full JSON backup export and import for papers, questions, notes, and annotations.
- **PDF Overlay Blend & Alignment**: Prevented visual text distortion and overlapping bounding boxes during highlight rendering.

---

### 🛠️ PDF & Text Processing Engine
- **Ligature & Typo Normalization**: Implemented `textNormalization.ts` to fix PDF text extraction anomalies.
- **Chemical Formula Heuristic**: Adjusted character spacing heuristics in `pdfProcessor.worker.ts` for subscripts and chemical notation.
