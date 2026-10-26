/**
 * Database schema and migrations definition for Project Pay.
 * Uses SQLite STRICT tables, foreign keys with ON DELETE RESTRICT, and check constraints.
 */

export const migrations = [
  {
    version: '001_initial_schema',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS students (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          full_name TEXT NOT NULL CHECK (length(trim(full_name)) > 0),
          monthly_fee INTEGER NOT NULL CHECK (monthly_fee >= 0),
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        ) STRICT;

        CREATE TABLE IF NOT EXISTS payments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
          amount INTEGER NOT NULL CHECK (amount > 0),
          payment_date TEXT NOT NULL CHECK (payment_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        ) STRICT;

        CREATE INDEX IF NOT EXISTS idx_payments_student_date_id ON payments (student_id, payment_date, id);
        CREATE INDEX IF NOT EXISTS idx_payments_payment_date ON payments (payment_date);
      `);
    }
  }
];
