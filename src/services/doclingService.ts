import { db } from '../db/schema';
import { saveToOPFS, getFromOPFS } from '../utils/opfsStorage';
import { useSettingsStore } from '../store/useSettingsStore';

export async function checkAndSyncFluidMode(documentId: string): Promise<{ status: string, markdown?: string }> {
  try {
    const doc = await db.documents.get(documentId);
    if (!doc) return { status: 'none' };

    // Already fully synced?
    if (doc.fluidStatus === 'ready' && doc.fluidMarkdownOpfsPath) {
      try {
        const file = await getFromOPFS(doc.fluidMarkdownOpfsPath);
        const text = await file.text();
        return { status: 'ready', markdown: text };
      } catch (err) {
        console.warn('Local fluid MD not found, will refetch...', err);
      }
    }

    const syncUrl = useSettingsStore.getState().syncServerUrl;
    if (!syncUrl) return { status: doc.fluidStatus || 'none' };

    const res = await fetch(`${syncUrl}/api/pdf/${documentId}/fluid`);
    if (!res.ok) return { status: 'error' };

    const data = await res.json();
    
    if (data.status === 'ready') {
      let md: string = data.markdown;
      
      // Sync images to OPFS
      if (data.images && data.images.length > 0) {
        for (const imgUrl of data.images) {
          try {
            const imgRes = await fetch(`${syncUrl}${imgUrl}`);
            if (imgRes.ok) {
              const blob = await imgRes.blob();
              const fileName = imgUrl.split('/').pop()!;
              const opfsPath = await saveToOPFS(blob, 'fluid-images', fileName);
              
              // Replace in markdown
              const escapedFileName = fileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
              md = md.replace(new RegExp(`!\\[([^\\]]*)\\]\\([^)]*?${escapedFileName}\\)`, 'g'), `![$1](${opfsPath})`);
            }
          } catch (imgErr) {
            console.error('Failed to sync fluid image', imgErr);
          }
        }
      }

      const mdPath = await saveToOPFS(new Blob([md]), 'markdowns', `${documentId}_fluid.md`);
      let jsonPath: string | undefined = undefined;

      // Sync complete Docling Structure JSON to OPFS
      if (data.json) {
        try {
          const jsonBlob = new Blob([JSON.stringify(data.json, null, 2)], { type: 'application/json' });
          jsonPath = await saveToOPFS(jsonBlob, 'parsed_json', `${documentId}.json`);
        } catch (jsonErr) {
          console.error('Failed to sync Docling JSON to OPFS:', jsonErr);
        }
      }
      
      await db.documents.update(documentId, {
        fluidStatus: 'ready',
        fluidMarkdownOpfsPath: mdPath,
        ...(jsonPath ? { fluidJsonOpfsPath: jsonPath } : {})
      });

      return { status: 'ready', markdown: md };
    }

    if (data.status === 'processing') {
      if (doc.fluidStatus !== 'processing') {
        await db.documents.update(documentId, { fluidStatus: 'processing' });
      }
      return { status: 'processing' };
    }

    if (data.status === 'error') {
      await db.documents.update(documentId, { fluidStatus: 'error' });
      return { status: 'error' };
    }

    return { status: 'none' };
  } catch (err) {
    console.error('checkAndSyncFluidMode error:', err);
    return { status: 'error' };
  }
}

export async function triggerFluidGeneration(documentId: string, force: boolean = false): Promise<{ status: string }> {
  try {
    const syncUrl = useSettingsStore.getState().syncServerUrl;
    if (!syncUrl) return { status: 'none' };

    const doc = await db.documents.get(documentId);
    if (!doc) return { status: 'none' };

    // Reset local state if forced
    if (force) {
      await db.documents.update(documentId, {
        fluidStatus: 'processing',
        fluidMarkdownOpfsPath: undefined,
        fluidJsonOpfsPath: undefined
      });
    }

    // Try regenerate route on server first if forced
    if (force) {
      try {
        const regenRes = await fetch(`${syncUrl}/api/pdf/${documentId}/fluid/regenerate`, {
          method: 'POST'
        });
        if (regenRes.ok) {
          await db.documents.update(documentId, { fluidStatus: 'processing' });
          return { status: 'processing' };
        }
      } catch (e) {}
    }

    // Otherwise, upload the PDF file from OPFS
    let file: File | null = null;
    if (doc.pdfOpfsPath) {
      try { file = await getFromOPFS(doc.pdfOpfsPath); } catch (e) {}
    }
    if (!file) {
      try { file = await getFromOPFS(`opfs://pdfs/${doc.id}.pdf`); } catch (e) {}
    }

    if (file) {
      const formData = new FormData();
      formData.append('file', file);
      const uploadRes = await fetch(`${syncUrl}/api/pdf/${documentId}${force ? '?force=true' : ''}`, {
        method: 'POST',
        body: formData
      });
      if (uploadRes.ok) {
        await db.documents.update(documentId, { isPdfOnServer: true, fluidStatus: 'processing' });
        return { status: 'processing' };
      }
    }

  } catch (err) {
    console.error('triggerFluidGeneration error:', err);
  }
  return { status: 'none' };
}

/**
 * Exports the full Docling structure JSON as a downloadable file in the browser.
 */
export async function exportParsedJson(documentId: string, customTitle?: string): Promise<boolean> {
  try {
    const doc = await db.documents.get(documentId);
    let blob: Blob | null = null;

    // 1. Try local OPFS first
    if (doc?.fluidJsonOpfsPath) {
      try {
        const file = await getFromOPFS(doc.fluidJsonOpfsPath);
        blob = file;
      } catch (e) {}
    }

    // 2. Fallback to Sync Server
    if (!blob) {
      const syncUrl = useSettingsStore.getState().syncServerUrl;
      if (syncUrl) {
        const res = await fetch(`${syncUrl}/api/pdf/${documentId}/fluid/json`);
        if (res.ok) {
          blob = await res.blob();
        }
      }
    }

    if (!blob) {
      console.warn('Docling JSON not found for document:', documentId);
      return false;
    }

    // Trigger browser download
    const cleanTitle = (customTitle || doc?.title || documentId).replace(/[^a-zA-Z0-9_-]/g, '_');
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${cleanTitle}_docling.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return true;
  } catch (err) {
    console.error('Failed to export parsed JSON:', err);
    return false;
  }
}

/**
 * Exports the parsed Fluid Markdown as a downloadable .md file in the browser.
 */
export async function exportFluidMarkdown(documentId: string, customTitle?: string): Promise<boolean> {
  try {
    const doc = await db.documents.get(documentId);
    let blob: Blob | null = null;

    if (doc?.fluidMarkdownOpfsPath) {
      try {
        const file = await getFromOPFS(doc.fluidMarkdownOpfsPath);
        blob = file;
      } catch (e) {}
    }

    if (!blob) return false;

    const cleanTitle = (customTitle || doc?.title || documentId).replace(/[^a-zA-Z0-9_-]/g, '_');
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${cleanTitle}_fluid.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return true;
  } catch (err) {
    console.error('Failed to export fluid markdown:', err);
    return false;
  }
}

/**
 * Force-regenerate Docling Fluid Mode: Clears local OPFS cache & triggers server reprocessing.
 */
export async function regenerateFluidMode(documentId: string): Promise<{ status: string }> {
  try {
    const syncUrl = useSettingsStore.getState().syncServerUrl;

    // 1. Reset local DB state
    await db.documents.update(documentId, {
      fluidStatus: 'processing',
      fluidMarkdownOpfsPath: undefined,
      fluidJsonOpfsPath: undefined
    });

    if (!syncUrl) {
      return { status: 'none' };
    }

    // 2. Call server endpoint to wipe server cache and re-trigger Docling
    const res = await fetch(`${syncUrl}/api/pdf/${documentId}/fluid/regenerate`, {
      method: 'POST'
    });

    if (res.ok) {
      const data = await res.json();
      return { status: data.status || 'processing' };
    } else {
      // Fallback: upload PDF directly from OPFS with force=true
      return triggerFluidGeneration(documentId, true);
    }
  } catch (err) {
    console.error('regenerateFluidMode error:', err);
    return triggerFluidGeneration(documentId, true);
  }
}


