/**
 * Student service providing parameterized CRUD operations with application-level validation.
 */

import { validateStudentInput, validateUpdateStudentInput, idSchema } from '../validators/index.js';
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
  const groupId = validated.group_id ?? null;

  const stmt = db.prepare(
    'INSERT INTO students (full_name, monthly_fee, created_at, group_id) VALUES (?, ?, ?, ?)'
  );
  const info = stmt.run(validated.full_name, validated.monthly_fee, createdAt, groupId);

  return getStudentById(db, Number(info.lastInsertRowid));
}

/**
 * Retrieves a student by their ID.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} id
 * @returns {{ id: number, full_name: string, monthly_fee: number, created_at: string, group_id: number|null, group_name: string|null } | null}
 */
export function getStudentById(db, id) {
  const validId = idSchema.parse(id);
  const stmt = db.prepare(`
    SELECT
      s.id,
      s.full_name,
      s.monthly_fee,
      s.created_at,
      s.group_id,
      g.name AS group_name
    FROM students s
    LEFT JOIN groups g ON g.id = s.group_id
    WHERE s.id = ?
  `);
  const row = stmt.get(validId);
  return row || null;
}

/**
 * Retrieves all students ordered by ID.
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {Array<{ id: number, full_name: string, monthly_fee: number, created_at: string, group_id: number|null, group_name: string|null }>}
 */
export function listStudents(db) {
  const stmt = db.prepare(`
    SELECT
      s.id,
      s.full_name,
      s.monthly_fee,
      s.created_at,
      s.group_id,
      g.name AS group_name
    FROM students s
    LEFT JOIN groups g ON g.id = s.group_id
    ORDER BY s.id ASC
  `);
  return stmt.all();
}

/**
 * Updates a student record partially.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} id
 * @param {{ full_name?: string, monthly_fee?: number, group_id?: number|null }} data
 * @returns {{ id: number, full_name: string, monthly_fee: number, created_at: string, group_id: number|null, group_name: string|null } | null}
 */
export function updateStudent(db, id, data) {
  const validId = idSchema.parse(id);
  const validated = validateUpdateStudentInput(data);

  const existing = getStudentById(db, validId);
  if (!existing) {
    return null;
  }

  const newFullName = validated.full_name !== undefined ? validated.full_name : existing.full_name;
  const newMonthlyFee = validated.monthly_fee !== undefined ? validated.monthly_fee : existing.monthly_fee;
  const newGroupId = validated.group_id !== undefined ? validated.group_id : existing.group_id;

  const stmt = db.prepare(
    'UPDATE students SET full_name = ?, monthly_fee = ?, group_id = ? WHERE id = ?'
  );
  stmt.run(newFullName, newMonthlyFee, newGroupId, validId);

  return getStudentById(db, validId);
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
