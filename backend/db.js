const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, 'sync.db');
const db = new Database(dbPath);

// Initialize tables exactly matching the Dexie schema
db.exec(`
  CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    title TEXT,
    createdAt INTEGER,
    syncUpdatedAt INTEGER,
    lastReadAt INTEGER,
    readingProgress INTEGER,
    fileSize INTEGER,
    numPages INTEGER,
    tokenUsage TEXT, 
    authors TEXT, 
    doi TEXT, 
    abstract TEXT
  );

  CREATE TABLE IF NOT EXISTS generated_questions (
    id TEXT PRIMARY KEY,
    documentId TEXT,
    question TEXT,
    shortAnswer TEXT,
    category TEXT,
    chunkId TEXT,
    chunkText TEXT,
    pageNumber INTEGER,
    embedding TEXT,
    createdAt INTEGER,
    syncUpdatedAt INTEGER
  );

  CREATE TABLE IF NOT EXISTS annotations (
    id TEXT PRIMARY KEY,
    documentId TEXT,
    pageNumber INTEGER,
    rects TEXT,
    text TEXT,
    color TEXT,
    createdAt INTEGER,
    syncUpdatedAt INTEGER
  );

  CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY,
    documentId TEXT,
    content TEXT,
    createdAt INTEGER,
    syncUpdatedAt INTEGER
  );

  CREATE TABLE IF NOT EXISTS deleted_records (
    id TEXT PRIMARY KEY,
    tableName TEXT,
    deletedAt INTEGER
  );
`);

module.exports = db;
