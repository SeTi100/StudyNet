# 🎓 StudyNet — Intelligent Scientific Paper Reader & Research Workspace

> **Local-First, AI-Powered Research & Study Platform** designed for reading scientific papers, extracting structured knowledge, generating Bloom-taxonomy study questions, and reading comfortably on any device (Desktop, Tablet, Mobile PWA).

---

## 📑 Inhaltsverzeichnis / Table of Contents
1. [✨ Highlights & Überblick](#-highlights--überblick)
2. [🚀 Schnellstart für Einsteiger (Quickstart for New Users)](#-schnellstart-für-einsteiger-quickstart-for-new-users)
   - [Voraussetzungen & Installation](#voraussetzungen--installation)
   - [API-Key einrichten (Gemini)](#api-key-einrichten-gemini)
   - [PDFs importieren & lesen](#pdfs-importieren--lesen)
   - [Study Board & Notizen](#study-board--notizen)
3. [📖 Kernfunktionen im Detail](#-kernfunktionen-im-detail)
   - [Fluid Mode (Docling Liquid Reading)](#fluid-mode-docling-liquid-reading)
   - [PDF Reader & Citation Backlinks](#pdf-reader--citation-backlinks)
   - [KI-Fragengenerierung & Active Recall](#ki-fragengenerierung--active-recall)
   - [Hybrid Vector & Lexical Search (RRF)](#hybrid-vector--lexical-search-rrf)
   - [Dashboard Study Board & Pinnwand](#dashboard-study-board--pinnwand)
4. [🛠️ Handbuch für Fortgeschrittene & Entwickler (Advanced Guide)](#️-handbuch-für-fortgeschrittene--entwickler-advanced-guide)
   - [Architektur-Überblick](#architektur-überblick)
   - [Docling Backend Pipeline & Gleichungs-Rekonstruktion](#docling-backend-pipeline--gleichungs-rekonstruktion)
   - [Lokale Vektorsuche & Hybrid Search Worker](#lokale-vektorsuche--hybrid-search-worker)
   - [Gemini Structured Outputs (`responseSchema`) & Token-Accounting](#gemini-structured-outputs-responseschema--token-accounting)
   - [Storage & Synchronisation (Dexie, OPFS & Sync Server)](#storage--synchronisation-dexie-opfs--sync-server)
   - [UI-Theming & Customization](#ui-theming--customization)
5. [🔧 Konfiguration & Umgebungsvariablen](#-konfiguration--umgebungsvariablen)
6. [❓ Troubleshooting & FAQ](#-troubleshooting--faq)

---

## ✨ Highlights & Überblick

- **Local-First & Offline-Fähig:** Alle Dokumente, Vektoreinbettungen, Notizen und Fragen werden lokal im Browser (Dexie.js / OPFS) gespeichert.
- **Fluid Mode (Responsive Markdown Reader):** Wandelt komplexe wissenschaftliche 2-Spalten-PDFs via IBM Docling in barrierefreies, responsives Markdown um – inklusive hochaufgelöster Abbildungen, Tabellen und mathematischer/chemischer LaTeX-Formeln.
- **2D-Gleichungsrekonstruktion:** Automatisches Sortieren fragmentierter PDF-Textströme (z. B. Elsevier ScienceDirect) zu sauberen LaTeX-Reaktionsgleichungen.
- **Passage Stitching:** Automatisches Zusammenfügen von Sätzen, die durch Seitenumbrüche, Header (`Catalysis Today`) oder Abbildungen (`Fig. 1`) zerrissen wurden.
- **KI-gestützte Fragengenerierung:** Strukturierte JSON-Generierung mit Google Gemini (Flash / Pro) nach Bloom's Taxonomie mit präzisen Quellzitaten und Seitenreferenzen.
- **Hybride Suche (RRF):** Kombiniert lokale semantische Vektoreinbettungen (`@xenova/transformers` / MiniLM) mit lexikalischer Volltextsuche (MiniSearch).
- **Zitier-Engine:** 1-Klick-Kopieren im APA 7th Format direkt über das DOI-Badge, automatische Hover-Vorschau von Literaturzitaten im PDF mit 15-Sekunden-Rückkehr-Timer.
- **Formel-OCR & Snip-Werkzeug:** Erfassen von Bildausschnitten direkt im PDF mit automatischer Gemini-Formelerkennung, Live-KaTeX-Vorschau und nahtloser Übernahme als LaTeX-Block.
- **Study Notes mit interaktivem Zoom:** Integrierter Markdown-Notizeneditor mit nativer KaTeX-Mathematik (`$$ ... $$`), stufenlosem Mausrad-Zoom für Grafiken und GPU-beschleunigter Fullscreen-Lightbox mit Drag-to-Pan.
- **Dashboard Study Board:** Visuelle Pinnwand mit Farbkarten, Lese-Warteschlange (Prioritäten 1–3), Deadlines, To-Do-Checklisten und Clipboard-Bild-Uploads (`Ctrl+V`).
- **Excel & JSON Export:** Vollständiger Export von Metadaten, Fragenkatalogen und Lernstatistiken in formatierte XLSX-Tabellen.

---

## 🚀 Schnellstart für Einsteiger (Quickstart for New Users)

### Voraussetzungen & Installation

1. **Repository klonen & Node-Abhängigkeiten installieren:**
   ```bash
   git clone https://github.com/DeinUsername/studynet.git
   cd studynet
   npm install
   ```

2. **Backend-Server & Python-Umgebung (für Docling Fluid Mode):**
   ```bash
   cd backend
   npm install
   pip install -r requirements.txt
   # Zusätzlich PyMuPDF für 2D-Gleichungs-Parsing:
   pip install pymupdf docling
   cd ..
   ```

3. **Anwendung starten:**
   - **Frontend:** `npm run dev` (läuft standardmäßig auf `http://localhost:5173`)
   - **Backend Sync Server:** `node backend/server.js` (läuft standardmäßig auf Port `3000`)

---

### API-Key einrichten (Gemini)

1. Öffne StudyNet im Browser (`http://localhost:5173`).
2. Klicke oben rechts auf das **Zahnrad-Symbol (Settings)**.
3. Gib deinen **Google Gemini API Key** ein ([kostenlos erstellbar bei Google AI Studio](https://aistudio.google.com/)).
4. Wähle dein bevorzugtes Modell (z. B. `gemini-1.5-flash`, `gemini-2.0-flash` oder `gemini-1.5-pro`).
5. Klicke auf **Speichern**.

---

### PDFs importieren & lesen

- **Import:** Ziehe ein oder mehrere PDF-Dokumente einfach per Drag & Drop auf das Dashboard oder nutze den Button **"PDF importieren"**.
- **Lesen:** Klicke auf die Paper-Karte. Du gelangst direkt in den High-Performance PDF-Reader.
- **Fluid Mode umschalten:** Klicke in der oberen Menüleiste auf das Buch-Symbol **"Fluid Mode"**. Das Dokument wird responsiv als leicht lesbarer Artikel mit formatierten Formeln und Abbildungen angezeigt.

---

### Study Board & Notizen

- Auf der rechten Seite des Dashboards findest du das **Study Board**:
  - **Notizzettel:** Erstelle farbige Notizen zu Theorien, Ideen und Zusammenfassungen.
  - **Leseliste:** Verknüpfe Paper direkt mit Prioritätsstufen (*Next*, *High*, *Optional*).
  - **Aufgaben & Termine:** Setze Deadlines mit automatischer Countdown-Anzeige (*Due tomorrow*, *In 3 days*).
  - **Bilder:** Füge Screenshots direkt mit `Ctrl+V` ein.

---

## 📖 Kernfunktionen im Detail

### Fluid Mode (Docling Liquid Reading)
Wissenschaftliche PDFs sind traditionell starr formatiert (zweispaltig, kleine Schriftarten, zersplitterte Formeln). Der **Fluid Mode** nutzt das lokale Backend (`docling_worker.py`), um:
1. Das Layout zu analysieren und Bilder in Originalauflösung zu extrahieren.
2. Formeln als isolierte LaTeX-Blöcke (`$$\begin{aligned}...$$`) oder hochauflösende PNGs darzustellen.
3. Wort- und Silbentrennungen (`precur-\nsor` $\rightarrow$ `precursor`) sowie typografische Ligaturen (`fi`, `fl`, `ffi`, `ff`) vollautomatisch zu reparieren.
4. Alle Daten offline in der Browser-eigenen OPFS (*Origin Private File System*) abzulegen.

### PDF Reader & Citation Backlinks
- **Supersampling (4K Mobile):** Gestochen scharfes Rendern auf hochauflösenden Displays und Touchscreens mit stufenlosem Pinch-to-Zoom.
- **Citation Tooltips:** Ein Klick auf Referenzen wie `[42]` im PDF springt direkt zur Bibliografie am Ende des Dokuments. Ein schwebender Button ermöglicht die sofortige Rückkehr zur Leseposition.
- **APA 7th 1-Click Copy:** Ein Klick auf die DOI in der Kopfzeile kopiert sofort das vollständige Zitat (Autoren, Erscheinungsjahr, Titel, Journal, DOI-URL).

### KI-Fragengenerierung & Active Recall
- Generiert Multiple-Choice-, Freitext- und Anwendungsfragen basierend auf den Chunks des Papers.
- Einstellbare Ziel-Chunk-Größe (250 bis 2000 Tokens) zur optimalen Ausnutzung des Kontextfensters.
- Filterbar nach Bloom's Taxonomie (Erinnern, Verstehen, Anwenden, Analysieren).

### Hybrid Vector & Lexical Search (RRF)
- Sucht quer über alle importierten Dokumente.
- Kombiniert semantische Ähnlichkeit (Vektoreinbettungen) mit exakter Stichwortsuche (BM25 / MiniSearch).
- Springt beim Klick auf ein Suchergebnis direkt an die exakte Textstelle im PDF und hebt die gesamte Quellpassage farblich hervor.

### Study Notes & Formel-OCR (Snip Tool)
- **Visuelle Snippets & Formel-OCR:** Mit dem Snip-Werkzeug können beliebige Formeln, Diagramme oder Reaktionsschemata aus dem PDF ausgeschnitten werden. Über den Button *"✨ Formel extrahieren (OCR)"* analysiert Gemini das Bild und generiert sauberen LaTeX-Code.
- **Live-KaTeX-Vorschau & Direkteinfügung:** Formeln können direkt im Popover editiert, per KaTeX in Echtzeit geprüft und mit einem Klick als `$$ ... $$`-Block in die Study Notes eingefügt werden.
- **Flüssiger Bild-Zoom & Drag-to-Pan Lightbox:**
  - In den Notizen eingebettete Bilder lassen sich per Mausrad stufenlos und flüssig in ihrer Größe anpassen.
  - Klick auf ein Bild öffnet eine GPU-beschleunigte Fullscreen-Lightbox mit stufenlosem Zoom (bis zu 1000 %), Drag-to-Pan (Verschieben mit der Maus) und Doppelklick-Skalierung.

---

## 🛠️ Handbuch für Fortgeschrittene & Entwickler (Advanced Guide)

### Architektur-Überblick

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

### Docling Backend Pipeline & Gleichungs-Rekonstruktion

Wissenschaftliche Verlage (insb. Elsevier/ScienceDirect) speichern mathematische Symbole (`+`, `→`, Indizes) in nicht-sequentiellen PDF-Textströmen. Standard-OCR und sequentielle Markdown-Parser erzeugen daraus oft unleserliches Kauderwelsch.

StudyNet löst dies in [`backend/docling_worker.py`](backend/docling_worker.py) durch:
1. **2D-Bounding-Box-Clustering:** PyMuPDF (`fitz`) gruppiert Wörter einer Textzeile nach vertikalen Schwellenwerten ($|Y_1 - Y_2| < 4\,\text{px}$) und sortiert sie strikt horizontal nach ihrer $X$-Koordinate.
2. **LaTeX Alignment Injection:** Gruppierte Formeln (z. B. Reaktionspfade `(4a)` bis `(4g)`) werden automatisch an den Reaktionspfeilen (`\rightarrow`) ausgerichtet und als standardkonformer `\begin{aligned}`-LaTeX-Block in das Markdown eingesetzt.
3. **Satz- & Bildunterschriften-Stitching:** `stitch_paragraphs()` erkennt offene Sätze am Zeilenende und verknüpft sie über zwischenliegende Abbildungen (`![Image]`), Bildunterschriften (`Fig.`, `Table`) und Zeitschriften-Kopfzeilen (`Catalysis Today 350 (2020)`) hinweg.

---

### Lokale Vektorsuche & Hybrid Search Worker

- **Modell:** `Xenova/all-MiniLM-L6-v2` (Quantisiert auf ONNX für WebAssembly/WebGPU).
- **Worker:** [`src/workers/vectorSearch.worker.ts`](src/workers/vectorSearch.worker.ts) führt Kosinus-Ähnlichkeitsberechnungen in einem separaten Thread aus, ohne den Haupt-UI-Thread zu blockieren.
- **RRF (Reciprocal Rank Fusion):**
  $$\text{Score}_{\text{RRF}}(d) = \frac{1}{60 + \text{Rank}_{\text{dense}}(d)} + \frac{1}{60 + \text{Rank}_{\text{lexical}}(d)}$$

---

### Gemini Structured Outputs (`responseSchema`) & Token-Accounting

Die Fragengenerierung nutzt das native JSON-Schema von Gemini (`responseSchema`).
- **Keine Halluzinationen:** 100 % schema-konforme Objekte für jede Frage (`question`, `options`, `correctAnswer`, `explanation`, `bloomsTaxonomy`, `quote`).
- **Präzises Token-Tracking:** Erfassung von `totalTokenCount`, `promptTokenCount` und `candidatesTokenCount` inklusive Reasoning-Tokens und System-Prompt-Caching.
- **Dynamisches Fallback:** Automatische Kaskadierung auf konfigurierte Alternativmodelle bei Ratenbegrenzung (`HTTP 429`) oder API-Überlastung (`HTTP 503`).

---

### Storage & Synchronisation (Dexie, OPFS & Sync Server)

- **Dexie.js (IndexedDB):** Speichert relationale Metadaten, Fragengenerierungen, Dashboard-Pinnwandkarten und Notizen (`src/db/schema.ts`).
- **OPFS (Origin Private File System):** Schneller, privater Dateispeicher im Browser für Binärdaten (PDFs, extrahierte Bilder, Markdown-Dateien).
- **Sync Server:** Optionaler Synchronisations-Endpunkt für Multi-Device-Betrieb über Tailscale oder lokales Netzwerk.

---

### UI-Theming & Customization

In den Einstellungen (**Settings**) kann das visuelle Design in Echtzeit umgeschaltet werden:
1. **Modern Rounded (Standard):** Weiche Bento-Grid-Karten (`rounded-xl`).
2. **Minimal Sharp:** 90°-Kanten (`border-radius: 0px`) für ein reduziertes, technisches Aussehen.
3. **Tactical Chamfer:** 45°-Winkelschnitte via CSS `clip-path: polygon(...)` (Futuristischer Cyber/HUD-Look).
4. **Technical Blueprint:** CAD-/Engineering-Gitter mit subtilen blauen Rahmenlinien und Monospace-Schriftarten.

---

## 🔧 Konfiguration & Umgebungsvariablen

Die Anwendung benötigt keine zwingende `.env`-Datei für den Frontend-Start, kann jedoch konfiguriert werden:

| Variable | Beschreibung | Standardwert |
|---|---|---|
| `PORT` | Port des Backend Sync Servers | `3000` |
| `VITE_SYNC_SERVER_URL` | Standard-URL des Sync Servers | `http://localhost:3000` |
| `UPLOADS_DIR` | Speicherort für PDF-Uploads und Docling-Caches | `backend/uploads/` |

---

## ❓ Troubleshooting & FAQ

#### 1. Docling bricht mit Fehlermeldung ab oder dauert sehr lange
- **Lösung:** Stelle sicher, dass `pymupdf` und `docling` in deiner Python-Umgebung installiert sind:
  ```bash
  pip install --upgrade docling pymupdf
  ```
- In [`backend/docling_worker.py`](backend/docling_worker.py) ist `pipeline_options.do_formula_enrichment = False` gesetzt, um auf reinen CPUs Verarbeitungszeiten von unter 30 Sekunden pro Paper zu garantieren.

#### 2. Formeln werden im Fluid Mode als unformatierter Text angezeigt
- **Lösung:** Klicke im Reader auf **"Fluid Mode neu generieren"**. Dadurch wird der lokale OPFS-Cache gelöscht und das Dokument mit dem neuesten Gleichungs-Parser frisch vom Server geladen.

#### 3. Zitate / DOI-Kopieren funktioniert nicht
- **Lösung:** Für die automatische Zitationserstellung muss das Dokument eine gültige DOI in den Metadaten enthalten. Falls keine DOI gefunden wird, steht in der Kopfzeile ein manueller Zitations-Fallback zur Verfügung.

---

## 📄 Lizenz
StudyNet steht unter der MIT-Lizenz.
