/**
 * Comprehensive integration and unit test suite for:
 * - Priority 1: Correct monthly tuition debt calculations across independent billing months
 * - Priority 2: Overall, group-level, and annual reports reconciliation
 * - Priority 3: Payment confirmation, idempotent receipt generation, and PDF streaming
 * - Priority 4: Existing student group assignment and duplicate protection
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createDatabase } from '../src/db/connection.js';
import { initDatabase } from '../src/db/init.js';
import { createApp } from '../src/app.js';
import { createStudent, listStudents } from '../src/services/students.js';
import { createGroup, getStudentsByGroupId } from '../src/services/groups.js';
import { createPayment, confirmPayment, getPaymentsByStudent } from '../src/services/payments.js';
import { getMonthlyDebtors } from '../src/services/debtors.js';
import { getMonthlyOverview, getGroupReports, getAnnualOverview } from '../src/services/reports.js';
import { getReceiptById, generateReceiptPdfBuffer } from '../src/services/receipts.js';

async function createTestServer() {
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

test('Priority 1: Isolated deterministic fixtures for September, October, November, December 2026', async (t) => {
  const db = createDatabase(':memory:');
  initDatabase(db);

  // Groups
  const g1 = createGroup(db, { name: 'Matematika' });
  const g2 = createGroup(db, { name: 'Fizika' });

  // 1. Registered student with no payments (liable in all months)
  const sUnpaid = createStudent(db, {
    full_name: 'Anvar Qodirov',
    monthly_fee: 500000,
    group_id: g1.id
  });

  // 2. Fully paid student in September, unpaid in other months
  const sPaidSep = createStudent(db, {
    full_name: 'Barno Karimova',
    monthly_fee: 600000,
    group_id: g1.id
  });
  createPayment(db, {
    student_id: sPaidSep.id,
    amount: 600000,
    payment_date: '2026-09-05',
    billing_month: '2026-09',
    status: 'confirmed'
  });

  // 3. Partially paid student in September (150k out of 400k)
  const sPartial = createStudent(db, {
    full_name: 'Dildora Sobirova',
    monthly_fee: 400000,
    group_id: g2.id
  });
  createPayment(db, {
    student_id: sPartial.id,
    amount: 150000,
    payment_date: '2026-09-10',
    billing_month: '2026-09',
    status: 'confirmed'
  });

  // 4. Student with pending payment (200k) in September -> must NOT reduce debt
  const sPending = createStudent(db, {
    full_name: 'Eldor Ergashev',
    monthly_fee: 500000,
    group_id: g2.id
  });
  createPayment(db, {
    student_id: sPending.id,
    amount: 200000,
    payment_date: '2026-09-12',
    billing_month: '2026-09',
    status: 'pending' // unconfirmed
  });

  // 5. Student with payment attributed to October (500k) -> does NOT reduce September debt
  const sPaidOct = createStudent(db, {
    full_name: 'Farhod Toshev',
    monthly_fee: 500000,
    group_id: g2.id
  });
  createPayment(db, {
    student_id: sPaidOct.id,
    amount: 500000,
    payment_date: '2026-09-28', // Paid late September for October
    billing_month: '2026-10',   // Attributed strictly to October
    status: 'confirmed'
  });

  // 6. Student with zero tuition (scholarship/exempt) -> never a debtor
  const sExempt = createStudent(db, {
    full_name: 'Gulnoza Grant',
    monthly_fee: 0,
    group_id: g1.id
  });

  // 7. Student enrolled in November 2026 -> not liable in Sep or Oct; liable in Nov and Dec!
  const sLateEnrolled = createStudent(db, {
    full_name: 'Husan NoyabrdaKelgan',
    monthly_fee: 450000,
    group_id: g1.id,
    enrollment_date: '2026-11-01'
  });

  await t.test('September 2026 (2026-09): verifies exact expected debtors and financial totals', () => {
    const sepDebtors = getMonthlyDebtors(db, '2026-09');

    // Liable fee-paying students in Sep: sUnpaid, sPaidSep (paid), sPartial, sPending, sPaidOct.
    // sLateEnrolled is NOT liable yet. sExempt is 0 fee.
    // Debtors in Sep:
    // - sUnpaid: debt 500,000 (paid 0)
    // - sPartial: debt 250,000 (paid 150,000)
    // - sPending: debt 500,000 (pending 200,000 does NOT reduce debt)
    // - sPaidOct: debt 500,000 (October payment does NOT reduce Sep debt)
    // Total debtors in Sep: 4
    assert.equal(sepDebtors.length, 4, 'September must have exactly 4 debtors');

    const unpaidRow = sepDebtors.find((d) => d.student_id === sUnpaid.id);
    assert.ok(unpaidRow);
    assert.equal(unpaidRow.debt, 500000);
    assert.equal(unpaidRow.total_paid, 0);

    const partialRow = sepDebtors.find((d) => d.student_id === sPartial.id);
    assert.ok(partialRow);
    assert.equal(partialRow.debt, 250000);
    assert.equal(partialRow.total_paid, 150000);

    const pendingRow = sepDebtors.find((d) => d.student_id === sPending.id);
    assert.ok(pendingRow);
    assert.equal(pendingRow.debt, 500000, 'Pending payment must not reduce remaining debt');
    assert.equal(pendingRow.total_paid, 0);
    assert.equal(pendingRow.pending_paid, 200000);

    const octPayerRow = sepDebtors.find((d) => d.student_id === sPaidOct.id);
    assert.ok(octPayerRow);
    assert.equal(octPayerRow.debt, 500000, 'October payment must not reduce September debt');
    assert.equal(octPayerRow.total_paid, 0);

    // Paid student, exempt student, and November-enrolled student must NOT be debtors in September
    assert.equal(sepDebtors.some((d) => d.student_id === sPaidSep.id), false);
    assert.equal(sepDebtors.some((d) => d.student_id === sExempt.id), false);
    assert.equal(sepDebtors.some((d) => d.student_id === sLateEnrolled.id), false, 'Not liable yet');
  });

  await t.test('October 2026 (2026-10): independent calculations where sPaidOct is cleared', () => {
    const octDebtors = getMonthlyDebtors(db, '2026-10');

    // In October:
    // - sPaidOct paid 500,000 for October -> Debt = 0, NOT a debtor!
    // - sPaidSep paid in September, but has 0 payment for October -> Debt = 600,000, IS a debtor!
    // - sUnpaid: Debt = 500,000
    // - sPartial: Debt = 400,000 (Sep partial payment does not count for Oct)
    // - sPending: Debt = 500,000
    // - sLateEnrolled: NOT enrolled yet -> NOT a debtor
    // Total debtors in Oct: 4 (sUnpaid, sPaidSep, sPartial, sPending)
    assert.equal(octDebtors.length, 4);

    assert.equal(octDebtors.some((d) => d.student_id === sPaidOct.id), false, 'Full October payment clears October debt');
    const sepPayerInOct = octDebtors.find((d) => d.student_id === sPaidSep.id);
    assert.ok(sepPayerInOct, 'Student who paid in September is a debtor in October');
    assert.equal(sepPayerInOct.debt, 600000);

    assert.equal(octDebtors.some((d) => d.student_id === sLateEnrolled.id), false, 'November student not liable in October');
  });

  await t.test('November 2026 (2026-11): sLateEnrolled is now enrolled and liable', () => {
    const novDebtors = getMonthlyDebtors(db, '2026-11');

    // In November, no one has paid.
    // Liable fee-paying students: sUnpaid (500k), sPaidSep (600k), sPartial (400k), sPending (500k), sPaidOct (500k), sLateEnrolled (450k)
    // Total debtors in Nov: 6
    assert.equal(novDebtors.length, 6);

    const novLate = novDebtors.find((d) => d.student_id === sLateEnrolled.id);
    assert.ok(novLate, 'November-enrolled student must be a debtor in November');
    assert.equal(novLate.debt, 450000);
  });

  await t.test('December 2026 (2026-12): zero-payment month reflects full debts for all liable students', () => {
    const decDebtors = getMonthlyDebtors(db, '2026-12');
    assert.equal(decDebtors.length, 6);

    const totalDecDebt = decDebtors.reduce((sum, d) => sum + d.debt, 0);
    // 500 + 600 + 400 + 500 + 500 + 450 = 2,950,000
    assert.equal(totalDecDebt, 2950000);
  });
});

test('Priority 2: Reporting interface reconciliation (Overall vs Group-level vs Annual)', async (t) => {
  const ctx = await createTestServer();
  try {
    const g1 = createGroup(ctx.db, { name: 'Guruh Alpha' });
    const g2 = createGroup(ctx.db, { name: 'Guruh Beta' });

    // Group 1: 2 students
    const s1 = createStudent(ctx.db, { full_name: 'Talaba Bir', monthly_fee: 1000000, group_id: g1.id });
    const s2 = createStudent(ctx.db, { full_name: 'Talaba Ikki', monthly_fee: 800000, group_id: g1.id });

    // Group 2: 2 students
    const s3 = createStudent(ctx.db, { full_name: 'Talaba Uch', monthly_fee: 500000, group_id: g2.id });
    const s4 = createStudent(ctx.db, { full_name: 'Talaba To\'rt', monthly_fee: 700000, group_id: g2.id });

    // Unassigned: 1 student
    const s5 = createStudent(ctx.db, { full_name: 'Guruhsiz Talaba', monthly_fee: 400000 });

    // Payments for 2026-10:
    // s1: 1,000,000 confirmed (fully paid)
    createPayment(ctx.db, { student_id: s1.id, amount: 1000000, payment_date: '2026-10-05', billing_month: '2026-10', status: 'confirmed' });
    // s2: 300,000 confirmed, 200,000 pending (partial)
    createPayment(ctx.db, { student_id: s2.id, amount: 300000, payment_date: '2026-10-10', billing_month: '2026-10', status: 'confirmed' });
    createPayment(ctx.db, { student_id: s2.id, amount: 200000, payment_date: '2026-10-12', billing_month: '2026-10', status: 'pending' });
    // s3: 500,000 confirmed (fully paid)
    createPayment(ctx.db, { student_id: s3.id, amount: 500000, payment_date: '2026-10-15', billing_month: '2026-10', status: 'confirmed' });
    // s4: 0 paid
    // s5: 100,000 confirmed
    createPayment(ctx.db, { student_id: s5.id, amount: 100000, payment_date: '2026-10-20', billing_month: '2026-10', status: 'confirmed' });

    // Test GET /api/reports/overview?month=2026-10
    const overviewRes = await fetch(`${ctx.baseUrl}/api/reports/overview?month=2026-10`);
    assert.equal(overviewRes.status, 200);
    const overview = await overviewRes.json();

    // Total expected = 1000 + 800 + 500 + 700 + 400 = 3,400,000
    assert.equal(overview.total_expected, 3400000);
    // Total confirmed = 1000 + 300 + 500 + 100 = 1,900,000
    assert.equal(overview.total_confirmed, 1900000);
    // Total pending = 200,000
    assert.equal(overview.total_pending, 200000);
    assert.equal(overview.pending_count, 1);
    // Total debt:
    // s1: 0 (paid full)
    // s2: 500,000 (800 - 300)
    // s3: 0 (paid full)
    // s4: 700,000
    // s5: 300,000 (400 - 100)
    // Total debt = 1,500,000
    assert.equal(overview.total_debt, 1500000);
    assert.equal(overview.debtor_count, 3);
    assert.equal(overview.fully_paid_count, 2);

    // Test GET /api/reports/groups?month=2026-10
    const groupsRes = await fetch(`${ctx.baseUrl}/api/reports/groups?month=2026-10`);
    assert.equal(groupsRes.status, 200);
    const groupsReport = await groupsRes.json();

    // Reconcile group report sum with overview
    const sumExpected = groupsReport.reduce((s, g) => s + g.total_expected, 0);
    const sumConfirmed = groupsReport.reduce((s, g) => s + g.total_confirmed, 0);
    const sumPending = groupsReport.reduce((s, g) => s + g.total_pending, 0);
    const sumDebt = groupsReport.reduce((s, g) => s + g.total_debt, 0);
    const sumDebtors = groupsReport.reduce((s, g) => s + g.debtor_count, 0);

    assert.equal(sumExpected, overview.total_expected, 'Group expected sum must reconcile with overall expected');
    assert.equal(sumConfirmed, overview.total_confirmed, 'Group confirmed sum must reconcile with overall confirmed');
    assert.equal(sumPending, overview.total_pending, 'Group pending sum must reconcile with overall pending');
    assert.equal(sumDebt, overview.total_debt, 'Group debt sum must reconcile with overall debt');
    assert.equal(sumDebtors, overview.debtor_count, 'Group debtor count sum must reconcile with overall debtor count');

    // Test GET /api/reports/annual?year=2026
    const annualRes = await fetch(`${ctx.baseUrl}/api/reports/annual?year=2026`);
    assert.equal(annualRes.status, 200);
    const annual = await annualRes.json();
    assert.equal(annual.months.length, 12);
    const octMonth = annual.months.find((m) => m.month === '2026-10');
    assert.ok(octMonth);
    assert.equal(octMonth.confirmed_billing, overview.total_confirmed);
    assert.equal(octMonth.debt, overview.total_debt);
  } finally {
    await ctx.close();
  }
});

test('Priority 3: Payment confirmation, idempotent receipts, and PDF streaming', async (t) => {
  const ctx = await createTestServer();
  try {
    const student = createStudent(ctx.db, {
      full_name: 'Sherzod Aliyev',
      monthly_fee: 500000
    });

    // 1. Create a payment with status 'pending'
    const createPendingRes = await fetch(`${ctx.baseUrl}/api/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        student_id: student.id,
        amount: 300000,
        payment_date: '2026-10-15',
        billing_month: '2026-10',
        payment_method: 'cash',
        status: 'pending'
      })
    });
    assert.equal(createPendingRes.status, 201);
    const pendingPayment = await createPendingRes.json();
    assert.equal(pendingPayment.status, 'pending');
    assert.equal(pendingPayment.receipt_id, null, 'Pending payment must not have a receipt');

    // Verify debt has NOT decreased
    const debtorsPendingRes = await fetch(`${ctx.baseUrl}/api/reports/debtors?month=2026-10`);
    const debtorsPending = await debtorsPendingRes.json();
    assert.equal(debtorsPending.length, 1);
    assert.equal(debtorsPending[0].debt, 500000, 'Pending payment must not reduce confirmed debt');

    // 2. Confirm the payment via POST /api/payments/:id/confirm
    const confirmRes = await fetch(`${ctx.baseUrl}/api/payments/${pendingPayment.id}/confirm`, {
      method: 'POST'
    });
    assert.equal(confirmRes.status, 200);
    const confirmResult = await confirmRes.json();
    assert.equal(confirmResult.payment.status, 'confirmed');
    assert.ok(confirmResult.receipt.id);
    assert.ok(confirmResult.receipt.receipt_number.startsWith('REC-202610-'));

    // 3. Confirm again (idempotent / duplicate protection) -> returns same receipt
    const confirmRepeatRes = await fetch(`${ctx.baseUrl}/api/payments/${pendingPayment.id}/confirm`, {
      method: 'POST'
    });
    assert.equal(confirmRepeatRes.status, 200);
    const confirmRepeat = await confirmRepeatRes.json();
    assert.equal(confirmRepeat.receipt.receipt_number, confirmResult.receipt.receipt_number);
    assert.equal(confirmRepeat.receipt.id, confirmResult.receipt.id);

    // 4. Verify debt has now decreased for October only
    const debtorsAfterRes = await fetch(`${ctx.baseUrl}/api/reports/debtors?month=2026-10`);
    const debtorsAfter = await debtorsAfterRes.json();
    assert.equal(debtorsAfter.length, 1);
    assert.equal(debtorsAfter[0].debt, 200000, 'Confirmed payment reduces debt');

    // 5. Test PDF streaming endpoint
    const pdfRes = await fetch(`${ctx.baseUrl}/api/receipts/${confirmResult.receipt.id}/pdf`);
    assert.equal(pdfRes.status, 200);
    assert.equal(pdfRes.headers.get('content-type'), 'application/pdf');
    const pdfBuffer = await pdfRes.arrayBuffer();
    assert.ok(pdfBuffer.byteLength > 500);
    const header = Buffer.from(pdfBuffer.slice(0, 5)).toString();
    assert.equal(header, '%PDF-', 'Must return valid PDF bytes');

    // 6. Test GET /api/payments/:id/receipt/pdf alias
    const paymentPdfRes = await fetch(`${ctx.baseUrl}/api/payments/${pendingPayment.id}/receipt/pdf`);
    assert.equal(paymentPdfRes.status, 200);
    assert.equal(paymentPdfRes.headers.get('content-type'), 'application/pdf');

    // 7. Student payment history lists receipt metadata
    const histRes = await fetch(`${ctx.baseUrl}/api/students/${student.id}/payments`);
    const hist = await histRes.json();
    assert.equal(hist.length, 1);
    assert.equal(hist[0].receipt_number, confirmResult.receipt.receipt_number);
    assert.equal(hist[0].status, 'confirmed');
  } finally {
    await ctx.close();
  }
});

test('Priority 4: Assign existing students to groups', async (t) => {
  const ctx = await createTestServer();
  try {
    const groupA = createGroup(ctx.db, { name: 'Ingliz tili B2' });
    const groupB = createGroup(ctx.db, { name: 'Koreys tili Topik' });

    const s1 = createStudent(ctx.db, { full_name: 'Mavjud Talaba Bir', monthly_fee: 400000 });
    const s2 = createStudent(ctx.db, { full_name: 'Mavjud Talaba Ikki', monthly_fee: 450000 });
    const s3 = createStudent(ctx.db, { full_name: 'Mavjud Talaba Uch', monthly_fee: 500000, group_id: groupA.id });

    // Assign s1 and s2 to groupA
    const assignRes = await fetch(`${ctx.baseUrl}/api/groups/${groupA.id}/assign-students`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        student_ids: [s1.id, s2.id]
      })
    });
    assert.equal(assignRes.status, 200);
    const assignData = await assignRes.json();
    assert.equal(assignData.count, 2);

    // Verify groupA now has 3 students
    const groupStudentsRes = await fetch(`${ctx.baseUrl}/api/groups/${groupA.id}/students`);
    const groupStudents = await groupStudentsRes.json();
    assert.equal(groupStudents.length, 3);
    const assignedIds = groupStudents.map((s) => s.id);
    assert.ok(assignedIds.includes(s1.id));
    assert.ok(assignedIds.includes(s2.id));
    assert.ok(assignedIds.includes(s3.id));

    // Reassign s1 to groupB
    const reassignRes = await fetch(`${ctx.baseUrl}/api/groups/${groupB.id}/assign-students`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        student_ids: [s1.id]
      })
    });
    assert.equal(reassignRes.status, 200);

    const bStudentsRes = await fetch(`${ctx.baseUrl}/api/groups/${groupB.id}/students`);
    const bStudents = await bStudentsRes.json();
    assert.equal(bStudents.length, 1);
    assert.equal(bStudents[0].id, s1.id);

    // Reject non-existent student ID
    const badStudentRes = await fetch(`${ctx.baseUrl}/api/groups/${groupA.id}/assign-students`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        student_ids: [999999]
      })
    });
    assert.equal(badStudentRes.status, 404);

    // Reject empty student_ids list
    const emptyListRes = await fetch(`${ctx.baseUrl}/api/groups/${groupA.id}/assign-students`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        student_ids: []
      })
    });
    assert.equal(emptyListRes.status, 400);
  } finally {
    await ctx.close();
  }
});
