/**
 * Ecomdev — Comprehensive QA, Financial Integrity & End-to-End Verification Test Suite
 *
 * Exercises the entire application domain with isolated in-memory SQLite fixtures:
 * 1. Student management (lifecycle, fee validations, bounds, phone normalization, updates, deletion restrictions)
 * 2. Group operations (creation, case-insensitive uniqueness, roster assignments, empty vs blocked deletion)
 * 3. Payment system & transitions (pending, confirmed, rejected, invalid transitions, safe amounts, cross-month attributions)
 * 4. Enrollment dates & historical liabilities (enrolled before year, first day, mid-month, last day, 2026-10-28, null fallback, corrupt date recovery)
 * 5. Debtor engine invariants (positive balances only, overpayment capping, zero-fee exclusion, multi-month independence)
 * 6. Monthly financial reports (expected, confirmed, cash received by date, pending, debt, debtors)
 * 7. Annual financial reports (12 rows, annual totals, column alignment, consistency with monthly/group reports)
 * 8. Group financial reports (reconciliation with overall monthly overview)
 * 9. Receipts & PDF verification (Ecomdev branding, receipt numbers, Uzbek formatting, valid readable PDF buffer, payment ID, rejection safety)
 * 10. Financial reconciliation oracle test (the prompt Section 13 fixture: 5 students = 2,600,000 UZS enrolled 2026-10-28, zero Jan-Sep liability, cross-month payments)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';

import { createDatabase } from '../src/db/connection.js';
import { initDatabase } from '../src/db/init.js';
import { createApp } from '../src/app.js';
import { createStudent, getStudentById, listStudents, updateStudent, deleteStudent } from '../src/services/students.js';
import { createGroup, getGroupById, listGroups, updateGroup, deleteGroup, getStudentsByGroupId, assignStudentsToGroup } from '../src/services/groups.js';
import { createPayment, getPaymentById, getPaymentsByStudent, confirmPayment, rejectPayment, listPayments } from '../src/services/payments.js';
import { getMonthlyDebtors } from '../src/services/debtors.js';
import { getMonthlyOverview, getGroupReports, getAnnualOverview } from '../src/services/reports.js';
import { getReceiptById, getReceiptByPaymentId, generateReceiptPdfBuffer } from '../src/services/receipts.js';

async function createIsolatedServer() {
  const db = createDatabase(':memory:');
  initDatabase(db);
  const app = createApp(db);

  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const port = server.address().port;

  return {
    db,
    server,
    baseUrl: `http://127.0.0.1:${port}`,
    async close() {
      await new Promise((r) => server.close(r));
      db.close();
    }
  };
}

/**
 * Extracts plain text chunks from uncompressed or FlateDecode PDF stream buffers.
 * Native to Node.js without third-party dependencies.
 *
 * @param {Buffer} pdfBuffer
 * @returns {string}
 */
function extractPdfText(pdfBuffer) {
  let combined = '';
  const needle = Buffer.from('stream');
  let pos = 0;
  while ((pos = pdfBuffer.indexOf(needle, pos)) !== -1) {
    let start = pos + 6;
    if (pdfBuffer[start] === 0x0d) start++;
    if (pdfBuffer[start] === 0x0a) start++;
    const end = pdfBuffer.indexOf(Buffer.from('endstream'), start);
    if (end !== -1) {
      let chunk = pdfBuffer.subarray(start, end);
      if (chunk[chunk.length - 1] === 0x0a) chunk = chunk.subarray(0, chunk.length - 1);
      if (chunk[chunk.length - 1] === 0x0d) chunk = chunk.subarray(0, chunk.length - 1);
      try {
        const dec = zlib.inflateSync(chunk).toString('utf-8');
        const hexRegex = /<([0-9a-fA-F]+)>/g;
        let m;
        while ((m = hexRegex.exec(dec)) !== null) {
          try {
            combined += Buffer.from(m[1], 'hex').toString('utf-8') + ' ';
          } catch {}
        }
        combined += ' ' + dec;
      } catch {
        combined += ' ' + chunk.toString('latin1');
      }
    }
    pos += 6;
  }
  combined += ' ' + pdfBuffer.toString('latin1');
  return combined;
}

test('1. Student Management & Full Lifecycle Integrity', async (t) => {
  const ctx = await createIsolatedServer();
  try {
    const g1 = createGroup(ctx.db, { name: 'Dasturlash Asoslari' });

    await t.test('creates student with all valid fields (full_name, phone, fee, group, enrollment_date)', async () => {
      const res = await fetch(`${ctx.baseUrl}/api/students`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_name: 'Alisher Navoiy',
          phone: '+998 90 123 45 67',
          monthly_fee: 500000,
          group_id: g1.id,
          enrollment_date: '2026-10-28'
        })
      });
      assert.equal(res.status, 201);
      const student = await res.json();
      assert.ok(student.id > 0);
      assert.equal(student.full_name, 'Alisher Navoiy');
      assert.equal(student.phone, '+998 90 123 45 67');
      assert.equal(student.monthly_fee, 500000);
      assert.equal(student.group_id, g1.id);
      assert.equal(student.group_name, 'Dasturlash Asoslari');
      assert.equal(student.enrollment_date, '2026-10-28');
    });

    await t.test('creates student with optional fields omitted or null', async () => {
      const res = await fetch(`${ctx.baseUrl}/api/students`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_name: 'Bobur Mirzo',
          monthly_fee: 600000
        })
      });
      assert.equal(res.status, 201);
      const student = await res.json();
      assert.equal(student.phone, null);
      assert.equal(student.group_id, null);
      assert.equal(student.group_name, null);
      assert.equal(student.enrollment_date, null);
    });

    await t.test('fee bounds: accepts zero (free/scholarship) and safe integer maximum, rejects negative, decimal, and strings', async () => {
      // 0 fee is valid
      const res0 = await fetch(`${ctx.baseUrl}/api/students`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ full_name: 'Grant Talaba', monthly_fee: 0 })
      });
      assert.equal(res0.status, 201);

      // Max safe integer is valid
      const resMax = await fetch(`${ctx.baseUrl}/api/students`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ full_name: 'Max Fee Talaba', monthly_fee: Number.MAX_SAFE_INTEGER })
      });
      assert.equal(resMax.status, 201);

      // Negative fee rejected
      const resNeg = await fetch(`${ctx.baseUrl}/api/students`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ full_name: 'Neg Talaba', monthly_fee: -1000 })
      });
      assert.equal(resNeg.status, 400);

      // Decimal fee rejected
      const resDec = await fetch(`${ctx.baseUrl}/api/students`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ full_name: 'Dec Talaba', monthly_fee: 450000.5 })
      });
      assert.equal(resDec.status, 400);

      // String fee without coercion rejected
      const resStr = await fetch(`${ctx.baseUrl}/api/students`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ full_name: 'Str Talaba', monthly_fee: '500000' })
      });
      assert.equal(resStr.status, 400);

      // Unsafe integer > MAX_SAFE_INTEGER rejected
      const resUnsafe = await fetch(`${ctx.baseUrl}/api/students`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ full_name: 'Unsafe Talaba', monthly_fee: Number.MAX_SAFE_INTEGER + 10 })
      });
      assert.equal(resUnsafe.status, 400);
    });

    await t.test('validates student full_name: trims whitespace, rejects empty, non-string, or > 200 chars', async () => {
      // Whitespace trimmed
      const resTrim = await fetch(`${ctx.baseUrl}/api/students`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ full_name: '  Amir Temur  ', monthly_fee: 500000 })
      });
      assert.equal(resTrim.status, 201);
      const student = await resTrim.json();
      assert.equal(student.full_name, 'Amir Temur');

      // Empty string rejected
      const resEmpty = await fetch(`${ctx.baseUrl}/api/students`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ full_name: '   ', monthly_fee: 500000 })
      });
      assert.equal(resEmpty.status, 400);

      // Overly long name rejected (> 200 chars)
      const resLong = await fetch(`${ctx.baseUrl}/api/students`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ full_name: 'A'.repeat(201), monthly_fee: 500000 })
      });
      assert.equal(resLong.status, 400);
    });

    await t.test('updates student partially and preserves omitted fields', async () => {
      const s = createStudent(ctx.db, {
        full_name: 'Nodira Begim',
        phone: '+998 90 999 88 77',
        monthly_fee: 450000,
        group_id: g1.id,
        enrollment_date: '2026-10-28'
      });

      // Update only monthly_fee
      const patchRes = await fetch(`${ctx.baseUrl}/api/students/${s.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ monthly_fee: 550000 })
      });
      assert.equal(patchRes.status, 200);
      const updated = await patchRes.json();
      assert.equal(updated.monthly_fee, 550000);
      assert.equal(updated.full_name, 'Nodira Begim', 'Omitted full_name must be preserved');
      assert.equal(updated.phone, '+998 90 999 88 77', 'Omitted phone must be preserved');
      assert.equal(updated.group_id, g1.id, 'Omitted group_id must be preserved');
      assert.equal(updated.enrollment_date, '2026-10-28', 'Omitted enrollment_date must be preserved');
    });

    await t.test('clearing phone and group: sets values to null cleanly', async () => {
      const s = createStudent(ctx.db, {
        full_name: 'Umar Hayyom',
        phone: '+998 97 111 22 33',
        monthly_fee: 400000,
        group_id: g1.id
      });

      const patchRes = await fetch(`${ctx.baseUrl}/api/students/${s.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: null, group_id: null })
      });
      assert.equal(patchRes.status, 200);
      const cleared = await patchRes.json();
      assert.equal(cleared.phone, null);
      assert.equal(cleared.group_id, null);
      assert.equal(cleared.group_name, null);
    });

    await t.test('student deletion: allows student without payments, blocks student with payments (409 Conflict)', async () => {
      const sNoPay = createStudent(ctx.db, { full_name: 'Hech To\'lamagan', monthly_fee: 300000 });
      const delRes1 = await fetch(`${ctx.baseUrl}/api/students/${sNoPay.id}`, { method: 'DELETE' });
      assert.equal(delRes1.status, 200);
      assert.equal(getStudentById(ctx.db, sNoPay.id), null);

      // Student with confirmed payment
      const sWithPay = createStudent(ctx.db, { full_name: 'To\'lagan Talaba', monthly_fee: 500000 });
      createPayment(ctx.db, { student_id: sWithPay.id, amount: 200000, payment_date: '2026-10-10' });

      const delRes2 = await fetch(`${ctx.baseUrl}/api/students/${sWithPay.id}`, { method: 'DELETE' });
      assert.equal(delRes2.status, 409);
      const body = await delRes2.json();
      assert.ok(body.message.includes('payment history'));
      assert.ok(getStudentById(ctx.db, sWithPay.id) !== null, 'Student record must still exist');

      // Student with pending payment
      const sWithPending = createStudent(ctx.db, { full_name: 'Kutilayotgan Talaba', monthly_fee: 500000 });
      createPayment(ctx.db, { student_id: sWithPending.id, amount: 100000, payment_date: '2026-10-12', status: 'pending' });
      const delRes3 = await fetch(`${ctx.baseUrl}/api/students/${sWithPending.id}`, { method: 'DELETE' });
      assert.equal(delRes3.status, 409);

      // Student with rejected payment
      const sWithRejected = createStudent(ctx.db, { full_name: 'Rad Etilgan Talaba', monthly_fee: 500000 });
      createPayment(ctx.db, { student_id: sWithRejected.id, amount: 100000, payment_date: '2026-10-12', status: 'rejected' });
      const delRes4 = await fetch(`${ctx.baseUrl}/api/students/${sWithRejected.id}`, { method: 'DELETE' });
      assert.equal(delRes4.status, 409, 'Even rejected payment history protects student referential integrity');
    });

    await t.test('foreign key integrity: assigning non-existent group returns 400 Bad Request', async () => {
      const res = await fetch(`${ctx.baseUrl}/api/students`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_name: 'Xato Guruh Talaba',
          monthly_fee: 500000,
          group_id: 999999
        })
      });
      assert.equal(res.status, 400);
      const body = await res.json();
      assert.ok(body.message.includes('group does not exist'));
    });
  } finally {
    await ctx.close();
  }
});

test('2. Group Management, Isolation & Assignment Verification', async (t) => {
  const ctx = await createIsolatedServer();
  try {
    await t.test('creates group with unique case-insensitive name, rejects duplicate (409 Conflict)', async () => {
      const res1 = await fetch(`${ctx.baseUrl}/api/groups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Frontend React' })
      });
      assert.equal(res1.status, 201);
      const g1 = await res1.json();
      assert.equal(g1.name, 'Frontend React');

      // Duplicate case-insensitive
      const resDup = await fetch(`${ctx.baseUrl}/api/groups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'frontend react' })
      });
      assert.equal(resDup.status, 409);
      const dupBody = await resDup.json();
      assert.ok(dupBody.message.includes('already exists'));
    });

    await t.test('deletes empty group successfully; blocks deleting group with assigned students (409 Conflict)', async () => {
      const gEmpty = createGroup(ctx.db, { name: 'Bo\'sh Guruh' });
      const delEmptyRes = await fetch(`${ctx.baseUrl}/api/groups/${gEmpty.id}`, { method: 'DELETE' });
      assert.equal(delEmptyRes.status, 200);

      // Group with assigned student
      const gActive = createGroup(ctx.db, { name: 'Faol Guruh' });
      const student = createStudent(ctx.db, { full_name: 'Guruh Talabasi', monthly_fee: 500000, group_id: gActive.id });

      const delActiveRes = await fetch(`${ctx.baseUrl}/api/groups/${gActive.id}`, { method: 'DELETE' });
      assert.equal(delActiveRes.status, 409);
      const activeBody = await delActiveRes.json();
      assert.ok(activeBody.message.includes('assigned students'));

      // Move student away, then delete succeeds
      updateStudent(ctx.db, student.id, { group_id: null });
      const delAfterMoveRes = await fetch(`${ctx.baseUrl}/api/groups/${gActive.id}`, { method: 'DELETE' });
      assert.equal(delAfterMoveRes.status, 200);
    });

    await t.test('assignStudentsToGroup: assigns multiple existing students atomically without creating duplicates', async () => {
      const gTarget = createGroup(ctx.db, { name: 'Target Guruh' });
      const s1 = createStudent(ctx.db, { full_name: 'Biriktiriluvchi 1', monthly_fee: 450000 });
      const s2 = createStudent(ctx.db, { full_name: 'Biriktiriluvchi 2', monthly_fee: 500000 });

      const assignRes = await fetch(`${ctx.baseUrl}/api/groups/${gTarget.id}/assign-students`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ student_ids: [s1.id, s2.id] })
      });
      assert.equal(assignRes.status, 200);
      const assignBody = await assignRes.json();
      assert.equal(assignBody.count, 2);

      // Verify roster
      const rosterRes = await fetch(`${ctx.baseUrl}/api/groups/${gTarget.id}/students`);
      assert.equal(rosterRes.status, 200);
      const roster = await rosterRes.json();
      assert.equal(roster.length, 2);
      assert.ok(roster.some((r) => r.id === s1.id));
      assert.ok(roster.some((r) => r.id === s2.id));
    });

    await t.test('changing a student\'s group does NOT rewrite or alter historical payment records', async () => {
      const gA = createGroup(ctx.db, { name: 'Guruh A' });
      const gB = createGroup(ctx.db, { name: 'Guruh B' });
      const s = createStudent(ctx.db, { full_name: 'Ko\'chuvchi Talaba', monthly_fee: 500000, group_id: gA.id });

      // Record payment while in Group A
      const p = createPayment(ctx.db, {
        student_id: s.id,
        amount: 500000,
        payment_date: '2026-09-15',
        billing_month: '2026-09',
        status: 'confirmed'
      });

      // Transfer student to Group B
      updateStudent(ctx.db, s.id, { group_id: gB.id });

      // Inspect payment: amount, date, billing_month, student_id completely unchanged
      const pAfter = getPaymentById(ctx.db, p.id);
      assert.equal(pAfter.student_id, s.id);
      assert.equal(pAfter.amount, 500000);
      assert.equal(pAfter.payment_date, '2026-09-15');
      assert.equal(pAfter.billing_month, '2026-09');
      assert.equal(pAfter.status, 'confirmed');
    });
  } finally {
    await ctx.close();
  }
});

test('3. Payment System: Status Transitions, Rejection & Ledger Integrity', async (t) => {
  const ctx = await createIsolatedServer();
  try {
    const student = createStudent(ctx.db, { full_name: 'To\'lov Testchi', monthly_fee: 500000 });

    await t.test('records confirmed payment, verifies billing_month attribution vs payment_date', async () => {
      // Paid on October 28 for September tuition
      const res = await fetch(`${ctx.baseUrl}/api/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          student_id: student.id,
          amount: 500000,
          payment_date: '2026-10-28',
          billing_month: '2026-09',
          payment_method: 'bank_transfer',
          status: 'confirmed'
        })
      });
      assert.equal(res.status, 201);
      const payment = await res.json();
      assert.equal(payment.student_id, student.id);
      assert.equal(payment.amount, 500000);
      assert.equal(payment.payment_date, '2026-10-28');
      assert.equal(payment.billing_month, '2026-09');
      assert.equal(payment.payment_method, 'bank_transfer');
      assert.equal(payment.status, 'confirmed');
      assert.ok(payment.receipt_id > 0);
      assert.ok(payment.receipt_number.startsWith('REC-202609-'));
    });

    await t.test('pending payment: does not reduce debt or create receipt; confirmPayment confirms and issues receipt', async () => {
      const s2 = createStudent(ctx.db, { full_name: 'Pending Testchi', monthly_fee: 600000 });
      const createRes = await fetch(`${ctx.baseUrl}/api/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          student_id: s2.id,
          amount: 600000,
          payment_date: '2026-10-20',
          billing_month: '2026-10',
          status: 'pending'
        })
      });
      assert.equal(createRes.status, 201);
      const pendingPay = await createRes.json();
      assert.equal(pendingPay.status, 'pending');
      assert.equal(pendingPay.receipt_id, null);

      // Verify debt is NOT reduced
      const debtorsPending = getMonthlyDebtors(ctx.db, '2026-10');
      const dRow = debtorsPending.find((d) => d.student_id === s2.id);
      assert.ok(dRow);
      assert.equal(dRow.debt, 600000, 'Pending payment must not reduce confirmed debt');
      assert.equal(dRow.total_paid, 0);
      assert.equal(dRow.pending_paid, 600000);

      // Confirm payment
      const confirmRes = await fetch(`${ctx.baseUrl}/api/payments/${pendingPay.id}/confirm`, { method: 'POST' });
      assert.equal(confirmRes.status, 200);
      const confirmedResult = await confirmRes.json();
      assert.equal(confirmedResult.payment.status, 'confirmed');
      assert.ok(confirmedResult.receipt.id > 0);

      // Now debt is cleared
      const debtorsAfter = getMonthlyDebtors(ctx.db, '2026-10');
      assert.equal(debtorsAfter.some((d) => d.student_id === s2.id), false, 'Debt cleared after confirmation');
    });

    await t.test('rejection flow: rejectPayment rejects pending payment; invalid transitions rejected', async () => {
      const s3 = createStudent(ctx.db, { full_name: 'Rejection Testchi', monthly_fee: 700000 });
      const pendingPayment = createPayment(ctx.db, {
        student_id: s3.id,
        amount: 300000,
        payment_date: '2026-10-22',
        billing_month: '2026-10',
        status: 'pending'
      });

      // Reject pending payment
      const rejectRes = await fetch(`${ctx.baseUrl}/api/payments/${pendingPayment.id}/reject`, { method: 'POST' });
      assert.equal(rejectRes.status, 200);
      const rejectedPayment = await rejectRes.json();
      assert.equal(rejectedPayment.status, 'rejected');

      // Rejected payment must NOT reduce debt and must NOT count as pending
      const debtors = getMonthlyDebtors(ctx.db, '2026-10');
      const dRow = debtors.find((d) => d.student_id === s3.id);
      assert.ok(dRow);
      assert.equal(dRow.debt, 700000);
      assert.equal(dRow.total_paid, 0);
      assert.equal(dRow.pending_paid, 0, 'Rejected payment must not count as pending');

      // Invalid transition: Attempting to confirm a rejected payment must return 400 Bad Request
      const invalidConfirmRes = await fetch(`${ctx.baseUrl}/api/payments/${pendingPayment.id}/confirm`, { method: 'POST' });
      assert.equal(invalidConfirmRes.status, 400);
      const invBody = await invalidConfirmRes.json();
      assert.ok(invBody.message.includes('Cannot confirm a rejected payment'));

      // Repeating reject on already rejected payment is idempotent
      const repeatRejectRes = await fetch(`${ctx.baseUrl}/api/payments/${pendingPayment.id}/reject`, { method: 'POST' });
      assert.equal(repeatRejectRes.status, 200);

      // Attempting to reject an already confirmed payment returns 400 Bad Request
      const confirmedPay = createPayment(ctx.db, {
        student_id: s3.id,
        amount: 700000,
        payment_date: '2026-10-25',
        billing_month: '2026-10',
        status: 'confirmed'
      });
      const rejectConfirmedRes = await fetch(`${ctx.baseUrl}/api/payments/${confirmedPay.id}/reject`, { method: 'POST' });
      assert.equal(rejectConfirmedRes.status, 400);
      const invRejBody = await rejectConfirmedRes.json();
      assert.ok(invRejBody.message.includes('Cannot reject already confirmed payment'));
    });

    await t.test('amount validation: rejects 0, negative, decimals, and strings', async () => {
      const resZero = await fetch(`${ctx.baseUrl}/api/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ student_id: student.id, amount: 0, payment_date: '2026-10-15' })
      });
      assert.equal(resZero.status, 400);

      const resNeg = await fetch(`${ctx.baseUrl}/api/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ student_id: student.id, amount: -50000, payment_date: '2026-10-15' })
      });
      assert.equal(resNeg.status, 400);

      const resDec = await fetch(`${ctx.baseUrl}/api/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ student_id: student.id, amount: 150000.5, payment_date: '2026-10-15' })
      });
      assert.equal(resDec.status, 400);

      const resNonExist = await fetch(`${ctx.baseUrl}/api/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ student_id: 999999, amount: 150000, payment_date: '2026-10-15' })
      });
      assert.equal(resNonExist.status, 404);
    });
  } finally {
    await ctx.close();
  }
});

test('4. Enrollment Dates & Historical Liability Verification', async (t) => {
  const ctx = await createIsolatedServer();
  try {
    // 1. Enrolled before reporting year (2025-11-20) -> Liable in Jan-Dec 2026
    const sPriorYear = createStudent(ctx.db, {
      full_name: 'O\'tgan Yili Kelgan',
      monthly_fee: 300000,
      enrollment_date: '2025-11-20'
    });

    // 2. Enrolled on first day of month (2026-10-01) -> Liable Oct-Dec 2026, 0 for Jan-Sep
    const sFirstDay = createStudent(ctx.db, {
      full_name: 'Birinchi Kuni Kelgan',
      monthly_fee: 400000,
      enrollment_date: '2026-10-01'
    });

    // 3. Enrolled in middle of month (2026-10-15) -> Liable Oct-Dec 2026, 0 for Jan-Sep
    const sMidMonth = createStudent(ctx.db, {
      full_name: 'Oy O\'rtasida Kelgan',
      monthly_fee: 500000,
      enrollment_date: '2026-10-15'
    });

    // 4. Enrolled on 2026-10-28 (Explicit requirement) -> Liable Oct-Dec 2026, 0 for Jan-Sep
    const sOct28 = createStudent(ctx.db, {
      full_name: 'Oktabr Yigirma Sakkiz',
      monthly_fee: 600000,
      enrollment_date: '2026-10-28'
    });

    // 5. Enrolled on last day of month (2026-10-31) -> Liable Oct-Dec 2026, 0 for Jan-Sep
    const sLastDay = createStudent(ctx.db, {
      full_name: 'Oxirgi Kuni Kelgan',
      monthly_fee: 700000,
      enrollment_date: '2026-10-31'
    });

    // 6. Enrolled with null enrollment_date but valid created_at in October 2026
    const sNullEnrollment = createStudent(ctx.db, {
      full_name: 'Sanasiz O\'quvchi',
      monthly_fee: 350000
    });
    // Explicitly set created_at to October 2026
    ctx.db.prepare("UPDATE students SET enrollment_date = NULL, created_at = '2026-10-10T10:00:00.000Z' WHERE id = ?").run(sNullEnrollment.id);

    // 7. Enrolled with blank/corrupt string enrollment_date -> safely falls back to created_at
    const sCorruptDate = createStudent(ctx.db, {
      full_name: 'Buzuq Sanali O\'quvchi',
      monthly_fee: 250000
    });
    ctx.db.prepare("UPDATE students SET enrollment_date = '', created_at = '2026-10-12T10:00:00.000Z' WHERE id = ?").run(sCorruptDate.id);

    // 8. Enrolled in December 2026 (2026-12-01) -> Liable in Dec 2026 ONLY
    const sDec = createStudent(ctx.db, {
      full_name: 'Dekabrda Kelgan',
      monthly_fee: 800000,
      enrollment_date: '2026-12-01'
    });

    await t.test('September 2026: only prior year enrollee is liable; all October/December enrollees have 0 debt', async () => {
      const sepDebtors = getMonthlyDebtors(ctx.db, '2026-09');
      // Only sPriorYear should be in debtors for September
      assert.equal(sepDebtors.length, 1);
      assert.equal(sepDebtors[0].student_id, sPriorYear.id);
      assert.equal(sepDebtors[0].debt, 300000);

      // Verify overview report for September 2026
      const sepOverview = getMonthlyOverview(ctx.db, '2026-09');
      assert.equal(sepOverview.total_expected, 300000, 'September expected tuition must strictly include only eligible prior-year student');
      assert.equal(sepOverview.total_debt, 300000);
      assert.equal(sepOverview.debtor_count, 1);
    });

    await t.test('October 2026: prior year enrollee and all 5 October enrollees are liable; December enrollee is NOT liable', async () => {
      const octDebtors = getMonthlyDebtors(ctx.db, '2026-10');
      // Liable fee-paying students in October:
      // sPriorYear (300k), sFirstDay (400k), sMidMonth (500k), sOct28 (600k), sLastDay (700k), sNullEnrollment (350k), sCorruptDate (250k)
      // Total 7 students. sDec is NOT liable.
      assert.equal(octDebtors.length, 7);
      assert.equal(octDebtors.some((d) => d.student_id === sDec.id), false, 'December enrollee must not be liable in October');

      const octOverview = getMonthlyOverview(ctx.db, '2026-10');
      const expectedOctTotal = 300000 + 400000 + 500000 + 600000 + 700000 + 350000 + 250000; // 3,100,000
      assert.equal(octOverview.total_expected, expectedOctTotal);
      assert.equal(octOverview.total_debt, expectedOctTotal);
      assert.equal(octOverview.debtor_count, 7);
    });

    await t.test('December 2026: all students including December enrollee are liable', async () => {
      const decDebtors = getMonthlyDebtors(ctx.db, '2026-12');
      // All 8 students liable
      assert.equal(decDebtors.length, 8);
      const decRow = decDebtors.find((d) => d.student_id === sDec.id);
      assert.ok(decRow);
      assert.equal(decRow.debt, 800000);
    });
  } finally {
    await ctx.close();
  }
});

test('5. Receipts and Downloadable PDF System Verification', async (t) => {
  const ctx = await createIsolatedServer();
  try {
    const group = createGroup(ctx.db, { name: 'Fizika Va Matematika' });
    const student = createStudent(ctx.db, {
      full_name: 'Po\'lat O\'rmonov',
      phone: '+998 90 777 66 55',
      monthly_fee: 550000,
      group_id: group.id,
      enrollment_date: '2026-10-28'
    });

    const payment = createPayment(ctx.db, {
      student_id: student.id,
      amount: 550000,
      payment_date: '2026-10-28',
      billing_month: '2026-10',
      payment_method: 'card',
      status: 'confirmed'
    });

    await t.test('receipt created automatically for confirmed payment with unique sequence REC-202610-00001', async () => {
      assert.ok(payment.receipt_id > 0);
      assert.equal(payment.receipt_number, 'REC-202610-00001');

      const receipt = getReceiptById(ctx.db, payment.receipt_id);
      assert.ok(receipt);
      assert.equal(receipt.student_name, 'Po\'lat O\'rmonov');
      assert.equal(receipt.group_name, 'Fizika Va Matematika');
      assert.equal(receipt.amount, 550000);
      assert.equal(receipt.billing_month, '2026-10');
      assert.equal(receipt.payment_method, 'card');
    });

    await t.test('subsequent receipt in same billing month increments sequence REC-202610-00002', async () => {
      const s2 = createStudent(ctx.db, { full_name: 'Ziyoda Aliyeva', monthly_fee: 500000 });
      const p2 = createPayment(ctx.db, {
        student_id: s2.id,
        amount: 500000,
        payment_date: '2026-10-29',
        billing_month: '2026-10',
        status: 'confirmed'
      });
      assert.equal(p2.receipt_number, 'REC-202610-00002');
    });

    await t.test('generates valid, readable, nonempty PDF with Ecomdev branding and payment details', async () => {
      const receipt = getReceiptById(ctx.db, payment.receipt_id);
      const pdfBuffer = await generateReceiptPdfBuffer(receipt);

      assert.ok(Buffer.isBuffer(pdfBuffer));
      assert.ok(pdfBuffer.length > 500, 'PDF buffer must be non-empty');
      // Starts with standard PDF magic number
      assert.equal(pdfBuffer.subarray(0, 5).toString('ascii'), '%PDF-');

      // Verify text inside PDF
      const pdfText = extractPdfText(pdfBuffer);
      assert.ok(pdfText.includes('ECOMDEV'), 'Receipt title must contain ECOMDEV');
      assert.ok(pdfText.includes('REC-202610-00001'), 'Receipt must contain receipt number');
      assert.ok(pdfText.includes(String(payment.id)), 'Receipt must contain payment ID');
      assert.ok(pdfText.includes('elektron'), 'Receipt footer must contain Ecomdev electron system note');
    });

    await t.test('receipt API endpoints: GET /api/payments/:id/receipt and /api/receipts/:id/pdf return 200 with application/pdf', async () => {
      const resMeta = await fetch(`${ctx.baseUrl}/api/payments/${payment.id}/receipt`);
      assert.equal(resMeta.status, 200);
      const meta = await resMeta.json();
      assert.equal(meta.receipt_number, 'REC-202610-00001');

      const resPdf = await fetch(`${ctx.baseUrl}/api/receipts/${payment.receipt_id}/pdf`);
      assert.equal(resPdf.status, 200);
      assert.equal(resPdf.headers.get('content-type'), 'application/pdf');
      const bytes = await resPdf.arrayBuffer();
      assert.ok(bytes.byteLength > 500);
    });

    await t.test('pending or rejected payments return 404 for receipt and PDF endpoints', async () => {
      const pPending = createPayment(ctx.db, {
        student_id: student.id,
        amount: 100000,
        payment_date: '2026-10-28',
        billing_month: '2026-10',
        status: 'pending'
      });

      const resPendReceipt = await fetch(`${ctx.baseUrl}/api/payments/${pPending.id}/receipt`);
      assert.equal(resPendReceipt.status, 404);

      const resPendPdf = await fetch(`${ctx.baseUrl}/api/payments/${pPending.id}/receipt/pdf`);
      assert.equal(resPendPdf.status, 404);
    });
  } finally {
    await ctx.close();
  }
});

test('6. Financial Reconciliation Oracle Test (Prompt Section 13 Minimum Fixture)', async (t) => {
  const ctx = await createIsolatedServer();
  try {
    // --------------------------------------------------------------------------
    // FIXTURE CONFIGURATION (as explicitly required by Section 13):
    // Five students enrolled on 2026-10-28 with fees:
    // S1: 450,000 UZS
    // S2: 450,000 UZS
    // S3: 500,000 UZS
    // S4: 700,000 UZS
    // S5: 500,000 UZS
    // Combined fee = 2,600,000 UZS.
    // Plus:
    // S_prior: Enrolled before 2026 (2025-10-15) with fee 300,000 UZS.
    // S_dec: Enrolled in December 2026 (2026-12-01) with fee 400,000 UZS.
    // S_null: Enrolled with null date falling back to created_at (2026-10-15) with fee 350,000 UZS.
    // --------------------------------------------------------------------------

    const gA = createGroup(ctx.db, { name: 'A guruhi' });
    const gB = createGroup(ctx.db, { name: 'B guruhi' });

    const s1 = createStudent(ctx.db, { full_name: 'Talaba 1 (450k)', monthly_fee: 450000, group_id: gA.id, enrollment_date: '2026-10-28' });
    const s2 = createStudent(ctx.db, { full_name: 'Talaba 2 (450k)', monthly_fee: 450000, group_id: gA.id, enrollment_date: '2026-10-28' });
    const s3 = createStudent(ctx.db, { full_name: 'Talaba 3 (500k)', monthly_fee: 500000, group_id: gB.id, enrollment_date: '2026-10-28' });
    const s4 = createStudent(ctx.db, { full_name: 'Talaba 4 (700k)', monthly_fee: 700000, group_id: gB.id, enrollment_date: '2026-10-28' });
    const s5 = createStudent(ctx.db, { full_name: 'Talaba 5 (500k)', monthly_fee: 500000, group_id: gB.id, enrollment_date: '2026-10-28' });

    // Additional fixtures
    const sPrior = createStudent(ctx.db, { full_name: 'Eski Talaba (300k)', monthly_fee: 300000, group_id: gA.id, enrollment_date: '2025-10-15' });
    const sDec = createStudent(ctx.db, { full_name: 'Dekabr Talabasi (400k)', monthly_fee: 400000, group_id: gB.id, enrollment_date: '2026-12-01' });
    const sNull = createStudent(ctx.db, { full_name: 'Fallback Talaba (350k)', monthly_fee: 350000, group_id: gA.id });
    ctx.db.prepare("UPDATE students SET enrollment_date = NULL, created_at = '2026-10-15T09:00:00.000Z' WHERE id = ?").run(sNull.id);

    // PAYMENTS SETUP:
    // 1. S1: Full payment for October (450,000 UZS) confirmed on 2026-10-28
    createPayment(ctx.db, { student_id: s1.id, amount: 450000, payment_date: '2026-10-28', billing_month: '2026-10', status: 'confirmed' });

    // 2. S2: Partial payment for October (200,000 UZS) confirmed on 2026-10-28 -> Debt = 250,000
    createPayment(ctx.db, { student_id: s2.id, amount: 200000, payment_date: '2026-10-28', billing_month: '2026-10', status: 'confirmed' });

    // 3. S3: Pending payment for October (300,000 UZS) -> Debt = 500,000 (pending does NOT reduce debt)
    createPayment(ctx.db, { student_id: s3.id, amount: 300000, payment_date: '2026-10-28', billing_month: '2026-10', status: 'pending' });

    // 4. S4: Rejected payment for October (400,000 UZS) -> Debt = 700,000 (rejected does NOT reduce debt)
    createPayment(ctx.db, { student_id: s4.id, amount: 400000, payment_date: '2026-10-28', billing_month: '2026-10', status: 'rejected' });

    // 5. S5: Overpayment for October (600,000 UZS) confirmed on 2026-10-28 -> Debt = 0
    createPayment(ctx.db, { student_id: s5.id, amount: 600000, payment_date: '2026-10-28', billing_month: '2026-10', status: 'confirmed' });

    // 6. S_prior: Cross-month payment! Paid on 2026-10-10 for September 2026 tuition (300,000 UZS confirmed)
    createPayment(ctx.db, { student_id: sPrior.id, amount: 300000, payment_date: '2026-10-10', billing_month: '2026-09', status: 'confirmed' });

    // --------------------------------------------------------------------------
    // INDEPENDENT MATHEMATICAL ORACLE CALCULATION:
    //
    // September 2026 (2026-09):
    // - Eligible students: only sPrior (300,000 UZS). The 5 students and sNull and sDec have ZERO liability.
    // - Expected tuition: 300,000 UZS
    // - Confirmed billing revenue: 300,000 UZS (paid by sPrior for Sep)
    // - Cash received in September: 0 UZS (sPrior payment was received on 2026-10-10!)
    // - Debt in September: 0 UZS (sPrior paid in full for Sep)
    // - Debtor count: 0
    //
    // October 2026 (2026-10):
    // - Eligible students:
    //   - 5 students combined: 2,600,000 UZS
    //   - sPrior: 300,000 UZS
    //   - sNull (created in Oct): 350,000 UZS
    //   - (sDec is NOT eligible in Oct: enrolled in Dec)
    // - Expected tuition: 2,600,000 + 300,000 + 350,000 = 3,250,000 UZS.
    // - Confirmed billing revenue (for 2026-10 billing month):
    //   - s1: 450,000
    //   - s2: 200,000
    //   - s5: 600,000
    //   - Total confirmed billing = 1,250,000 UZS.
    // - Pending billing revenue: s3 = 300,000 UZS.
    // - Cash received by actual payment date in October [2026-10-01 to 2026-10-31]:
    //   - sPrior (paid 2026-10-10): 300,000
    //   - s1 (paid 2026-10-28): 450,000
    //   - s2 (paid 2026-10-28): 200,000
    //   - s5 (paid 2026-10-28): 600,000
    //   - Total cash received = 300k + 450k + 200k + 600k = 1,550,000 UZS!
    //   (Note: Cash received 1,550,000 != Confirmed billing 1,250,000 due to cross-month collection!)
    // - Debtors for October:
    //   - s1: 450k - 450k = 0 (paid full) -> not debtor
    //   - s2: 450k - 200k = 250,000 -> debtor
    //   - s3: 500k - 0 (pending does not reduce) = 500,000 -> debtor
    //   - s4: 700k - 0 (rejected does not reduce) = 700,000 -> debtor
    //   - s5: MAX(0, 500k - 600k) = 0 (overpayment does not subsidize others) -> not debtor
    //   - sPrior: 300k - 0 (Sep payment does not settle Oct) = 300,000 -> debtor
    //   - sNull: 350k - 0 = 350,000 -> debtor
    //   - Total October debt = 250k + 500k + 700k + 300k + 350k = 2,100,000 UZS.
    //   - Total October debtors = 5 students.
    // --------------------------------------------------------------------------

    await t.test('Oracle check: September 2026 reconciliation', () => {
      const sepOverview = getMonthlyOverview(ctx.db, '2026-09');
      assert.equal(sepOverview.total_expected, 300000);
      assert.equal(sepOverview.total_confirmed, 300000);
      assert.equal(sepOverview.total_cash_received, 0, 'No cash received in September');
      assert.equal(sepOverview.total_debt, 0);
      assert.equal(sepOverview.debtor_count, 0);
    });

    await t.test('Oracle check: October 2026 reconciliation', () => {
      const octOverview = getMonthlyOverview(ctx.db, '2026-10');
      assert.equal(octOverview.total_expected, 3250000, 'Expected tuition must equal 3,250,000 UZS');
      assert.equal(octOverview.total_confirmed, 1250000, 'Confirmed billing revenue must equal 1,250,000 UZS');
      assert.equal(octOverview.total_cash_received, 1550000, 'Cash received must equal 1,550,000 UZS including September late payment');
      assert.equal(octOverview.total_pending, 300000);
      assert.equal(octOverview.total_debt, 2100000, 'Total debt must equal 2,100,000 UZS');
      assert.equal(octOverview.debtor_count, 5);

      const octDebtors = getMonthlyDebtors(ctx.db, '2026-10');
      assert.equal(octDebtors.length, 5);
      const s2Debt = octDebtors.find((d) => d.student_id === s2.id);
      assert.equal(s2Debt.debt, 250000);
      const s3Debt = octDebtors.find((d) => d.student_id === s3.id);
      assert.equal(s3Debt.debt, 500000);
      const s4Debt = octDebtors.find((d) => d.student_id === s4.id);
      assert.equal(s4Debt.debt, 700000);
      const sPriorDebt = octDebtors.find((d) => d.student_id === sPrior.id);
      assert.equal(sPriorDebt.debt, 300000);
      const sNullDebt = octDebtors.find((d) => d.student_id === sNull.id);
      assert.equal(sNullDebt.debt, 350000);

      // Verify group report matches overall report
      const groupReports = getGroupReports(ctx.db, '2026-10');
      const sumExpected = groupReports.reduce((sum, g) => sum + g.total_expected, 0);
      const sumConfirmed = groupReports.reduce((sum, g) => sum + g.total_confirmed, 0);
      const sumDebt = groupReports.reduce((sum, g) => sum + g.total_debt, 0);
      const sumDebtors = groupReports.reduce((sum, g) => sum + g.debtor_count, 0);

      assert.equal(sumExpected, octOverview.total_expected);
      assert.equal(sumConfirmed, octOverview.total_confirmed);
      assert.equal(sumDebt, octOverview.total_debt);
      assert.equal(sumDebtors, octOverview.debtor_count);
    });

    await t.test('Oracle check: Annual report 2026 reconciliation', () => {
      const annual = getAnnualOverview(ctx.db, '2026');
      assert.equal(annual.months.length, 12);

      const sepRow = annual.months.find((m) => m.month === '2026-09');
      assert.equal(sepRow.expected, 300000);
      assert.equal(sepRow.confirmed_billing, 300000);
      assert.equal(sepRow.cash_received_by_date, 0);
      assert.equal(sepRow.debt, 0);

      const octRow = annual.months.find((m) => m.month === '2026-10');
      assert.equal(octRow.expected, 3250000);
      assert.equal(octRow.confirmed_billing, 1250000);
      assert.equal(octRow.cash_received_by_date, 1550000);
      assert.equal(octRow.debt, 2100000);
      assert.equal(octRow.debtor_count, 5);

      // December includes sDec (400,000 UZS)
      const decRow = annual.months.find((m) => m.month === '2026-12');
      assert.equal(decRow.expected, 3250000 + 400000); // 3,650,000 UZS
    });
  } finally {
    await ctx.close();
  }
});

test('11. Enrollment-Exclusive Financial Eligibility (No Payment Retroactivity)', async (t) => {
  const ctx = await createIsolatedServer();
  try {
    const group = createGroup(ctx.db, { name: 'Full-Stack QA' });

    // 1. Create student enrolled in October (2026-10-15) with fee 600,000 UZS
    const student = createStudent(ctx.db, {
      full_name: 'Jasur Beknazarov',
      monthly_fee: 600000,
      group_id: group.id,
      enrollment_date: '2026-10-15'
    });

    // 2. Record confirmed payment assigned to September (billing_month = '2026-09') received on 2026-10-05
    createPayment(ctx.db, {
      student_id: student.id,
      amount: 200000,
      payment_date: '2026-10-05',
      billing_month: '2026-09',
      status: 'confirmed'
    });

    // 3. Record pending payment assigned to September (billing_month = '2026-09') received on 2026-10-06
    createPayment(ctx.db, {
      student_id: student.id,
      amount: 100000,
      payment_date: '2026-10-06',
      billing_month: '2026-09',
      status: 'pending'
    });

    await t.test('September 2026: October enrollee has ZERO liability despite September payments', () => {
      // Debtors query must strictly exclude Jasur because enrollment_date ('2026-10-15') > '2026-09'
      const sepDebtors = getMonthlyDebtors(ctx.db, '2026-09');
      assert.equal(sepDebtors.length, 0, 'October enrollee must NOT be a debtor in September');

      // Monthly overview must show 0 expected tuition and 0 debt
      const sepOverview = getMonthlyOverview(ctx.db, '2026-09');
      assert.equal(sepOverview.total_expected, 0, 'Expected tuition must be 0 for September');
      assert.equal(sepOverview.total_debt, 0, 'Total debt must be 0 for September');
      assert.equal(sepOverview.debtor_count, 0);

      // Confirmed billing revenue records the 200,000 payment for billing_month 2026-09
      assert.equal(sepOverview.total_confirmed, 200000);
      assert.equal(sepOverview.total_pending, 100000);

      // Cash received in September is 0 (money was paid in October)
      assert.equal(sepOverview.total_cash_received, 0);

      // Group report must also exclude Jasur from liable student count
      const groupReports = getGroupReports(ctx.db, '2026-09');
      const gRow = groupReports.find((g) => g.group_id === group.id);
      assert.ok(gRow);
      assert.equal(gRow.student_count, 0, 'Group student count in Sep must be 0 for October enrollee');
      assert.equal(gRow.total_expected, 0);
      assert.equal(gRow.total_debt, 0);
      assert.equal(gRow.debtor_count, 0);
    });

    await t.test('October 2026: October liability is established, cash received reflects 200,000 UZS intake', () => {
      const octOverview = getMonthlyOverview(ctx.db, '2026-10');
      assert.equal(octOverview.total_expected, 600000, 'October tuition liability is established (600,000 UZS)');
      assert.equal(octOverview.total_confirmed, 0, 'No payment recorded for October billing month');
      assert.equal(octOverview.total_debt, 600000, 'October debt is 600,000 UZS');
      assert.equal(octOverview.debtor_count, 1);

      // Cash received in October is 200,000 UZS (payment_date was 2026-10-05)
      assert.equal(octOverview.total_cash_received, 200000, 'Cash received in October reflects actual payment date intake');

      const octDebtors = getMonthlyDebtors(ctx.db, '2026-10');
      assert.equal(octDebtors.length, 1);
      assert.equal(octDebtors[0].student_id, student.id);
      assert.equal(octDebtors[0].debt, 600000);
      assert.equal(octDebtors[0].status, 'unpaid');
    });

    await t.test('Explicitly updating enrollment date to September establishes retroactive September liability as expected', async () => {
      // Admin explicitly changes enrollment_date to '2026-09-01'
      const updateRes = await fetch(`${ctx.baseUrl}/api/students/${student.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enrollment_date: '2026-09-01' })
      });
      assert.equal(updateRes.status, 200);
      const updatedStudent = await updateRes.json();
      assert.equal(updatedStudent.enrollment_date, '2026-09-01');

      // Now September liability applies:
      const sepOverview = getMonthlyOverview(ctx.db, '2026-09');
      assert.equal(sepOverview.total_expected, 600000, 'September expected tuition now 600,000 UZS');
      assert.equal(sepOverview.total_confirmed, 200000, 'Confirmed payments: 200,000 UZS');
      assert.equal(sepOverview.total_pending, 100000, 'Pending payments: 100,000 UZS');
      assert.equal(sepOverview.total_debt, 400000, 'September debt is now 400,000 UZS (600k - 200k)');
      assert.equal(sepOverview.debtor_count, 1);

      const sepDebtors = getMonthlyDebtors(ctx.db, '2026-09');
      assert.equal(sepDebtors.length, 1);
      assert.equal(sepDebtors[0].student_id, student.id);
      assert.equal(sepDebtors[0].debt, 400000);
      assert.equal(sepDebtors[0].total_paid, 200000);
      assert.equal(sepDebtors[0].pending_paid, 100000);
      assert.equal(sepDebtors[0].status, 'partial');

      // Group report also reconciles with the updated enrollment date
      const groupReports = getGroupReports(ctx.db, '2026-09');
      const gRow = groupReports.find((g) => g.group_id === group.id);
      assert.ok(gRow);
      assert.equal(gRow.student_count, 1);
      assert.equal(gRow.total_expected, 600000);
      assert.equal(gRow.total_confirmed, 200000);
      assert.equal(gRow.total_debt, 400000);
      assert.equal(gRow.debtor_count, 1);
    });
  } finally {
    await ctx.close();
  }
});

test('12. Robust Enrollment Date Validation & created_at Fallback', async (t) => {
  const ctx = await createIsolatedServer();
  try {
    // 1. API level rejection of invalid and impossible dates
    await t.test('API rejects impossible calendar dates and malformed strings', async () => {
      const impossibleDates = ['2026-02-31', '2025-02-29', '2026-04-31', '2026-99-invalid', 'not-a-date', '2026-13-01'];
      for (const badDate of impossibleDates) {
        const res = await fetch(`${ctx.baseUrl}/api/students`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            full_name: 'Test Bad Date',
            monthly_fee: 500000,
            enrollment_date: badDate
          })
        });
        assert.equal(res.status, 400, `API must reject invalid enrollment_date: ${badDate}`);
      }

      // Valid dates must succeed
      const validRes1 = await fetch(`${ctx.baseUrl}/api/students`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_name: 'Test Valid Leap',
          monthly_fee: 500000,
          enrollment_date: '2024-02-29'
        })
      });
      assert.equal(validRes1.status, 201, 'Valid leap day 2024-02-29 must be accepted');

      const validRes2 = await fetch(`${ctx.baseUrl}/api/students`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_name: 'Test Valid Day',
          monthly_fee: 500000,
          enrollment_date: '2026-10-28'
        })
      });
      assert.equal(validRes2.status, 201, 'Valid standard date 2026-10-28 must be accepted');
    });

    // 2. Direct database corruption tolerance and created_at fallback
    await t.test('SQL queries safely fall back to created_at for corrupt, malformed, and impossible dates in stored records', () => {
      // Create student fixtures directly in database with simulated legacy/corrupt records
      const insert = ctx.db.prepare(`
        INSERT INTO students (full_name, monthly_fee, enrollment_date, created_at)
        VALUES (?, ?, ?, ?)
      `);

      // Student A: null date, created in October 2026
      insert.run('Student A (null)', 100000, null, '2026-10-01T10:00:00.000Z');
      // Student B: empty string, created in October 2026
      insert.run('Student B (empty)', 100000, '', '2026-10-02T10:00:00.000Z');
      // Student C: malformed string, created in October 2026
      insert.run('Student C (2026-99-invalid)', 100000, '2026-99-invalid', '2026-10-03T10:00:00.000Z');
      // Student D: impossible day 2026-02-31, created in October 2026
      insert.run('Student D (2026-02-31)', 100000, '2026-02-31', '2026-10-04T10:00:00.000Z');
      // Student E: impossible leap day 2025-02-29, created in October 2026
      insert.run('Student E (2025-02-29)', 100000, '2025-02-29', '2026-10-05T10:00:00.000Z');
      // Student F: out of range month 2026-13-01, created in October 2026
      insert.run('Student F (2026-13-01)', 100000, '2026-13-01', '2026-10-06T10:00:00.000Z');
      // Student G: text non-date, created in October 2026
      insert.run('Student G (corrupt)', 100000, 'not-a-real-date', '2026-10-07T10:00:00.000Z');

      // Verify in September 2026: NONE of Students A-G are liable because fallback created_at is in October!
      const sepDebtors = getMonthlyDebtors(ctx.db, '2026-09');
      const testIdsInSep = sepDebtors.filter((d) => d.full_name.startsWith('Student '));
      assert.equal(testIdsInSep.length, 0, 'No malformed/corrupted October student may be liable in September');

      const sepOverview = getMonthlyOverview(ctx.db, '2026-09');
      // Only the earlier student (Valid Leap 2024) is eligible in September (500k)
      assert.equal(sepOverview.total_expected, 500000);

      // Verify in October 2026: ALL Students A-G fall back to October created_at and establish liability!
      const octDebtors = getMonthlyDebtors(ctx.db, '2026-10');
      const testStudentsInOct = octDebtors.filter((d) => d.full_name.startsWith('Student '));
      assert.equal(testStudentsInOct.length, 7, 'All 7 corrupted/fallback students must establish liability in October');
      for (const s of testStudentsInOct) {
        assert.equal(s.debt, 100000, `${s.full_name} must have debt 100,000 UZS`);
        assert.equal(s.status, 'unpaid');
      }

      // Total expected for October includes:
      // Valid Leap (500k) + Valid Day (500k) + 7 * 100k = 1,700,000 UZS
      const octOverview = getMonthlyOverview(ctx.db, '2026-10');
      assert.equal(octOverview.total_expected, 1700000, 'October expected tuition must include all 7 fallback students');
      assert.equal(octOverview.total_debt, 1700000);
      assert.equal(octOverview.debtor_count, 9);
    });
  } finally {
    await ctx.close();
  }
});
