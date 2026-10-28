/**
 * Student service providing parameterized CRUD operations with application-level validation.
 */

import { validateStudentInput, validateUpdateStudentInput, idSchema } from '../validators/index.js';
import { getCurrentUtcIsoString } from '../utils/date.js';

function hasColumn(db, table, col) {
  try {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all();
    return cols.some((c) => c.name === col);
  } catch {
    return false;
  }
}

/**
 * Creates a new student record using parameterized SQL.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {{ full_name: string, phone?: string|null, monthly_fee: number, group_id?: number|null, enrollment_date?: string|null }} data
 * @returns {Object}
 */
export function createStudent(db, data) {
  const validated = validateStudentInput(data);
  const createdAt = getCurrentUtcIsoString();
  const phone = validated.phone ?? null;
  const groupId = validated.group_id ?? null;
  const enrollmentDate = validated.enrollment_date ?? null;

  const supportsEnrollment = hasColumn(db, 'students', 'enrollment_date');

  let info;
  if (supportsEnrollment) {
    const stmt = db.prepare(
      'INSERT INTO students (full_name, phone, monthly_fee, created_at, group_id, enrollment_date) VALUES (?, ?, ?, ?, ?, ?)'
    );
    info = stmt.run(validated.full_name, phone, validated.monthly_fee, createdAt, groupId, enrollmentDate);
  } else {
    const stmt = db.prepare(
      'INSERT INTO students (full_name, phone, monthly_fee, created_at, group_id) VALUES (?, ?, ?, ?, ?)'
    );
    info = stmt.run(validated.full_name, phone, validated.monthly_fee, createdAt, groupId);
  }

  return getStudentById(db, Number(info.lastInsertRowid));
}

/**
 * Retrieves a student by their ID.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} id
 * @returns {Object|null}
 */
export function getStudentById(db, id) {
  const validId = idSchema.parse(id);
  const supportsEnrollment = hasColumn(db, 'students', 'enrollment_date');

  if (supportsEnrollment) {
    const stmt = db.prepare(`
      SELECT
        s.id,
        s.full_name,
        s.phone,
        s.monthly_fee,
        s.created_at,
        s.group_id,
        s.enrollment_date,
        g.name AS group_name
      FROM students s
      LEFT JOIN groups g ON g.id = s.group_id
      WHERE s.id = ?
    `);
    return stmt.get(validId) || null;
  }

  const stmt = db.prepare(`
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
  `);
  return stmt.get(validId) || null;
}

/**
 * Retrieves all students ordered by ID.
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {Array<Object>}
 */
export function listStudents(db) {
  const supportsEnrollment = hasColumn(db, 'students', 'enrollment_date');

  if (supportsEnrollment) {
    const stmt = db.prepare(`
      SELECT
        s.id,
        s.full_name,
        s.phone,
        s.monthly_fee,
        s.created_at,
        s.group_id,
        s.enrollment_date,
        g.name AS group_name
      FROM students s
      LEFT JOIN groups g ON g.id = s.group_id
      ORDER BY s.id ASC
    `);
    return stmt.all();
  }

  const stmt = db.prepare(`
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
  `);
  return stmt.all();
}

/**
 * Updates a student record partially inside an atomic transaction.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} id
 * @param {{ full_name?: string, phone?: string|null, monthly_fee?: number, group_id?: number|null, enrollment_date?: string|null }} data
 * @returns {Object|null}
 */
export function updateStudent(db, id, data) {
  const validId = idSchema.parse(id);
  const validated = validateUpdateStudentInput(data);
  const supportsEnrollment = hasColumn(db, 'students', 'enrollment_date');

  const runUpdate = db.transaction(() => {
    const existing = getStudentById(db, validId);
    if (!existing) {
      return null;
    }

    const newFullName = validated.full_name !== undefined ? validated.full_name : existing.full_name;
    const newPhone = validated.phone !== undefined ? validated.phone : existing.phone;
    const newMonthlyFee = validated.monthly_fee !== undefined ? validated.monthly_fee : existing.monthly_fee;
    const newGroupId = validated.group_id !== undefined ? validated.group_id : existing.group_id;

    if (supportsEnrollment) {
      const newEnrollmentDate = validated.enrollment_date !== undefined ? validated.enrollment_date : existing.enrollment_date;
      const stmt = db.prepare(
        'UPDATE students SET full_name = ?, phone = ?, monthly_fee = ?, group_id = ?, enrollment_date = ? WHERE id = ?'
      );
      stmt.run(newFullName, newPhone, newMonthlyFee, newGroupId, newEnrollmentDate, validId);
    } else {
      const stmt = db.prepare(
        'UPDATE students SET full_name = ?, phone = ?, monthly_fee = ?, group_id = ? WHERE id = ?'
      );
      stmt.run(newFullName, newPhone, newMonthlyFee, newGroupId, validId);
    }

    return getStudentById(db, validId) || null;
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
  const stmt = db.prepare('DELETE FROM students WHERE id = ?');
  const info = stmt.run(validId);
  return {
    success: info.changes > 0,
    changes: info.changes
  };
}
