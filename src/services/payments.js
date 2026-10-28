/**
 * Payment service providing parameterized operations with application-level validation.
 */

import { validatePaymentInput, idSchema } from '../validators/index.js';
import { getCurrentUtcIsoString } from '../utils/date.js';

const paymentStmtCache = new WeakMap();

function getPaymentStmts(db) {
  let stmts = paymentStmtCache.get(db);
  if (!stmts) {
    stmts = {
      insert: db.prepare(
        'INSERT INTO payments (student_id, amount, payment_date, created_at) VALUES (?, ?, ?, ?)'
      ),
      byStudent: db.prepare(
        'SELECT id, student_id, amount, payment_date, created_at FROM payments WHERE student_id = ? ORDER BY payment_date ASC, id ASC'
      ),
      list: db.prepare(
        'SELECT id, student_id, amount, payment_date, created_at FROM payments ORDER BY payment_date ASC, id ASC'
      )
    };
    paymentStmtCache.set(db, stmts);
  }
  return stmts;
}

/**
 * Records a new payment using parameterized SQL.
 * Foreign-key constraint ensures student exists, otherwise throws constraint error.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {{ student_id: number, amount: number, payment_date: string }} data
 * @returns {{ id: number, student_id: number, amount: number, payment_date: string, created_at: string }}
 */
export function createPayment(db, data) {
  const validated = validatePaymentInput(data);
  const createdAt = getCurrentUtcIsoString();

  const { insert } = getPaymentStmts(db);
  const info = insert.run(validated.student_id, validated.amount, validated.payment_date, createdAt);

  return {
    id: Number(info.lastInsertRowid),
    student_id: validated.student_id,
    amount: validated.amount,
    payment_date: validated.payment_date,
    created_at: createdAt
  };
}

/**
 * Retrieves all payments for a specific student ordered by payment date and id.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} studentId
 * @returns {Array<{ id: number, student_id: number, amount: number, payment_date: string, created_at: string }>}
 */
export function getPaymentsByStudent(db, studentId) {
  const validStudentId = idSchema.parse(studentId);
  const { byStudent } = getPaymentStmts(db);
  return byStudent.all(validStudentId);
}

/**
 * Retrieves all recorded payments.
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {Array<{ id: number, student_id: number, amount: number, payment_date: string, created_at: string }>}
 */
export function listPayments(db) {
  const { list } = getPaymentStmts(db);
  return list.all();
}
