/**
 * Monthly debtor calculation service for Project Pay.
 * Identifies students with outstanding debt for a given calendar month using strictly parameterized SQL.
 */

import { validateReportMonth } from '../validators/index.js';
import { getMonthDateRange } from '../utils/date.js';

export const MONTHLY_DEBTORS_QUERY = `
  SELECT
    s.id,
    s.id AS student_id,
    s.full_name,
    s.monthly_fee,
    s.group_id,
    g.name AS group_name,
    COALESCE(p.total_paid, 0) AS total_paid,
    COALESCE(p.pending_paid, 0) AS pending_paid,
    MAX(0, s.monthly_fee - COALESCE(p.total_paid, 0)) AS debt,
    CASE
      WHEN COALESCE(p.total_paid, 0) = 0 AND COALESCE(p.pending_paid, 0) > 0 THEN 'pending'
      WHEN COALESCE(p.total_paid, 0) = 0 THEN 'unpaid'
      WHEN COALESCE(p.total_paid, 0) < s.monthly_fee THEN 'partial'
      ELSE 'paid'
    END AS status
  FROM students s
  LEFT JOIN groups g ON g.id = s.group_id
  LEFT JOIN (
    SELECT
      student_id,
      SUM(CASE WHEN COALESCE(status, 'confirmed') = 'confirmed' THEN amount ELSE 0 END) AS total_paid,
      SUM(CASE WHEN status = 'pending' THEN amount ELSE 0 END) AS pending_paid
    FROM payments
    WHERE COALESCE(billing_month, substr(payment_date, 1, 7)) = ?
    GROUP BY student_id
  ) p ON s.id = p.student_id
  WHERE s.monthly_fee > 0
    AND (s.enrollment_date IS NULL OR substr(s.enrollment_date, 1, 7) <= ?)
    AND COALESCE(p.total_paid, 0) < s.monthly_fee
  ORDER BY s.id ASC;
`;

const LEGACY_DEBTORS_QUERY = `
  SELECT
    s.id,
    s.id AS student_id,
    s.full_name,
    s.monthly_fee,
    COALESCE(p.total_paid, 0) AS total_paid,
    0 AS pending_paid,
    MAX(0, s.monthly_fee - COALESCE(p.total_paid, 0)) AS debt,
    'unpaid' AS status
  FROM students s
  LEFT JOIN (
    SELECT
      student_id,
      SUM(amount) AS total_paid
    FROM payments
    WHERE payment_date >= ? AND payment_date <= ?
    GROUP BY student_id
  ) p ON s.id = p.student_id
  WHERE COALESCE(p.total_paid, 0) < s.monthly_fee
  ORDER BY s.id ASC;
`;

function hasColumn(db, table, col) {
  try {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all();
    return cols.some((c) => c.name === col);
  } catch {
    return false;
  }
}

const debtorsStmtCache = new WeakMap();

function getDebtorsStmt(db) {
  let cached = debtorsStmtCache.get(db);
  if (!cached) {
    const supportsBillingMonth = hasColumn(db, 'payments', 'billing_month');
    const supportsGroups = hasColumn(db, 'students', 'group_id');
    const supportsEnrollment = hasColumn(db, 'students', 'enrollment_date');

    if (supportsBillingMonth && supportsGroups && supportsEnrollment) {
      cached = {
        stmt: db.prepare(MONTHLY_DEBTORS_QUERY),
        type: 'modern'
      };
    } else {
      cached = {
        stmt: db.prepare(LEGACY_DEBTORS_QUERY),
        type: 'legacy'
      };
    }
    debtorsStmtCache.set(db, cached);
  }
  return cached;
}

/**
 * Calculates and returns debtors for a specified report month (YYYY-MM).
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} reportMonth - Canonical YYYY-MM month string.
 * @returns {Array<{
 *   id: number,
 *   student_id: number,
 *   full_name: string,
 *   monthly_fee: number,
 *   group_id?: number|null,
 *   group_name?: string|null,
 *   total_paid: number,
 *   pending_paid?: number,
 *   debt: number,
 *   status?: string
 * }>}
 */
export function getMonthlyDebtors(db, reportMonth) {
  const validMonth = validateReportMonth(reportMonth);
  const { stmt, type } = getDebtorsStmt(db);

  let rows;
  try {
    if (type === 'modern') {
      rows = stmt.all(validMonth, validMonth);
    } else {
      const { startOfMonth, endOfMonth } = getMonthDateRange(validMonth);
      rows = stmt.all(startOfMonth, endOfMonth);
    }
  } catch (err) {
    if (err && typeof err.message === 'string' && err.message.toLowerCase().includes('integer overflow')) {
      throw new RangeError('Financial calculation overflow detected during monthly payment aggregation.');
    }
    throw err;
  }

  for (const row of rows) {
    if (!Number.isSafeInteger(row.total_paid) || !Number.isSafeInteger(row.debt)) {
      throw new RangeError(
        `Financial calculation overflow detected for student ID ${row.student_id}. Amount exceeds safe integer limits.`
      );
    }
  }

  return rows;
}
