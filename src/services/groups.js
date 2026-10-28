/**
 * Groups service providing parameterized CRUD operations with application-level validation.
 */

import { validateGroupInput, validateUpdateGroupInput, idSchema } from '../validators/index.js';
import { getCurrentUtcIsoString } from '../utils/date.js';

const groupStmtCache = new WeakMap();

function getGroupStmts(db) {
  let stmts = groupStmtCache.get(db);
  if (!stmts) {
    stmts = {
      list: db.prepare(`
        SELECT
          g.id,
          g.name,
          g.created_at,
          COUNT(s.id) AS student_count
        FROM groups g
        LEFT JOIN students s ON s.group_id = g.id
        GROUP BY g.id, g.name, g.created_at
        ORDER BY g.name COLLATE NOCASE ASC;
      `),
      getById: db.prepare(`
        SELECT
          g.id,
          g.name,
          g.created_at,
          COUNT(s.id) AS student_count
        FROM groups g
        LEFT JOIN students s ON s.group_id = g.id
        WHERE g.id = ?
        GROUP BY g.id, g.name, g.created_at;
      `),
      insert: db.prepare('INSERT INTO groups (name, created_at) VALUES (?, ?)'),
      update: db.prepare('UPDATE groups SET name = ? WHERE id = ?'),
      deleteById: db.prepare('DELETE FROM groups WHERE id = ?'),
      studentsByGroup: db.prepare(`
        SELECT
          s.id,
          s.full_name,
          s.phone,
          s.monthly_fee,
          s.created_at,
          s.group_id,
          g.name AS group_name
        FROM students s
        JOIN groups g ON g.id = s.group_id
        WHERE s.group_id = ?
        ORDER BY s.id ASC;
      `)
    };
    groupStmtCache.set(db, stmts);
  }
  return stmts;
}

/**
 * Retrieves all groups with assigned student counts, ordered by name.
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {Array<{ id: number, name: string, created_at: string, student_count: number }>}
 */
export function listGroups(db) {
  const { list } = getGroupStmts(db);
  return list.all().map((row) => ({
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
  const { getById } = getGroupStmts(db);
  const row = getById.get(validId);
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

  const { insert } = getGroupStmts(db);
  const info = insert.run(validated.name, createdAt);

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
  const { update } = getGroupStmts(db);

  const runUpdate = db.transaction(() => {
    const existing = getGroupById(db, validId);
    if (!existing) {
      return null;
    }

    update.run(validated.name, validId);

    return {
      id: existing.id,
      name: validated.name,
      created_at: existing.created_at,
      student_count: existing.student_count
    };
  });

  return runUpdate();
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
  const { deleteById } = getGroupStmts(db);

  const runDelete = db.transaction(() => {
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

    const info = deleteById.run(validId);

    return {
      found: true,
      deleted: info.changes > 0,
      hasStudents: false,
      student_count: 0
    };
  });

  return runDelete();
}

/**
 * Retrieves all students assigned to a specific group.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} groupId
 * @returns {Array<{ id: number, full_name: string, phone: string|null, monthly_fee: number, created_at: string, group_id: number, group_name: string }>}
 */
export function getStudentsByGroupId(db, groupId) {
  const validId = idSchema.parse(groupId);
  const { studentsByGroup } = getGroupStmts(db);
  return studentsByGroup.all(validId);
}
