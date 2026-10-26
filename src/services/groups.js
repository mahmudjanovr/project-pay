/**
 * Groups service providing parameterized CRUD operations with application-level validation.
 */

import { validateGroupInput, validateUpdateGroupInput, idSchema } from '../validators/index.js';
import { getCurrentUtcIsoString } from '../utils/date.js';

/**
 * Retrieves all groups with assigned student counts, ordered by name.
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {Array<{ id: number, name: string, created_at: string, student_count: number }>}
 */
export function listGroups(db) {
  const stmt = db.prepare(`
    SELECT
      g.id,
      g.name,
      g.created_at,
      COUNT(s.id) AS student_count
    FROM groups g
    LEFT JOIN students s ON s.group_id = g.id
    GROUP BY g.id, g.name, g.created_at
    ORDER BY g.name COLLATE NOCASE ASC;
  `);

  return stmt.all().map((row) => ({
    id: row.id,
    name: row.name,
    created_at: row.created_at,
    student_count: Number(row.student_count)
  }));
}

/**
 * Retrieves a single group by ID with assigned student count.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} id
 * @returns {{ id: number, name: string, created_at: string, student_count: number } | null}
 */
export function getGroupById(db, id) {
  const validId = idSchema.parse(id);
  const stmt = db.prepare(`
    SELECT
      g.id,
      g.name,
      g.created_at,
      COUNT(s.id) AS student_count
    FROM groups g
    LEFT JOIN students s ON s.group_id = g.id
    WHERE g.id = ?
    GROUP BY g.id, g.name, g.created_at;
  `);

  const row = stmt.get(validId);
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    name: row.name,
    created_at: row.created_at,
    student_count: Number(row.student_count)
  };
}

/**
 * Creates a new group record.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {{ name: string }} data
 * @returns {{ id: number, name: string, created_at: string, student_count: number }}
 */
export function createGroup(db, data) {
  const validated = validateGroupInput(data);
  const createdAt = getCurrentUtcIsoString();

  const stmt = db.prepare(
    'INSERT INTO groups (name, created_at) VALUES (?, ?)'
  );
  const info = stmt.run(validated.name, createdAt);

  return {
    id: Number(info.lastInsertRowid),
    name: validated.name,
    created_at: createdAt,
    student_count: 0
  };
}

/**
 * Renames an existing group.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} id
 * @param {{ name: string }} data
 * @returns {{ id: number, name: string, created_at: string, student_count: number } | null}
 */
export function updateGroup(db, id, data) {
  const validId = idSchema.parse(id);
  const validated = validateUpdateGroupInput(data);

  const existing = getGroupById(db, validId);
  if (!existing) {
    return null;
  }

  const stmt = db.prepare(
    'UPDATE groups SET name = ? WHERE id = ?'
  );
  stmt.run(validated.name, validId);

  return {
    id: existing.id,
    name: validated.name,
    created_at: existing.created_at,
    student_count: existing.student_count
  };
}

/**
 * Deletes a group by ID only if no students are assigned.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} id
 * @returns {{ found: boolean, deleted: boolean, hasStudents: boolean, student_count: number }}
 */
export function deleteGroup(db, id) {
  const validId = idSchema.parse(id);

  const existing = getGroupById(db, validId);
  if (!existing) {
    return {
      found: false,
      deleted: false,
      hasStudents: false,
      student_count: 0
    };
  }

  if (existing.student_count > 0) {
    return {
      found: true,
      deleted: false,
      hasStudents: true,
      student_count: existing.student_count
    };
  }

  const stmt = db.prepare('DELETE FROM groups WHERE id = ?');
  const info = stmt.run(validId);

  return {
    found: true,
    deleted: info.changes > 0,
    hasStudents: false,
    student_count: 0
  };
}
