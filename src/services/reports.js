/**
 * Annual and aggregate reporting service for Project Pay.
 * Computes exact annual payment collections and 12-month breakdowns from underlying records.
 */

import { validateReportYear } from '../validators/index.js';

const UZBEK_MONTH_NAMES = [
  'Yanvar',
  'Fevral',
  'Mart',
  'Aprel',
  'May',
  'Iyun',
  'Iyul',
  'Avgust',
  'Sentabr',
  'Oktabr',
  'Noyabr',
  'Dekabr'
];

/**
 * Computes the annual report for a specified calendar year.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string|number} rawYear - 4-digit calendar year (e.g. 2026).
 * @returns {{
 *   year: number,
 *   total_collected: number,
 *   payment_count: number,
 *   paying_student_count: number,
 *   active_students_count: number,
 *   total_expected_year: number,
 *   total_debt_year: number,
 *   months: Array<{
 *     month: string,
 *     month_name: string,
 *     month_index: number,
 *     total_collected: number,
 *     payment_count: number,
 *     paying_student_count: number,
 *     debtor_count: number,
 *     fully_paid_count: number,
 *     total_expected: number,
 *     total_debt: number
 *   }>
 * }}
 */
export function getAnnualReport(db, rawYear) {
  const year = validateReportYear(rawYear);
  const startOfYear = `${year}-01-01`;
  const endOfYear = `${year}-12-31`;

  // 1. All active fee-paying students (students with monthly_fee > 0)
  const students = db.prepare(`
    SELECT id, monthly_fee
    FROM students
    WHERE monthly_fee > 0
    ORDER BY id ASC
  `).all();

  // 2. Overall payment statistics for the year
  const overallRow = db.prepare(`
    SELECT
      COALESCE(SUM(amount), 0) AS total_collected,
      COUNT(id) AS payment_count,
      COUNT(DISTINCT student_id) AS paying_student_count
    FROM payments
    WHERE payment_date >= ? AND payment_date <= ?
  `).get(startOfYear, endOfYear);

  // 3. Payment statistics grouped by month
  const monthlyStatsRows = db.prepare(`
    SELECT
      substr(payment_date, 1, 7) AS month_str,
      COALESCE(SUM(amount), 0) AS total_collected,
      COUNT(id) AS payment_count,
      COUNT(DISTINCT student_id) AS paying_student_count
    FROM payments
    WHERE payment_date >= ? AND payment_date <= ?
    GROUP BY substr(payment_date, 1, 7)
  `).all(startOfYear, endOfYear);

  const monthlyStatsMap = new Map();
  for (const row of monthlyStatsRows) {
    monthlyStatsMap.set(row.month_str, row);
  }

  // 4. Payments grouped by month and student for debt calculation
  const studentMonthRows = db.prepare(`
    SELECT
      substr(payment_date, 1, 7) AS month_str,
      student_id,
      COALESCE(SUM(amount), 0) AS total_paid
    FROM payments
    WHERE payment_date >= ? AND payment_date <= ?
    GROUP BY substr(payment_date, 1, 7), student_id
  `).all(startOfYear, endOfYear);

  const studentMonthPaidMap = new Map();
  for (const row of studentMonthRows) {
    studentMonthPaidMap.set(`${row.month_str}:${row.student_id}`, Number(row.total_paid));
  }

  // 5. Build 12-month array (January through December)
  let totalDebtYear = 0;
  let totalExpectedYear = 0;
  const months = [];

  for (let m = 1; m <= 12; m++) {
    const monthPadded = String(m).padStart(2, '0');
    const monthStr = `${year}-${monthPadded}`;
    const stats = monthlyStatsMap.get(monthStr);

    const totalCollected = stats ? Number(stats.total_collected) : 0;
    const paymentCount = stats ? Number(stats.payment_count) : 0;
    const payingStudentCount = stats ? Number(stats.paying_student_count) : 0;

    let monthExpected = 0;
    let monthDebt = 0;
    let debtorCount = 0;
    let fullyPaidCount = 0;

    for (const s of students) {
      const fee = Number(s.monthly_fee);
      monthExpected += fee;
      const paid = studentMonthPaidMap.get(`${monthStr}:${s.id}`) || 0;
      const debt = Math.max(0, fee - paid);
      if (debt > 0) {
        debtorCount++;
        monthDebt += debt;
      } else {
        fullyPaidCount++;
      }
    }

    totalExpectedYear += monthExpected;
    totalDebtYear += monthDebt;

    months.push({
      month: monthStr,
      month_name: UZBEK_MONTH_NAMES[m - 1],
      month_index: m,
      total_collected: totalCollected,
      payment_count: paymentCount,
      paying_student_count: payingStudentCount,
      debtor_count: debtorCount,
      fully_paid_count: fullyPaidCount,
      total_expected: monthExpected,
      total_debt: monthDebt
    });
  }

  const result = {
    year,
    total_collected: Number(overallRow.total_collected),
    payment_count: Number(overallRow.payment_count),
    paying_student_count: Number(overallRow.paying_student_count),
    active_students_count: students.length,
    total_expected_year: totalExpectedYear,
    total_debt_year: totalDebtYear,
    months
  };

  // Safe integer guards
  if (!Number.isSafeInteger(result.total_collected) || !Number.isSafeInteger(result.total_debt_year)) {
    throw new RangeError('Financial calculation overflow detected during annual report aggregation.');
  }

  return result;
}
