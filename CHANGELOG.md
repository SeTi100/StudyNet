# Changelog

All notable changes to the StudyNet project are documented in this file.

## [Unreleased] - 2026-08-30

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
