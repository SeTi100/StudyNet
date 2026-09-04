<div align="center">

# ◈ StudyNet
### Intelligent Scientific Paper Reader & Research Workspace

**Local-First • AI-Powered • Offline-Ready • Privacy-Focused**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-18.x-61dafb?style=flat-square&logo=react&logoColor=black)](https://reactjs.org/)
[![Vite](https://img.shields.io/badge/Vite-6.x-646cff?style=flat-square&logo=vite&logoColor=white)](https://vitejs.dev/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-3.x-38b2ac?style=flat-square&logo=tailwind-css&logoColor=white)](https://tailwindcss.com/)
[![Google Gemini](https://img.shields.io/badge/AI-Google%20Gemini-orange?style=flat-square&logo=google&logoColor=white)](https://ai.google.dev/)
[![PWA Ready](https://img.shields.io/badge/PWA-Ready-10b981?style=flat-square&logo=pwa&logoColor=white)](#)

<p align="center">
  [ <b>English</b> | <a href="README.de.md">Deutsch</a> ]
</p>

<p align="center">
  A modern, privacy-first scientific research and study platform.<br />
  Reads complex 2-column academic PDFs, reconstructs mathematical/chemical equations, generates Bloom-taxonomy study questions via Google Gemini, and stores all documents, vectors, and notes 100% locally in your browser.
</p>

[◈ Highlights](#-highlights) • [⬡ Quickstart](#-quickstart) • [⌬ Core Features](#-core-features-in-detail) • [⎔ Architecture](#-architecture--system-design) • [⌖ Configuration](#-configuration--environment-variables) • [⧉ FAQ](#-troubleshooting--faq)

</div>

---

## ◈ Highlights

| Feature | Description |
| :--- | :--- |
| ◈ **100% Local-First & Offline** | All papers, vector embeddings, notes, and questions are stored strictly in the client's browser database (**Dexie.js** / **OPFS**). No cloud lock-in. |
| ⬡ **Fluid Mode (IBM Docling)** | Transforms rigid two-column PDFs into an accessible, responsive Markdown layout with native high-resolution figures and tables. |
| ⌬ **2D Equation Reconstruction** | PyMuPDF-powered spatial clustering reorders fragmented PDF text streams (e.g. Elsevier ScienceDirect) into clean LaTeX reaction equations. |
| ⌖ **Formula OCR (Gemini 2.5 Flash)** | Snip tool to crop any equation or diagram from the PDF with integrated Gemini OCR, live KaTeX preview, and 1-click note insertion. |
| ⧉ **Hybrid Search (RRF)** | Reciprocal Rank Fusion combining client-side semantic vector embeddings (`all-MiniLM-L6-v2` via ONNX/WebAssembly) and BM25 lexical full-text search (MiniSearch). |
| ⊞ **Study Notes & 1000% GPU-Zoom** | Split-screen Markdown editor with native KaTeX (`$$ ... $$`), fluid mouse-wheel image scaling, and a GPU-accelerated fullscreen lightbox with drag-to-pan. |
| ◈ **Bloom-Taxonomy Question Generation** | Automated generation of structured questions (MCQ, open-ended, practical application) based on Bloom's taxonomy with verified source citations and page references. |
| ⬢ **Dashboard Study Board** | Interactive kanban scratchpad with color-coded sticky notes, reading queue (priorities 1–3), deadlines with countdowns, and clipboard image pasting (`Ctrl+V`). |
| ▷ **1-Click APA 7th Citations** | Instant citation copying in APA 7th format directly via the DOI badge in the reader header. |
| ⎔ **Adaptive Shape Themes** | Real-time design engine: Modern Rounded, Minimal Sharp (0px corners), Tactical Chamfer (45° cuts), and Technical Blueprint (CAD grid). |

---

## ⬡ Quickstart

### Prerequisites & Installation

1. **Clone repository & install dependencies:**
   ```bash
   git clone https://github.com/SeTi100/StudyNet.git
   cd StudyNet
   npm install
   ```

2. **Backend Server & Python Environment (for Docling Fluid Mode):**
   ```bash
   cd backend
   npm install
   pip install -r requirements.txt
   # Additional packages for 2D equation reconstruction & layout parsing:
   pip install pymupdf docling
   cd ..
   ```

3. **Launch the application:**
   - **Frontend:** `npm run dev` (Port `5173`)
   - **Backend Sync Server:** `node backend/server.js` (Port `3000`)

---

### Setup Google Gemini API Key

1. Open StudyNet in your browser (`http://localhost:5173`).
2. Click the **Gear icon (Settings)** in the top right corner.
3. Enter your **Google Gemini API Key** ([free key available at Google AI Studio](https://aistudio.google.com/)).
4. Select your preferred model (e.g. `gemini-2.5-flash` or `gemini-2.5-pro`).
5. Click **Save** — keys and configurations are securely stored in your browser storage.

---

### Importing & Reading PDFs

- **Import:** Drag & drop one or multiple PDF documents directly onto the dashboard or click **"Import PDF"**.
- **Reading:** Click any paper card to open the high-performance PDF reader.
- **Toggle Fluid Mode:** Click the book icon **"Fluid Mode"** in the top reader toolbar. The document is rendered as a clean, responsive article with formatted LaTeX formulas and extracted figures.

---

### Study Board & Notes

- The right column of the dashboard hosts the **Study Board**:
  - **Sticky Notes:** Capture quick theories, summaries, and hypotheses with 7 color schemes.
  - **Reading Queue:** Link papers directly to priority ranks (*Next*, *High*, *Optional*) with reading progress indicators.
  - **Deadlines & Schedules:** Track paper review dates with automatic countdown badges (*Due today*, *In 3 days*).
  - **Visual Snippets:** Paste screenshots directly from your clipboard (`Ctrl+V`).

---

## ⌬ Core Features in Detail

### ⬡ Fluid Mode (Docling Liquid Reading)
Traditional scientific PDFs are rigidly formatted (two columns, tiny fonts, broken formulas). **Fluid Mode** utilizes the local backend (`docling_worker.py`) to:
1. **Layout Parsing:** Automatically detects headings, column flows, figure captions, and table structures.
2. **2D Equation Re-Ordering:** Words are clustered horizontally by $X$-coordinate and vertically within line tolerances ($|Y_1 - Y_2| < 4\,\text{px}$). Fragmented multi-step reaction sequences are assembled into clean LaTeX `aligned` blocks.
3. **Passage Stitching:** Reassembles sentences broken across column boundaries, figure captions (`Fig. 1`), or journal header artifacts (`Catalysis Today`).
4. **Typography Normalization:** Auto-resolves hyphens (`precur-\nsor` $\rightarrow$ `precursor`) and typographic ligature glitches (`fi`, `fl`, `ffi`, `ff`).
5. **OPFS Caching:** Stores all extracted high-resolution assets offline in the browser's Origin Private File System.

### ▷ PDF Reader & Citation Backlinks
- **Supersampling (4K Mobile):** Crystal-clear canvas rendering on retina displays with smooth pinch-to-zoom.
- **Citation Tooltips:** Clicking reference markers like `[42]` navigates directly to the bibliography entry with a 15-second floating countdown button to return to your reading position.
- **APA 7th 1-Click Copy:** Click the DOI badge in the header to copy the complete formatted bibliographic entry (Authors, Year, Title, Journal, DOI).

### ◈ AI Question Generation & Active Recall
- Generates Multiple-Choice, Open-Ended, and Real-World Application questions from paper chunks.
- Configurable chunk size (250 to 2000 tokens) for optimized LLM context usage.
- Filterable by Bloom's Taxonomy (*Remember, Understand, Apply, Analyze*).
- **Native JSON Schemas (`responseSchema`):** 100% schema-compliant responses without fragile regex parsing.
- **Verifiable Quotes:** Every generated question references an exact verbatim quote and page number from the paper.
- **Excel Export:** Full export of questions, answer options, explanations, and metrics into a formatted `.xlsx` workbook.

### ⧉ Hybrid Vector & Lexical Search (RRF)
- Cross-document search across your entire paper library.
- Combines dense semantic similarity (`all-MiniLM-L6-v2` in a dedicated Web Worker) with BM25 lexical matching (MiniSearch):
  $$\text{Score}_{\text{RRF}}(d) = \frac{1}{60 + \text{Rank}_{\text{dense}}(d)} + \frac{1}{60 + \text{Rank}_{\text{lexical}}(d)}$$
- Jumps directly to the exact page in the PDF and highlights the complete matching passage.

### ⊞ Study Notes & Formula OCR (Snip Tool)
- **Visual Snippets & Formula OCR:** Use the snip tool in the reader toolbar to select any formula or reaction scheme. Clicking *"Extract Formula (OCR)"* calls Gemini 2.5 Flash to generate accurate LaTeX code.
- **Live KaTeX Preview & In-Place Editing:** Preview formulas in real-time, tweak LaTeX syntax directly in the popover, and insert them as `$$ ... $$` math blocks into your paper notes.
- **Fluid In-Note Image Scaling:** Images scale dynamically with mouse-wheel scrolling with debounced background database saves.
- **Fullscreen Lightbox with GPU Drag-to-Pan:**
  - Opens in an isolated React Portal attached to `document.body`.
  - **Infinite Zoom (up to 1000%):** Hardware-accelerated scaling via non-passive wheel listeners.
  - **Drag-to-Pan:** Click and drag to smoothly pan across magnified details.
  - **Quick Toggles:** Double-click toggles between 100% and 250% zoom; toolbar buttons provide step zoom and reset badges.

---

## ⎔ Architecture & Developer Guide

### Architecture Overview

```text
┌───────────────────────────────────────────────────────────────────────────┐
│                              StudyNet (Frontend)                          │
│                                                                           │
│  ┌──────────────────────┐  ┌──────────────────────┐  ┌─────────────────┐  │
│  │   React + Tailwind   │  │   Dexie.js (IndexedDB)│ │   OPFS Storage  │  │
│  │  TanStack Virtual    │  │  - Documents/Papers  │  │  - Raw PDFs     │  │
│  │  LiquidPdfViewer     │  │  - Generated Cards   │  │  - Fluid MD     │  │
│  │  Dashboard & Board   │  │  - Notes & Highlights│  │  - Images/Assets│  │
│  └──────────┬───────────┘  └──────────┬───────────┘  └────────┬────────┘  │
│             │                         │                       │           │
│  ┌──────────▼─────────────────────────▼───────────────────────▼────────┐  │
│  │           Web Workers (vectorSearch.worker, pdfProcessor.worker)    │  │
│  │           - Local Embeddings (@xenova/transformers MiniLM)          │  │
│  │           - Lexical Search (MiniSearch RRF Ranking)                 │  │
│  └────────────────────────────────────┬────────────────────────────────┘  │
└───────────────────────────────────────┼───────────────────────────────────┘
                                        │ REST / SSE
┌───────────────────────────────────────▼───────────────────────────────────┐
│                              Backend Sync Server                          │
│                                                                           │
│  ┌─────────────────────────────────────────────────────────────────────┐  │
│  │ Express.js (Port 3000)                                              │  │
│  │ - PDF Upload & Sync                                                 │  │
│  │ - Docling Job Management (activeDoclingJobs)                        │  │
│  │ - SQLite (better-sqlite3) State Management                          │  │
│  └──────────────────────────────────┬──────────────────────────────────┘  │
│                                     │ Subprocess spawn                    │
│  ┌──────────────────────────────────▼──────────────────────────────────┐  │
│  │ Python Worker (docling_worker.py)                                   │  │
│  │ - IBM Docling Layout & Document Parser                              │  │
│  │ - PyMuPDF (fitz) 2D Spatial Word Clustering (Formula Re-Ordering)   │  │
│  │ - Typographic Ligature Normalizer & Multiline Sentence Stitcher     │  │
│  │ - High-Resolution Crop Extraction for Fallback Formulas & Images    │  │
│  └─────────────────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────────────────┘
```

---

### Docling Backend Pipeline & 2D Equation Reconstruction

Academic publishers (especially Elsevier/ScienceDirect) often store mathematical symbols (`+`, `→`, sub/superscripts) in non-sequential PDF text streams. Standard OCR and naive Markdown parsers frequently generate illegible jumbles.

StudyNet resolves this in [`backend/docling_worker.py`](backend/docling_worker.py) via:
1. **2D Bounding-Box Clustering:** PyMuPDF (`fitz`) groups words in each line based on vertical thresholds ($|Y_1 - Y_2| < 4\,\text{px}$) and sorts them strictly horizontally by $X$-coordinate.
2. **LaTeX Alignment Injection:** Grouped reaction formulas (e.g. pathways `(4a)` through `(4g)`) are aligned at reaction arrows (`\rightarrow`) and wrapped in standardized `\begin{aligned}` LaTeX blocks.
3. **Sentence & Caption Stitching:** `stitch_paragraphs()` identifies uncompleted sentences across column breaks and re-joins them across interrupting figures (`![Image]`), captions (`Fig.`, `Table`), and journal header artifacts (`Catalysis Today 350 (2020)`).

---

### Local Vector Search & Hybrid Search Worker

- **Model:** `Xenova/all-MiniLM-L6-v2` (quantized ONNX for WebAssembly/WebGPU).
- **Worker Thread:** [`src/workers/vectorSearch.worker.ts`](src/workers/vectorSearch.worker.ts) executes cosine-similarity computations in a background worker thread without blocking the UI.
- **RRF (Reciprocal Rank Fusion):**
  $$\text{Score}_{\text{RRF}}(d) = \frac{1}{60 + \text{Rank}_{\text{dense}}(d)} + \frac{1}{60 + \text{Rank}_{\text{lexical}}(d)}$$

---

### Gemini Structured Outputs (`responseSchema`) & Token Accounting

Question generation uses Gemini's native JSON Schema validation (`responseSchema`).
- **Zero Hallucination Parsing:** Guarantees 100% schema-compliant objects for every generated question (`question`, `options`, `correctAnswer`, `explanation`, `bloomsTaxonomy`, `quote`).
- **Precise Token Tracking:** Tracks `totalTokenCount`, `promptTokenCount`, and `candidatesTokenCount` including reasoning tokens and prompt-cache hits.
- **Dynamic Fallback:** Automatic model cascading to alternate configured models upon rate-limiting (`HTTP 429`) or server overload (`HTTP 503`).

---

### Storage & Synchronization (Dexie, OPFS & Sync Server)

- **Dexie.js (IndexedDB):** Stores relational paper metadata, generated questions, study board cards, and notes (`src/db/schema.ts`).
- **OPFS (Origin Private File System):** Fast, sandboxed binary storage inside the browser for raw PDFs, extracted figures, and Markdown documents.
- **Sync Server:** Optional synchronization endpoint for multi-device workflows over Tailscale or local networks.

---

### UI Theming & Customization

The Settings panel supports real-time design switching:
1. **Modern Rounded (Default):** Soft Bento-grid layout with smooth borders (`rounded-xl`).
2. **Minimal Sharp:** 90° crisp angular corners (`border-radius: 0px`) for a clean, technical aesthetic.
3. **Tactical Chamfer:** 45° beveled angle cuts using CSS `clip-path: polygon(...)` (cyberpunk HUD look).
4. **Technical Blueprint:** CAD engineering style with a subtle grid background, blue framing, and monospace metrics.

---

## ⎔ Technology Stack / Built With

| Layer | Technology | Purpose |
| :--- | :--- | :--- |
| **Frontend Framework** | React 18, TypeScript, Vite 6 | Reactive Single-Page Application & Progressive Web App (PWA) |
| **Styling & UI Components** | Tailwind CSS, Lucide React | Adaptive design themes (Bento, Minimal, Tactical, Blueprint) |
| **Client Database** | Dexie.js (IndexedDB) | Relational storage for papers, questions, notes, and study cards |
| **Local File System** | OPFS (*Origin Private File System*) | High-performance private browser storage for PDFs and cropped assets |
| **PDF Rendering** | Mozilla pdf.js, TanStack Virtual | Virtualized page streaming with 4K mobile supersampling |
| **Mathematics & Formulas** | KaTeX, remark-math, rehype-katex | Hardware-accelerated client-side mathematical formula typesetting |
| **Client-Side Embeddings** | Transformers.js (`all-MiniLM-L6-v2`) | On-device semantic vector representations in a Web Worker |
| **Lexical Search** | MiniSearch | Client-side BM25 text search with Reciprocal Rank Fusion |
| **Cloud AI Pipeline** | Google Gemini API (2.5 Flash / Pro) | Structured JSON question generation and multimodal formula OCR |
| **PDF Layout Extraction** | IBM Docling & PyMuPDF | 2D spatial word sorting and PDF-to-Markdown conversion |
| **Backend & Sync** | Express.js, better-sqlite3 | Optional local synchronization server for multi-device setups |

---

## ⌖ Configuration & Environment Variables

No `.env` file is required for frontend operations; all settings can be configured directly in the application UI.

The optional backend server supports the following environment variables:

| Variable | Description | Default |
| :--- | :--- | :--- |
| `PORT` | Port of the Backend Sync Server | `3000` |
| `VITE_SYNC_SERVER_URL` | Sync server URL used by the frontend | `http://localhost:3000` |
| `UPLOADS_DIR` | Storage directory for PDF uploads and Docling caches | `backend/uploads/` |

---

## ⧉ Troubleshooting & FAQ

<details>
<summary><b>1. Docling fails with an error or takes too long</b></summary>
<br>

Ensure both `pymupdf` and `docling` are installed in your active Python environment:
```bash
pip install --upgrade docling pymupdf
```
In `backend/docling_worker.py`, `pipeline_options.do_formula_enrichment = False` is set by default to keep processing times under 30 seconds on laptop CPUs.
</details>

<details>
<summary><b>2. Formulas in Fluid Mode appear as unformatted text</b></summary>
<br>

Click **"Regenerate Fluid Mode"** in the reader toolbar. This clears the local OPFS cache and re-parses the document with the latest 2D equation pipeline.
</details>

<details>
<summary><b>3. DOI citation copy does not work</b></summary>
<br>

Automatic citation generation requires a valid DOI in the document's metadata. If the paper lacks a DOI, the citation button falls back to document metadata editing.
</details>

<details>
<summary><b>4. Gemini API reports quota limits (HTTP 429)</b></summary>
<br>

StudyNet includes an automated model fallback cascade: In Settings, configure alternative models (e.g. `gemini-2.5-flash` as primary and `gemini-2.0-flash` as backup). The engine cascades automatically when rate-limited.
</details>

---

## ◈ Contributing

Contributions to StudyNet are welcome!

1. Fork the repository (`https://github.com/SeTi100/StudyNet/fork`)
2. Create your feature branch (`git checkout -b feature/NewFeature`)
3. Commit your changes (`git commit -m 'feat: Add NewFeature'`)
4. Push to the branch (`git push origin feature/NewFeature`)
5. Open a Pull Request

---

## ▷ License

This project is licensed under the **MIT License**. See the [LICENSE](LICENSE) file for details.

