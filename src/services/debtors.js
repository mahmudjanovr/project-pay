/**
 * Monthly debtor calculation service for Project Pay.
 * Identifies students with outstanding debt for a given calendar month using strictly parameterized SQL.
 */

import { validateReportMonth } from '../validators/index.js';
import { getMonthDateRange } from '../utils/date.js';

/**
 * SQL query to calculate monthly debtors.
 * - Computes total payments for each student within [startOfMonth, startOfNextMonth).
 * - Debt = MAX(0, monthly_fee - total_paid).
 * - Restricts to students where total_paid < monthly_fee.
 * - Uses LEFT JOIN and COALESCE so students with no payments are retained.
 * - Integer arithmetic for financial values.
 */
export const MONTHLY_DEBTORS_QUERY = `
  SELECT
    s.id,
    s.id AS student_id,
    s.full_name,
    s.monthly_fee,
    COALESCE(p.total_paid, 0) AS total_paid,
    MAX(0, s.monthly_fee - COALESCE(p.total_paid, 0)) AS debt
  FROM students s
  LEFT JOIN (
    SELECT
      student_id,
      SUM(amount) AS total_paid
    FROM payments
    WHERE payment_date >= ? AND payment_date < ?
    GROUP BY student_id
  ) p ON s.id = p.student_id
  WHERE COALESCE(p.total_paid, 0) < s.monthly_fee
  ORDER BY s.id ASC;
`;

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
 *   total_paid: number,
 *   debt: number
 * }>}
 */
export function getMonthlyDebtors(db, reportMonth) {
  // Validate report month format and calendar range
  const validMonth = validateReportMonth(reportMonth);
  const { startOfMonth, startOfNextMonth } = getMonthDateRange(validMonth);

  const stmt = db.prepare(MONTHLY_DEBTORS_QUERY);
  return stmt.all(startOfMonth, startOfNextMonth);
}
