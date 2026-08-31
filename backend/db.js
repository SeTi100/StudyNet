const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'sync.db');
const db = new Database(dbPath);

// Generic key-value JSON store per table with timestamps
db.exec(`
  CREATE TABLE IF NOT EXISTS sync_records (
    tableName TEXT NOT NULL,
    id TEXT NOT NULL,
    syncUpdatedAt INTEGER NOT NULL,
    data TEXT NOT NULL,
    PRIMARY KEY (tableName, id)
  );

  CREATE TABLE IF NOT EXISTS deleted_records (
    id TEXT PRIMARY KEY,
    tableName TEXT NOT NULL,
    deletedAt INTEGER NOT NULL
  );
`);

module.exports = db;
