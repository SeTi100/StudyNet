import * as XLSX from 'xlsx';
import { db, DocumentRecord, NoteRecord, AnnotationRecord, CitationRecord, GeneratedQuestionRecord, DashboardCardRecord } from '../db/schema';
import { calculateReadingProgress } from '../store/useDocumentStore';
import { useDocumentStore } from '../store/useDocumentStore';

const DB_NAME = 'studynet_file_handles';
const STORE_NAME = 'handles';
const EXCEL_HANDLE_KEY = 'linked_excel_file';

/**
 * Öffnet eine IndexedDB-Instanz für FileSystemHandles
 */
function openHandleDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Liest das gespeicherte Excel-FileHandle aus IndexedDB
 */
export async function getLinkedExcelFileInfo(): Promise<{ handle: FileSystemFileHandle | null; name: string | null; lastExportAt: string | null }> {
  try {
    const db = await openHandleDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(EXCEL_HANDLE_KEY);
      req.onsuccess = () => {
        const val = req.result;
        if (val && val.handle) {
          resolve({
            handle: val.handle,
            name: val.name || val.handle.name || 'StudyNet_Research.xlsx',
            lastExportAt: val.lastExportAt || null,
          });
        } else {
          resolve({ handle: null, name: null, lastExportAt: null });
        }
      };
      req.onerror = () => resolve({ handle: null, name: null, lastExportAt: null });
    });
  } catch {
    return { handle: null, name: null, lastExportAt: null };
  }
}

/**
 * Speichert ein FileSystemFileHandle in IndexedDB
 */
export async function storeLinkedExcelFileHandle(handle: FileSystemFileHandle): Promise<void> {
  const db = await openHandleDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.put({
      key: EXCEL_HANDLE_KEY,
      handle,
      name: handle.name,
      lastExportAt: new Date().toISOString(),
    });
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/**
 * Entfernt die Dateiverknüpfung
 */
export async function clearLinkedExcelFileHandle(): Promise<void> {
  const db = await openHandleDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.delete(EXCEL_HANDLE_KEY);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export interface ExcelExportStats {
  papersCount: number;
  notesCount: number;
  annosCount: number;
  citationsCount: number;
  questionsCount: number;
  cardsCount: number;
}

/**
 * Erzeugt die Multi-Sheet-Excel-Arbeitsmappe mit allen Daten
 */
export async function generateExcelWorkbookBlob(): Promise<{ blob: Blob; stats: ExcelExportStats }> {
  const [documents, notes, annotations, citations, paperQuestions, dashboardCards] = await Promise.all([
    db.documents.toArray(),
    db.notes.toArray(),
    db.annotations.toArray(),
    db.citations.toArray(),
    db.paperQuestions.toArray(),
    db.dashboardCards ? db.dashboardCards.toArray() : Promise.resolve([]),
  ]);

  const docMap = new Map<string, DocumentRecord>(documents.map((d) => [d.id, d]));

  // ── Sheet 1: Papers & Lesestatus ──────────────────────────────────────────
  const papersRows = documents.map((doc) => {
    const progress = calculateReadingProgress(doc);
    return {
      'Titel': doc.title || 'Unbenannt',
      'Autoren': doc.authors?.join(', ') || 'Unbekannt',
      'Jahr': doc.publicationYear || '',
      'DOI': doc.doi || '',
      'Status': progress.isCompleted ? 'Gelesen (100%)' : 'In Bearbeitung',
      'Fortschritt (%)': `${progress.percent}%`,
      'Gelesene Seiten': progress.readPagesCount,
      'Gesamtseiten': doc.totalPages || 1,
      'Lesezeit (Min.)': Math.round((doc.readingTimeSeconds || 0) / 60),
      'Zuletzt gelesen': doc.lastReadAt ? new Date(doc.lastReadAt).toLocaleString() : 'Noch nicht geöffnet',
      'Tags': doc.tags?.join(', ') || '',
      'Dateipfad': doc.folderRelativePath || doc.pdfOpfsPath || '',
      'Hinzugefügt am': doc.addedAt ? new Date(doc.addedAt).toLocaleDateString() : '',
    };
  });

  // ── Sheet 2: Study Notes ──────────────────────────────────────────────────
  const notesRows = notes.map((note) => {
    const doc = docMap.get(note.documentId);
    return {
      'Paper': doc?.title || note.title || 'Allgemeine Notiz',
      'Autoren': doc?.authors?.join(', ') || '',
      'Notiz-Titel': note.title || 'Notizen',
      'Inhalt (Markdown)': note.content || '',
      'Erstellt am': note.createdAt ? new Date(note.createdAt).toLocaleString() : '',
      'Zuletzt bearbeitet': note.updatedAt ? new Date(note.updatedAt).toLocaleString() : '',
    };
  });

  // ── Sheet 3: Markierungen & Highlights ────────────────────────────────────
  const annosRows = annotations.map((anno) => {
    const doc = docMap.get(anno.documentId);
    return {
      'Paper': doc?.title || 'Unbekanntes Paper',
      'Seite': anno.pageNumber,
      'Typ': anno.type === 'highlight' ? 'Highlight' : anno.type === 'comment' ? 'Kommentar' : 'Bookmark',
      'Markierter Text': anno.selectedText || '',
      'Eigener Kommentar': anno.comment || '',
      'Farbe': anno.color || '',
      'Erstellt am': anno.createdAt ? new Date(anno.createdAt).toLocaleString() : '',
    };
  });

  // ── Sheet 4: Zitationen & Literaturverzeichnis ───────────────────────────
  const citationsRows = citations.map((cit) => {
    const doc = docMap.get(cit.documentId);
    return {
      'Paper': doc?.title || 'Unbekanntes Paper',
      'Kürzel (Marker)': cit.marker || '',
      'Referenz-Titel': cit.title || '',
      'Autoren der Referenz': cit.authors?.join(', ') || '',
      'Abstract / Kontext': cit.abstract || '',
    };
  });

  // ── Sheet 5: KI-Analysen (Q&A) ────────────────────────────────────────────
  const questionsRows = paperQuestions.map((q) => {
    const doc = docMap.get(q.documentId);
    const categoryLabels: Record<string, string> = {
      method: 'Methodik',
      result: 'Ergebnisse',
      material: 'Materialien & Daten',
      conclusion: 'Fazit & Diskussion',
      limitation: 'Einschränkungen',
      general: 'Allgemein',
    };
    return {
      'Paper': doc?.title || 'Unbekanntes Paper',
      'Kategorie': categoryLabels[q.category] || q.category || 'Allgemein',
      'Frage': q.question || '',
      'Kernantwort': q.shortAnswer || '',
      'Quell-Textabschnitt': q.chunkText || '',
      'Seite': q.pageNumber || '',
      'Erstellt am': q.createdAt ? new Date(q.createdAt).toLocaleString() : '',
    };
  });

  // ── Sheet 6: Pinnwand & Aufgaben ──────────────────────────────────────────
  const cardsRows = dashboardCards.map((card) => {
    let checklistContent = '';
    if (card.checklistItems && card.checklistItems.length > 0) {
      checklistContent = card.checklistItems.map((item) => `[${item.isDone ? 'x' : ' '}] ${item.text}`).join('\n');
    }
    let readingContent = '';
    if (card.readingItems && card.readingItems.length > 0) {
      readingContent = card.readingItems.map((item) => `[${item.isDone ? 'x' : ' '}] ${item.title || item.documentId}`).join('\n');
    }

    return {
      'Typ': card.type,
      'Titel': card.title || 'Ohne Titel',
      'Inhalt / Notiz': card.content || checklistContent || readingContent || '',
      'Angepinnt': card.isPinned ? 'Ja' : 'Nein',
      'Fälligkeitsdatum': card.dueDate || '',
      'Erstellt am': card.createdAt ? new Date(card.createdAt).toLocaleString() : '',
    };
  });

  // Erstelle Workbook
  const wb = XLSX.utils.book_new();

  function appendSheetWithWidths(data: any[], sheetName: string) {
    const ws = XLSX.utils.json_to_sheet(data.length > 0 ? data : [{ 'Status': 'Keine Daten vorhanden' }]);
    if (data.length > 0) {
      const keys = Object.keys(data[0]);
      ws['!cols'] = keys.map((k) => ({
        wch: Math.max(12, Math.min(60, Math.max(...data.map((row) => String(row[k] || '').length), k.length) + 2)),
      }));
    }
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  }

  appendSheetWithWidths(papersRows, 'Papers & Lesestatus');
  appendSheetWithWidths(notesRows, 'Study Notes');
  appendSheetWithWidths(annosRows, 'Markierungen & Highlights');
  appendSheetWithWidths(citationsRows, 'Literatur & Zitate');
  appendSheetWithWidths(questionsRows, 'KI-Analysen (Q&A)');
  appendSheetWithWidths(cardsRows, 'Pinnwand & Aufgaben');

  const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([excelBuffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });

  const stats: ExcelExportStats = {
    papersCount: documents.length,
    notesCount: notes.length,
    annosCount: annotations.length,
    citationsCount: citations.length,
    questionsCount: paperQuestions.length,
    cardsCount: dashboardCards.length,
  };

  return { blob, stats };
}

/**
 * Schreibt direkt in ein bestehendes oder verknüpftes FileSystemFileHandle
 */
export async function writeBlobToFileHandle(handle: FileSystemFileHandle, blob: Blob): Promise<void> {
  // Berechtigung prüfen / anfordern falls nötig
  if ((handle as any).queryPermission) {
    const perm = await (handle as any).queryPermission({ mode: 'readwrite' });
    if (perm !== 'granted') {
      const req = await (handle as any).requestPermission({ mode: 'readwrite' });
      if (req !== 'granted') {
        throw new Error('Schreibberechtigung für die Datei wurde verweigert.');
      }
    }
  }

  const writable = await (handle as any).createWritable();
  await writable.write(blob);
  await writable.close();
}

/**
 * 1. Schreibt in die verknüpfte Excel-Datei auf dem PC
 */
export async function exportToLinkedExcelFile(): Promise<{ fileName: string; stats: ExcelExportStats }> {
  const { handle } = await getLinkedExcelFileInfo();
  if (!handle) {
    throw new Error('NO_LINKED_FILE');
  }

  const { blob, stats } = await generateExcelWorkbookBlob();
  await writeBlobToFileHandle(handle, blob);
  await storeLinkedExcelFileHandle(handle);

  return { fileName: handle.name, stats };
}

/**
 * 2. Wählt über den nativen Windows-Dateidialog einen Speicherort und verknüpft die Datei dauerhaft
 */
export async function pickAndLinkExcelFile(): Promise<{ fileName: string; stats: ExcelExportStats }> {
  if (typeof (window as any).showSaveFilePicker !== 'function') {
    throw new Error('FILE_PICKER_NOT_SUPPORTED');
  }

  const handle = await (window as any).showSaveFilePicker({
    suggestedName: 'StudyNet_Research.xlsx',
    types: [
      {
        description: 'Excel-Arbeitsmappe (.xlsx)',
        accept: {
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
        },
      },
    ],
  });

  const { blob, stats } = await generateExcelWorkbookBlob();
  await writeBlobToFileHandle(handle, blob);
  await storeLinkedExcelFileHandle(handle);

  return { fileName: handle.name, stats };
}

/**
 * 3. Schreibt direkt in den verknüpften Paper-Quellordner auf dem PC
 */
export async function exportExcelToPaperFolder(): Promise<{ fileName: string; stats: ExcelExportStats }> {
  const folderHandle = useDocumentStore.getState().folderHandle;
  if (!folderHandle) {
    throw new Error('NO_FOLDER_CONNECTED');
  }

  const fileHandle = await folderHandle.getFileHandle('StudyNet_Research.xlsx', { create: true });
  const { blob, stats } = await generateExcelWorkbookBlob();
  await writeBlobToFileHandle(fileHandle, blob);
  await storeLinkedExcelFileHandle(fileHandle);

  return { fileName: 'StudyNet_Research.xlsx', stats };
}

/**
 * 4. Fallback: Normaler Browser-Download der Excel-Datei
 */
export async function downloadExcelFallback(): Promise<{ fileName: string; stats: ExcelExportStats }> {
  const { blob, stats } = await generateExcelWorkbookBlob();
  const url = URL.createObjectURL(blob);
  const dateStr = new Date().toISOString().slice(0, 10);
  const fileName = `StudyNet_Research_${dateStr}.xlsx`;

  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  return { fileName, stats };
}
