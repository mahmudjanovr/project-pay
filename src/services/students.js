/**
 * Student service providing parameterized CRUD operations with application-level validation.
 */

import { validateStudentInput, validateUpdateStudentInput, idSchema } from '../validators/index.js';
import { getCurrentUtcIsoString } from '../utils/date.js';

const studentStmtCache = new WeakMap();

function getStudentStmts(db) {
  let stmts = studentStmtCache.get(db);
  if (!stmts) {
    stmts = {
      insert: db.prepare(
        'INSERT INTO students (full_name, phone, monthly_fee, created_at, group_id) VALUES (?, ?, ?, ?, ?)'
      ),
      getById: db.prepare(`
        SELECT
          s.id,
          s.full_name,
          s.phone,
          s.monthly_fee,
          s.created_at,
          s.group_id,
          g.name AS group_name
        FROM students s
        LEFT JOIN groups g ON g.id = s.group_id
        WHERE s.id = ?
      `),
      list: db.prepare(`
        SELECT
          s.id,
          s.full_name,
          s.phone,
          s.monthly_fee,
          s.created_at,
          s.group_id,
          g.name AS group_name
        FROM students s
        LEFT JOIN groups g ON g.id = s.group_id
        ORDER BY s.id ASC
      `),
      update: db.prepare(
        'UPDATE students SET full_name = ?, phone = ?, monthly_fee = ?, group_id = ? WHERE id = ?'
      ),
      deleteById: db.prepare('DELETE FROM students WHERE id = ?')
    };
    studentStmtCache.set(db, stmts);
  }
  return stmts;
}

/**
 * Creates a new student record using parameterized SQL.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {{ full_name: string, phone?: string|null, monthly_fee: number, group_id?: number|null }} data
 * @returns {{ id: number, full_name: string, phone: string|null, monthly_fee: number, created_at: string, group_id: number|null, group_name: string|null }}
 */
export function createStudent(db, data) {
  const validated = validateStudentInput(data);
  const createdAt = getCurrentUtcIsoString();
  const phone = validated.phone ?? null;
  const groupId = validated.group_id ?? null;

  const { insert } = getStudentStmts(db);
  const info = insert.run(validated.full_name, phone, validated.monthly_fee, createdAt, groupId);

  return getStudentById(db, Number(info.lastInsertRowid));
}

/**
 * Retrieves a student by their ID.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} id
 * @returns {{ id: number, full_name: string, phone: string|null, monthly_fee: number, created_at: string, group_id: number|null, group_name: string|null } | null}
 */
export function getStudentById(db, id) {
  const validId = idSchema.parse(id);
  const { getById } = getStudentStmts(db);
  const row = getById.get(validId);
  return row || null;
}

/**
 * Retrieves all students ordered by ID.
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {Array<{ id: number, full_name: string, phone: string|null, monthly_fee: number, created_at: string, group_id: number|null, group_name: string|null }>}
 */
export function listStudents(db) {
  const { list } = getStudentStmts(db);
  return list.all();
}

/**
 * Updates a student record partially inside an atomic transaction.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} id
 * @param {{ full_name?: string, phone?: string|null, monthly_fee?: number, group_id?: number|null }} data
 * @returns {{ id: number, full_name: string, phone: string|null, monthly_fee: number, created_at: string, group_id: number|null, group_name: string|null } | null}
 */
export function updateStudent(db, id, data) {
  const validId = idSchema.parse(id);
  const validated = validateUpdateStudentInput(data);
  const { getById, update } = getStudentStmts(db);

  const runUpdate = db.transaction(() => {
    const existing = getById.get(validId);
    if (!existing) {
      return null;
    }

    const newFullName = validated.full_name !== undefined ? validated.full_name : existing.full_name;
    const newPhone = validated.phone !== undefined ? validated.phone : existing.phone;
    const newMonthlyFee = validated.monthly_fee !== undefined ? validated.monthly_fee : existing.monthly_fee;
    const newGroupId = validated.group_id !== undefined ? validated.group_id : existing.group_id;

    update.run(newFullName, newPhone, newMonthlyFee, newGroupId, validId);
    return getById.get(validId) || null;
  });

  return runUpdate();
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
  const { deleteById } = getStudentStmts(db);
  const info = deleteById.run(validId);
  return {
    success: info.changes > 0,
    changes: info.changes
  };
}
