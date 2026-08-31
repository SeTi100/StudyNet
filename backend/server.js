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

// PDF Upload Endpoint
app.post('/api/pdf/:id', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  console.log(`[Server] PDF erfolgreich empfangen für ID: ${req.params.id}`);
  res.json({ success: true });
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
