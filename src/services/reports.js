/**
 * Reporting service for Project Pay.
 * Provides monthly overview, group-level breakdown, and annual overview reports
 * with strict reconciliation against debtor calculations.
 */

import { validateReportMonth, validateReportYear } from '../validators/index.js';
import { getMonthlyDebtors } from './debtors.js';
import { getMonthDateRange } from '../utils/date.js';

const UZBEK_MONTH_NAMES = [
  'Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun',
  'Iyul', 'Avgust', 'Sentyabr', 'Oktyabr', 'Noyabr', 'Dekabr'
];

/**
 * Returns overall monthly financial metrics for a selected billing month.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} reportMonth - Format: YYYY-MM
 * @returns {Object}
 */
export function getMonthlyOverview(db, reportMonth) {
  const validMonth = validateReportMonth(reportMonth);

  // 1. Liable fee-paying students count and total expected tuition
  const liableStmt = db.prepare(`
    SELECT
      COUNT(*) AS total_students,
      COUNT(CASE WHEN monthly_fee > 0 THEN 1 END) AS fee_paying_students,
      COALESCE(SUM(monthly_fee), 0) AS total_expected
    FROM students
    WHERE (enrollment_date IS NULL OR substr(enrollment_date, 1, 7) <= ?);
  `);
  const liableInfo = liableStmt.get(validMonth);
  const totalExpected = Number(liableInfo.total_expected);
  const feePayingStudents = Number(liableInfo.fee_paying_students);

  // 2. Confirmed & pending payment sums for this billing month
  const paymentsStmt = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN COALESCE(status, 'confirmed') = 'confirmed' THEN amount ELSE 0 END), 0) AS total_confirmed,
      COALESCE(SUM(CASE WHEN status = 'pending' THEN amount ELSE 0 END), 0) AS total_pending,
      COUNT(CASE WHEN status = 'pending' THEN 1 END) AS pending_count
    FROM payments
    WHERE COALESCE(billing_month, substr(payment_date, 1, 7)) = ?;
  `);
  const paymentInfo = paymentsStmt.get(validMonth);
  const totalConfirmed = Number(paymentInfo.total_confirmed);
  const totalPending = Number(paymentInfo.total_pending);
  const pendingCount = Number(paymentInfo.pending_count);

  // 3. Debtors from the authoritative debtor calculation engine
  const debtors = getMonthlyDebtors(db, validMonth);
  let totalDebtBigInt = 0n;
  for (const d of debtors) {
    if (Number.isSafeInteger(d.debt) && d.debt > 0) {
      totalDebtBigInt += BigInt(d.debt);
    }
  }
  const totalDebt = Number(totalDebtBigInt);
  const debtorCount = debtors.length;
  const fullyPaidCount = Math.max(0, feePayingStudents - debtorCount);

  // Collection percentage (0 - 100)
  const collectionRate = totalExpected > 0
    ? Math.min(100, Math.round((totalConfirmed / totalExpected) * 100))
    : 100;

  return {
    month: validMonth,
    total_expected: totalExpected,
    total_confirmed: totalConfirmed,
    total_pending: totalPending,
    total_debt: totalDebt,
    debtor_count: debtorCount,
    fully_paid_count: fullyPaidCount,
    pending_count: pendingCount,
    collection_rate: collectionRate
  };
}

/**
 * Returns group-level breakdown for a selected billing month.
 * Group figures reconcile completely with the overall monthly report.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} reportMonth - Format: YYYY-MM
 * @returns {Array<Object>}
 */
export function getGroupReports(db, reportMonth) {
  const validMonth = validateReportMonth(reportMonth);

  // Load all groups
  const groups = db.prepare('SELECT id, name FROM groups ORDER BY name COLLATE NOCASE ASC').all();

  // Load all liable students with their group and payments for this billing month
  const studentsStmt = db.prepare(`
    SELECT
      s.id,
      s.full_name,
      s.phone,
      s.monthly_fee,
      s.group_id,
      g.name AS group_name,
      COALESCE(p.total_paid, 0) AS total_paid,
      COALESCE(p.pending_paid, 0) AS pending_paid,
      MAX(0, s.monthly_fee - COALESCE(p.total_paid, 0)) AS debt
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
    WHERE (s.enrollment_date IS NULL OR substr(s.enrollment_date, 1, 7) <= ?)
    ORDER BY s.full_name COLLATE NOCASE ASC;
  `);

  const allLiableStudents = studentsStmt.all(validMonth, validMonth);

  // Group students by group_id
  const studentMap = new Map();
  for (const s of allLiableStudents) {
    const gid = s.group_id !== null ? s.group_id : 'unassigned';
    if (!studentMap.has(gid)) {
      studentMap.set(gid, []);
    }
    studentMap.get(gid).push({
      ...s,
      total_paid: Number(s.total_paid),
      pending_paid: Number(s.pending_paid),
      debt: Number(s.debt),
      status: s.monthly_fee === 0 ? 'exempt'
            : s.debt === 0 ? 'paid'
            : s.total_paid === 0 ? (s.pending_paid > 0 ? 'pending' : 'unpaid')
            : 'partial'
    });
  }

  const result = [];

  for (const group of groups) {
    const groupStudents = studentMap.get(group.id) || [];
    let expectedSum = 0n;
    let confirmedSum = 0n;
    let pendingSum = 0n;
    let debtSum = 0n;
    let debtorCount = 0;

    for (const st of groupStudents) {
      expectedSum += BigInt(st.monthly_fee);
      confirmedSum += BigInt(st.total_paid);
      pendingSum += BigInt(st.pending_paid);
      debtSum += BigInt(st.debt);
      if (st.monthly_fee > 0 && st.debt > 0) {
        debtorCount += 1;
      }
    }

    result.push({
      group_id: group.id,
      group_name: group.name,
      student_count: groupStudents.length,
      total_expected: Number(expectedSum),
      total_confirmed: Number(confirmedSum),
      total_pending: Number(pendingSum),
      total_debt: Number(debtSum),
      debtor_count: debtorCount,
      students: groupStudents
    });
  }

  // Include unassigned students if any
  const unassigned = studentMap.get('unassigned') || [];
  if (unassigned.length > 0) {
    let unassignedExpected = 0n;
    let unassignedConfirmed = 0n;
    let unassignedPending = 0n;
    let unassignedDebt = 0n;
    let unassignedDebtors = 0;

    for (const st of unassigned) {
      unassignedExpected += BigInt(st.monthly_fee);
      unassignedConfirmed += BigInt(st.total_paid);
      unassignedPending += BigInt(st.pending_paid);
      unassignedDebt += BigInt(st.debt);
      if (st.monthly_fee > 0 && st.debt > 0) {
        unassignedDebtors += 1;
      }
    }

    result.push({
      group_id: null,
      group_name: 'Guruhsiz',
      student_count: unassigned.length,
      total_expected: Number(unassignedExpected),
      total_confirmed: Number(unassignedConfirmed),
      total_pending: Number(unassignedPending),
      total_debt: Number(unassignedDebt),
      debtor_count: unassignedDebtors,
      students: unassigned
    });
  }

  return result;
}

/**
 * Returns annual financial overview broken down across all 12 calendar months.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} reportYear - Format: YYYY
 * @returns {{ year: string, months: Array<Object>, totals: Object }}
 */
export function getAnnualOverview(db, reportYear) {
  const validYear = validateReportYear(reportYear);

  const months = [];
  let totalExpected = 0n;
  let totalConfirmed = 0n;
  let totalPending = 0n;
  let totalDebt = 0n;
  let totalCashReceived = 0n;

  for (let m = 1; m <= 12; m++) {
    const monthNum = String(m).padStart(2, '0');
    const monthStr = `${validYear}-${monthNum}`;
    const monthName = UZBEK_MONTH_NAMES[m - 1];

    const overview = getMonthlyOverview(db, monthStr);

    // Cash received by actual payment receipt date within this calendar month
    const { startOfMonth, endOfMonth } = getMonthDateRange(monthStr);
    const cashStmt = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) AS total_cash
      FROM payments
      WHERE payment_date >= ? AND payment_date <= ?
        AND COALESCE(status, 'confirmed') = 'confirmed';
    `);
    const cashRow = cashStmt.get(startOfMonth, endOfMonth);
    const cashReceived = Number(cashRow.total_cash);

    totalExpected += BigInt(overview.total_expected);
    totalConfirmed += BigInt(overview.total_confirmed);
    totalPending += BigInt(overview.total_pending);
    totalDebt += BigInt(overview.total_debt);
    totalCashReceived += BigInt(cashReceived);

    months.push({
      month: monthStr,
      month_name: monthName,
      expected: overview.total_expected,
      confirmed_billing: overview.total_confirmed,
      pending_billing: overview.total_pending,
      debt: overview.total_debt,
      debtor_count: overview.debtor_count,
      cash_received_by_date: cashReceived
    });
  }

  return {
    year: validYear,
    months,
    totals: {
      total_expected: Number(totalExpected),
      total_confirmed_billing: Number(totalConfirmed),
      total_pending_billing: Number(totalPending),
      total_debt: Number(totalDebt),
      total_cash_received: Number(totalCashReceived)
    }
  };
}
