/**
 * Database initialization and migration runner for Project Pay.
 * Safe, idempotent, and repeatable without data destruction or demo data insertion.
 */

import { migrations } from './schema.js';
import { getCurrentUtcIsoString } from '../utils/date.js';

/**
 * Initializes the SQLite database schema and applies pending migrations.
 * Verifies foreign-key enforcement and runs schema setup idempotently.
 *
 * @param {import('better-sqlite3').Database} db - An active database connection.
 * @returns {import('better-sqlite3').Database} The initialized database connection.
 */
export function initDatabase(db) {
  // Ensure foreign keys are enabled and active
  const fkStatus = db.pragma('foreign_keys', { simple: true });
  if (fkStatus !== 1) {
    db.pragma('foreign_keys = ON');
    const verified = db.pragma('foreign_keys', { simple: true });
    if (verified !== 1) {
      throw new Error('SQLite foreign-key enforcement could not be enabled during initialization.');
    }
  }

  // Ensure migration tracking table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL
    ) STRICT;
  `);

  const getApplied = db.prepare('SELECT version FROM schema_migrations');
  const insertMigration = db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)');

  // Run pending migrations inside a transaction
  const applyMigrations = db.transaction(() => {
    const appliedVersions = new Set(getApplied.all().map((row) => row.version));

    for (const migration of migrations) {
      if (!appliedVersions.has(migration.version)) {
        migration.up(db);
        insertMigration.run(migration.version, getCurrentUtcIsoString());
      }
    }
  });

  applyMigrations();

  return db;
}
