const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const https = require('https');
const db = require('./db');

const app = express();
app.use(cors());
app.use(express.json({ limit: '100mb' }));

const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => cb(null, req.params.id + '.pdf')
});
const upload = multer({ storage });

// --- ENDPOINTS ---

// PULL: Gibt alle geänderten Datensätze seit `since` zurück
app.get('/api/sync/pull', (req, res) => {
  const since = parseInt(req.query.since || '0', 10);
  const tables = ['documents', 'generated_questions', 'annotations', 'notes'];
  const data = {};

  try {
    const pullStmt = db.prepare('SELECT id, data FROM sync_records WHERE tableName = ? AND syncUpdatedAt > ?');

    for (const table of tables) {
      const rows = pullStmt.all(table, since);
      data[table] = rows.map(r => JSON.parse(r.data));
    }

    const deletions = db.prepare('SELECT id, tableName FROM deleted_records WHERE deletedAt > ?').all(since);

    res.json({
      timestamp: Date.now(),
      data,
      deletions
    });
  } catch (err) {
    console.error('[Server Pull Error]', err);
    res.status(500).json({ error: err.message });
  }
});

// PUSH: Empfängt geänderte Datensätze und Deletions
app.post('/api/sync/push', (req, res) => {
  const { data, deletions } = req.body;
  if (!data) return res.status(400).json({ error: 'No data provided' });

  const tables = ['documents', 'generated_questions', 'annotations', 'notes'];

  const upsertStmt = db.prepare(`
    INSERT INTO sync_records (tableName, id, syncUpdatedAt, data)
    VALUES (@tableName, @id, @syncUpdatedAt, @data)
    ON CONFLICT(tableName, id) DO UPDATE SET
      syncUpdatedAt = excluded.syncUpdatedAt,
      data = excluded.data
    WHERE excluded.syncUpdatedAt > sync_records.syncUpdatedAt
  `);

  const deleteRecordStmt = db.prepare(`
    INSERT OR REPLACE INTO deleted_records (id, tableName, deletedAt)
    VALUES (@id, @tableName, @deletedAt)
  `);

  const removeSyncedRecordStmt = db.prepare(`
    DELETE FROM sync_records WHERE tableName = ? AND id = ?
  `);

  try {
    db.transaction(() => {
      // Upserts ausführen
      for (const table of tables) {
        if (data[table] && Array.isArray(data[table])) {
          for (const item of data[table]) {
            if (!item.id) continue;
            upsertStmt.run({
              tableName: table,
              id: item.id,
              syncUpdatedAt: item.syncUpdatedAt || Date.now(),
              data: JSON.stringify(item)
            });
          }
        }
      }

      // Deletions ausführen
      if (deletions && Array.isArray(deletions)) {
        for (const del of deletions) {
          removeSyncedRecordStmt.run(del.tableName, del.id);
          deleteRecordStmt.run({
            id: del.id,
            tableName: del.tableName,
            deletedAt: del.deletedAt || Date.now()
          });
        }
      }
    })();

    res.json({ success: true, timestamp: Date.now() });
  } catch (err) {
    console.error('[Server Push Error]', err);
    res.status(500).json({ error: err.message });
  }
});

const { spawn } = require('child_process');
const activeDoclingJobs = new Map();

function getDocTitle(docId) {
  try {
    const row = db.prepare("SELECT data FROM sync_records WHERE tableName = 'documents' AND id = ?").get(docId);
    if (row && row.data) {
      const parsed = JSON.parse(row.data);
      if (parsed && parsed.title) return parsed.title;
    }
  } catch (e) {}
  return `Paper ${docId.slice(0, 8)}`;
}

function triggerDocling(docId, force = false) {
  const existingJob = activeDoclingJobs.get(docId);
  if (existingJob && existingJob.status === 'running') return true;

  const pdfPath = path.join(UPLOADS_DIR, `${docId}.pdf`);
  if (!fs.existsSync(pdfPath)) return false;

  const doclingDir = path.join(UPLOADS_DIR, 'docling', docId);
  if (force && fs.existsSync(doclingDir)) {
    try {
      fs.rmSync(doclingDir, { recursive: true, force: true });
    } catch (e) {}
  }
  if (!fs.existsSync(doclingDir)) {
    fs.mkdirSync(doclingDir, { recursive: true });
  }
  const mdPath = path.join(doclingDir, `${docId}.md`);
  const imageDir = path.join(doclingDir, 'images');
  const errorPath = path.join(doclingDir, '.error');

  // If already done and not forced, don't re-run
  if (!force && fs.existsSync(mdPath)) return true;
  if (fs.existsSync(errorPath)) fs.unlinkSync(errorPath);

  const title = getDocTitle(docId);
  console.log(`[Server] Starte Docling Konvertierung für "${title}" (${docId})... (force=${force})`);

  const pythonProcess = spawn('python', [
    path.join(__dirname, 'docling_worker.py'),
    pdfPath,
    mdPath,
    imageDir
  ]);

  const job = {
    docId,
    title,
    startedAt: Date.now(),
    status: 'running',
    lastLog: 'Starte Python Docling Layout- & Formel-Erkennung...',
    logs: ['[Init] Starte docling_worker.py...'],
    process: pythonProcess,
  };
  activeDoclingJobs.set(docId, job);

  pythonProcess.stdout.on('data', (data) => {
    const text = data.toString().trim();
    console.log(`[Docling ${docId}]: ${text}`);
    if (text) {
      job.lastLog = text.split('\n').pop() || job.lastLog;
      job.logs.push(`[stdout] ${text}`);
      if (job.logs.length > 50) job.logs.shift();
    }
  });

  pythonProcess.stderr.on('data', (data) => {
    const text = data.toString().trim();
    console.error(`[Docling ${docId} Error]: ${text}`);
    if (text) {
      job.lastLog = text.split('\n').pop() || job.lastLog;
      job.logs.push(`[stderr] ${text}`);
      if (job.logs.length > 50) job.logs.shift();
    }
  });

  pythonProcess.on('close', (code) => {
    job.status = code === 0 ? 'completed' : 'error';
    job.finishedAt = Date.now();
    job.exitCode = code;
    job.lastLog = code === 0 ? 'Erfolgreich abgeschlossen (Markdown & Bilder erzeugt).' : `Beendet mit Fehler (Code ${code})`;
    console.log(`[Docling ${docId}] beendet mit Code ${code}`);

    if (code !== 0 && !fs.existsSync(mdPath)) {
      fs.writeFileSync(errorPath, `Docling exited with code ${code}`);
    }

    // Nach 5 Minuten aus dem Speicher entfernen
    setTimeout(() => {
      if (activeDoclingJobs.get(docId)?.status !== 'running') {
        activeDoclingJobs.delete(docId);
      }
    }, 5 * 60 * 1000);
  });

  pythonProcess.on('error', (err) => {
    job.status = 'error';
    job.finishedAt = Date.now();
    job.lastLog = `Spawn-Fehler: ${err.message}`;
    job.logs.push(`[error] ${err.message}`);
    console.error(`[Docling ${docId} Spawn Error]:`, err);
    fs.writeFileSync(errorPath, err.message);
  });

  return true;
}

// System Jobs Status Endpoint
app.get('/api/system/jobs', (req, res) => {
  const jobs = Array.from(activeDoclingJobs.values()).map((j) => ({
    docId: j.docId,
    title: j.title,
    startedAt: j.startedAt,
    finishedAt: j.finishedAt,
    status: j.status,
    lastLog: j.lastLog,
    logs: j.logs.slice(-20),
    elapsedSeconds: Math.round(((j.finishedAt || Date.now()) - j.startedAt) / 1000),
  }));

  res.json({
    activeCount: jobs.filter((j) => j.status === 'running').length,
    jobs,
  });
});

// System Job Cancel Endpoint
app.post('/api/system/jobs/:id/cancel', (req, res) => {
  const docId = req.params.id;
  const job = activeDoclingJobs.get(docId);
  if (job && job.process && job.status === 'running') {
    try {
      job.process.kill('SIGKILL');
    } catch (e) {}
    job.status = 'cancelled';
    job.finishedAt = Date.now();
    job.lastLog = 'Vom Benutzer abgebrochen.';
    return res.json({ success: true, message: 'Job abgebrochen' });
  }
  res.status(404).json({ error: 'Job nicht aktiv' });
});

// PDF Upload Endpoint
app.post('/api/pdf/:id', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const docId = req.params.id;
  const force = req.query.force === 'true';
  console.log(`[Server] PDF erfolgreich empfangen für ID: ${docId} (force=${force})`);
  
  res.json({ success: true });

  // Trigger Docling Background Job
  triggerDocling(docId, force);
});

// PDF Download Endpoint
app.get('/api/pdf/:id', (req, res) => {
  const filePath = path.join(UPLOADS_DIR, req.params.id + '.pdf');
  if (fs.existsSync(filePath)) {
    res.sendFile(filePath);
  } else {
    res.status(404).json({ error: 'PDF not found' });
  }
});

// Fluid Mode Status & Data Endpoint
app.get('/api/pdf/:id/fluid', (req, res) => {
  const docId = req.params.id;
  const doclingDir = path.join(UPLOADS_DIR, 'docling', docId);
  const mdPath = path.join(doclingDir, `${docId}.md`);
  const imageDir = path.join(doclingDir, 'images');
  const errorPath = path.join(doclingDir, '.error');

  if (fs.existsSync(mdPath)) {
    const markdown = fs.readFileSync(mdPath, 'utf8');
    let images = [];
    if (fs.existsSync(imageDir)) {
      images = fs.readdirSync(imageDir).map(f => `/api/pdf/${docId}/fluid/images/${f}`);
    }
    const jsonPath = path.join(doclingDir, `${docId}.json`);
    let structureJson = null;
    if (fs.existsSync(jsonPath)) {
      try {
        structureJson = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      } catch (e) {
        console.warn(`[Server] Konnte JSON für ${docId} nicht parsen:`, e);
      }
    }
    return res.json({ status: 'ready', markdown, images, json: structureJson });
  }

  if (fs.existsSync(errorPath)) {
    return res.json({ status: 'error', error: fs.readFileSync(errorPath, 'utf8') });
  }

  if (activeDoclingJobs.has(docId)) {
    return res.json({ status: 'processing' });
  }

  // If PDF exists on server, trigger conversion automatically on-demand!
  const pdfPath = path.join(UPLOADS_DIR, `${docId}.pdf`);
  if (fs.existsSync(pdfPath)) {
    triggerDocling(docId);
    return res.json({ status: 'processing' });
  }

  res.json({ status: 'none' });
});

// Re-generate Fluid Mode Endpoint (Clears server cache and restarts Docling)
app.post('/api/pdf/:id/fluid/regenerate', (req, res) => {
  const docId = req.params.id;
  const pdfPath = path.join(UPLOADS_DIR, `${docId}.pdf`);

  if (fs.existsSync(pdfPath)) {
    triggerDocling(docId, true);
    return res.json({ status: 'processing', message: 'Docling re-generation started.' });
  }

  res.status(404).json({ status: 'none', error: 'PDF file not found on server. Please upload first.' });
});

// Fluid Mode Image Download Endpoint
app.get('/api/pdf/:id/fluid/images/:imageName', (req, res) => {
  const { id, imageName } = req.params;
  const imagePath = path.join(UPLOADS_DIR, 'docling', id, 'images', imageName);
  
  if (fs.existsSync(imagePath)) {
    res.sendFile(imagePath);
  } else {
    res.status(404).json({ error: 'Image not found' });
  }
});

// Fluid Mode JSON Download Endpoint
app.get('/api/pdf/:id/fluid/json', (req, res) => {
  const { id } = req.params;
  const jsonPath = path.join(UPLOADS_DIR, 'docling', id, `${id}.json`);

  if (fs.existsSync(jsonPath)) {
    res.setHeader('Content-Disposition', `attachment; filename="${id}_docling.json"`);
    res.setHeader('Content-Type', 'application/json');
    res.sendFile(jsonPath);
  } else {
    res.status(404).json({ error: 'Structure JSON not found' });
  }
});


// START SERVER
const PORT = process.env.PORT || 3000;

const filesInDir = fs.readdirSync(__dirname);
const crtFile = filesInDir.find(f => f.endsWith('.crt'));
const keyFile = filesInDir.find(f => f.endsWith('.key'));

if (crtFile && keyFile) {
  const certPath = path.join(__dirname, crtFile);
  const keyPath = path.join(__dirname, keyFile);

  const options = {
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath)
  };
  https.createServer(options, app).listen(PORT, () => {
    console.log(`Sync Server running securely on HTTPS port ${PORT} using ${crtFile} and ${keyFile}`);
  });
} else {
  app.listen(PORT, () => {
    console.log(`Sync Server running on HTTP port ${PORT}. Warning: HTTPS is required for OPFS on mobile!`);
  });
}
