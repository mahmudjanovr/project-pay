import test from 'node:test';
import assert from 'node:assert/strict';

import { createApp } from '../src/app.js';
import { createDatabase } from '../src/db/connection.js';
import { initDatabase } from '../src/db/init.js';
import { createStudent } from '../src/services/students.js';
import { createPayment } from '../src/services/payments.js';
import { getMonthlyDebtors } from '../src/services/debtors.js';
import { getAnnualReport } from '../src/services/reports.js';

function createTestContext() {
  const db = createDatabase(':memory:');
  initDatabase(db);
  const app = createApp(db);
  const server = app.listen(0);
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  return {
    db,
    app,
    server,
    baseUrl,
    close: () => server.close()
  };
}

test('Monthly Debt Report API & Calculation Regressions', async (t) => {
  const ctx = createTestContext();
  t.after(() => ctx.close());

  // Setup Students:
  // Student 1: 500,000 UZS fee
  // Student 2: 700,000 UZS fee
  // Student 3: 0 UZS fee (scholarship)
  const s1 = createStudent(ctx.db, { full_name: 'Dilorom Alieva', monthly_fee: 500000 });
  const s2 = createStudent(ctx.db, { full_name: 'Bekzod Qodirov', monthly_fee: 700000 });
  const s3 = createStudent(ctx.db, { full_name: 'Grant Talaba', monthly_fee: 0 });

  // In September 2026 (2026-09):
  // s1 pays 500,000 (fully paid)
  // s2 pays 200,000 (partial payment, debt = 500,000)
  createPayment(ctx.db, { student_id: s1.id, amount: 500000, payment_date: '2026-09-10' });
  createPayment(ctx.db, { student_id: s2.id, amount: 200000, payment_date: '2026-09-20' });

  // In October 2026 (2026-10):
  // s1 pays 100,000 (partial payment, debt = 400,000)
  // s2 pays 700,000 (fully paid, debt = 0)
  createPayment(ctx.db, { student_id: s1.id, amount: 100000, payment_date: '2026-10-05' });
  createPayment(ctx.db, { student_id: s2.id, amount: 700000, payment_date: '2026-10-18' });

  // In November 2026 (2026-11):
  // s1 pays 250,000 (partial payment, debt = 250,000)
  // s2 pays 350,000 (partial payment, debt = 350,000)
  createPayment(ctx.db, { student_id: s1.id, amount: 250000, payment_date: '2026-11-08' });
  createPayment(ctx.db, { student_id: s2.id, amount: 350000, payment_date: '2026-11-22' });

  // In December 2026 (2026-12):
  // s1 pays 0 (debt = 500,000)
  // s2 pays 150,000 (partial payment, debt = 550,000)
  createPayment(ctx.db, { student_id: s2.id, amount: 150000, payment_date: '2026-12-14' });

  await t.test('Four distinct months (Sep, Oct, Nov, Dec 2026) return four distinct expected results', async () => {
    // 1. September 2026 check: 1 debtor (s2), debt = 500,000, paid = 200,000
    const sepRes = await fetch(`${ctx.baseUrl}/api/reports/debtors?month=2026-09`);
    assert.equal(sepRes.status, 200);
    assert.ok(sepRes.headers.get('cache-control')?.includes('no-store'));
    const sepDebtors = await sepRes.json();
    assert.equal(sepDebtors.length, 1);
    assert.equal(sepDebtors[0].student_id, s2.id);
    assert.equal(sepDebtors[0].debt, 500000);
    assert.equal(sepDebtors[0].total_paid, 200000);

    // 2. October 2026 check: 1 debtor (s1), debt = 400,000, paid = 100,000
    const octRes = await fetch(`${ctx.baseUrl}/api/reports/debtors?month=2026-10`);
    assert.equal(octRes.status, 200);
    const octDebtors = await octRes.json();
    assert.equal(octDebtors.length, 1);
    assert.equal(octDebtors[0].student_id, s1.id);
    assert.equal(octDebtors[0].debt, 400000);
    assert.equal(octDebtors[0].total_paid, 100000);

    // 3. November 2026 check: 2 debtors (s1 debt 250k, s2 debt 350k), total debt = 600,000, paid = 600,000
    const novRes = await fetch(`${ctx.baseUrl}/api/reports/debtors?month=2026-11`);
    assert.equal(novRes.status, 200);
    const novDebtors = await novRes.json();
    assert.equal(novDebtors.length, 2);
    const novDebtTotal = novDebtors.reduce((sum, d) => sum + d.debt, 0);
    const novPaidTotal = novDebtors.reduce((sum, d) => sum + d.total_paid, 0);
    assert.equal(novDebtTotal, 600000);
    assert.equal(novPaidTotal, 600000);

    // 4. December 2026 check: 2 debtors (s1 debt 500k, s2 debt 550k), total debt = 1,050,000, paid = 150,000
    const decRes = await fetch(`${ctx.baseUrl}/api/reports/debtors?month=2026-12`);
    assert.equal(decRes.status, 200);
    const decDebtors = await decRes.json();
    assert.equal(decDebtors.length, 2);
    const decDebtTotal = decDebtors.reduce((sum, d) => sum + d.debt, 0);
    const decPaidTotal = decDebtors.reduce((sum, d) => sum + d.total_paid, 0);
    assert.equal(decDebtTotal, 1050000);
    assert.equal(decPaidTotal, 150000);

    // Verify all four months are strictly independent with distinct totals
    const debtTotals = [
      sepDebtors.reduce((s, d) => s + d.debt, 0),
      octDebtors.reduce((s, d) => s + d.debt, 0),
      novDebtTotal,
      decDebtTotal
    ];
    assert.deepEqual(debtTotals, [500000, 400000, 600000, 1050000]);

    const paidTotals = [
      sepDebtors.reduce((s, d) => s + d.total_paid, 0),
      octDebtors.reduce((s, d) => s + d.total_paid, 0),
      novPaidTotal,
      decPaidTotal
    ];
    assert.deepEqual(paidTotals, [200000, 100000, 600000, 150000]);
  });

  await t.test('Financial payment semantics: payments attributed strictly by payment_date in calendar month', async () => {
    // Current fee is read from students table (s.monthly_fee)
    // Payments are summed strictly where payment_date >= startOfMonth AND payment_date <= endOfMonth
    // Excess payments in prior months (or future months) never roll over to another month
    const debtorsStmt = getMonthlyDebtors(ctx.db, '2026-10');
    assert.equal(debtorsStmt.length, 1);
    assert.equal(debtorsStmt[0].student_id, s1.id);
    assert.equal(debtorsStmt[0].monthly_fee, 500000);
    assert.equal(debtorsStmt[0].total_paid, 100000);
    assert.equal(debtorsStmt[0].debt, 400000);
  });

  await t.test('Top-level GET /debtors?month=YYYY-MM works identically to /api/reports/debtors', async () => {
    const res = await fetch(`${ctx.baseUrl}/debtors?month=2026-09`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.length, 1);
    assert.equal(data[0].student_id, s2.id);
  });

  await t.test('Month with no payments shows all fee-paying students as debtors with full fee', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/reports/debtors?month=2026-01`);
    assert.equal(res.status, 200);
    const debtors = await res.json();
    assert.equal(debtors.length, 2); // s1 and s2, s3 has fee 0
    const totalDebt = debtors.reduce((sum, d) => sum + d.debt, 0);
    assert.equal(totalDebt, 1200000); // 500,000 + 700,000
    assert.ok(debtors.every((d) => d.total_paid === 0));
  });

  await t.test('Month where all students paid returns empty array (zero debtors)', async () => {
    // In August 2026 (2026-08), both s1 and s2 pay their full fee
    createPayment(ctx.db, { student_id: s1.id, amount: 500000, payment_date: '2026-08-01' });
    createPayment(ctx.db, { student_id: s2.id, amount: 700000, payment_date: '2026-08-15' });

    const res = await fetch(`${ctx.baseUrl}/api/reports/debtors?month=2026-08`);
    assert.equal(res.status, 200);
    const debtors = await res.json();
    assert.deepEqual(debtors, []);
  });

  await t.test('Invalid or missing month parameter returns 400 Bad Request', async () => {
    const missingRes = await fetch(`${ctx.baseUrl}/api/reports/debtors`);
    assert.equal(missingRes.status, 400);

    const invalidMonthRes = await fetch(`${ctx.baseUrl}/api/reports/debtors?month=2026-13`);
    assert.equal(invalidMonthRes.status, 400);

    const notFormattedRes = await fetch(`${ctx.baseUrl}/api/reports/debtors?month=October`);
    assert.equal(notFormattedRes.status, 400);
  });
});

test('Annual Financial Report API & Calculation Suite', async (t) => {
  const ctx = createTestContext();
  t.after(() => ctx.close());

  const s1 = createStudent(ctx.db, { full_name: 'Talaba Bir', monthly_fee: 600000 });
  const s2 = createStudent(ctx.db, { full_name: 'Talaba Ikki', monthly_fee: 400000 });

  // Record payments across 2026
  // March: s1 pays 600,000
  createPayment(ctx.db, { student_id: s1.id, amount: 600000, payment_date: '2026-03-15' });
  // July: s1 pays 300,000, s2 pays 400,000
  createPayment(ctx.db, { student_id: s1.id, amount: 300000, payment_date: '2026-07-10' });
  createPayment(ctx.db, { student_id: s2.id, amount: 400000, payment_date: '2026-07-22' });
  // November: s2 pays 200,000
  createPayment(ctx.db, { student_id: s2.id, amount: 200000, payment_date: '2026-11-05' });

  // Record payment in 2025 (should NOT count in 2026)
  createPayment(ctx.db, { student_id: s1.id, amount: 600000, payment_date: '2025-12-25' });

  await t.test('Annual report calculates exact totals and returns all 12 months', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/reports/annual?year=2026`);
    assert.equal(res.status, 200);
    assert.ok(res.headers.get('cache-control')?.includes('no-store'));
    const report = await res.json();

    assert.equal(report.year, 2026);
    // 2026 payments: 600,000 + 300,000 + 400,000 + 200,000 = 1,500,000
    assert.equal(report.total_collected, 1500000);
    assert.equal(report.payment_count, 4);
    assert.equal(report.paying_student_count, 2);
    assert.equal(report.active_students_count, 2);

    // Exactly 12 months in chronological order
    assert.equal(report.months.length, 12);
    assert.equal(report.months[0].month, '2026-01');
    assert.equal(report.months[0].month_name, 'Yanvar');
    assert.equal(report.months[11].month, '2026-12');
    assert.equal(report.months[11].month_name, 'Dekabr');

    // March check (month_index = 3)
    const march = report.months[2];
    assert.equal(march.month, '2026-03');
    assert.equal(march.total_collected, 600000);
    assert.equal(march.payment_count, 1);
    assert.equal(march.paying_student_count, 1);
    assert.equal(march.debtor_count, 1); // s2 paid 0, so owes 400,000
    assert.equal(march.total_debt, 400000);

    // July check (month_index = 7)
    const july = report.months[6];
    assert.equal(july.month, '2026-07');
    assert.equal(july.total_collected, 700000); // 300,000 + 400,000
    assert.equal(july.payment_count, 2);
    assert.equal(july.paying_student_count, 2);
    assert.equal(july.debtor_count, 1); // s1 paid 300k of 600k (debt 300k)
    assert.equal(july.total_debt, 300000);

    // Zero-activity month check (January 2026)
    const jan = report.months[0];
    assert.equal(jan.total_collected, 0);
    assert.equal(jan.payment_count, 0);
    assert.equal(jan.paying_student_count, 0);
    assert.equal(jan.debtor_count, 2);
    assert.equal(jan.total_debt, 1000000); // 600k + 400k

    // Sum of monthly collections must exactly equal year total
    const sumMonthlyCollected = report.months.reduce((acc, m) => acc + m.total_collected, 0);
    assert.equal(sumMonthlyCollected, report.total_collected);
  });

  await t.test('Previous year query (2025) reflects only 2025 payments', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/reports/annual?year=2025`);
    assert.equal(res.status, 200);
    const report = await res.json();
    assert.equal(report.year, 2025);
    assert.equal(report.total_collected, 600000);
    assert.equal(report.payment_count, 1);
    assert.equal(report.paying_student_count, 1);
  });

  await t.test('Future year query (2030) reflects zero payments gracefully without error', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/reports/annual?year=2030`);
    assert.equal(res.status, 200);
    const report = await res.json();
    assert.equal(report.year, 2030);
    assert.equal(report.total_collected, 0);
    assert.equal(report.payment_count, 0);
    assert.equal(report.paying_student_count, 0);
    assert.equal(report.months.length, 12);
    assert.ok(report.months.every((m) => m.total_collected === 0));
  });

  await t.test('Invalid or missing year parameter returns 400 Bad Request', async () => {
    const missingRes = await fetch(`${ctx.baseUrl}/api/reports/annual`);
    assert.equal(missingRes.status, 400);

    const invalidYearRes = await fetch(`${ctx.baseUrl}/api/reports/annual?year=abcd`);
    assert.equal(invalidYearRes.status, 400);

    const outOfRangeRes = await fetch(`${ctx.baseUrl}/api/reports/annual?year=1800`);
    assert.equal(outOfRangeRes.status, 400);
  });
});
