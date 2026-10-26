/**
 * Student service providing parameterized CRUD operations with application-level validation.
 */

import { validateStudentInput, idSchema } from '../validators/index.js';
import { getCurrentUtcIsoString } from '../utils/date.js';

/**
 * Creates a new student record using parameterized SQL.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {{ full_name: string, monthly_fee: number }} data
 * @returns {{ id: number, full_name: string, monthly_fee: number, created_at: string }}
 */
export function createStudent(db, data) {
  const validated = validateStudentInput(data);
  const createdAt = getCurrentUtcIsoString();

  const stmt = db.prepare(
    'INSERT INTO students (full_name, monthly_fee, created_at) VALUES (?, ?, ?)'
  );
  const info = stmt.run(validated.full_name, validated.monthly_fee, createdAt);

  return {
    id: Number(info.lastInsertRowid),
    full_name: validated.full_name,
    monthly_fee: validated.monthly_fee,
    created_at: createdAt
  };
}

/**
 * Retrieves a student by their ID.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} id
 * @returns {{ id: number, full_name: string, monthly_fee: number, created_at: string } | null}
 */
export function getStudentById(db, id) {
  const validId = idSchema.parse(id);
  const stmt = db.prepare(
    'SELECT id, full_name, monthly_fee, created_at FROM students WHERE id = ?'
  );
  const row = stmt.get(validId);
  return row || null;
}

/**
 * Retrieves all students ordered by ID.
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {Array<{ id: number, full_name: string, monthly_fee: number, created_at: string }>}
 */
export function listStudents(db) {
  const stmt = db.prepare(
    'SELECT id, full_name, monthly_fee, created_at FROM students ORDER BY id ASC'
  );
  return stmt.all();
}

/**
 * Deletes a student by ID.
 * Restricted by SQLite foreign-key constraint if student has payments.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} id
 * @returns {{ success: boolean, changes: number }}
 */
export function deleteStudent(db, id) {
  const validId = idSchema.parse(id);
  const stmt = db.prepare('DELETE FROM students WHERE id = ?');
  const info = stmt.run(validId);
  return {
    success: info.changes > 0,
    changes: info.changes
  };
}
