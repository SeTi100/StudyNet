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
  [ <a href="README.md">English</a> | <b>Deutsch</b> ]
</p>

<p align="center">
  Eine moderne, datenschutzfreundliche Forschungs- und Lernplattform für wissenschaftliche Publikationen.<br />
  Liest komplexe 2-Spalten-PDFs, rekonstruiert mathematische/chemische Formeln, generiert didaktische Lernfragen via Google Gemini und speichert alle Dokumente, Vektoren und Notizen 100% lokal im Browser.
</p>

[◈ Highlights](#-highlights) • [⬡ Schnellstart](#-schnellstart--quickstart) • [⌬ Kernfunktionen](#-kernfunktionen-im-detail) • [⎔ Architektur](#-architektur--technologie-stack) • [⌖ Konfiguration](#-konfiguration--umgebungsvariablen) • [⧉ FAQ](#-troubleshooting--faq)

</div>

---

## ◈ Highlights

| Feature | Beschreibung |
| :--- | :--- |
| ◈ **100% Local-First & Offline** | Sämtliche Dokumente, Vektoreinbettungen, Notizen und Fragen verbleiben in der lokalen Browserdatenbank (**Dexie.js** / **OPFS**). Keine Cloud-Pflicht. |
| ⬡ **Fluid Mode (IBM Docling)** | Konvertiert starre zweispaltige PDFs in ein barrierefreies, flüssiges Markdown-Layout mit originalgetreuen Grafiken und Tabellen. |
| ⌬ **2D-Gleichungsrekonstruktion** | PyMuPDF-basiertes 2D-Clustering sortiert fragmentierte PDF-Textströme (z. B. Elsevier ScienceDirect) zu sauberen LaTeX-Reaktionsgleichungen. |
| ⌖ **Formel-OCR (Gemini 2.5 Flash)** | Snip-Werkzeug zum Ausschneiden beliebiger PDF-Passagen mit integrierter KI-Formelextraktion, Live-KaTeX-Vorschau und 1-Klick-Übernahme in Notizen. |
| ⧉ **Hybride Suche (RRF)** | Kombination aus lokaler semantischer Vektorsuche (`all-MiniLM-L6-v2` via ONNX/WebAssembly) und BM25-Volltextsuche (MiniSearch). |
| ⊞ **Study Notes & 1000% GPU-Zoom** | Split-Screen Markdown-Notizen mit KaTeX-Support (`$$ ... $$`), stufenlosem Mausrad-Zoom und interaktiver Fullscreen-Lightbox mit Drag-to-Pan. |
| ◈ **Bloom-Lernfragengenerierung** | Automatische Erstellung strukturierter Fragen (MC, Freitext, Anwendung) nach Bloom's Taxonomie mit echten Quellzitaten und Seitenangaben. |
| ⬢ **Dashboard Study Board** | Digitale Pinnwand mit Haftnotizen, Leseliste (Prioritäten 1–3), Deadlines mit Countdown und Screenshot-Upload via `Ctrl+V`. |
| ▷ **1-Click APA 7th Citation** | Klick auf das DOI-Badge im Reader kopiert sofort das normgerechte APA-Zitat in die Zwischenablage. |
| ⎔ **Adaptive Shape Themes** | Umschaltbare UI-Themen: Modern Rounded, Minimal Sharp (0px), Tactical Chamfer (45° Cut) und Technical Blueprint (CAD Grid). |

---

## ⬡ Schnellstart / Quickstart

### Voraussetzungen & Installation

1. **Repository klonen & Node-Abhängigkeiten installieren:**
   ```bash
   git clone https://github.com/SeTi100/StudyNet.git
   cd StudyNet
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
   - **Frontend:** `npm run dev` (Port `5173`)
   - **Backend Sync Server:** `node backend/server.js` (Port `3000`)

---

### API-Key einrichten (Google Gemini)

1. Öffne StudyNet im Browser (`http://localhost:5173`).
2. Klicke oben rechts auf das **Zahnrad-Symbol (Settings)**.
3. Gib deinen **Google Gemini API Key** ein ([kostenlos erstellbar bei Google AI Studio](https://aistudio.google.com/)).
4. Wähle dein bevorzugtes Modell (z. B. `gemini-2.5-flash` oder `gemini-2.5-pro`).
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

## ⌬ Kernfunktionen im Detail

### ⬡ Fluid Mode (Docling Liquid Reading)
Wissenschaftliche PDFs sind traditionell starr formatiert (zweispaltig, kleine Schriftarten, zersplitterte Formeln). Der **Fluid Mode** nutzt das lokale Backend (`docling_worker.py`), um:
1. Das Layout zu analysieren und Bilder in Originalauflösung zu extrahieren.
2. Formeln als isolierte LaTeX-Blöcke (`$$\begin{aligned}...$$`) oder hochauflösende PNGs darzustellen.
3. Wort- und Silbentrennungen (`precur-\nsor` $\rightarrow$ `precursor`) sowie typografische Ligaturen (`fi`, `fl`, `ffi`, `ff`) vollautomatisch zu reparieren.
4. Alle Daten offline in der Browser-eigenen OPFS (*Origin Private File System*) abzulegen.

### ▷ PDF Reader & Citation Backlinks
- **Supersampling (4K Mobile):** Gestochen scharfes Rendern auf hochauflösenden Displays und Touchscreens mit stufenlosem Pinch-to-Zoom.
- **Citation Tooltips:** Ein Klick auf Referenzen wie `[42]` im PDF springt direkt zur Bibliografie am Ende des Dokuments. Ein schwebender Button ermöglicht die sofortige Rückkehr zur Leseposition.
- **APA 7th 1-Click Copy:** Ein Klick auf die DOI in der Kopfzeile kopiert sofort das vollständige Zitat (Autoren, Erscheinungsjahr, Titel, Journal, DOI-URL).

### ◈ KI-Fragengenerierung & Active Recall
- Generiert Multiple-Choice-, Freitext- und Anwendungsfragen basierend auf den Chunks des Papers.
- Einstellbare Ziel-Chunk-Größe (250 bis 2000 Tokens) zur optimalen Ausnutzung des Kontextfensters.
- Filterbar nach Bloom's Taxonomie (Erinnern, Verstehen, Anwenden, Analysieren).

### ⧉ Hybride Vektorsuche & Passage-Highlighting
- Sucht quer über alle importierten Dokumente.
- Kombiniert semantische Ähnlichkeit (Vektoreinbettungen) mit exakter Stichwortsuche (BM25 / MiniSearch).
- Springt beim Klick auf ein Suchergebnis direkt an die exakte Textstelle im PDF und hebt die gesamte Quellpassage farblich hervor.

### ⊞ Study Notes & Formel-OCR (Snip Tool)
- **Visuelle Snippets & Formel-OCR:** Mit dem Snip-Werkzeug können beliebige Formeln, Diagramme oder Reaktionsschemata aus dem PDF ausgeschnitten werden. Über den Button *"Formel extrahieren (OCR)"* analysiert Gemini das Bild und generiert sauberen LaTeX-Code.
- **Live-KaTeX-Vorschau & Direkteinfügung:** Formeln können direkt im Popover editiert, per KaTeX in Echtzeit geprüft und mit einem Klick als `$$ ... $$`-Block in die Study Notes eingefügt werden.
- **Flüssiger Bild-Zoom & Drag-to-Pan Lightbox:**
  - In den Notizen eingebettete Bilder lassen sich per Mausrad stufenlos und flüssig in ihrer Größe anpassen.
  - Klick auf ein Bild öffnet eine GPU-beschleunigte Fullscreen-Lightbox mit stufenlosem Zoom (bis zu 1000 %), Drag-to-Pan (Verschieben mit der Maus) und Doppelklick-Skalierung.

---

## ⎔ Handbuch für Fortgeschrittene & Entwickler (Advanced Guide)

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

## ⎔ Technologie-Stack / Built With

| Schicht | Technologie | Verwendungszweck |
| :--- | :--- | :--- |
| **Frontend Framework** | React 18, TypeScript, Vite 6 | Reaktive Single-Page-Applikation & PWA |
| **Styling & Icons** | Tailwind CSS, Lucide React | Adaptives Designsystem (Bento, Minimal, Tactical, Blueprint) |
| **Lokale Datenbank** | Dexie.js (IndexedDB) | Speicherung aller Dokumente, Fragen, Notizen und Pinnwand-Karten |
| **Lokales Dateisystem** | OPFS (*Origin Private File System*) | Hochperformante Browser-Ablage für PDFs und Bild-Snippets |
| **PDF Rendering** | Mozilla pdf.js, TanStack Virtual | Schnelles, virtualisiertes Scrollen mit gestochen scharfem 4K-Zoom |
| **Mathematik & Formeln** | KaTeX, remark-math, rehype-katex | Blitzschnelles clientseitiges Rendering von mathematischen Formeln |
| **Lokale KI & Vektoren** | Transformers.js (`all-MiniLM-L6-v2`) | Lokale Vektor-Embeddings im separaten Web Worker |
| **Lexikalische Suche** | MiniSearch | Schnelle Volltext-Stichwortsuche mit Reciprocal Rank Fusion |
| **Cloud KI-Pipeline** | Google Gemini API (2.5 Flash / Pro) | Strukturierte Fragengenerierung & visuelle Formel-OCR |
| **PDF-Konvertierung** | IBM Docling & PyMuPDF | 2D-gestützte PDF-zu-Markdown-Transformation im Backend |
| **Backend & Sync** | Express.js, better-sqlite3 | Optionaler lokaler Sync-Server für Multi-Device-Nutzung |

---

## ⌖ Konfiguration & Umgebungsvariablen

Für den regulären Frontend-Betrieb ist **keine `.env`-Datei zwingend nötig**, da alle Einstellungen direkt in der App-UI gepflegt werden.

Für das optionale Backend stehen folgende Umgebungsvariablen zur Verfügung:

| Variable | Beschreibung | Standardwert |
| :--- | :--- | :--- |
| `PORT` | Port des Backend Sync Servers | `3000` |
| `VITE_SYNC_SERVER_URL` | Standard-URL des Sync Servers | `http://localhost:3000` |
| `UPLOADS_DIR` | Speicherort für PDF-Uploads und Docling-Caches | `backend/uploads/` |

---

## ⧉ Troubleshooting & FAQ

<details>
<summary><b>1. Docling bricht mit Fehlermeldung ab oder dauert sehr lange</b></summary>
<br>

Stelle sicher, dass `pymupdf` und `docling` in deiner Python-Umgebung installiert sind:
```bash
pip install --upgrade docling pymupdf
```
In `backend/docling_worker.py` ist `pipeline_options.do_formula_enrichment = False` gesetzt, um auf reinen CPUs Verarbeitungszeiten von unter 30 Sekunden pro Paper zu garantieren.
</details>

<details>
<summary><b>2. Formeln werden im Fluid Mode als unformatierter Text angezeigt</b></summary>
<br>

Klicke im Reader auf **"Fluid Mode neu generieren"**. Dadurch wird der lokale OPFS-Cache gelöscht und das Dokument mit dem neuesten 2D-Gleichungs-Parser frisch vom Server geladen.
</details>

<details>
<summary><b>3. Zitate / DOI-Kopieren funktioniert nicht</b></summary>
<br>

Für die automatische Zitationserstellung muss das Dokument eine gültige DOI in den Metadaten enthalten. Falls keine DOI gefunden wird, steht in der Kopfzeile ein manueller Zitations-Fallback zur Verfügung.
</details>

<details>
<summary><b>4. Gemini API meldet Quota-Limits (HTTP 429)</b></summary>
<br>

StudyNet verfügt über ein integriertes Fallback-System: In den Einstellungen kannst du alternative Modelle konfigurieren (z. B. `gemini-2.5-flash` als primäres Modell und `gemini-2.0-flash` als Ausweichmodell). Die Anwendung kaskadiert bei Ratenbegrenzungen automatisch.
</details>

---

## ◈ Mitwirken / Contributing

Beiträge zur Weiterentwicklung von StudyNet sind herzlich willkommen!

1. Forke das Projekt (`https://github.com/SeTi100/StudyNet/fork`)
2. Erstelle einen Feature-Branch (`git checkout -b feature/NeuesFeature`)
3. Committe deine Änderungen (`git commit -m 'feat: Neues Feature hinzufügen'`)
4. Pushe auf den Branch (`git push origin feature/NeuesFeature`)
5. Öffne einen Pull Request

---

## ▷ Lizenz

Dieses Projekt steht unter der **MIT-Lizenz**. Siehe die [LICENSE](LICENSE)-Datei für weitere Details.

