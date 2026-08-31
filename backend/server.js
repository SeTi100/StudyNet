const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const https = require('https');
const db = require('./db');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR);
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => cb(null, req.params.id + '.pdf')
});
const upload = multer({ storage });

// Helper to safely parse/stringify JSON objects in SQLite
const serialize = (obj) => obj ? JSON.stringify(obj) : null;
const deserialize = (str) => str ? JSON.parse(str) : null;

// --- ENDPOINTS ---

app.get('/api/sync/pull', (req, res) => {
  const since = parseInt(req.query.since || '0', 10);

  const tables = ['documents', 'generated_questions', 'annotations', 'notes'];
  const data = {};

  try {
    for (const table of tables) {
      const records = db.prepare(`SELECT * FROM ${table} WHERE syncUpdatedAt > ?`).all(since);
      // Deserialize nested JSON fields where applicable
      data[table] = records.map(r => {
        if (table === 'documents') {
          return { ...r, tokenUsage: deserialize(r.tokenUsage), authors: deserialize(r.authors) };
        }
        if (table === 'generated_questions') {
          return { ...r, embedding: deserialize(r.embedding) };
        }
        if (table === 'annotations') {
          return { ...r, rects: deserialize(r.rects) };
        }
        return r;
      });
    }

    const deletions = db.prepare('SELECT id, tableName FROM deleted_records WHERE deletedAt > ?').all(since);
    
    res.json({
      timestamp: Date.now(),
      data,
      deletions
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/sync/push', (req, res) => {
  const { data, deletions, timestamp } = req.body;
  if (!data) return res.status(400).json({ error: 'No data' });

  const tables = ['documents', 'generated_questions', 'annotations', 'notes'];
  const insertStmts = {
    documents: db.prepare(`
      INSERT INTO documents (id, title, createdAt, syncUpdatedAt, lastReadAt, readingProgress, fileSize, numPages, tokenUsage, authors, doi, abstract)
      VALUES (@id, @title, @createdAt, @syncUpdatedAt, @lastReadAt, @readingProgress, @fileSize, @numPages, @tokenUsage, @authors, @doi, @abstract)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title, syncUpdatedAt = excluded.syncUpdatedAt, lastReadAt = excluded.lastReadAt, 
        readingProgress = excluded.readingProgress, tokenUsage = excluded.tokenUsage,
        authors = excluded.authors, doi = excluded.doi, abstract = excluded.abstract
      WHERE excluded.syncUpdatedAt > documents.syncUpdatedAt
    `),
    generated_questions: db.prepare(`
      INSERT INTO generated_questions (id, documentId, question, shortAnswer, category, chunkId, chunkText, pageNumber, embedding, createdAt, syncUpdatedAt)
      VALUES (@id, @documentId, @question, @shortAnswer, @category, @chunkId, @chunkText, @pageNumber, @embedding, @createdAt, @syncUpdatedAt)
      ON CONFLICT(id) DO UPDATE SET
        question = excluded.question, shortAnswer = excluded.shortAnswer, category = excluded.category,
        syncUpdatedAt = excluded.syncUpdatedAt
      WHERE excluded.syncUpdatedAt > generated_questions.syncUpdatedAt
    `),
    annotations: db.prepare(`
      INSERT INTO annotations (id, documentId, pageNumber, rects, text, color, createdAt, syncUpdatedAt)
      VALUES (@id, @documentId, @pageNumber, @rects, @text, @color, @createdAt, @syncUpdatedAt)
      ON CONFLICT(id) DO UPDATE SET
        rects = excluded.rects, text = excluded.text, color = excluded.color, syncUpdatedAt = excluded.syncUpdatedAt
      WHERE excluded.syncUpdatedAt > annotations.syncUpdatedAt
    `),
    notes: db.prepare(`
      INSERT INTO notes (id, documentId, content, createdAt, syncUpdatedAt)
      VALUES (@id, @documentId, @content, @createdAt, @syncUpdatedAt)
      ON CONFLICT(id) DO UPDATE SET
        content = excluded.content, syncUpdatedAt = excluded.syncUpdatedAt
      WHERE excluded.syncUpdatedAt > notes.syncUpdatedAt
    `)
  };

  const deleteStmt = db.prepare(`
    INSERT OR IGNORE INTO deleted_records (id, tableName, deletedAt) 
    VALUES (@id, @tableName, @deletedAt)
  `);

  try {
    db.transaction(() => {
      // Handle upserts
      for (const table of tables) {
        if (data[table] && Array.isArray(data[table])) {
          for (const record of data[table]) {
            if (table === 'documents') {
              record.tokenUsage = serialize(record.tokenUsage);
              record.authors = serialize(record.authors);
            }
            if (table === 'generated_questions') {
              record.embedding = serialize(record.embedding);
            }
            if (table === 'annotations') {
              record.rects = serialize(record.rects);
            }
            insertStmts[table].run(record);
          }
        }
      }

      // Handle deletions
      if (deletions && Array.isArray(deletions)) {
        for (const del of deletions) {
          if (tables.includes(del.tableName)) {
            // Delete from main table
            db.prepare(\`DELETE FROM \${del.tableName} WHERE id = ?\`).run(del.id);
            // Record deletion
            deleteStmt.run({ id: del.id, tableName: del.tableName, deletedAt: del.deletedAt || Date.now() });
          }
        }
      }
    })();

    res.json({ success: true, timestamp: Date.now() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// PDF Upload Endpoint
app.post('/api/pdf/:id', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
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

// Versuche Tailscale / lokale SSL Zertifikate zu laden (cert.crt und cert.key im backend ordner)
const certPath = path.join(__dirname, 'cert.crt');
const keyPath = path.join(__dirname, 'cert.key');

if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
  const options = {
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath)
  };
  https.createServer(options, app).listen(PORT, () => {
    console.log(\`Sync Server running securely on HTTPS port \${PORT}\`);
  });
} else {
  app.listen(PORT, () => {
    console.log(\`Sync Server running on HTTP port \${PORT}. Warning: HTTPS is required for OPFS on mobile!\`);
  });
}
