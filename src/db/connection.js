/**
 * SQLite database connection factory using better-sqlite3.
 * Enforces foreign-key constraints on every database connection.
 */

import Database from 'better-sqlite3';

/**
 * Creates and configures a SQLite database connection.
 * Foreign-key enforcement is enabled and verified on every connection.
 *
 * @param {string} [dbPath=':memory:'] - Path to database file or ':memory:'
 * @param {import('better-sqlite3').Options} [options={}] - Database options
 * @returns {import('better-sqlite3').Database}
 */
export function createDatabase(dbPath = ':memory:', options = {}) {
  const db = new Database(dbPath, options);

  // Explicitly enable foreign-key constraint enforcement
  db.pragma('foreign_keys = ON');

  // Verify foreign-key enforcement is active
  const fkStatus = db.pragma('foreign_keys', { simple: true });
  if (fkStatus !== 1) {
    db.close();
    throw new Error('SQLite foreign-key enforcement could not be enabled or verified.');
  }

  // Enable Write-Ahead Logging for file-backed databases for durability and concurrency
  if (typeof dbPath === 'string' && dbPath !== ':memory:' && !dbPath.startsWith('file::memory:')) {
    db.pragma('journal_mode = WAL');
  }

  return db;
}
